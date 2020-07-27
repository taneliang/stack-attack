import type { Stacker } from "../stacker";
import type { Repository, Commit } from "../shared/types";

import { useReducer, useEffect } from "react";

export type DisplayCommit = {
  /** Backing commit */
  commit: Commit;

  // No. commits from left side of screen
  totalDepth: number;
  commitDepth: number;
  hasFork: boolean;

  isFocused: boolean;
  isHighlightedAsPartOfStack: boolean;
  isBeingMoved: boolean;
};

export type Command = {
  key: string;
  name: string;
  handler: (state: State, action: KeyAction) => State;
};

type NormalModeState = {
  type: "normal";
};
type RebaseModeState = {
  type: "rebase";
  rebaseRoot: DisplayCommit;
};

type State = {
  stacker: Stacker;
  repository: Repository;
  commits: DisplayCommit[];
  modeState: NormalModeState | RebaseModeState;
  keyboardCommands: Map<string, Command>;
};
const initialState: Pick<State, "modeState" | "keyboardCommands"> = {
  modeState: { type: "normal" },
  keyboardCommands: new Map(),
};

type InitializeAction = {
  type: "initialize";
  payload: {
    stacker: Stacker;
    repository: Repository;
  };
};
type KeyAction = {
  type: "key";
  payload: {
    key: string;
    dispatch: React.Dispatch<Action>;
    reload: () => void;
  };
};
type Action = InitializeAction | KeyAction;

function backendCommitGraphToDisplayCommits(
  repository: Repository,
  backendRootCommit: Commit,
): DisplayCommit[] {
  // Recursively build commit **tree**.
  // TODO: Don't use recursion!
  // TODO: Make this work with merge commits, i.e. build a commit graph instead of a tree.
  function displayCommitsForSubgraphRootedAtCommit(
    subgraphBackendRootCommit: Commit,
    depth: number,
    hasFork: boolean,
  ): DisplayCommit[] {
    const childCommits = subgraphBackendRootCommit.childCommits.map(
      (childCommitHash) => repository.commits[childCommitHash],
    );
    const sortedChildren = childCommits.sort((a, b) =>
      a.timestamp > b.timestamp ? 1 : -1,
    );
    const childDisplayCommits = sortedChildren.flatMap((child, index) => {
      const forkIndex = sortedChildren.length - index - 1;
      return displayCommitsForSubgraphRootedAtCommit(
        child,
        depth + forkIndex,
        forkIndex !== 0,
      );
    });

    return [
      {
        commit: subgraphBackendRootCommit,

        totalDepth: depth,
        commitDepth: depth - 1,
        hasFork,

        isFocused: false,
        isHighlightedAsPartOfStack: false,
        isBeingMoved: false,
      },
      ...childDisplayCommits,
    ];
  }
  return displayCommitsForSubgraphRootedAtCommit(backendRootCommit, 1, false);
}

function initializedState(stacker: Stacker, repository: Repository): State {
  return stateForNormalMode({
    ...initialState,
    stacker,
    repository,
    commits: backendCommitGraphToDisplayCommits(
      repository,
      repository.earliestInterestingCommit,
    ),
  });
}

function indexOfFocusedCommit(commits: Readonly<DisplayCommit[]>): number {
  return commits.findIndex(({ isFocused }) => isFocused);
}

function commitsWithAddedFocus(
  commits: Readonly<DisplayCommit[]>,
  focusIndex: number,
): DisplayCommit[] {
  if (focusIndex < 0) {
    return [...commits];
  }

  const newCommits = commits.slice();
  const commit: DisplayCommit = {
    ...newCommits[focusIndex],
    isFocused: true,
  };
  newCommits.splice(focusIndex, 1, commit);
  return newCommits;
}

function commitsWithRemovedFocus(
  commits: Readonly<DisplayCommit[]>,
  focusIndex: number,
): DisplayCommit[] {
  if (focusIndex < 0) {
    return [...commits];
  }

  const newCommits = commits.slice();
  const commit: DisplayCommit = {
    ...newCommits[focusIndex],
    isFocused: false,
  };
  newCommits.splice(focusIndex, 1, commit);
  return newCommits;
}

