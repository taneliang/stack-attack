import nodegit from "nodegit";
import produce, { enableMapSet } from "immer";
import fs from "fs";
enableMapSet();

import type { BranchName, Commit, CommitHash, Repository, CommitSignature } from "../shared/types";
import type {
  SourceControl,
  SourceControlRepositoryUpdateListener,
} from "./SourceControl";

let localRefPrefix: string = "refs/heads/";

function refIsLocal(refString: string): boolean {
  return refString.startsWith(localRefPrefix);
}

function localRefToBranchName(refString: string): string {
  if (!refIsLocal(refString)) return refString;
  return refString.substr(localRefPrefix.length);
}

function isSttackBranch(branch: BranchName): boolean {
  return branch.startsWith("sttack-");
}

function createSttackBranch(commit: Commit): BranchName {
  //TODO: Implement slug generation
  return ""; 
}


export class GitSourceControl implements SourceControl {
  private repoPath: string;

  repositoryUpdateListener: SourceControlRepositoryUpdateListener;
  private commitHashMap = new Map<string, Commit>();

  constructor(
    repoPath: string,
    repositoryUpdateListener: SourceControlRepositoryUpdateListener,
  ) {
    this.repoPath = repoPath;
    this.repositoryUpdateListener = repositoryUpdateListener;
    this.populateGitSourceControl();
  }

  loadRepositoryInformation(): void {}

