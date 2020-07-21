export type PullRequestID = number;

export interface PullRequestInfo {
  number: PullRequestID;

  url: string;
  title: string;
  description: string;

  // TODO: Move this into a function?
  dependencies?: PullRequestID[];

  isOutdated: boolean;
}

export type CommitHash = string;
export type RefName = string;
export type BranchName = string;

export interface CommitSignature {
  name: string;
  email: string;
}

export interface Commit {
  hash: CommitHash;

  title: string;
  timestamp: Date;
  author: CommitSignature;
  committer: CommitSignature;

  refNames: RefName[];
  pullRequestInfo?: PullRequestInfo | undefined;

  parentCommits: CommitHash[];
  childCommits: CommitHash[];
}

export interface Repository {
  path: string;
  hasUncommittedChanges: boolean;
  headHash: string;

  earliestInterestingCommit: Commit;
}
