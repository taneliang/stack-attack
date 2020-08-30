import fs from "fs";

import produce, { enableMapSet } from "immer";
import nodegit from "nodegit";
import nullthrows from "nullthrows";
import randomWords from "random-words";

import type {
  BranchName,
  Commit,
  CommitHash,
  CommitSignature,
  Repository,
  RefName,
} from "../shared/types";

import type {
  SourceControl,
  SourceControlRepositoryUpdateListener,
} from "./SourceControl";

enableMapSet();

const localRefPrefix: string = "refs/heads/";
const stackAttackBranchNamePrefix = "stack-attack/";

function refIsLocal(refString: RefName): boolean {
  return refString.startsWith(localRefPrefix);
}

function localRefToBranchName(refString: RefName): BranchName {
  if (!refIsLocal(refString)) return refString;
  return refString.substr(localRefPrefix.length);
}

function branchNameToLocalRef(branchName: BranchName): RefName {
  return `${localRefPrefix}${branchName}`;
}

function isSttackBranch(branch: BranchName): boolean {
  return branch.startsWith(stackAttackBranchNamePrefix);
}

function createSttackBranch(): BranchName {
  return `${stackAttackBranchNamePrefix}${randomWords({
    exactly: 3,
    join: "-",
  })}`;
}

export class GitSourceControl implements SourceControl {
  private repoPath: string;
  // Repo has to exist whenever called; We add a loadIfChangesPresent check before any major mishap
  private repo!: Repository;

  repositoryUpdateListener: SourceControlRepositoryUpdateListener;

  constructor(
    repoPath: string,
    repositoryUpdateListener: SourceControlRepositoryUpdateListener,
  ) {
    this.repoPath = repoPath;
    this.repositoryUpdateListener = repositoryUpdateListener;
  }

  loadRepositoryInformation(): void {
    this.loadIfChangesPresent();
  }

  private async loadIfChangesPresent() {
    // Only populate repo if we haven't loaded it yet
    // TODO: Also repopulate if the repo has changed after we've first loaded it (somehow)
    if (!this.repo) {
      await this.populateGitSourceControl();
    }
    this.repositoryUpdateListener(this.repo);
  }

