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
  private repoPath: string;
  private owner: string;
  private repo: string;
  /**
   * @param repoPath Path to repository root.
   */
  constructor(repoPath: string, owner: string, repo: string) {
    this.repoPath = repoPath;
    this.owner = owner;
    this.repo = repo;
  }
  private octokit = getOctokit(this.repoPath);

  async getPRForCommit(commit: Commit): Promise<PullRequestInfo | null> {
    const {
      data,
    } = await this.octokit.repos.listPullRequestsAssociatedWithCommit({
      owner: this.owner,
      repo: this.repo,
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
    commitBranchPairs: {
      commit: Commit;
      headBranch: BranchName;
      baseBranch: BranchName;
    }[],
  ): Promise<Commit[]> {
    let commitArr = new Array();
    commitBranchPairs.forEach(async (element) => {
      //If the commit has an existing PR, don't create one, but update title + base branch
      const prResult = await this.getPRForCommit(element.commit);
      if (prResult !== null) {
        await this.octokit.pulls.update({
          owner: this.owner,
          repo: this.repo,
          pull_number: prResult.number,
          title: element.commit.title,
          base: element.baseBranch,
        });
      }
      //Else if the commit doesn't have an existing PR, create one
      else {
        await this.octokit.pulls.create({
          owner: this.owner,
          repo: this.repo,
          title: element.commit.title,
          head: element.headBranch,
          base: element.baseBranch,
          maintainer_can_modify: true,
        });
      }
      commitArr.push(element.commit);
    });
    return commitArr;
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
