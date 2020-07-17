/**
 * Stores the view models and interface types between the UI layer and its
 * backend.
 */
import nodegit from "nodegit";
/**
 * A GitHub Pull Request, GitLab Merge Request, or similar.
 */
export interface PullRequestInfo {
  url: string;
  title: string;

  isOutdated: boolean;
}

export interface Commit {
  title: string;
  hash: string;
  timestamp: Date;
  author: nodegit.Signature;
  branchNames: string[];
  pullRequestInfo?: PullRequestInfo | undefined;

  parentCommits: Commit[];
  childCommits: Commit[];
}

export interface Repository {
  path: string;
  hasUncommittedChanges: boolean;
  headHash: string;

  /** The earliest interesting commit. */
  rootDisplayCommit: Commit;
}

export type NavigatorBackend = {
  // Getters
  /**
   * Asynchronously gets repository information.
   * @param repoPath Path to repository root.
   * @returns Cached repository information, along with a promise that returns
   * the repository information updated with remote data (e.g. PRs).
   */
  getRepositoryInformation: (
    repoPath: string,
  ) => Promise<{
    repo: Repository;
    remoteRepoInfoPromise: Promise<Repository>;
  }>;

  // Actions
  createOrUpdateBranchesForCommitStack: (
    repoPath: string,
    commitStack: Commit[],
  ) => Promise<Commit[]>;

  /**
   * Uproot a commit tree and rebase it onto `targetCommit`.
   * @param repoPath Path to repository root.
   * @param rootCommit The commit tree root to be moved.
   * @param targetCommit The commit the tree should be rebased on.
   * @returns Updated `targetCommit`.
   */
  rebaseCommits: (
    repoPath: string,
    rootCommit: Commit,
    targetCommit: Commit,
  ) => Promise<Commit>;

  /**
   * Amend the checked-out commit with the staged changes, then rebase this
   * commit's dependents onto the ammended commit.
   * @param repoPath Path to repository root.
   */
  amendAndRebaseDependentTree: (repoPath: string) => Promise<Commit>;

  createOrUpdatePRsForCommits: (
    repoPath: string,
    commitStack: Commit[],
  ) => Promise<Commit[]>;
};
