import type { Repository, Commit } from "../shared/types";

export type SourceControlRepositoryUpdateListener = (repo: Repository) => void;

/**
 * A backend that integrates Stack Attack with a source control management
 * system (e.g. Git or Mercurial).
 */
export interface SourceControl {
  repositoryUpdateListener: SourceControlRepositoryUpdateListener;

  /**
   * Asynchronously gets repository information from these 2 sources:
   * 1. Existing data from the local working copy.
   * 2. Data from the local working copy after fetching data from the remote
   * repository (e.g. `git fetch`).
   *
   * Likely calls `repositoryUpdateListener` multiple times when known data
   * changes.
   */
  loadRepositoryInformation(): void;

  /**
   * Uproot a commit tree and rebase it onto `targetCommit`.
   *
   * Calls `repositoryUpdateListener` on success.
   *
   * @param rebaseRootCommit The commit tree root to be moved.
   * @param targetCommit The commit the tree should be rebased on.
   * @returns Promise that resolves when operation is complete.
   */
  rebaseCommits(rebaseRootCommit: string, targetCommit: string): Promise<void>;

  pushCommit(commit: Commit): Promise<void>;
  pushCommitsForCommitTreeRootedAtCommit(commit: Commit): Promise<void>;

  /**
   * Turn random commits into Stack Attack-managed commits by attaching Stack
   * Attack branches to them. Commits that already have Stack Attack branches
   * will not be modified.
   *
   * Calls `repositoryUpdateListener` if any commits are updated.
   *
   * @param commits The commits to attach Stack Attack branches to.
   * @returns Promise that resolves when operation is complete.
   */
  attachSttackBranchesToCommits(commits: Commit[]): Promise<void>;
}
