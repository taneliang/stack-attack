import type {
  Commit,
  Repository,
  CommitHash,
  PullRequestInfo,
  BranchName,
} from "../shared/types";
import type {
  SourceControl,
  SourceControlRepositoryUpdateListener,
} from "../source-control/SourceControl";
import type { CollaborationPlatform } from "../collaboration-platform/CollaborationPlatform";
import type { Stacker, StackerRepositoryUpdateListener } from "./Stacker";

/**
 * A concrete implementation of the Stacker interface.
 *
 * Uses the injected source control and collaboration platform to
 * create/update/manipulate stacked PRs and their backing commits/branches.
 */
export class ConcreteStacker implements Stacker {
  private repoPath: string;
  private collaborationPlatform: CollaborationPlatform;
  private sourceControl: SourceControl;

  repositoryUpdateListener: StackerRepositoryUpdateListener;

  private sourceControlRepositoryUpdateListener: SourceControlRepositoryUpdateListener = (
    repo: Repository,
  ) => {
    this.repositoryUpdateListener(repo);
  };

  constructor(
    repoPath: string,
    repositoryUpdateListener: StackerRepositoryUpdateListener,
    collaborationPlatform: CollaborationPlatform,
    sourceControlConstructor: (
      stackerListener: SourceControlRepositoryUpdateListener,
    ) => SourceControl,
  ) {
    this.repoPath = repoPath;
    this.repositoryUpdateListener = repositoryUpdateListener;
    this.collaborationPlatform = collaborationPlatform;
    this.sourceControl = sourceControlConstructor(
      this.sourceControlRepositoryUpdateListener.bind(this),
    );
  }

  loadRepositoryInformation(): void {
    return this.sourceControl.loadRepositoryInformation();
  }

  getCommitByHash(hash: CommitHash): Promise<Commit | null> {
    return this.sourceControl.getCommitByHash(hash);
  }

  rebaseCommits(rebaseRootCommit: Commit, targetCommit: Commit): Promise<void> {
    return this.sourceControl.rebaseCommits(rebaseRootCommit, targetCommit);
  }

  async createOrUpdatePRContentsForSingleCommit(commit: Commit): Promise<void> {
    const commitBranchPairs = await this.sourceControl.attachSttackBranchesToCommits(
      [commit],
    );
    const commitsWithMetaData: Array<{
      commit: Commit;
      headBranch: BranchName;
      baseBranch: BranchName;
    }> = [];
    commitBranchPairs.forEach((commitBranchPair) => {
      commitsWithMetaData.push({
        commit: commitBranchPair.commit,
        headBranch: commitBranchPair.sttackBranch,
        baseBranch: "master",
      });
    });
    const commits = this.collaborationPlatform.createOrUpdatePRForCommits(
      commitsWithMetaData,
    );
  }

  async createOrUpdatePRContentsForCommitTreeRootedAtCommit(
    commit: Commit,
  ): Promise<void> {
    // 1. Find all commits in the tree rooted at this commit.

    // Some old code from useInteractionReducer that gets a stack rooted at
    // `commit`s is below. It may be possible to update this to work with the
    // new `childCommit` hashes (as it used to be `Commit` objects) and also
    // adapt this to operate on trees.

    const stack = [];
    const nextCommits = [commit];
    while (nextCommits.length) {
      const nextCommit = nextCommits.pop()!;
      stack.push(nextCommit);
      const childCommits: Commit[] = [];
      nextCommit.childCommits.forEach((commitHash) => {
        const commit = this.sourceControl.getCommitByHash(commitHash);
      });
      nextCommits.push(...childCommits);
    }

    // 2. Create or update PRs for all these commits.
    const commitBranchPairs = await this.sourceControl.attachSttackBranchesToCommits(
      stack,
    );
    const commitsWithMetaData: Array<{
      commit: Commit;
      headBranch: BranchName;
      baseBranch: BranchName;
    }> = [];
    commitBranchPairs.forEach((commitBranchPair) => {
      commitsWithMetaData.push({
        commit: commitBranchPair.commit,
        headBranch: commitBranchPair.sttackBranch,
        baseBranch: "master",
      });
    });
    this.collaborationPlatform.createOrUpdatePRForCommits(commitsWithMetaData);
    // 3. Update PR descriptions for all stacked PRs related to this commit.
    await this.updatePRDescriptionsForCompleteTreeContainingCommit(commit);
  }

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
  private async updatePRDescriptionsForCompleteTreeContainingCommit(
    commit: Commit,
  ): Promise<void> {
    const stack = [];
    const nextCommits = [commit];
    while (nextCommits.length) {
      const nextCommit = nextCommits.pop()!;
      stack.push(nextCommit);
      const childCommits: Commit[] = [];
      nextCommit.childCommits.forEach((commitHash) => {
        this.sourceControl.getCommitByHash(commitHash);
      });
      nextCommits.push(...childCommits);
    }
    //TODO: Implement a complete version of the stack that start from the merge-base commit and also takes into consideration landed PRs
    let commitPrInfoPairs: { commit?: Commit; prInfo: PullRequestInfo }[] = [];
    stack.forEach(async (commit) => {
      let PRInfo = await this.collaborationPlatform.getPRForCommit(commit);
      if (PRInfo !== null) {
        commitPrInfoPairs.push({ commit: commit, prInfo: PRInfo });
      }
    });
    return this.collaborationPlatform.updatePRDescriptionsForCommitGraph(
      commitPrInfoPairs,
    );
  }
}
