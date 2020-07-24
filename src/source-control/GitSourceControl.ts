import type { Commit, CommitHash } from "../shared/types";
import type {
  SourceControl,
  SourceControlRepositoryUpdateListener,
} from "./SourceControl";

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

  async attachSttackBranchesToCommits(commits: Commit[]): Promise<void> {
    // TODO: Implement
  }
}
