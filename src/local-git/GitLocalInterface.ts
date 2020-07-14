import { Commit, Repository, NavigatorBackend } from "../NavigatorBackendType";
import nodegit from "nodegit";

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
  async pushCommitstoRepo(branchName: string, repoPath: string) {
    let repo: nodegit.Repository, remote: nodegit.Remote;
    //Local repo
    await nodegit.Repository.open(repoPath)
      .then(function (repoResult) {
        repo = repoResult;
        //get the origin repo
        return repo.getRemote("origin");
      })
      .then(function (remoteResult) {
        console.log("Remote loaded");
        const remote = remoteResult;

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
  createOrUpdatePRsForCommits(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    return Promise.reject("NOT IMPLEMENTED");
  }
}
