import type { Commit, Repository } from "../NavigatorBackendType";

import React from "react";
import { Text, Box, useInput, useApp, useFocus } from "ink";
import { useInteractionReducer, DisplayCommit } from "./useInteractionReducer";

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
  commits: DisplayCommit[];
}
const CommitGraph: React.FC<CommitGraphProps> = ({ commits }) => (
  <Box flexDirection="column-reverse">
    {commits.map(({ commit, totalDepth, commitDepth, hasFork }) => (
      <Box key={commit.hash} flexDirection="row">
        <GraphLine
          totalDepth={totalDepth}
          commitDepth={commitDepth}
          hasFork={hasFork}
        />
        <CommitInfo commit={commit} />
      </Box>
    ))}
  </Box>
);

interface RepositoryComponentProps {
  repository: Repository;
}
export const RepositoryComponent: React.FC<RepositoryComponentProps> = ({
  repository,
}) => {
  const { exit } = useApp();

  const [state, dispatch] = useInteractionReducer(repository);

  useInput((input, key) => {
    if (input === "q") {
      exit();
    }
    if (key.upArrow) {
      dispatch({ type: "move up" });
    }
  });

  return (
    <Box flexDirection="column">
      <CommitGraph commits={state.commits} />
      <Text>TODO: Line of commands</Text>
    </Box>
  );
};
