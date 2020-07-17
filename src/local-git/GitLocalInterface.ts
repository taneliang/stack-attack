import {
  Commit,
  Repository,
  PullRequestInfo,
  NavigatorBackend,
} from "../NavigatorBackendType";
import nodegit from "nodegit";
import { getOctokit } from "../github-integration/authentication";

function refIsLocal(refString: string) {
  return refString.startsWith("refs/heads/");
}

function localRefToBranchName(refString: string) {
  if (!refIsLocal(refString)) return refString;
  return refString.substr("refs/heads/".length);
}

function remoteUrlToOwnerAndRepo(
  remoteUrl: string,
): { owner: string; repo: string } {
  // Sample URLs:
  // "https://github.com/taneliang/stack-attack"
  // "git@github.com:taneliang/stack-attack.git"
  // "git@github.com:taneliang/hello.world"
  // TODO: Check if an owner/repo can contain "/" or ":"
  const [rawRepo, owner] = remoteUrl
    .split("/")
    .flatMap((s) => s.split(":"))
    .reverse();
  // TODO: Check if it's possible for a repo name to end with ".git"
  const repo = rawRepo.endsWith(".git")
    ? rawRepo.substr(0, rawRepo.length - 4)
    : rawRepo;
  return { owner, repo };
}

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

    // Compute the most recent common ancestor of all branches.
    const commonAncestorCommitOid = await branchCommits.reduce(
      async (
        interestingCommit: Promise<nodegit.Oid> | nodegit.Oid,
        branchCommit,
      ) => {
        const interestingCommitOid = await interestingCommit;
        const branchCommitOid = nodegit.Oid.fromString(branchCommit.sha());
        return nodegit.Merge.base(repo, interestingCommitOid, branchCommitOid);
      },
      nodegit.Oid.fromString(branchCommits[0].sha()),
    );

    // Find all commits and build children maps
    /**
     * Maps commit hashes to their childrens' commit hashes.
     *
     * This needs to exist as we can only retrieve a commit's parents, but we
     * actually want to build relationships with its children.
     *
     * Commit hash keys *are not* guaranteed to exist in `commitHashDict`.
     * Commit hashes in the sets *are* guaranteed to exist in
     * `commitHashDict` as we traverse from children to parents.
     */
    const commitChildrenMap = new Map<string, Set<string>>();
    const commitHashDict = new Map<string, Commit>();
    await Promise.all(
      refs.map((ref) => {
        return new Promise(async (resolve, _) => {
          const history = (await repo.getBranchCommit(ref)).history();
          let stopped = false;

          history.on("commit", (nodegitCommit: nodegit.Commit) => {
            if (stopped) {
              return;
            }
            const sha = nodegitCommit.sha();

            // If the commit is already in `commitHashDict`, stop because we
            // have already processed it.
            if (commitHashDict.has(sha)) {
              stopped = true;
              return;
            }

            // Create a new commit and add it to `commitHashDict`.
            const newCommit: Commit = {
              title: nodegitCommit.summary(),
              hash: sha,
              timestamp: nodegitCommit.date(),
              author: nodegitCommit.author(),
              branchNames: [],
              parentCommits: [],
              childCommits: [],
            };
            commitHashDict.set(sha, newCommit);

            // Update the commit's children.
            const parentHashes = nodegitCommit
              .parents()
              .map((parent) => parent.tostrS());
            parentHashes.forEach((parentHash) => {
              if (!commitChildrenMap.has(parentHash)) {
                commitChildrenMap.set(parentHash, new Set());
              }

              commitChildrenMap.get(parentHash)!.add(sha);
            });

            // Stop if this is the common ancestor commit
            if (nodegitCommit.id().equal(commonAncestorCommitOid)) {
              stopped = true;
            }
          });

          history.on("end", () => resolve());
          history.start();
        });
      }),
    );

    // Build relationships
    commitChildrenMap.forEach((childrenHashes, parentHash) => {
      const parentCommit = commitHashDict.get(parentHash);
      if (!parentCommit) {
        return;
      }
      childrenHashes.forEach((childHash) => {
        const childCommit = commitHashDict.get(childHash)!;
        childCommit.parentCommits = Array.from(
          new Set([...childCommit.parentCommits, parentCommit]),
        );
        parentCommit.childCommits = Array.from(
          new Set([...parentCommit.childCommits, childCommit]),
        );
      });
    });

    // Inject branch names
    refs.forEach((ref) => {
      const branchName = ref.name();
      const branchSha = ref.target().tostrS();
      commitHashDict.get(branchSha)?.branchNames.push(branchName);
    });

    const hasUncommittedChanges = repoStatus.length > 0;
    const rootDisplayCommit = commitHashDict.get(
      commonAncestorCommitOid.tostrS(),
    )!;

    const ourRepository = {
      path: repoPath,
      hasUncommittedChanges,
      headHash,
      rootDisplayCommit,
    };

    const getRemoteRepoInfo = async (): Promise<Repository> => {
      // Get all commits with local branches
      const allCommitsWithBranches = Array.from(commitHashDict.values()).filter(
        (commit) => commit.branchNames.filter(refIsLocal).length !== 0,
      );

      // Look up PR information for them and inject their information
      await Promise.all(
        allCommitsWithBranches.map(async (commit) => {
          commit.pullRequestInfo = await this.getPullRequestInfo(
            repoPath,
            commit.hash,
            // TODO: Handle commits with multiple PRs
            commit.branchNames.filter(refIsLocal)[0],
          );
        }),
      );

      return ourRepository;
    };

    return {
      repo: ourRepository,
      remoteRepoInfoPromise: getRemoteRepoInfo(),
    };
  }

  async getPullRequestBranchMap(
    repoPath: string,
    owner: string,
    repo: string,
  ): Promise<Map<string, PullRequestInfo>> {
    const octokit = getOctokit(repoPath);
    const { data } = await octokit.pulls.list({
      owner,
      repo,
    });
    let pullRequestBranchMap = new Map<string, PullRequestInfo>();
    data.forEach((pullRequest: any) => {
      if (!pullRequestBranchMap.has(pullRequest.head.ref)) {
        let pullRequestInfo = {
          url: pullRequest.url,
          title: pullRequest.title,
          isOutdated: false,
        };
        pullRequestBranchMap.set(pullRequest.head.ref, pullRequestInfo);
      }
    });
    return pullRequestBranchMap;
  }

  async getPullRequestInfo(
    repoPath: string,
    commitHash: string,
    branch: string,
  ): Promise<PullRequestInfo | undefined> {
    try {
      const repoResult = await nodegit.Repository.open(repoPath);
      // TODO: Handle remotes that are not named "origin"
      const remoteResult = await repoResult.getRemote("origin");
      const { owner, repo } = remoteUrlToOwnerAndRepo(remoteResult.url());
      const octokit = getOctokit(repoPath);
      let pullRequestInfo: PullRequestInfo | undefined;
      try {
        const {
          data,
        } = await octokit.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: commitHash,
        });
        return (pullRequestInfo = {
          title: data[0].title,
          url: data[0].url,
          isOutdated: false,
        });
      } catch (e) {
        const pullRequestBranchMap = await this.getPullRequestBranchMap(
          repoPath,
          owner,
          repo,
        );
        if (pullRequestBranchMap.has(branch)) {
          pullRequestInfo = pullRequestBranchMap.get(branch);
          if (pullRequestInfo !== undefined) {
            pullRequestInfo.isOutdated = true;
            return pullRequestInfo;
          }
        } else return undefined;
      }
    } catch (e) {
      console.log(e);
    }
  }

  //Actions
  async createOrUpdateBranchesForCommitStack(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    const repo = await nodegit.Repository.open(repoPath);
    for (let i = 0; i < commitStack.length; i++) {
      const commitMessage = "feature/new-branch"; // TODO: get the branch name from user
      const newBranchName = `${commitMessage}-${i}`; // Branch name is "commit message-branch number"
      commitStack[i].branchNames.push(newBranchName);
      const commitTarget = await nodegit.Commit.lookup(
        repo,
        commitStack[i].hash,
      );
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

    // Create a dummy target branch and cherry pick onto that. THIS WILL ONLY SUPPORT STACK REBASING

    // 1. Rebase each child Commit of the root commit on the target commit
    // (I'm assuming git reset --HARD needs to be done in the case of having multiple branch names??)
    // 2. Add the children of each child to a queue
    // 3. Iterate 1->2 till queue is empty
    const commitQueue: Commit[] = [rootCommit];
    let commitToRebase = targetCommitLookup;
    while (commitQueue.length !== 0) {
      const [childCommit] = commitQueue.splice(0, 1);
      const childCommitLookup: nodegit.Commit = await nodegit.Commit.lookup(
        repo,
        nodegit.Oid.fromString(childCommit.hash),
      );

      const index = ((await nodegit.Cherrypick.commit(
        repo,
        commitToRebase,
        childCommitLookup,
        0,
        {},
        // Bug in type defs: `commit` returns an Index, not a number.
        // See: https://www.nodegit.org/api/cherrypick/#cherrypick
      )) as unknown) as nodegit.Index;

      const tree = await index.writeTreeTo(repo);

      const newCommitOid = await repo.createCommit(
        "refs/heads/feature/new-branch-0", // TODO: Create and use a temp branch
        childCommitLookup.author(),
        childCommitLookup.committer(),
        childCommitLookup.message(),
        tree,
        [commitToRebase],
      );
      console.log("CPing index", index, tree, newCommitOid.tostrS());

      // Use `git branch -f` to change all the original commit's local branches
      // to point to the new one.
      childCommit.branchNames.map(async (branchName: string) => {
        // Target Commit Lookup will change if we use CherryPick
        if (refIsLocal(branchName)) {
          await repo.createBranch(
            localRefToBranchName(branchName),
            newCommitOid,
            true,
          );
        }
      });

      // TODO: Fix this commit target; this is the wrong commit. We should be rebasing the next commit on top of newCommitOid
      commitToRebase = childCommitLookup;
    }

    // TODO: Abandon this updated-commit strategy and just reload the entire app!

    return rootCommit;
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
    // TODO: Handle remotes that are not named "origin"
    const remoteResult = await repoResult.getRemote("origin");
    const { owner, repo } = remoteUrlToOwnerAndRepo(remoteResult.url());
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
        repo,
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
