import type { Repository, Commit, CommitHash } from "../shared/types";

export type StackerRepositoryUpdateListener = (repo: Repository) => void;

/**
 * Orchestrates Stack Attack backend classes.
 */
export interface Stacker {
  repositoryUpdateListener: StackerRepositoryUpdateListener;

  /**
   * Asynchronously gets repository information from these 3 sources:
   * 1. Existing data from the local working copy.
   * 2. Data from the local working copy after fetching data from the remote
   * repository (e.g. `git fetch`).
   * 3. PR information.
   *
   * Likely calls `repositoryUpdateListener` multiple times when known data
   * changes.
   */
  loadRepositoryInformation(): void;

  /**
   * Get a commit by its hash.
   */
  getCommitByHash(hash: CommitHash): Promise<Commit | null>;

  /**
   * Uproot a commit tree and rebase it onto `targetCommit`.
   *
   * Calls `repositoryUpdateListener` on success.
   *
   * @param rebaseRootCommit The commit tree root to be moved.
   * @param targetCommit The commit the tree should be rebased on.
   * @returns Promise that resolves when operation is complete.
   */
  rebaseCommits(rebaseRootCommit: Commit, targetCommit: Commit): Promise<void>;

  /**
   * Given a single commit, create a PR for it or update the existing PR linked
   * to it.
   *
   * Calls `repositoryUpdateListener` if any data is updated.
   *
   * @param commit The commit to make a PR for.
   * @returns Promise that resolves when operation is complete.
   */
  createOrUpdatePRContentsForSingleCommit(commit: Commit): Promise<void>;

  /**
   * Given a commit:
   * 1. Find all commits in the tree rooted at this commit.
   * 2. Create or update PRs for all these commits.
   * 3. Update PR descriptions for all stacked PRs related to this commit.
   *
   * Calls `repositoryUpdateListener` if any data is updated.
   *
   * @param commits The commits to attach Stack Attack branches to.
   * @returns Promise that resolves when operation is complete.
   */
  createOrUpdatePRContentsForCommitTreeRootedAtCommit(
    commit: Commit,
  ): Promise<void>;
}
