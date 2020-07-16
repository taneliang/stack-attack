import { Repository, Commit, NavigatorBackend } from "../NavigatorBackendType";
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
  backend: NavigatorBackend;
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
    backend: NavigatorBackend;
    repository: Repository;
  };
};
type KeyAction = {
  type: "key";
  payload: {
    key: string;
    dispatch: React.Dispatch<Action>;
  };
};
type Action = InitializeAction | KeyAction;

function backendCommitGraphToDisplayCommits(
  backendRootCommit: Commit,
): DisplayCommit[] {
  const tops = [backendRootCommit];
  const displayCommits: DisplayCommit[] = [];
  const commitDepths = new Map<string, number>();

  // Assume commits are a DAG
  // TODO: Break on infinite loop
  while (tops.length > 0) {
    const totalDepth = tops.length;

    tops.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
    const [commit] = tops.splice(0, 1);

    let commitDepth = 0;
    let hasFork = false;
    if (commit.parentCommits.length === 0) {
      // Root commit, no parents
      commitDepth = 0;
    } else if (commit.parentCommits.length === 1) {
      // Regular commit
      const [parent] = commit.parentCommits;
      if (parent.childCommits.length === 0) {
        console.error(
          `Commit ${commit.hash} has a parent that does not have children!`,
        );
        commitDepth = 0;
      } else if (parent.childCommits.length === 1) {
        // Regular commit, use parent's depth
        commitDepth = commitDepths.get(parent.hash) ?? 0;
      } else if (parent.childCommits.length > 1) {
        // Use parent's depth + depth based on whether we're earlier or later.
        const diffFromParentDepth = parent.childCommits
          // Earlier commits have higher depth
          .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
          .indexOf(commit);
        commitDepth =
          diffFromParentDepth + (commitDepths.get(parent.hash) ?? 0);
        if (diffFromParentDepth > 0) {
          hasFork = true;
        }
      }
    } else if (commit.parentCommits.length > 1) {
      // Merge commit
      // TODO: handle merge commit
      commitDepth = 1;
    }

    commitDepths.set(commit.hash, commitDepth);

    displayCommits.push({
      commit,

      totalDepth,
      commitDepth,
      hasFork,

      isFocused: false,
      isHighlightedAsPartOfStack: false,
      isBeingMoved: false,
    });
    tops.push(...commit.childCommits);
  }

  return displayCommits;
}

function initializedState(
  backend: NavigatorBackend,
  repository: Repository,
): State {
  return stateForNormalMode({
    ...initialState,
    backend,
    repository,
    commits: backendCommitGraphToDisplayCommits(repository.rootDisplayCommit),
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
          handler(state, { payload: { dispatch } }) {
            const { commits, backend, repository } = state;

            const focusedCommitIndex = indexOfFocusedCommit(commits);
            // Bail if no focus
            if (focusedCommitIndex === -1) {
              return state;
            }

            const stackBase = commits[focusedCommitIndex].commit;

            backend
              .createOrUpdatePRsForCommits(repository.path, [stackBase])
              .then(() =>
                dispatch({
                  type: "initialize",
                  payload: { backend, repository },
                }),
              );
            return state;
          },
        },
      ],
      [
        "s",
        {
          key: "s",
          name: "PR stack",
          handler(state, { payload: { dispatch } }) {
            const { commits, backend, repository } = state;

            const focusedCommitIndex = indexOfFocusedCommit(commits);
            // Bail if no focus
            if (focusedCommitIndex === -1) {
              return state;
            }

            const stackBase = commits[focusedCommitIndex].commit;

            // Traverse tree to build commit stack
            const stack = [];
            const nextCommits = [stackBase];
            while (nextCommits.length) {
              const nextCommit = nextCommits.pop()!;
              stack.push(nextCommit);
              nextCommits.push(...nextCommit.childCommits);
            }

            backend
              .createOrUpdatePRsForCommits(repository.path, stack)
              .then(() =>
                dispatch({
                  type: "initialize",
                  payload: { backend, repository },
                }),
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

  const originalRebaseRootParent = rebaseRoot.commit.parentCommits[0];

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

    const parentHash = parentCommits[0].hash;
    if (!movingHashes.has(parentHash)) {
      return displayCommit;
    }

    movingHashes.add(hash);
    return {
      ...displayCommit,
      isBeingMoved: true,
    };
  });

  // Move focus to originalRebaseRootParent
  newCommits = commitsWithMovedFocus(newCommits, () => {
    const originalRebaseRootParentHash = originalRebaseRootParent.hash;
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
          handler(state, { payload: { dispatch } }) {
            if (state.modeState.type !== "rebase") {
              return state;
            }

            const {
              commits,
              backend,
              repository,
              modeState: { rebaseRoot },
            } = state;

            const focusedCommitIndex = indexOfFocusedCommit(commits);
            // Bail if no focus
            if (focusedCommitIndex === -1) {
              return stateForNormalMode(state);
            }

            const rebaseTarget = commits[focusedCommitIndex];

            backend
              .rebaseCommits(
                repository.path,
                rebaseRoot.commit,
                rebaseTarget.commit,
              )
              .then(() =>
                dispatch({
                  type: "initialize",
                  payload: { backend, repository },
                }),
              );
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
        action.payload.backend,
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
  backend: NavigatorBackend,
  repository: Repository,
): [State, React.Dispatch<Action>] {
  const [state, dispatch] = useReducer(reducer, {}, () =>
    initializedState(backend, repository),
  );

  useEffect(() => {
    dispatch({ type: "initialize", payload: { backend, repository } });
  }, [repository]);

  return [state, dispatch];
}
