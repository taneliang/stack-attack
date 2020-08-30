import type { Octokit } from "@octokit/rest";

import type {
  BranchName,
  Commit,
  PullRequestID,
  PullRequestInfo,
  CommitHash,
} from "../shared/types";

import type { CollaborationPlatform } from "./CollaborationPlatform";
import { getOctokit } from "./OctokitAuth";

export class GitHubCollaborationPlatform implements CollaborationPlatform {
  private repoPath: string;
  private owner: string;
  private repo: string;
  private octokit: Octokit;

  /**
   * @param repoPath Path to repository root.
   */
  constructor(repoPath: string, owner: string, repo: string) {
    this.repoPath = repoPath;
    this.owner = owner;
    this.repo = repo;
    this.octokit = getOctokit(this.repoPath);
  }

  async getPRForCommit(commit: Commit): Promise<PullRequestInfo | null> {
    const {
      data,
    } = await this.octokit.repos.listPullRequestsAssociatedWithCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: commit.hash,
    });
    if (data.length === 0) {
      return null;
    }
    const prResult = data[0];
    return {
      number: prResult.number,
      url: prResult.url,
      title: prResult.title,
      description: prResult.body,
      isOutdated: prResult.head.sha !== commit.hash,
    };
  }

  async getPRForCommitByBranchName(
    commitHash: CommitHash,
    branchName: BranchName,
  ): Promise<PullRequestInfo | null> {
    // TODO: Make this more efficient; it's getting a list of _all_ the PRs
    const { data } = await this.octokit.pulls.list({
      owner: this.owner,
      repo: this.repo,
    });
    const prResult = data.find(
      (pullRequest) => pullRequest.head.ref === branchName,
    );
    if (prResult) {
      return {
        number: prResult.number,
        url: prResult.url,
        title: prResult.title,
        description: prResult.body,
        isOutdated: prResult.head.sha !== commitHash,
      };
    }
    return null;
  }

  async getPR(prNumber: PullRequestID): Promise<PullRequestInfo | null> {
    const { data: pullRequest } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return {
      number: prNumber,
      url: pullRequest.url,
      title: pullRequest.title,
      description: pullRequest.body,
    };
  }

  async createOrUpdatePRForCommits(
    commitsWithMetadata: {
      commit: Commit;
      headBranch: BranchName;
      baseBranch: BranchName;
    }[],
  ): Promise<Commit[]> {
    return Promise.all(
      commitsWithMetadata.map(async ({ commit, headBranch, baseBranch }) => {
        const existingPullRequest = await this.getPRForCommitByBranchName(
          commit.hash,
          headBranch,
        );

        if (existingPullRequest) {
          await this.octokit.pulls.update({
            owner: this.owner,
            repo: this.repo,
            pull_number: existingPullRequest.number,
            // Update the fields below
            title: commit.title,
            base: baseBranch,
          });
        } else {
          await this.octokit.pulls.create({
            owner: this.owner,
            repo: this.repo,
            title: commit.title,
            base: baseBranch,
            head: headBranch,
            maintainer_can_modify: true,
          });
        }

        // TODO: Update commit so that we can update the frontend
        return commit;
      }),
    );
  }

  async updatePRDescriptionsForCommitGraph(
    commitPrInfoPairs: { commit?: Commit; prInfo: PullRequestInfo }[],
  ): Promise<void> {
    await Promise.all(
      commitPrInfoPairs.map((pullRequest, prIndex) => {
        let description =
          "Stack PR by [STACK ATTACK](https://github.com/taneliang/stack-attack):\n";
        description += commitPrInfoPairs
          .map(({ prInfo }, indexOfDescriptionPr) => {
            const starsOrNone = prIndex === indexOfDescriptionPr ? "**" : "";
            return `- ${starsOrNone}#${prInfo.number} ${prInfo.title}${starsOrNone}`;
          })
          .join("\n");

        return this.octokit.pulls.update({
          owner: this.owner,
          repo: this.repo,
          pull_number: pullRequest.prInfo.number,
          body: description,
        });
      }),
    );
  }
}
