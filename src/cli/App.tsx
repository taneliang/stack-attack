import { Commit, NavigatorBackend, Repository } from "../NavigatorBackendType";

import React, { useState, useEffect } from "react";
import { Text, Color, Box, useInput, useStdout, useApp } from "ink";

function makeCommits() {
  const existingStuffCommit: Commit = {
    title: "Existing stuff",
    hash: "1234",
    timestamp: new Date(0),
    author: "Commit McCommitFace",
    branchNames: ["master"],
    parentCommits: [],
    childCommits: [],
  };

  const newMasterCommit: Commit = {
    title: "Other peoples trash",
    hash: "1235",
    timestamp: new Date(100),
    author: "Commit McCommitFace",
    branchNames: ["origin/master"],
    parentCommits: [existingStuffCommit],
    childCommits: [],
  };
  existingStuffCommit.childCommits.push(newMasterCommit);

  const commit1: Commit = {
    title: "1",
    hash: "abc1",
    timestamp: new Date(1),
    author: "Commit McCommitFace",
    branchNames: [],
    parentCommits: [existingStuffCommit],
    childCommits: [],
  };
  existingStuffCommit.childCommits.push(commit1);

  const commit2: Commit = {
    title: "2",
    hash: "abc2",
    timestamp: new Date(2),
    author: "Commit McCommitFace",
    branchNames: [],
    parentCommits: [commit1],
    childCommits: [],
  };
  commit1.childCommits.push(commit2);

  return existingStuffCommit;
}

const backend: NavigatorBackend = {
  getRepositoryInformation(repoPath: string) {
    const repo = {
      path: "/",
      hasUncommittedChanges: true,
      headHash: "1234",
      rootDisplayCommit: makeCommits(),
    };
    return Promise.resolve({
      repo,
      remoteRepoInfoPromise: Promise.resolve(repo),
    });
  },

  createOrUpdateBranchesForCommitStack(
    repoPath: string,
    commitStack: Commit[],
  ) {
    return Promise.reject("NOT IMPLEMENTED");
  },

  rebaseCommits(repoPath: string, rootCommit: Commit, targetCommit: Commit) {
    return Promise.reject("NOT IMPLEMENTED");
  },

  amendAndRebaseDependentTree(repoPath: string) {
    return Promise.reject("NOT IMPLEMENTED");
  },

  createOrUpdatePRsForCommits(repoPath: string, commitStack: Commit[]) {
    return Promise.reject("NOT IMPLEMENTED");
  },
};

interface GraphLineProps {
  totalDepth: number;
  commitDepth: number;
  hasFork: boolean;
}
const GraphLine: React.FC<GraphLineProps> = ({
  totalDepth,
  commitDepth,
  hasFork,
}) => {
  const firstLine = Array.from({ length: totalDepth }, (_, i) => i)
    .map((_, idx) => (idx === commitDepth ? "*" : "|"))
    .join(" ");

  const secondLineBars = Array.from(
    { length: totalDepth - (hasFork ? 1 : 0) },
    (_, i) => i,
  )
    .map(() => "|")
    .join(" ");
  const secondLine = `${secondLineBars}${hasFork ? "/" : ""}`;

  return (
    <Color cyan>
      <Box height={2} flexDirection="column" paddingRight={1}>
        <Text>{firstLine}</Text>
        <Text>{secondLine}</Text>
      </Box>
    </Color>
  );
};

interface CommitInfoProps {
  commit: Commit;
}
const CommitInfo: React.FC<CommitInfoProps> = ({
  commit: { hash, timestamp, title, author, branchNames },
}) => (
  <Box flexDirection="row">
    <Text>
      <Color blueBright>{hash}</Color> -{" "}
    </Text>
    <Box flexDirection="column">
      <Text>
        <Color cyan>{timestamp.toISOString()}</Color>
        {branchNames.length > 0 && (
          <Color greenBright>{` (${branchNames.join(", ")})`}</Color>
        )}
      </Text>
      <Text>
        {title} - <Color blueBright>{author}</Color>
      </Text>
    </Box>
  </Box>
);

interface CommitGraphProps {
  rootCommit: Commit;
}
const CommitGraph: React.FC<CommitGraphProps> = ({ rootCommit }) => {
  const tops = [rootCommit];
  const commitComponents: React.ReactElement[] = [];
  const commitDepths = new Map<string, number>();

  // Assume commits are a DAG
  // TODO: Break on infinite loop
  while (tops.length > 0) {
    const totalDepth = tops.length;

    tops.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
    const [commit] = tops.splice(0, 1);

    let commitDepth = 0;
    let hasFork = false;
    if (commit.parentCommits.length === 0) {
      // Root commit, no parents
      commitDepth = 0;
    } else if (commit.parentCommits.length === 1) {
      // Regular commit
      const [parent] = commit.parentCommits;
      if (parent.childCommits.length === 0) {
        console.error(
          `Commit ${commit.hash} has a parent that does not have children!`,
        );
        commitDepth = 0;
      } else if (parent.childCommits.length === 1) {
        // Regular commit, use parent's depth
        commitDepth = commitDepths.get(parent.hash) ?? 0;
      } else if (parent.childCommits.length > 1) {
        // Use parent's depth + depth based on whether we're earlier or later.
        const diffFromParentDepth = parent.childCommits
          // Earlier commits have higher depth
          .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
          .indexOf(commit);
        commitDepth =
          diffFromParentDepth + (commitDepths.get(parent.hash) ?? 0);
        if (diffFromParentDepth > 0) {
          hasFork = true;
        }
      }
    } else if (commit.parentCommits.length > 1) {
      // Merge commit
      // TODO: handle merge commit
      commitDepth = 1;
    }
    commitDepths.set(commit.hash, commitDepth);

    commitComponents.push(
      <Box key={commit.hash} flexDirection="row">
        <GraphLine
          totalDepth={totalDepth}
          commitDepth={commitDepth}
          hasFork={hasFork}
        />
        <CommitInfo commit={commit} />
      </Box>,
    );
    tops.push(...commit.childCommits);
  }

  return <Box flexDirection="column-reverse">{commitComponents}</Box>;
};

interface AppProps {
  repoPath: string;
}
const App: React.FC<AppProps> = ({ repoPath }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [repository, setRepository] = useState<Repository>();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      if (repository || isLoading) return;
      setIsLoading(true);
      const {
        repo,
        remoteRepoInfoPromise,
      } = await backend.getRepositoryInformation(repoPath);
      setRepository(repo);
      setIsLoading(false);
      await remoteRepoInfoPromise;
      setRepository(repo);
    })();
  }, [repository, isLoading, setRepository, setIsLoading]);

  useInput((input, key) => {
    if (input === "q") {
      exit();
    }
    if (key.leftArrow) {
      // Left arrow key pressed
      stdout.write("LEFT Arrow");
    }
  });

  if (!repository) {
    return <Text>{isLoading ? "Loading" : "Could not load repo"}</Text>;
  }

  return (
    <Box flexDirection="column">
      <CommitGraph rootCommit={repository.rootDisplayCommit} />
      <Text>TODO: Line of commands</Text>
    </Box>
  );
};

export default App;
