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
    // TODO: Find PR info to load Pr info
    // TODDO: SLoad PR info
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
    const stack = [];
    //TODO: Implement a complete version of the stack that start from the merge-base commit and also takes into consideration landed PRs
    const mergeBaseCommitHashes = await this.sourceControl.getMergeCommitByCommitHash(
      commit,
    ); //Question: what if the commit is on the same branch as the mergeBaseCommit?
    //Should one not be looking for a merge base commit then? Description update stopped working, reason? Did I fuck up something? 
    let parentCommitHashes = commit.parentCommits;
    let currentCommitHash = commit.hash; 
    let baseCommit;
    while (parentCommitHashes.length) {
      const parentCommitHash = parentCommitHashes.pop();
      const baseCommitHash = mergeBaseCommitHashes.find(
        (commitHash) => commitHash === parentCommitHash,
      );
      if (baseCommitHash) {
        baseCommit = await this.sourceControl.getCommitByHash(currentCommitHash);
        console.log("CURRENT COMMIT:", baseCommit);
        break;
      }
      if (parentCommitHash) {
        const parentCommit = await this.sourceControl.getCommitByHash(
          parentCommitHash,
        );
        if (parentCommit && parentCommit.parentCommits.length){
          parentCommitHashes = parentCommitHashes.concat(
            parentCommit.parentCommits,
          );
          currentCommitHash = parentCommit.hash;
        }
          
      }
    }
    const nextCommits = [baseCommit];
    while (nextCommits.length) {
      // Push commit onto stack
      console.log("NEXT COMMIT:", nextCommits);
      const nextCommit = nextCommits.pop()!;
      stack.push(nextCommit);

      // Find next commits
      const nullableChildCommits = await Promise.all(
        nextCommit.childCommits.map((commitHash) =>
          this.sourceControl.getCommitByHash(commitHash),
        ),
      );
      const childCommits = nullableChildCommits.map((commit) =>
        nullthrows(
          commit,
          "Commit must exist if we got the commit from the repository.",
        ),
      );
      nextCommits.push(...childCommits);
    }
    console.log("Stack: ", stack);

    const commitNullablePrInfoPairs = await Promise.all(
      stack.map(async (commit) => {
        const branchName = nullthrows(
          this.sourceControl.getSttackBranchForCommit(commit),
          "Violation of prerequisite: updatePRDescriptionsForCompleteTreeContainingCommit requires commits to have its Stack Attack branch already pushed to the remote.",
        );
        const prInfo = await this.collaborationPlatform.getPRForCommitByBranchName(
          commit.hash,
          branchName,
        );
        return { commit, prInfo };
      }),
    );
    const commitPrInfoPairs = commitNullablePrInfoPairs
      .filter(({ prInfo }) => !!prInfo) // Commits may not have PRs opened
      .map(({ commit, prInfo }) => ({
        commit,
        prInfo: nullthrows(prInfo, "null prInfo should have been filtered out"),
      }));

    return this.collaborationPlatform.updatePRDescriptionsForCommitGraph(
      commitPrInfoPairs,
    );
  }
}
