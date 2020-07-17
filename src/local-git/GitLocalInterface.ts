import {
  Commit,
  Repository,
  PullRequestInfo,
  NavigatorBackend,
} from "../NavigatorBackendType";
import nodegit from "nodegit";
import { getOctokit } from "../github-integration/authentication";
import fs from "fs";

const localRefPrefix = "refs/heads/";

function refIsLocal(refString: string) {
  return refString.startsWith(localRefPrefix);
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
      refs.map(
        async (ref: nodegit.Reference) => await repo.getBranchCommit(ref),
      ),
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

  //Actions: create new branch for each commit that don't have an existing "feature/new-branch" branch
  async createOrUpdateBranchesForCommitStack(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    // TODO: Get from user
    const stackBranchBaseName = "feature/new-branch";
    const stackBranchNamePrefix = `${stackBranchBaseName}-`;

    const repo = await nodegit.Repository.open(repoPath);
    //assume we're operating on the entire stack
    for (let i = 0; i < commitStack.length; i++) {
      //Example: ["refs/heads/origin/master", "refs/heads/feature/new-branch-1"];
      //if the commit has a branch "refs/heads/feature/new-branch-", don't create a new branch
      if (commitStack[i].branchNames.length > 0) {
        let skip = false;
        for (let j = 0; j < commitStack[i].branchNames.length; j++) {
          if (
            commitStack[i].branchNames[j].startsWith(
              `${localRefPrefix}${stackBranchNamePrefix}`,
            )
          ) {
            skip = true;
            break;
          }
        }
        if (skip) continue;
      }
      //else: create a new branch
      const newBranchName = `${stackBranchNamePrefix}${i}`;
      commitStack[i].branchNames.push(newBranchName);
      await repo.createBranch(newBranchName, commitStack[i].hash, true);
    }
    return commitStack;
  }
  //Actions: push to the origin repo
  pushCommitstoRepo(branchName: string, repoPath: string) {
    let repo: nodegit.Repository, remote: nodegit.Remote;
    //Local repo
    const configFileContents = fs
      .readFileSync(`${repoPath}/sttack.config.json`)
      .toString();
    const {
      userPublicKeyPath,
      userPrivateKeyPath,
      userPassphrase,
    } = JSON.parse(configFileContents);
    return nodegit.Repository.open(repoPath)
      .then(function (repoResult) {
        repo = repoResult;
        //get the origin repo
        return repo.getRemote("origin");
      })
      .then(function (remoteResult) {
        //console.log("Remote loaded");
        remote = remoteResult;
        const callback = {
          credentials: function (_url: string, userName: string) {
            //console.log("Getting credentials");
            //   // FIXME: Possible infinite loop when using sshKeyFromAgent
            //   // See: https://github.com/nodegit/nodegit/issues/1133
            //   //return nodegit.Cred.sshKeyFromAgent(userName);
            return nodegit.Cred.sshKeyNew(
              userName,
              userPublicKeyPath, //"/Users/phuonganh/.ssh/id_rsa.pub",
              userPrivateKeyPath, //"/Users/phuonganh/.ssh/id_rsa",
              userPassphrase, //"hello",
            );
            //console.log("Done getting credentials");
          },
        };

        //Configure and connect the remote repo
        return remote.connect(nodegit.Enums.DIRECTION.PUSH, callback);
      })
      .then(function () {
        //console.log("Remote Connected?", remote.connected());
        return remote.push([`${branchName}:${branchName}`], {
          callbacks: {
            credentials: function (_: string, userName: string) {
              return nodegit.Cred.sshKeyNew(
                userName,
                userPublicKeyPath, //"/Users/phuonganh/.ssh/id_rsa.pub",
                userPrivateKeyPath, //"/Users/phuonganh/.ssh/id_rsa",
                userPassphrase, //"hello",
              );
            },
          },
        });
      })
      .then(function (status) {
        //console.log("Remote Pushed!", status);
      })
      .catch(function (error) {
        console.log(error);
      });
  }

  // //Actions: push to the origin repo
  // async pushCommitstoRepo(branchName: string, repoPath: string) {
  //   //Local repo
  //   const repo = await nodegit.Repository.open(repoPath);
  //   const remote = await repo.getRemote("origin");
  //   console.log("Remote loaded");

  //   await remote.push([`${branchName}:${branchName}`], {
  //     callbacks: {
  //       credentials(_url: string, userName: string) {
  //         console.log("Getting credentials");
  //         // FIXME: Possible infinite loop when using sshKeyFromAgent
  //         // See: https://github.com/nodegit/nodegit/issues/1133

  //         // return nodegit.Cred.sshKeyFromAgent(userName);
  //         return nodegit.Cred.sshKeyNew(
  //           userName,
  //           "/home/e-liang/.ssh/github_ed25519.pub",
  //           "/home/e-liang/.ssh/github_ed25519",
  //           "",
  //         );
  //       },
  //     },
  //   });

  //   // TODO: await nodegit.Branch.setUpstream(branch, upstream_name)

  //   console.log("Remote Pushed!");
  // }

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
  //Actions: create or update PRs for commits
  async createOrUpdatePRsForCommits(
    repoPath: string,
    commitStack: Commit[],
  ): Promise<Commit[]> {
    //CREATE OR UPDATE BRANCH for each commit
    commitStack = await this.createOrUpdateBranchesForCommitStack(
      repoPath,
      commitStack,
    );

    //get information for octokit.pulls.create()
    const repoResult = await nodegit.Repository.open(repoPath);
    // TODO: Handle remotes that are not named "origin"
    const remoteResult = await repoResult.getRemote("origin");
    const { owner, repo } = remoteUrlToOwnerAndRepo(remoteResult.url());
    const octokit = getOctokit(repoPath);

    //for each commit/branch in the stack
    for (let i = 0; i < commitStack.length; i++) {
      const lastIndex = commitStack[i].branchNames.length - 1;
      const branchName = commitStack[i].branchNames[lastIndex];

      //PUSH the commits to that branch on the remote repository
      await this.pushCommitstoRepo(branchName, repoPath);

      //CREATE OR UPDATE PR for each branch
      /* find which branch has an existing PR
       * create PR for other branches
       * update description for every branch
       */

      //If the branch has an existing PR, don't create one
      const getPR = await octokit.pulls.list({
        owner: owner,
        repo,
        head: `${owner}:${branchName}`,
      });
      if (getPR.data.length !== 0) {
      }
      //Else if the branch doesn't have an existing PR, create one
      else {
        //find the base branch
        let baseName: string;
        if (i === 0) baseName = "master";
        else {
          const lastIndexofLastCommit =
            commitStack[i - 1].branchNames.length - 1;
          baseName = commitStack[i - 1].branchNames[lastIndexofLastCommit];
        }
        //create PR for that branch
        await octokit.pulls.create({
          owner: owner,
          repo,
          title: commitStack[i].title,
          head: branchName,
          base: baseName, //TODO: ask the user the base
          body: commitStack[i].title, //TODO: description for PR
          maintainer_can_modify: true,
          // TODO: Uncomment when pushCommitstoRepo is fixed. Commented to get
          // around a misleading error from GitHub
          // draft: true, //draft PR default
        });
      }
    }

    // Get list of PRs
    const pullRequests = await Promise.all(
      commitStack
        .filter(({ branchNames }) => !!branchNames.find(refIsLocal))
        .map(async ({ branchNames }) => {
          const lastIndex = branchNames.length - 1;
          const branchName = branchNames[lastIndex];
          const prList = await octokit.pulls.list({
            owner: owner,
            repo,
            head: `${owner}:${branchName}`,
          });
          // Assume that all commits in commitStack already have a PR, since we've
          // just created it above.
          return prList.data[0]!;
        }),
    );

    // let prNumberArr = [];
    // for (let i = 0; i < commitStack.length; i++) {
    //   const lastIndex = commitStack[i].branchNames.length - 1;
    //   const branchName = commitStack[i].branchNames[lastIndex];
    //   const prList = await octokit.pulls.list({
    //     owner: owner,
    //     repo: repoName,
    //     head: `${owner}:${branchName}`,
    //   });
    //   const prSingle = prList.data.pop();
    //   const prNumber = prSingle?.number;
    //   const prTitle = prSingle?.title;
    //   prNumberArr.push(prNumber);
    // }

    // Update PR descriptions
    await Promise.all(
      pullRequests.map((pullRequest, prIndex) => {
        let description =
          "Stack PR by [STACK ATTACK](https://github.com/taneliang/stack-attack):\n";
        // Assume pullRequests and commitStack have the same length
        description += pullRequests
          .map(({ number, title }, indexOfDescriptionPr) => {
            const starsOrNone = prIndex === indexOfDescriptionPr ? "**" : "";
            return `- ${starsOrNone}#${number} ${title}${starsOrNone}`;
          })
          .join("\n");

        return octokit.pulls.update({
          owner: owner,
          repo,
          pull_number: pullRequest.number,
          body: description,
        });
      }),
    );

    return commitStack;
  }
}
