import type { Repository, NavigatorBackend } from "../NavigatorBackendType";

import React from "react";
import { Text, Box, useInput, useApp } from "ink";
import {
  useInteractionReducer,
  DisplayCommit,
  Command,
} from "./useInteractionReducer";

interface GraphLineProps {
  totalDepth: number;
  commitDepth: number;
  hasFork: boolean;
  isFocused: boolean;
  isBeingMoved: boolean;
}
const GraphLine: React.FC<GraphLineProps> = ({
  totalDepth,
  commitDepth,
  hasFork,
  isFocused,
  isBeingMoved,
}) => {
  const firstLine = Array.from({ length: totalDepth }, (_, i) => i)
    .map((_, idx) =>
      idx === commitDepth ? (isBeingMoved ? "@" : isFocused ? ">" : "*") : "|",
    )
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
  displayCommit: DisplayCommit;
}
const CommitInfo: React.FC<CommitInfoProps> = ({
  displayCommit: {
    commit: { hash, timestamp, title, author, branchNames },
    isFocused,
    isBeingMoved,
  },
}) => {
  return (
    <Box flexDirection="row">
      <Text dimColor={isBeingMoved}>
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
          {title} - <Text color="blueBright">{author.toString()}</Text>
        </Text>
      </Box>
    </Box>
  );
};

interface CommitGraphProps {
  displayCommits: DisplayCommit[];
}
const CommitGraph: React.FC<CommitGraphProps> = ({ displayCommits }) => (
  <Box flexDirection="column-reverse">
    {displayCommits.map((displayCommit) => (
      <Box key={displayCommit.commit.hash} flexDirection="row">
        <GraphLine
          totalDepth={displayCommit.totalDepth}
          commitDepth={displayCommit.commitDepth}
          hasFork={displayCommit.hasFork}
          isFocused={displayCommit.isFocused}
          isBeingMoved={displayCommit.isBeingMoved}
        />
        <CommitInfo displayCommit={displayCommit} />
      </Box>
    ))}
  </Box>
);

interface CommandListProps {
  commands: Command[];
}
const CommandList: React.FC<CommandListProps> = ({ commands }) => (
  <Box marginTop={1}>
    {commands.map(({ key, name }) => (
      <Box key={key} marginRight={2}>
        <Box marginRight={1} flexShrink={0}>
          <Text color="white">({key})</Text>
        </Box>
        <Text color="gray">{name}</Text>
      </Box>
    ))}
  </Box>
);

interface RepositoryComponentProps {
  backend: NavigatorBackend;
  repository: Repository;
}
export const RepositoryComponent: React.FC<RepositoryComponentProps> = ({
  backend,
  repository,
}) => {
  const { exit } = useApp();

  const [state, dispatch] = useInteractionReducer(backend, repository);

  useInput((input, key) => {
    if (input === "q") {
      exit();
    } else if (key.upArrow) {
      dispatch({ type: "key", payload: { key: "↑", dispatch } });
    } else if (key.downArrow) {
      dispatch({ type: "key", payload: { key: "↓", dispatch } });
    } else {
      dispatch({ type: "key", payload: { key: input, dispatch } });
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginY={1} marginLeft={1}>
        <Text backgroundColor="yellow" color="#000" bold>
          {" "}
          STACK ATTACK{" "}
        </Text>
        <Text color="gray"> Repository: </Text>
        <Text color="white">{repository.path}</Text>
      </Box>
      <CommitGraph displayCommits={state.commits} />
      <CommandList commands={Array.from(state.keyboardCommands.values())} />
    </Box>
  );
};