  private async populateGitSourceControl(): Promise<void> {
    const repo = await nodegit.Repository.open(this.repoPath);
    const repoStatus = await repo.getStatus();
    const refs = await repo.getReferences();
    const headHash = (await repo.getHeadCommit()).sha();
    const commitHashMap = new Map<CommitHash, Commit>();
    const branchCommits = await Promise.all(
      refs.map(async (ref: nodegit.Reference) => repo.getBranchCommit(ref)),
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
     * Commit hash keys *are not* guaranteed to exist in `commitHashMap`.
     * Commit hashes in the sets *are* guaranteed to exist in
     * `commitHashMap` as we traverse from children to parents.
     */
    const commitChildrenMap = new Map<string, Set<string>>();
    await Promise.all(
      refs.map((ref) => {
        return new Promise(async (resolve, _) => {
          const history = (await repo.getBranchCommit(ref)).history();
          history.on("commit", (nodegitCommit: nodegit.Commit) => {
            const sha = nodegitCommit.sha();

            // If the commit is already in `commitHashMap`, stop because we
            // have already processed it.
            if (commitHashMap.has(sha)) {
              return;
            }

            const commitSignature: CommitSignature = {
              name: nodegitCommit.author().name(),
              email: nodegitCommit.author().email(),
            };

            // Create a new commit and add it to `commitHashMap`.
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
            commitHashMap.set(sha, newCommit);

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
          });

          history.on("end", () => resolve());
          history.start();
        });
      }),
    );

    // Build relationships
    commitChildrenMap.forEach((childrenHashes, parentHash) => {
      const parentCommit = commitHashMap.get(parentHash);
      if (!parentCommit) {
        return;
      }
      childrenHashes.forEach((childHash) => {
        const childCommit: Commit = commitHashMap.get(childHash)!;
        if (!childCommit.parentCommits.includes(parentHash)) {
          childCommit.parentCommits = [
            ...childCommit.parentCommits,
            parentHash,
          ];
        }
        if (!parentCommit.childCommits.includes(parentHash)) {
          parentCommit.childCommits = [...parentCommit.childCommits, childHash];
        }
        commitHashMap.set(childHash, childCommit);
      });
      commitHashMap.set(parentHash, parentCommit);
    });

    // Inject branch names
    refs.forEach((ref) => {
      const refName = ref.name();
      const branchSha = ref.target().tostrS();
      commitHashMap.get(branchSha)?.refNames.push(refName);
    });

    const hasUncommittedChanges = repoStatus.length > 0;
    // Earliest Interesting Commit must exist at this point
    const earliestInterestingCommit = commitHashMap.get(
      commonAncestorCommitOid.tostrS(),
    )!;

    const ourRepository: Repository = {
      path: this.repoPath,
      hasUncommittedChanges,
      headHash,
      earliestInterestingCommit,
      commits: commitHashMap,
    };
    this.repo = ourRepository;
  }

  private getLongLivedBranchesFromConfig(): BranchName[] {
    const configFileContents = fs
      .readFileSync(`${this.repoPath}/sttack.config.json`)
      .toString();
    const { longLivedBranches } = JSON.parse(configFileContents);
    return longLivedBranches ?? [];
  }

  async getMergeBasesWithLongLivedBranches(
    commit: Commit,
  ): Promise<CommitHash[]> {
    const repo = await nodegit.Repository.open(this.repoPath);
    const longLivedBranchNames: BranchName[] = this.getLongLivedBranchesFromConfig();
    const commitOid = nodegit.Oid.fromString(commit.hash);
    return await Promise.all(
      longLivedBranchNames.map(async (branchName) => {
        const branchTipCommitOid = await nodegit.Reference.nameToId(
          repo,
          branchName,
        );
        const mergeBaseOid = await nodegit.Merge.base(
          repo,
          commitOid,
          branchTipCommitOid,
        );
        return mergeBaseOid.tostrS();
      }),
    );
  }

  async getCommitByHash(hash: CommitHash): Promise<Commit | null> {
    try {
      const repo = await nodegit.Repository.open(this.repoPath);
      const commit = await nodegit.AnnotatedCommit.fromRevspec(repo, hash);
      const completeCommitHash = commit.id().tostrS();
      return this.repo.commits.get(completeCommitHash) ?? null;
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }

  async rebaseCommits(
    rebaseRootCommitHash: CommitHash,
    targetCommitHash: CommitHash,
  ): Promise<void> {
    const repo = await nodegit.Repository.open(this.repoPath);
    await this.loadIfChangesPresent();
    const rebaseTargetHashMap = new Map<CommitHash, CommitHash>();
    if (!this.repo.commits.has(targetCommitHash)) {
      throw new Error(`Target commit ${targetCommitHash} does not exist`);
    }
    rebaseTargetHashMap.set(rebaseRootCommitHash, targetCommitHash);
    const tempBranchName = "stack-attack-temporary-cherry-pick-target-branch";
    const queue: string[] = [rebaseRootCommitHash];
    while (queue.length) {
      // Loop overview:
      // 1. Rebase root commit on target commit
      // 2. Update Target Commit to point to the cherry picked commit
      // 3. Update rebaseRootCommit to point to child of itself

      const hashOfCommitToBeRebased = queue.pop()!;
      // `hashOfCommitToBeRebased` should always be present in the rebaseTargetHashMap, adding nullthrows here, so that if null,
      // rebase cannot happen
      targetCommitHash = nullthrows(
        rebaseTargetHashMap.get(hashOfCommitToBeRebased),
        `Target commit for ${hashOfCommitToBeRebased} could not be found`,
      );
      const commitToBeRebased = nullthrows(
        this.repo.commits.get(hashOfCommitToBeRebased),
        `Commit to be rebased ${hashOfCommitToBeRebased} does not exist`,
      );
      if (!this.repo.commits.has(targetCommitHash)) {
        throw new Error(`Target commit ${targetCommitHash} does not exist`);
      }

      // Cherry pick commit to be rebased onto target
      const targetCommitOid = nodegit.Oid.fromString(targetCommitHash);
      const originalNodegitCommit = await nodegit.Commit.lookup(
        repo,
        nodegit.Oid.fromString(commitToBeRebased.hash),
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

      // Use `git branch -f` to change all the original commit's local branches
      // to point to the new one.
      commitToBeRebased.refNames.map(async (refName: RefName) => {
        if (!refIsLocal(refName)) {
          return; // We only want to move local refs
        }

        const branchRef = await repo.getReference(refName);
        const isBranchHead = nodegit.Branch.isHead(branchRef);
        if (isBranchHead) {
          // We cannot move a branch if we're checked out to it, so we need to detach.
          repo.detachHead(); // Be sure to set the head after detaching!
        }

        const newBranchRef = await repo.createBranch(
          localRefToBranchName(refName),
          newCommitOid,
          true,
        );

        if (isBranchHead) {
          // If we were checked out to the pre-cherry-pick branch, check out the
          // new post-cherry-pick branch.
          repo.setHead(newBranchRef.toString());
        }
      });

      // Update refs in our hashMap
      const targetCommitHashCopy = targetCommitHash; // Ensure producer function below captures the correct target commit hash
      this.repo = produce(this.repo, (draftRepo) => {
        const draftTargetCommit = nullthrows(
          draftRepo.commits.get(targetCommitHashCopy),
          `Could not find commit with hash ${targetCommitHashCopy}`,
        );

        // Add the newly-created commit to our repo
        const newCommitToInsert: Commit = {
          hash: newCommitOid.tostrS(),
          title: commitToBeRebased.title,
          timestamp: new Date(),
          author: commitToBeRebased.author,
          committer: commitToBeRebased.committer,
          refNames: commitToBeRebased.refNames.filter(refIsLocal),
          parentCommits: [draftTargetCommit.hash],
          childCommits: [],
        };
        draftRepo.commits.set(newCommitOid.tostrS(), newCommitToInsert);

        // Update target's children
        draftTargetCommit.childCommits = [
          ...draftTargetCommit.childCommits,
          newCommitOid.tostrS(),
        ];
      });

      queue.push(...commitToBeRebased.childCommits);

      // Register new commit as the rebase target for all children
      commitToBeRebased.childCommits.forEach((childCommitHash) => {
        rebaseTargetHashMap.set(childCommitHash, newCommitOid.tostrS());
      });
    }

    // Remove temp branch
    nodegit.Branch.delete(await repo.getBranch(tempBranchName));

    await this.populateGitSourceControl();
  }

  async pushBranch(
    branchName: BranchName,
    remoteName = "origin",
  ): Promise<void> {
    try {
      const {
        userPublicKeyPath,
        userPrivateKeyPath,
        userPassphrase,
      } = JSON.parse(
        fs.readFileSync(`${this.repoPath}/sttack.config.json`, "utf-8"),
      );
      const repo = await nodegit.Repository.open(this.repoPath);
      const remote = await repo.getRemote(remoteName);
      const refName = branchNameToLocalRef(branchName);
      const branchReference = nullthrows(
        await nodegit.Branch.lookup(
          repo,
          branchName,
          nodegit.Branch.BRANCH.LOCAL,
        ),
        `Branch with name ${branchName} could not be found`,
      );
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
      await remote.push([`+${refName}:${refName}`], { callbacks: callback });
      await nodegit.Branch.setUpstream(
        branchReference,
        `${remoteName}/${branchName}`,
      );
    } catch (err) {
      console.log(err);
    }
  }

  getSttackBranchForCommit(commit: Commit): BranchName | null {
    for (const refName of commit.refNames) {
      if (isSttackBranch(localRefToBranchName(refName))) {
        return localRefToBranchName(refName);
      }
    }
    return null;
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
        let branch: BranchName | null = null;

        // Use the existing stack-attack branch if it exists
        branch = this.getSttackBranchForCommit(commit);

        // Attach stack-attack branch otherwise
        if (!branch) {
          branch = createSttackBranch();
          await repo.createBranch(branch, commit.hash, true);
          this.repo = produce(this.repo, (draftRepo) => {
            const commitToUpdate = draftRepo.commits.get(commit.hash)!;
            commitToUpdate.refNames = Array.from(
              new Set([
                ...commitToUpdate.refNames,
                branchNameToLocalRef(branch!),
              ]),
            );
            draftRepo.commits.set(commit.hash, commitToUpdate);
          });
        }
        commitBranchPairs.push({ commit: commit, sttackBranch: branch });
      }),
    );
    await this.loadIfChangesPresent();
    return commitBranchPairs;
  }
}
