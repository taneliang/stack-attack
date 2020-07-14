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
      const newBranchName = `${commitMessage}-${i}`; //branch name is commit message - branch number
      commitStack[i].branchNames.push(newBranchName);
      //Commit.create(repo, update_ref, author, committer, message_encoding, message, tree, parent_count, parents)
      const commitTarget = await nodegit.Commit.lookup(
        repo,
        commitStack[i].hash,
      );
      await nodegit.Branch.create(repo, newBranchName, commitTarget, 1);
    }
    return commitStack;
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
