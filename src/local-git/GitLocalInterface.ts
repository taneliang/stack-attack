import {
  Commit,
  Repository,
  PullRequestInfo,
  NavigatorBackend,
} from "../NavigatorBackendType";
import nodegit from "nodegit";
import { getOctokit } from "../github-integration/authentication";

export class GitLocal implements NavigatorBackend {
  async getRepositoryInformation(
    repoPath: string,
  ): Promise<{ repo: Repository; remoteRepoInfoPromise: Promise<Repository> }> {
    const repo = await nodegit.Repository.open(repoPath);
    const repoStatus = await repo.getStatus();
    const refs = await repo.getReferences();
    const headHash = (await repo.getHeadCommit()).sha();
    const branchCommits = await Promise.all(
      refs.map(async (ref: nodegit.Reference) => repo.getBranchCommit(ref)),
    );
    const branchNames: string[] = refs.map((ref: nodegit.Reference) =>
      ref.name(),
    );
    const interestingCommit = branchCommits[0];
    let baseMostCommit = nodegit.Oid.fromString(interestingCommit.sha());
    if (branchCommits.length > 1) {
      baseMostCommit = await branchCommits.reduce(
        async (interestingCommit: Promise<nodegit.Oid>, branchCommit) => {
          const interestingCommitOid = await interestingCommit;
          const branchCommitOid = nodegit.Oid.fromString(branchCommit.sha());
          return nodegit.Merge.base(
            repo,
            interestingCommitOid,
            branchCommitOid,
          );
        },
        Promise.resolve(nodegit.Oid.fromString(interestingCommit.sha())),
      );
    }

    const baseCommitLookup = await nodegit.Commit.lookup(repo, baseMostCommit);
    const commitHashDict = new Map<string, Commit>();
    await Promise.all(
      refs.map((ref: nodegit.Reference) => {
        return new Promise(async (resolve, _) => {
          const history = (await repo.getBranchCommit(ref)).history();
          const branchName = ref.name();
          /**
           * Maps commit hashes to their childrens' commit hashes.
           *
           * Commit hash keys *are not* guaranteed to exist in `commitHashDict`.
           * Commit hashes in the sets *are* guaranteed to exist in
           * `commitHashDict` as we traverse from children to parents.
           */
          const commitChildrenMap = new Map<string, Set<string>>();
          let stopped = false;

          history.on("commit", async (nodegitCommit: nodegit.Commit) => {
            if (stopped) {
              return;
            }

            const sha = nodegitCommit.sha();

            // Create a commit before we do the check below as we need to await it
            // and we don't want the result of the check to be invalid if another
            // execution/event loop(?) sets it.
            const newCommit = await this.shaToCommit(sha, repo, branchName);

            // If the commit is already in `commitHashDict`, update the branch name and
            // stop because we have already processed it.
            if (commitHashDict.has(sha)) {
              commitHashDict.get(sha)?.branchNames.push(branchName);
              stopped = true;
              return;
            }

            // If not, the commit has not been seen before.

            // 1. Create the commit and add it to `commitHashDict`.
            commitHashDict.set(sha, newCommit);

            // 2. Build the relationships with the commit's children, which we
            // should have seen before.
            if (commitChildrenMap.has(sha)) {
              const childrenHashes = commitChildrenMap.get(sha)!;
              childrenHashes.forEach((childHash) => {
                const childCommit = commitHashDict.get(childHash)!;
                childCommit.parentCommits = [
                  ...new Set([...childCommit.parentCommits, newCommit]),
                ];
                newCommit.childCommits = [
                  ...new Set([...newCommit.childCommits, childCommit]),
                ];
              });
            }

            // 3. Update the commit's children.
            const parentHashes = nodegitCommit
              .parents()
              .map((parent) => parent.tostrS());
            parentHashes.forEach((parentHash) => {
              if (!commitChildrenMap.has(parentHash)) {
                commitChildrenMap.set(parentHash, new Set());
              }

              commitChildrenMap.get(parentHash)!.add(sha);
            });
          });

          history.on("end", () => resolve());
          history.start();
        });
      }),
    );
    const hasUncommittedChanges = repoStatus.length > 0;
    const rootDisplayCommit: Commit = {
      title: baseCommitLookup.summary(),
      hash: baseCommitLookup.sha(),
      timestamp: baseCommitLookup.date(),
      author: baseCommitLookup.author(),
      branchNames,
      pullRequestInfo: this.getPullRequestInfo(
        baseCommitLookup.author().name(),
        repo,
        baseCommitLookup.sha(),
      ),
      parentCommits: commitHashDict.get(baseCommitLookup.sha())?.parentCommits!,
      childCommits: commitHashDict.get(baseCommitLookup.sha())?.childCommits!,
    };

    return Promise.resolve({
      repo: {
        path: repoPath,
        hasUncommittedChanges,
        headHash,
        rootDisplayCommit,
      },
      remoteRepoInfoPromise: Promise.resolve({
        path: repoPath,
        hasUncommittedChanges,
        headHash,
        rootDisplayCommit,
      }),
    });

    // Const rootDisplayCommit = {
    //   title: baseCommitLookup.summary(),
    //   hash: baseCommitLookup.sha(),
    //   timestamp: baseCommitLookup.timeMs(),
    //   author: baseCommitLookup.author().toString(),
    //   branchNames: branchNames,
    // };

    // const history = (await repo.getHeadCommit()).history();
    // const childCommits: nodegit.Commit[] = [];
    // let child: Boolean = true;
    // history.on('commit', (commit: nodegit.Commit) => {
    //   commitHashDict.set(commit.sha(), commit);
    //   if (commit.sha() === baseCommitLookup.sha()) {
    //     child = false;
    //     return;
    //   }
    //   if (child) {
    //     childCommits.push(commit);
    //   } else {
    //     return;
    //   }
    // });
    // history.on('end', async (_: nodegit.Commit[]) => {
    //   // Checking if any file in the repository has changed
    // });

    // history.start();
  }

