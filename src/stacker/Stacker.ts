import { Repository, Commit } from "../shared/types";

type StackerRepositoryUpdateListener = (repo: Repository) => void;

/**
 * Updates the PR descriptions for all PRs related to `commit`.
 *
 * Implementation sketch (@manyaagarwal this is different from what we
 * discussed in the team call on 21 July):
 *
 * 1. Get PRs = union of the following sets of PRs:
 *    - Find merge-base with intended base branch (if we know what the base
 *    branch is. If we don't know it, we could just find the latest commit among
 *    the merge bases with all the long-lived branches from sttack.config.json).
 *    Find commit tree rooted at the merge-base commit, and get their PRs if
 *    present (let's just ignore commits without PRs).
 *    - PR descriptions from related landed PRs.
 *      - We find the earliest PR in the commit tree from the above stack.
 *      - Stack Attack should store the PR(s, but let's not support multiple
 *      dependencies just yet) that each stacked PR depends on in its description.
 *      - We can then traverse the PR descriptions to find all the landed PRs that
 *      the commit graph was stacked on.
 * 1. Update PR description (it needs to be able to display a tree of PRs).
 *
 * @returns Promise that resolves when operation is complete.
 */
// updatePRDescriptionsForCompleteTreeContainingCommit(
//   commit: Commit,
// ): Promise<void>;

// /**
//  * @param repoPath Path to repository root.
//  */
// constructor(
//   repoPath: string,
//   repositoryUpdateListener: StackerRepositoryUpdateListener,
//   vcsBackend: VCSBackend,
//   collaborationPlatform: CollaborationPlatform,
// ): Stacker;

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
