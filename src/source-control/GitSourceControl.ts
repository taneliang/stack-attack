import { func } from "prop-types";
import type { BranchName, Commit, CommitHash } from "../shared/types";
import type {
  SourceControl,
  SourceControlRepositoryUpdateListener,
} from "./SourceControl";

var randomWords = require("random-words");
let localRefPrefix: string = "refs/heads/";

function refIsLocal(refString: string): boolean {
  return refString.startsWith(localRefPrefix);
}

function localRefToBranchName(refString: string): string {
  if (!refIsLocal(refString)) return refString;
  return refString.substr(localRefPrefix.length);
}

function isSttackBranch(branch: BranchName): boolean {
  if (branch.startsWith("sttack-")) return true;
  return false;
}

function createSttackBranch(commit: Commit): string {
  let branch: BranchName = `sttack-${randomWords({ exactly: 4, join: "-" })}`;
  return branch;
}
export class GitSourceControl implements SourceControl {
  private repoPath: string;

  repositoryUpdateListener: SourceControlRepositoryUpdateListener;

  constructor(
    repoPath: string,
    repositoryUpdateListener: SourceControlRepositoryUpdateListener,
  ) {
    this.repoPath = repoPath;
    this.repositoryUpdateListener = repositoryUpdateListener;
  }

  loadRepositoryInformation(): void {
    // TODO: Implement
  }

  async getCommitByHash(hash: CommitHash): Promise<Commit | null> {
    // TODO: Implement
    return null;
  }

  async rebaseCommits(
    rebaseRootCommit: Commit,
    targetCommit: Commit,
  ): Promise<void> {
    // TODO: Implement
  }

  async pushCommit(commit: Commit): Promise<void> {
    // TODO: Implement
  }

  async pushCommitsForCommitTreeRootedAtCommit(commit: Commit): Promise<void> {
    // TODO: Implement
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