function commitsWithMovedFocus(
  commits: Readonly<DisplayCommit[]>,
  focusMover: (previousFocusIndex: number | undefined) => number,
): DisplayCommit[] {
  const existingFocusIndex = indexOfFocusedCommit(commits);
  const newCommits = commitsWithRemovedFocus(commits, existingFocusIndex);

  const newFocusIndex =
    focusMover(existingFocusIndex === -1 ? undefined : existingFocusIndex) %
    newCommits.length;
  return commitsWithAddedFocus(newCommits, newFocusIndex);
}

function stateForNormalMode(state: State): State {
  return {
    ...state,
    modeState: {
      type: "normal",
    },
    keyboardCommands: new Map([
      [
        "↑",
        {
          key: "↑",
          name: "next commit",
          handler: (state) => ({
            ...state,
            commits: commitsWithMovedFocus(state.commits, (focusIndex) =>
              focusIndex === undefined ? 0 : focusIndex + 1,
            ),
          }),
        },
      ],
      [
        "↓",
        {
          key: "↓",
          name: "previous commit",
          handler(state) {
            const numberCommits = state.commits.length;
            return {
              ...state,
              commits: commitsWithMovedFocus(
                state.commits,
                (focusIndex) =>
                  (focusIndex ?? numberCommits) - 1 + numberCommits,
              ),
            };
          },
        },
      ],
      [
        "r",
        {
          key: "r",
          name: "begin rebase",
          handler(state) {
            return stateForRebaseMode(state);
          },
        },
      ],
      [
        "c",
        {
          key: "c",
          name: "PR single commit",
          handler(state) {
            const { commits, stacker } = state;
            const focusedCommitIndex = indexOfFocusedCommit(commits);
            // Bail if no focus
            if (focusedCommitIndex === -1) {
              return state;
            }
            const stackBase = commits[focusedCommitIndex].commit;
            stacker.createOrUpdatePRContentsForSingleCommit(stackBase);
            return state;
          },
        },
      ],
      [
        "s",
        {
          key: "s",
          name: "PR stack",
          handler(state) {
            const { commits, stacker } = state;
            const focusedCommitIndex = indexOfFocusedCommit(commits);
            // Bail if no focus
            if (focusedCommitIndex === -1) {
              return state;
            }
            const stackBase = commits[focusedCommitIndex].commit;
            stacker.createOrUpdatePRContentsForCommitTreeRootedAtCommit(
              stackBase,
            );
            return state;
          },
        },
      ],
    ]),
  };
}