  async shaToCommit(
    sha: string,
    repo: nodegit.Repository,
    branchName: string,
  ): Promise<Commit> {
    const commit = await nodegit.Commit.lookup(repo, sha);
    return {
      title: commit.summary(),
      hash: commit.sha(),
      timestamp: commit.date(),
      author: commit.author(),
      branchNames: [branchName],
      pullRequestInfo: this.getPullRequestInfo(
        commit.author().toString(),
        repo,
        commit.sha(),
      ),
      parentCommits: [],
      childCommits: [],
    };
  }

  getPullRequestInfo(
    _: string,
    __: nodegit.Repository,
    ___: string,
  ): PullRequestInfo {
    return {
      url: "http://www.google.com",
      shortName: "google",
      isOutdated: true,
    };
  }

  // Actions
  async createOrUpdateBranchesForCommitStack(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    const repo = await nodegit.Repository.open(repoPath);
    for (const [i, element] of commitStack.entries()) {
      const commitMessage = "feature/new-branch"; // TODO: get the branch name from user
      const newBranchName = `${commitMessage}-${i}`; // Branch name is "commit message-branch number"
      element.branchNames.push(newBranchName);
      const commitTarget = await nodegit.Commit.lookup(repo, element.hash);
      await nodegit.Branch.create(repo, newBranchName, commitTarget, 1);
    }

    return commitStack;
  }

