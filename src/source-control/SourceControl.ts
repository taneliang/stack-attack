import type {
  Repository,
  Commit,
  CommitHash,
  BranchName,
} from "../shared/types";

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
   * Get a commit by its unique hash (or a unique prefix of its hash), or null
   * if one cannot be found.
   *
   * For example, if our repository had 2 commits with the hashes "abcdefghi"
   * and "abcdwxyz":
   *
   * - getCommitByHash("abcdefghi") -> Commit with exact hash "abcdefghi"
   * - getCommitByHash("abcde") -> Commit with hash "abcdefghi"
   * - getCommitByHash("abcd") -> null, since this prefix is not unique
   * - getCommitByHash("a") -> null
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
  attachSttackBranchesToCommits(
    commits: Commit[],
  ): Promise<Array<{ commit: Commit; sttackBranch: BranchName }>>;
}
