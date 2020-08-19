import type { Commit, Repository, CommitHash } from "../shared/types";
import type {
  SourceControl,
  SourceControlRepositoryUpdateListener,
} from "../source-control/SourceControl";
import type { CollaborationPlatform } from "../collaboration-platform/CollaborationPlatform";
import type { Stacker, StackerRepositoryUpdateListener } from "./Stacker";

import nullthrows from "nullthrows";

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

  async loadRepositoryInformation(): Promise<void> {
    await this.sourceControl.loadRepositoryInformation();
    // TODO: Find PR info to load PR info
    // TODO: Load PR info
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
      await Promise.all(
        nextCommit.childCommits.map(async (commitHash) => {
          const childCommit = await this.sourceControl.getCommitByHash(
            commitHash,
          );
          if (childCommit) childCommits.push(childCommit);
        }),
      );
      nextCommits.push(...childCommits);
    }

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
    const updatedCommits = await this.collaborationPlatform.createOrUpdatePRForCommits(
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
    // Perform *breadth*-first search to find root of the complete tree
    // containing `commit`. Search starts from `commit` and goes down the commit
    // graph. We stop when we reach the tree root, i.e. the first merge-base
    // commit between `commit` and any long-lived branch.
    const mergeBaseCommitHashes = await this.sourceControl.getMergeBasesWithLongLivedBranches(
      commit,
    );
    let nextParentCommitHashes: CommitHash[] = [...commit.parentCommits];
    let currentCommitHash = commit.hash;
    let treeRootCommit: Commit | null | undefined; // What we're searching for
    while (nextParentCommitHashes.length) {
      const [parentCommitHash] = nextParentCommitHashes.splice(0, 1);

      // Stop if we've found the tree root
      if (mergeBaseCommitHashes.includes(parentCommitHash)) {
        // The tree root is the child of this parent (because the parent is on
        // the base branch, it's not part of the tree to be updated).
        treeRootCommit = nullthrows(
          await this.sourceControl.getCommitByHash(currentCommitHash),
          `A tree root commit hash ${parentCommitHash} from sourceControl should have an actual backing commit`,
        );
        break;
      }

      const parentCommit = nullthrows(
        await this.sourceControl.getCommitByHash(parentCommitHash),
        `A parent commit hash ${parentCommitHash} from sourceControl should have an actual backing commit`,
      );
      nextParentCommitHashes = [
        ...nextParentCommitHashes,
        ...parentCommit.parentCommits,
      ];

      // FIXME: The following line of code causes this BFS to produce the wrong
      // tree root if `parentCommit`'s parent has multiple children.
      //
      // Take the following commit graph:
      // * A
      // |\
      // | * B
      // *   C
      //
      // Before the loop starts, the variables are initialized as such:
      // - nextParentCommitHashes = [B, C]
      // - currentCommitHash = A
      //
      // During the first iteration, before the following line of code is
      // executed:
      // - currentCommitHash = A
      // - parentCommit = B
      // - nextParentCommitHashes = [C]
      //
      // The following line of code will then set:
      // currentCommitHash = parentCommit = B
      //
      // The second iteration will thus have the following variables:
      // - currentCommitHash = B
      // - parentCommit = C (dequeued from nextParentCommitHashes)
      //
      // Because C is not a parent of B, we've violated our (implicitly assumed)
      // loop invariants (that parentCommit is a parent of currentCommitHash).
      // More practically, if C is on a long lived branch, this search will
      // output B as the tree root, when it should be A.
      currentCommitHash = parentCommit.hash;
    }

    // TODO: Figure out a way to handle the case when we reached the end of the
    // commit history without finding a tree root. Update everything?
    treeRootCommit = nullthrows(
      treeRootCommit,
      "A tree root could not be found!",
    );

    // Build the commit tree up from the tree root by *depth*-first search
    const linearCommitTree = []; // We don't care about the tree structure so we just store it as a list
    const nextCommits = [treeRootCommit];
    while (nextCommits.length) {
      // Push commit into tree
      const nextCommit = nextCommits.pop()!;
      linearCommitTree.push(nextCommit);

      // Find next commits
      const childCommits = await Promise.all(
        nextCommit.childCommits.map(async (commitHash) =>
          nullthrows(
            await this.sourceControl.getCommitByHash(commitHash),
            "Commit must exist as we got the commit from the repository.",
          ),
        ),
      );
      nextCommits.push(...childCommits);
    }

    // Get PRs to be updated
    const commitNullablePrInfoPairs = await Promise.all(
      linearCommitTree.map(async (commit) => {
        const branchName = this.sourceControl.getSttackBranchForCommit(commit);
        return {
          commit,
          prInfo: branchName
            ? await this.collaborationPlatform.getPRForCommitByBranchName(
                commit.hash,
                branchName,
              )
            : null,
        };
      }),
    );
    const commitPrInfoPairs = commitNullablePrInfoPairs
      .filter(({ prInfo }) => !!prInfo) // Commits may not have associated PRs
      .map(({ commit, prInfo }) => ({
        commit,
        prInfo: nullthrows(prInfo, "null prInfo should have been filtered out"),
      }));

    await this.collaborationPlatform.updatePRDescriptionsForCommitGraph(
      commitPrInfoPairs,
    );
  }
}