  // Actions: push to the origin repo
  pushCommitstoRepo(branchName: string, repoPath: string) {
    let repo: nodegit.Repository;
    let remote: nodegit.Remote;
    // Local repo
    return nodegit.Repository.open(repoPath)
      .then(function (repoResult) {
        repo = repoResult;
        // Get the origin repo
        return repo.getRemote("origin");
      })
      .then(function (remoteResult) {
        console.log("Remote loaded");
        remote = remoteResult;

        // Configure and connect the remote repo
        return remote.connect(nodegit.Enums.DIRECTION.PUSH, {
          credentials(userName: string) {
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

  async rebaseCommits(
    repoPath: string,
    rootCommit: Commit,
    targetCommit: Commit,
  ): Promise<Commit> {
    const repo = await nodegit.Repository.open(repoPath);
    const targetCommitLookup: nodegit.Commit = await nodegit.Commit.lookup(
      repo,
      nodegit.Oid.fromString(targetCommit.hash),
    );
    const rootCommitLookup: nodegit.Commit = await nodegit.Commit.lookup(
      repo,
      nodegit.Oid.fromString(rootCommit.hash),
    );
    // 1. Rebase each child Commit of the root commit on the target commit
    // (I'm assuming git reset --HARD needs to be done in the case of having multiple branch names??)
    // 2. Add the children of each child to a queue
    // 3. Iterate 1->2 till queue is empty
    const commitQueue: Commit[] = [rootCommit];
    let stackAttackCommit = rootCommit;
    let commitToRebase = targetCommitLookup;
    while (!(commitQueue.length === 0)) {
      const childCommit = commitQueue.splice(0, 1)[0];
      const childCommitLookup: nodegit.Commit = await nodegit.Commit.lookup(
        repo,
        nodegit.Oid.fromString(childCommit.hash),
      );
      // Rebase each child commit on target Commit - TODO: GET HELP - Can use CherryPick
      // Using CherryPick
      const status = nodegit.Cherrypick.commit(
        repo,
        commitToRebase,
        childCommitLookup,
        0,
        {},
      );
      // Can have multiple names so, git reset HARD :check:
      childCommit.branchNames.map(async (branchName: string) => {
        // Target Commit Lookup will change if we use CherryPick
        const reference = await nodegit.Branch.create(
          repo,
          branchName,
          targetCommitLookup,
          1,
        );
      });
      commitToRebase = childCommitLookup;
      stackAttackCommit = childCommit;
    }

    return Promise.resolve(stackAttackCommit);
  }

  amendAndRebaseDependentTree(repoPath: string): Promise<Commit> {
    return Promise.reject("NOT IMPLEMENTED");
  }

  // Octokit.pulls.create({owner, repo, title, head, base, body, maintainer_can_modify, draft});
  async createOrUpdatePRsForCommits(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    // Create branch for each commit
    commitStack = await this.createOrUpdateBranchesForCommitStack(
      repoPath,
      commitStack,
    );

    // Get information for octokit.pulls.create()
    const repoResult = await nodegit.Repository.open(repoPath);
    const remoteResult = await repoResult.getRemote("origin");
    const remoteURL = await remoteResult.url();
    // Sample URL: "https://github.com/taneliang/stack-attack"
    const repoName = remoteURL.split("/").pop() ?? "invalid repo";
    const owner = remoteURL.split("/")[3];
    const octokit = getOctokit(repoPath);
    // For each commit/branch in the stack
    for (let i = 0; i < commitStack.length; i++) {
      const lastIndex = commitStack[i].branchNames.length - 1;
      const branchName = commitStack[i].branchNames[lastIndex];

      // Push the commits to that branch on the remote repository
      await this.pushCommitstoRepo(branchName, repoPath);

      // Find the base branch
      let baseName: string;
      if (i === 0) baseName = "master";
      else {
        const lastIndexofLastCommit = commitStack[i - 1].branchNames.length - 1;
        baseName = commitStack[i - 1].branchNames[lastIndexofLastCommit];
      }

      // Create PR for that branch
      await octokit.pulls.create({
        owner,
        repo: repoName,
        title: commitStack[i].title,
        head: branchName,
        base: baseName, // TODO: ask the user the base
        body: commitStack[i].title, // TODO: description for PR
        maintainer_can_modify: true,
        draft: true, // Draft PR default
      });
    }

    return commitStack;
  }
}
