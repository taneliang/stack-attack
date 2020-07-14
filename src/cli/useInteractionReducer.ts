import { Repository, Commit } from "../NavigatorBackendType";
import { useReducer } from "react";

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

type State = {
  repository: Repository;
  commits: DisplayCommit[];
};
const initialState = {};

type MoveUpAction = {
  type: "move up";
};
type Action = MoveUpAction;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "move up": {
      return state;
    }
  }
}

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

export function useInteractionReducer(repository: Repository) {
  return useReducer(reducer, initialState, (partialState) => ({
    ...partialState,
    repository,
    commits: backendCommitGraphToDisplayCommits(repository.rootDisplayCommit),
  }));
}
