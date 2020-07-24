import type { Stacker, StackerRepositoryUpdateListener } from "../stacker";

import { GitSourceControl } from "../source-control";
import { GitHubCollaborationPlatform } from "../collaboration-platform";
import { ConcreteStacker } from "../stacker";

export function constructStacker(
  repoPath: string,
  repositoryUpdateListener: StackerRepositoryUpdateListener,
): Stacker {
  return new ConcreteStacker(
    repoPath,
    repositoryUpdateListener,
    new GitHubCollaborationPlatform(repoPath),
    (stackerListener) => new GitSourceControl(repoPath, stackerListener),
  );
}
