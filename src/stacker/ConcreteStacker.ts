import type { Commit, Repository } from "../shared/types";
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
    // TODO: Implement
  }

  async rebaseCommits(
    rebaseRootCommit: Commit,
    targetCommit: Commit,
  ): Promise<void> {
    // TODO: Implement
  }

  async createOrUpdatePRContentsForSingleCommit(commit: Commit): Promise<void> {
    // TODO: Implement
  }

  async createOrUpdatePRContentsForCommitTreeRootedAtCommit(
    commit: Commit,
  ): Promise<void> {
    // TODO: 1. Find all commits in the tree rooted at this commit.

    // Some old code from useInteractionReducer that gets a stack rooted at
    // `commit`s is below. It may be possible to update this to work with the
    // new `childCommit` hashes (as it used to be `Commit` objects) and also
    // adapt this to operate on trees.

    // const stack = [];
    // const nextCommits = [commit];
    // while (nextCommits.length) {
    //   const nextCommit = nextCommits.pop()!;
    //   stack.push(nextCommit);
    //   nextCommits.push(...nextCommit.childCommits);
    // }

    // TODO: 2. Create or update PRs for all these commits.

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
    // TODO: Implement
  }
}