function stateForRebaseMode(state: State): State {
  const { commits } = state;

  const focusedCommitIndex = indexOfFocusedCommit(commits);
  // Bail if no focus
  if (focusedCommitIndex === -1) {
    return stateForNormalMode(state);
  }

  const rebaseRoot = commits[focusedCommitIndex];

  // Bail if commit has no parent or multiple parents
  // TODO: Figure out how to rebase merge commits and initial commits
  if (rebaseRoot.commit.parentCommits.length !== 1) {
    return stateForNormalMode(state);
  }

  const originalRebaseRootParentHash = rebaseRoot.commit.parentCommits[0];

  // Mark commits as being moved.
  // Loop from earliest to latest commit (assumes commits is sorted in ascending
  // order of timestamp), marking is moving if parent is being moved.
  // O(commits.length) time and space.
  const movingHashes = new Set([rebaseRoot.commit.hash]);
  let newCommits = commits.map((displayCommit) => {
    const { hash, parentCommits } = displayCommit.commit;
    if (hash === rebaseRoot.commit.hash) {
      return {
        ...displayCommit,
        isBeingMoved: true,
      };
    }

    // TODO: Handle merge commits; we currently just ignore them
    if (parentCommits.length !== 1) {
      return displayCommit;
    }

    const parentHash = parentCommits[0];
    if (!movingHashes.has(parentHash)) {
      return displayCommit;
    }

    movingHashes.add(hash);
    return {
      ...displayCommit,
      isBeingMoved: true,
    };
  });

  // Move focus to originalRebaseRootParentHash
  newCommits = commitsWithMovedFocus(newCommits, () => {
    // We know indexOfRebaseRootParent must not be -1 as we know the parent exists
    return newCommits.findIndex(
      ({ commit: { hash } }) => hash === originalRebaseRootParentHash,
    );
  });

  return {
    ...state,
    commits: newCommits,
    modeState: {
      type: "rebase",
      rebaseRoot,
    },
    keyboardCommands: new Map([
      [
        "↑",
        {
          key: "↑",
          name: "next rebase target",
          handler: (state) => ({
            ...state,
            commits: commitsWithMovedFocus(state.commits, (focusIndex) => {
              const numberCommits = state.commits.length;
              let proposedIndex = focusIndex ?? 0;
              let i = 0; // Prevents infinite loops
              do {
                proposedIndex = (proposedIndex + 1) % numberCommits;
                i++;
                if (i > numberCommits) {
                  return focusIndex ?? 0;
                }
              } while (state.commits[proposedIndex].isBeingMoved);

              return proposedIndex;
            }),
          }),
        },
      ],
      [
        "↓",
        {
          key: "↓",
          name: "previous rebase target",
          handler: (state) => ({
            ...state,
            commits: commitsWithMovedFocus(state.commits, (focusIndex) => {
              const numberCommits = state.commits.length;
              let proposedIndex = focusIndex ?? numberCommits;
              let i = 0; // Prevents infinite loops
              do {
                proposedIndex =
                  (proposedIndex - 1 + numberCommits) % numberCommits;
                i++;
                if (i > numberCommits) {
                  return focusIndex ?? 0;
                }
              } while (state.commits[proposedIndex].isBeingMoved);

              return proposedIndex;
            }),
          }),
        },
      ],
      [
        "a",
        {
          key: "a",
          name: "abort rebase",
          handler(state) {
            // Unmark commits as being moved
            const newState = {
              ...state,
              commits: state.commits.map((displayCommit) => {
                if (displayCommit.isBeingMoved) {
                  return {
                    ...displayCommit,
                    isBeingMoved: false,
                  };
                }

                return displayCommit;
              }),
            };
            return stateForNormalMode(newState);
          },
        },
      ],
      [
        "c",
        {
          key: "c",
          name: "confirm rebase",
          handler(state, { payload: { reload } }) {
            if (state.modeState.type !== "rebase") {
              return state;
            }

            const {
              commits,
              stacker,
              modeState: { rebaseRoot },
            } = state;

            const focusedCommitIndex = indexOfFocusedCommit(commits);
            // Bail if no focus
            if (focusedCommitIndex === -1) {
              return stateForNormalMode(state);
            }

            const rebaseTarget = commits[focusedCommitIndex];

            stacker
              .rebaseCommits(rebaseRoot.commit.hash, rebaseTarget.commit.hash)
              .then(() => reload());
            return state;
          },
        },
      ],
    ]),
  };
}

function reducer(state: Readonly<State>, action: Action): State {
  switch (action.type) {
    case "initialize": {
      return initializedState(
        action.payload.stacker,
        action.payload.repository,
      );
    }

    case "key": {
      const command = state.keyboardCommands.get(action.payload.key);
      if (!command) {
        return state;
      }

      return command.handler(state, action);
    }
  }
}

export function useInteractionReducer(
  stacker: Stacker,
  repository: Repository,
): [State, React.Dispatch<Action>] {
  const [state, dispatch] = useReducer(reducer, {}, () =>
    initializedState(stacker, repository),
  );

  useEffect(() => {
    dispatch({ type: "initialize", payload: { stacker, repository } });
  }, [repository]);

  return [state, dispatch];
}
