import type { Commit, Repository } from "../NavigatorBackendType";

import React from "react";
import { Text, Box, useInput, useStdout, useApp, useFocus } from "ink";

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
    <Box height={2} flexDirection="column" paddingRight={1}>
      <Text color="cyan">{firstLine}</Text>
      <Text color="cyan">{secondLine}</Text>
    </Box>
  );
};

interface CommitInfoProps {
  commit: Commit;
}
const CommitInfo: React.FC<CommitInfoProps> = ({
  commit: { hash, timestamp, title, author, branchNames },
}) => {
  const { isFocused } = useFocus();
  return (
    <Box flexDirection="row">
      <Text>
        <Text
          color="blueBright"
          backgroundColor={isFocused ? "yellow" : "none"}>
          {hash}
        </Text>{" "}
        -{" "}
      </Text>
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">{timestamp.toISOString()}</Text>
          {branchNames.length > 0 && (
            <Text color="greenBright">{` (${branchNames.join(", ")})`}</Text>
          )}
        </Box>
        <Text>
          {title} - <Text color="blueBright">{author}</Text>
        </Text>
      </Box>
    </Box>
  );
};

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

interface RepositoryComponentProps {
  repository: Repository;
}
export const RepositoryComponent: React.FC<RepositoryComponentProps> = ({
  repository: { rootDisplayCommit },
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  useInput((input, key) => {
    if (input === "q") {
      exit();
    }
    if (key.leftArrow) {
      // Left arrow key pressed
      stdout?.write("LEFT Arrow");
    }
  });

  return (
    <Box flexDirection="column">
      <CommitGraph rootCommit={rootDisplayCommit} />
      <Text>TODO: Line of commands</Text>
    </Box>
  );
};
