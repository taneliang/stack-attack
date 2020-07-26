import type {
  BranchName,
  Commit,
  PullRequestID,
  PullRequestInfo,
} from "../shared/types";
import type { CollaborationPlatform } from "./CollaborationPlatform";
import { getOctokit } from "./OctokitAuth";
import nodegit from "nodegit";

async function repoPathToOwnerAndRepo(
  repoPath: string,
): Promise<{ owner: string; repo: string }> {
  const repoResult = await nodegit.Repository.open(repoPath);
  // TODO: Handle remotes that are not named "origin"
  const remoteResult = await repoResult.getRemote("origin");
  const remoteUrl = remoteResult.url();
  // Sample URLs:
  // "https://github.com/taneliang/stack-attack"
  // "git@github.com:taneliang/stack-attack.git"
  // "git@github.com:taneliang/hello.world"
  const [rawRepo, owner] = remoteUrl
    .split("/")
    .flatMap((s) => s.split(":"))
    .reverse();
  const repo = rawRepo.endsWith(".git")
    ? rawRepo.substr(0, rawRepo.length - 4)
    : rawRepo;
  return { owner, repo };
}

export class GitHubCollaborationPlatform implements CollaborationPlatform {
  private owner: string;
  private repo: string;
  private octokit = getOctokit(this.repoPath);

  /**
   * @param repoPath Path to repository root.
   */
  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async getPRForCommit(commit: Commit): Promise<PullRequestInfo | null> {
    const { owner, repo } = await repoPathToOwnerAndRepo(this.repoPath);
    try {
      const {
        data,
      } = await this.octokit.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: commit.hash,
      });
      const prResult = data[0];
      return {
        number: prResult.number,
        url: prResult.url,
        title: prResult.title,
        description: prResult.body,
        isOutdated: prResult.head.sha !== commit.hash,
      };
    } catch (e) {
      return null;
    }
  }

  async getPR(prNumber: PullRequestID): Promise<PullRequestInfo | null> {
    const owner = (await repoPathToOwnerAndRepo(this.repoPath)).owner;
    const repo = (await repoPathToOwnerAndRepo(this.repoPath)).repo;
    try {
      const { data: pullRequest } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      return {
        number: prNumber,
        url: pullRequest.url,
        title: pullRequest.title,
        description: pullRequest.body,
      };
    } catch (e) {
      return null;
    }
  }

  async createOrUpdatePRForCommits(
    commitBranchPairs: {
      commit: Commit;
      headBranch: BranchName;
      baseBranch: BranchName;
    }[],
  ): Promise<Commit[]> {
    let commitArr = new Array();
    const owner = (await repoPathToOwnerAndRepo(this.repoPath)).owner;
    const repo = (await repoPathToOwnerAndRepo(this.repoPath)).repo;
    commitBranchPairs.forEach(async (pair) => {
      //If the commit has an existing PR, don't create one, but update title + base branch
      const prResult = await this.getPRForCommit(pair.commit);
      if (prResult !== null) {
        await this.octokit.pulls.update({
          owner,
          repo,
          pull_number: prResult.number,
          title: pair.commit.title,
          base: pair.baseBranch,
        });
      }
      //Else if the commit doesn't have an existing PR, create one
      else {
        await this.octokit.pulls.create({
          owner,
          repo,
          title: pair.commit.title,
          head: pair.headBranch,
          base: pair.baseBranch,
          maintainer_can_modify: true,
        });
      }
      commitArr.push(pair.commit);
    });
    return commitArr;
  }

  async updatePRDescriptionsForCommitGraph(
    commitPrInfoPairs: { commit?: Commit; prInfo: PullRequestInfo }[],
  ): Promise<void> {
    const owner = (await repoPathToOwnerAndRepo(this.repoPath)).owner;
    const repo = (await repoPathToOwnerAndRepo(this.repoPath)).repo;
    // Get list of PRs
    const pullRequests = await Promise.all(
      commitPrInfoPairs.map(async ({ prInfo }) => {
        const prNumber = prInfo.number;
        const prResult = await this.octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });
        return prResult;
      }),
    );
    // Update PR descriptions
    await Promise.all(
      pullRequests.map((pullRequest, prIndex) => {
        let description =
          "Stack PR by [STACK ATTACK](https://github.com/taneliang/stack-attack):\n";
        description += pullRequests
          .map(({ data }, indexOfDescriptionPr) => {
            const starsOrNone = prIndex === indexOfDescriptionPr ? "**" : "";
            const number = data.number;
            const title = data.title;
            return `- ${starsOrNone}#${number} ${title}${starsOrNone}`;
          })
          .join("\n");

        return this.octokit.pulls.update({
          owner,
          repo,
          pull_number: pullRequest.data.number,
          body: description,
        });
      }),
    );
  }
}
