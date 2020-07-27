import nodegit from "nodegit";
import produce, { enableMapSet } from "immer";
import fs from "fs";
import { lorem } from "faker";
enableMapSet();

import type {
  BranchName,
  Commit,
  CommitHash,
  CommitSignature,
  Repository,
} from "../shared/types";
import type {
  SourceControl,
  SourceControlRepositoryUpdateListener,
} from "./SourceControl";

const localRefPrefix: string = "refs/heads/";

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

function createSttackBranch(): BranchName {
  const branchName: BranchName = `sttack-${lorem.slug(3)}`;
  return branchName;
}

export class GitSourceControl implements SourceControl {
  private repoPath: string;
  // Repo has to exist whenever called; We add a loadIfChangesPresent check before any major mishap
  private repo!: Repository;

  repositoryUpdateListener: SourceControlRepositoryUpdateListener;
  private commitHashMap = new Map<CommitHash, Commit>();

  constructor(
    repoPath: string,
    repositoryUpdateListener: SourceControlRepositoryUpdateListener,
  ) {
    this.repoPath = repoPath;
    this.repositoryUpdateListener = repositoryUpdateListener;
  }

  async getRepo(): Promise<Repository> {
    await this.loadIfChangesPresent();
    return this.repo;
  }

  loadRepositoryInformation(): void {
    this.repositoryUpdateListener(this.repo);
  }

  private async loadIfChangesPresent() {
    // If commitHashMap is populated or changes are not detected, we need to return
    if (!this.repo) {
      return;
    }
    const repo = await nodegit.Repository.open(this.repoPath);
    const repoStatus = await repo.getStatus();
    if (repoStatus.length === 0) {
      // No changes in repo, can return
      return;
    } else {
      await this.populateGitSourceControl();
      this.loadRepositoryInformation();
    }
    // Else we can call populate GitSourceControl
  }

  private async populateGitSourceControl(): Promise<void> {
    const repo = await nodegit.Repository.open(this.repoPath);
    const repoStatus = await repo.getStatus();
    const refs = await repo.getReferences();
    const headHash = (await repo.getHeadCommit()).sha();
    const hashMap = new Map<CommitHash, Commit>();
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
            if (hashMap.has(sha)) {
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
            hashMap.set(sha, newCommit);

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
      const parentCommit = hashMap.get(parentHash);
      if (!parentCommit) {
        return;
      }
      childrenHashes.forEach((childHash) => {
        const childCommit: Commit = hashMap.get(childHash)!;
        childCommit.parentCommits = Array.from(
          new Set([...childCommit.parentCommits, parentHash]),
        );
        parentCommit.childCommits = Array.from(
          new Set([...parentCommit.childCommits, childHash]),
        );
        hashMap.set(childHash, childCommit);
      });
      hashMap.set(parentHash, parentCommit);
    });

    // Inject branch names

    refs.forEach((ref) => {
      const branchName = ref.name();
      const branchSha = ref.target().tostrS();
      hashMap.get(branchSha)?.refNames.push(branchName);
    });

    const hasUncommittedChanges = repoStatus.length > 0;
    // Earliest Interesting Commit must exist at this point
    const earliestInterestingCommit = hashMap.get(
      commonAncestorCommitOid.tostrS(),
    )!;

    const ourRepository: Repository = {
      path: this.repoPath,
      hasUncommittedChanges,
      headHash,
      earliestInterestingCommit,
      commits: hashMap,
    };

    this.repo = ourRepository;
  }

  async getCommitByHash(hash: CommitHash): Promise<Commit | null> {
    // TODO: Implement for partial match
    const relatedCommits: Commit[] = [];
    const keys = Array.from(this.repo.commits.keys());
    keys.forEach((key) => {
      if (key.indexOf(hash) !== -1) {
        // If hash in key, as the key was from the commits' key, it should be present
        relatedCommits.push(this.repo.commits.get(key)!);
      }
    });
    if (relatedCommits.length !== 1) {
      return null;
    } else {
      return relatedCommits[0];
    }
  }

  async rebaseCommits(
    rebaseRootCommit: CommitHash,
    targetCommit: CommitHash,
  ): Promise<void> {
    const repo = await nodegit.Repository.open(this.repoPath);
    await this.loadIfChangesPresent();
    const tempBranchName = `sttack-${lorem.slug(3)}`;
    const queue: string[] = [rebaseRootCommit];
    // 1. Rebase root commit on target commit
    // 2. Update Target Commit to point to the cherry picked commit
    // 3. Update rebaseRootCommit to point to child of itself
    // Call LoadRepositoryInformation

    while (queue.length) {
      const hashToBeRebased = queue.pop();
      // This rebase commit must exist
      const baseCommitSttack = this.repo.commits.get(hashToBeRebased!)!;
      const targetCommitSttack = this.repo.commits.get(targetCommit!)!;

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
      this.repo.commits = produce(this.repo.commits, (draftCommitHashMap) => {
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
    await this.loadIfChangesPresent();
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
        ...commit.childCommits.map((hash) => this.repo.commits.get(hash)!),
      );
    }
    await this.loadIfChangesPresent();
  }

  async attachSttackBranchesToCommits(
    commits: Commit[],
  ): Promise<Array<{ commit: Commit; sttackBranch: BranchName }>> {
    const commitBranchPairs: Array<{
      commit: Commit;
      sttackBranch: BranchName;
    }> = [];

    const repo = await nodegit.Repository.open(this.repoPath);
    await Promise.all(
      commits.map(async (commit) => {
        let branch: BranchName = "";
        commit.refNames.forEach((refName) => {
          if (isSttackBranch(localRefToBranchName(refName))) {
            branch = localRefToBranchName(refName);
          }
        });
        if (branch.length == 0) {
          branch = createSttackBranch();
          await repo.createBranch(branch, commit.hash, true);
          this.repo.commits = produce(
            this.repo.commits,
            (draftCommitHashMap) => {
              const commitToUpdate = draftCommitHashMap.get(commit.hash)!;
              commitToUpdate.refNames = Array.from(
                new Set([...commitToUpdate.refNames, branch]),
              );
              draftCommitHashMap.set(commit.hash, commitToUpdate);
            },
          );
        }
        commitBranchPairs.push({ commit: commit, sttackBranch: branch });
      }),
    );
    await this.loadIfChangesPresent();
    return commitBranchPairs;
  }
}
