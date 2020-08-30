import nodegit from "nodegit";

import { GitHubCollaborationPlatform } from "../collaboration-platform";
import { GitSourceControl } from "../source-control";
import type { Stacker, StackerRepositoryUpdateListener } from "../stacker";
import { ConcreteStacker } from "../stacker";

export async function constructStacker(
  repoPath: string,
  repositoryUpdateListener: StackerRepositoryUpdateListener,
): Promise<Stacker> {
  const { owner, repo } = await repoPathToOwnerAndRepo(repoPath);
  return new ConcreteStacker(
    repoPath,
    repositoryUpdateListener,
    new GitHubCollaborationPlatform(repoPath, owner, repo),
    (stackerListener) => new GitSourceControl(repoPath, stackerListener),
  );
}

async function repoPathToOwnerAndRepo(
  repoPath: string,
): Promise<{ owner: string; repo: string }> {
  const repoResult = await nodegit.Repository.open(repoPath);
  // TODO: Handle remotes that are not named "origin"
  const remoteResult = await repoResult.getRemote("origin");
  const remoteUrl = remoteResult.url();
  // Sample URLs:
  // "https://github.com/taneliang/stack-attack"
  // "git@github.com:taneliang/stack-attack.git"
  // "git@github.com:taneliang/hello.world"
  const [rawRepo, owner] = remoteUrl
    .split("/")
    .flatMap((s) => s.split(":"))
    .reverse();
  const repo = rawRepo.endsWith(".git")
    ? rawRepo.substr(0, rawRepo.length - 4)
    : rawRepo;
  return { owner, repo };
}
