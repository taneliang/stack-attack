import { Commit, Repository, NavigatorBackend } from "../NavigatorBackendType";
const nodegit = require("nodegit");

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
    try {
      const repo = this.getRepositoryInformation(repoPath);
      for (let i = 0; i < commitStack.length; i++) {
        const commitMessage = commitStack[i].title.replace(" ", "-"); //first word of the commit message's line
        const newBranchName = `${commitMessage}-${i}`; //branch name is commit message -
        commitStack[i].branchNames.push(newBranchName);
        //Branch.create(repo, branch_name, target, force)
        await nodegit.Branch.create(repo, newBranchName, commitStack[i], 1);
      }
      return commitStack;
    } catch (e) {
      throw new Error(e.message);
    }
  }
  //Actions
  async pushCommitstoRepo(commitSingle: Commit, repoPath: string) {
    try {
      const repo = this.getRepositoryInformation(repoPath);
      const tree = await nodegit.Commit.getTree(); //TODO: save the tree in the commit
      //Commit.create(repo, update_ref, author, committer, message_encoding, message, tree, parent_count, parents)
      return await nodegit.Commit.create(
        repo,
        null,
        commitSingle.author,
        commitSingle.timestamp,
        "UTF-8",
        commitSingle.title,
        tree,
        commitSingle.parentCommits.length,
        commitSingle.parentCommits,
      );
    } catch (e) {
      throw new Error(e.message);
    }
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
