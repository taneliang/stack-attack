import type {
  BranchName,
  Commit,
  PullRequestID,
  PullRequestInfo,
} from "../shared/types";
import type { CollaborationPlatform } from "./CollaborationPlatform";

export class GitHubCollaborationPlatform implements CollaborationPlatform {
  private repoPath: string;

  /**
   * @param repoPath Path to repository root.
   */
  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async getPRForCommit(commit: Commit): Promise<PullRequestInfo | null> {
    // TODO: Implement
    return null;
  }

  async getPR(prNumber: PullRequestID): Promise<PullRequestInfo | null> {
    // TODO: Implement
    return null;
  }

  async createOrUpdatePRForCommits(
    commitBranchPairs: { commit: Commit; branch: BranchName }[],
  ): Promise<Commit[]> {
    // TODO: Implement
    return [];
  }

  async updatePRDescriptionsForCommitGraph(
    commitPrInfoPairs: { commit?: Commit; prInfo: PullRequestInfo }[],
  ): Promise<void> {
    // TODO: Implement
  }
}
