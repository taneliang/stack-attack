import type {
  Commit,
  Repository,
  CommitHash,
  PullRequestInfo,
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
    this.sourceControl.loadRepositoryInformation();
  }

  getCommitByHash(hash: CommitHash): Promise<Commit | null> {
    return this.sourceControl.getCommitByHash(hash);
  }

  rebaseCommits(
    rebaseRootCommit: CommitHash,
    targetCommit: CommitHash,
  ): Promise<void> {
    return this.sourceControl.rebaseCommits(rebaseRootCommit, targetCommit);
  }

  async createOrUpdatePRContentsForSingleCommit(commit: Commit): Promise<void> {
    await this.pushCommitsAndCreateOrUpdateBarePR([commit]);
    await this.updatePRDescriptionsForCompleteTreeContainingCommit(commit);
  }

  async createOrUpdatePRContentsForCommitTreeRootedAtCommit(
    commit: Commit,
  ): Promise<void> {
    // Find all commits in the tree rooted at this commit.
    const stack: Commit[] = [];
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
    // COMBAK: WAS IST WRONG WITH DAS

    await this.pushCommitsAndCreateOrUpdateBarePR(stack);
    await this.updatePRDescriptionsForCompleteTreeContainingCommit(commit);
  }

  private async pushCommitsAndCreateOrUpdateBarePR(
    commits: Commit[],
  ): Promise<void> {
    // Push all the commits' Stack Attack branches
    const commitBranchPairs = await this.sourceControl.attachSttackBranchesToCommits(
      commits,
    );
    await Promise.all(
      commitBranchPairs.map(({ sttackBranch }) =>
        this.sourceControl.pushBranch(sttackBranch),
      ),
    );

    // Create or update PRs for all these commits.
    const commitsWithMetaData = commitBranchPairs.map((commitBranchPair) => ({
      commit: commitBranchPair.commit,
      headBranch: commitBranchPair.sttackBranch,
      baseBranch: "master", // TODO: Implement retrieval of base branch for a given commit
    }));
    const updatedCommits = this.collaborationPlatform.createOrUpdatePRForCommits(
      commitsWithMetaData,
    );
    // TODO: Pass updated commits back to GSC/our listener. Possible deeper
    // issue: GSC caches its own `repo` but we want to augment it with PR info.
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
    const commitPrInfoPairs: {
      commit?: Commit;
      prInfo: PullRequestInfo;
    }[] = [];
    await Promise.all(
      stack.map(async (commit) => {
        const prInfo = await this.collaborationPlatform.getPRForCommit(commit);
        if (prInfo) {
          commitPrInfoPairs.push({ commit, prInfo });
        }
      }),
    );
    return this.collaborationPlatform.updatePRDescriptionsForCommitGraph(
      commitPrInfoPairs,
    );
  }
}
