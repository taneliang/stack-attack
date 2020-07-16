import { Commit, Repository, NavigatorBackend } from "../NavigatorBackendType";
import nodegit from "nodegit";
import { getOctokit } from "../github-integration/authentication";

export class GitLocal implements NavigatorBackend {
  getRepositoryInformation(
    repoPath: string,
  ): Promise<{ repo: Repository; remoteRepoInfoPromise: Promise<Repository> }> {
    throw new Error("Method not implemented.");
  }

  //Actions
  async createOrUpdateBranchesForCommitStack(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    const repo = await nodegit.Repository.open(repoPath);
    for (let i = 0; i < commitStack.length; i++) {
      const commitMessage = "feature/new-branch"; //TODO: get the branch name from user
      const newBranchName = `${commitMessage}-${i}`; //branch name is "commit message-branch number"
      commitStack[i].branchNames.push(newBranchName);
      const commitTarget = await nodegit.Commit.lookup(
        repo,
        commitStack[i].hash,
      );
      await nodegit.Branch.create(repo, newBranchName, commitTarget, 1);
    }
    return commitStack;
  }

  //Actions: push to the origin repo
  pushCommitstoRepo(branchName: string, repoPath: string) {
    let repo: nodegit.Repository, remote: nodegit.Remote;
    //Local repo
    return nodegit.Repository.open(repoPath)
      .then(function (repoResult) {
        repo = repoResult;
        //get the origin repo
        return repo.getRemote("origin");
      })
      .then(function (remoteResult) {
        console.log("Remote loaded");
        remote = remoteResult;

        //Configure and connect the remote repo
        return remote.connect(nodegit.Enums.DIRECTION.PUSH, {
          credentials: function (userName: string) {
            return nodegit.Cred.sshKeyFromAgent(userName);
          },
        });
      })
      .then(function () {
        console.log("Remote Connected?", remote.connected());
        return remote.push([
          `refs/heads/${branchName}:refs/heads/${branchName}`,
        ]);
      })
      .then(function () {
        console.log("Remote Pushed!");
      })
      .catch(function (error) {
        console.log(error);
      });
  }
  rebaseCommits(
    repoPath: string,
    rootCommit: Commit,
    targetCommit: Commit,
  ): Promise<Commit> {
    return Promise.reject("NOT IMPLEMENTED");
  }
  amendAndRebaseDependentTree(repoPath: string): Promise<Commit> {
    return Promise.reject("NOT IMPLEMENTED");
  }
  //octokit.pulls.create({owner, repo, title, head, base, body, maintainer_can_modify, draft});
  async createOrUpdatePRsForCommits(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    //create branch for each commit
    commitStack = await this.createOrUpdateBranchesForCommitStack(
      repoPath,
      commitStack,
    );

    //get information for octokit.pulls.create()
    const repoResult = await nodegit.Repository.open(repoPath);
    const remoteResult = await repoResult.getRemote("origin");
    const remoteURL = await remoteResult.url();
    //sample URL: "https://github.com/taneliang/stack-attack"
    const repoName = remoteURL.split("/").pop() ?? "invalid repo";
    const owner = remoteURL.split("/")[3];
    const octokit = getOctokit(repoPath);
    //for each commit/branch in the stack
    for (let i = 0; i < commitStack.length; i++) {
      const lastIndex = commitStack[i].branchNames.length - 1;
      const branchName = commitStack[i].branchNames[lastIndex];

      //push the commits to that branch on the remote repository
      await this.pushCommitstoRepo(branchName, repoPath);

      //find the base branch
      let baseName: string;
      if (i === 0) baseName = "master";
      else {
        const lastIndexofLastCommit = commitStack[i - 1].branchNames.length - 1;
        baseName = commitStack[i - 1].branchNames[lastIndexofLastCommit];
      }
      //create PR for that branch
      await octokit.pulls.create({
        owner: owner,
        repo: repoName,
        title: commitStack[i].title,
        head: branchName,
        base: baseName, //TODO: ask the user the base
        body: commitStack[i].title, //TODO: description for PR
        maintainer_can_modify: true,
        draft: true, //draft PR default
      });
    }
    return commitStack;
  }
}