  private async populateGitSourceControl() {
    const repo = await nodegit.Repository.open(this.repoPath);
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
            if (this.commitHashMap.has(sha)) {
              stopped = true;
              return;
            }

            const commitSignature: CommitSignature = {
              name: nodegitCommit.author().name(),
              email: nodegitCommit.author().email(),
            };

            // Create a new commit and add it to `commitHashDict`.
            const newCommit: Commit = {
              title: nodegitCommit.summary(),
              hash: sha,
              timestamp: nodegitCommit.date(),
              author: commitSignature,
              committer: commitSignature,
              refNames: [],
              parentCommits: [],
              childCommits: [],
            };
            // Use Immer?
            this.commitHashMap.set(sha, newCommit);

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
      this.commitHashMap = produce(this.commitHashMap, (draftCommitHashMap) => {
        const parentCommit = draftCommitHashMap.get(parentHash);
        if (!parentCommit) {
          return;
        }
        childrenHashes.forEach((childHash) => {
          const childCommit: Commit = draftCommitHashMap.get(childHash)!;
          childCommit.parentCommits = Array.from(
            new Set([...childCommit.parentCommits, parentHash]),
          );
          parentCommit.childCommits = Array.from(
            new Set([...parentCommit.childCommits, childHash]),
          );
        });
      });
    });

    this.commitHashMap = produce(this.commitHashMap, (draftCommitHashMap) => {
      refs.forEach((ref) => {
        const branchName = ref.name();
        const branchSha = ref.target().tostrS();
        draftCommitHashMap.get(branchSha)?.refNames.push(branchName);
      });
    });

    // Inject branch names

    const hasUncommittedChanges = repoStatus.length > 0;
    const earliestInterestingCommit = this.commitHashMap.get(
      commonAncestorCommitOid.tostrS(),
    )!;

    const ourRepository: Repository = {
      path: this.repoPath,
      hasUncommittedChanges,
      headHash,
      earliestInterestingCommit,
      commits: this.commitHashMap,
    };

    const getRemoteRepoInfo = async (
      ourRepository: Repository,
    ): Promise<Repository> => {
      const remoteUpdatedCommitHashMap = await produce(
        ourRepository.commits,
        async (draftCommitHashMap) => {
          // Get all commits with local branches
          const allCommitsWithBranches = Array.from(
            draftCommitHashMap.values(),
          ).filter((commit) => commit.refNames.filter(refIsLocal).length !== 0);

          // Look up PR information for them and inject their information
          await Promise.all(
            allCommitsWithBranches.map(async (commit) => {
              // TODO: Implement this.getPullRequestInfo
              commit.pullRequestInfo = await this.getPullRequestInfo(
                this.repoPath,
                commit.hash,
                // TODO: Handle commits with multiple PRs
                commit.refNames.filter(refIsLocal)[0],
              );
            }),
          );
        },
      );
      const updatedRepository = {
        ...ourRepository,
        commits: remoteUpdatedCommitHashMap,
      };
      return updatedRepository;
    };

    return {
      repo: ourRepository,
      remoteRepoInfoPromise: getRemoteRepoInfo(ourRepository),
    };
  }

  async getCommitByHash(hash: CommitHash): Promise<Commit | null> {
    // TODO: Implement
    return null;
  }

  async rebaseCommits(
    rebaseRootCommit: string,
    targetCommit: string,
  ): Promise<void> {
    const repo = await nodegit.Repository.open(this.repoPath);
    const tempBranchName = `sttack-${randomWord()}`;
    const queue: string[] = [rebaseRootCommit];
    // 1. Rebase root commit on target commit
    // 2. Update Target Commit to point to the cherry picked commit
    // 3. Update rebaseRootCommit to point to child of itself
    // Call LoadRepositoryInformation

    while (queue.length) {
      const hashToBeRebased = queue.pop();
      // This rebase commit must exist
      const baseCommitSttack = this.commitHashMap.get(hashToBeRebased!)!;
      const targetCommitSttack = this.commitHashMap.get(targetCommit!)!;

      const targetCommitOid = nodegit.Oid.fromString(targetCommit);
      const originalNodegitCommit = await nodegit.Commit.lookup(
        repo,
        nodegit.Oid.fromString(baseCommitSttack.hash),
      );
      const targetNodegitCommit = await repo.getCommit(targetCommitOid);
      const index = ((await nodegit.Cherrypick.commit(
        repo,
        originalNodegitCommit,
        targetNodegitCommit,
        0,
        {},
        // Bug in type defs: `commit` returns an Index, not a number.
        // See: https://www.nodegit.org/api/cherrypick/#cherrypick
      )) as unknown) as nodegit.Index;

      const tree = await index.writeTreeTo(repo);

      const cherryPickTargetRef = await repo.createBranch(
        tempBranchName,
        targetCommitOid,
        true,
      );

      const newCommitOid = await repo.createCommit(
        cherryPickTargetRef.toString(),
        originalNodegitCommit.author(),
        originalNodegitCommit.committer(),
        originalNodegitCommit.message(),
        tree,
        [targetNodegitCommit],
      );
      // We now would want to use this new commit hash as the target
      targetCommit = newCommitOid.tostrS();

      // Use `git branch -f` to change all the original commit's local branches
      // to point to the new one.
      baseCommitSttack.refNames.map(async (branchName: string) => {
        // Target Commit Lookup will change if we use CherryPick
        if (refIsLocal(branchName)) {
          const branchRef = await repo.getReference(branchName);
          const isBranchHead = nodegit.Branch.isHead(branchRef);
          if (isBranchHead) {
            repo.detachHead();
          }
          const newBranchRef = await repo.createBranch(
            localRefToBranchName(branchName),
            newCommitOid,
            true,
          );
          if (isBranchHead) {
            repo.setHead(newBranchRef.toString());
          }
        }
      });
      queue.push(...baseCommitSttack.childCommits);

      // Update refs in our hashMap
      this.commitHashMap = produce(this.commitHashMap, (draftCommitHashMap) => {
        const childrenOfTargetCommit = targetCommitSttack.childCommits;
        const newCommitToInsert: Commit = {
          hash: newCommitOid.tostrS(),
          title: "Sttack Commit",
          timestamp: new Date(),
          author: baseCommitSttack.author,
          committer: baseCommitSttack.committer,
          refNames: baseCommitSttack.refNames.filter(refIsLocal),
          parentCommits: [targetCommitSttack.hash],
          childCommits: [...childrenOfTargetCommit],
        };
        draftCommitHashMap.set(newCommitOid.tostrS(), newCommitToInsert);
        // Update ChildCommitHash for targetCommitSttack to newCommit
        targetCommitSttack.childCommits = [newCommitOid.tostrS()];
        // Update ParentCommitHash for all of the children and replace targetCommitSttack's hash with newCommit's hash
        childrenOfTargetCommit.forEach((child) => {
          const childCommit = draftCommitHashMap.get(child)!;
          const parentsOfChild = childCommit.parentCommits.map((parent) => {
            if (parent === targetCommitSttack.hash) {
              return newCommitOid.tostrS();
            }
            return parent;
          });
          childCommit.parentCommits = parentsOfChild;
          draftCommitHashMap.set(child, childCommit);
        });
      });
    }
    // Remove temp branch
    nodegit.Branch.delete(await repo.getBranch(tempBranchName));
    // SEE: Call loadRepository? How?
  }

  async pushCommit(commit: Commit): Promise<void> {
    try {
      const {
        userPublicKeyPath,
        userPrivateKeyPath,
        userPassphrase,
      } = JSON.parse(
        fs.readFileSync(`${this.repoPath}/sttack.config.json`, "utf-8"),
      );
      const repo = await nodegit.Repository.open(this.repoPath);
      // SEE: Could be any of the long lived branches?
      const remote = await repo.getRemote("origin");
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
        },
      };
      const connection = remote.connect(nodegit.Enums.DIRECTION.PUSH, callback);
      // SEE: Can only push if branch exists on remote? How to find branch name here?
      await Promise.all(
        commit.refNames.map(
          async (ref: string): Promise<number> => {
            return await remote.push([`${ref}:${ref}`], {
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
          },
        ),
      );
    } catch (err) {
      console.log(err);
    }
  }

  async pushCommitsForCommitTreeRootedAtCommit(commit: Commit): Promise<void> {
    const queue: Commit[] = [commit];
    while (queue.length) {
      // SEE: Always have an element there
      const commit = queue.pop()!;
      await this.pushCommit(commit);
      queue.push(
        ...commit.childCommits.map((hash) => this.commitHashMap.get(hash)!),
      );
    }
    // SEE: Call Load Repository Information
  }

  async attachSttackBranchesToCommits(
    commits: Commit[],
  ): Promise<Array<{ commit: Commit; sttackBranch: BranchName }>> {
    let commitBranchPairs: Array<{
      commit: Commit;
      sttackBranch: BranchName;
    }> = [];
    commits.forEach((commit) => {
      let branch: BranchName = "";
      commit.refNames.forEach((refName) => {
        if (isSttackBranch(localRefToBranchName(refName))) {
          branch = localRefToBranchName(refName);
        }
      });
      if (branch === "") {
        branch = createSttackBranch(commit);
        //TODO: Implement branch creation
      }
      commitBranchPairs.push({ commit: commit, sttackBranch: branch });
    });
    return commitBranchPairs;
  }
}
