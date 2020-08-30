import { Text } from "ink";
import React, { useCallback, useState, useEffect } from "react";

import { constructStacker } from "../shared/constructStacker";
import type { Repository } from "../shared/types";
import type { Stacker, StackerRepositoryUpdateListener } from "../stacker";

import { RepositoryComponent } from "./RepositoryComponent";

interface Props {
  repoPath: string;
}

const App: React.FC<Props> = ({ repoPath }) => {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [stacker, setStacker] = useState<Stacker | null>(null);

  const repositoryUpdateListener: StackerRepositoryUpdateListener = useCallback(
    (repo) => {
      setRepository(repo);
    },
    [setRepository],
  );

  useEffect(() => {
    constructStacker(repoPath, repositoryUpdateListener).then((newStacker) => {
      newStacker.loadRepositoryInformation();
      setStacker(newStacker);
    });
  }, [repoPath, repositoryUpdateListener, setStacker]);

  const reload = useCallback(() => stacker?.loadRepositoryInformation(), [
    stacker,
  ]);

  if (!stacker || !repository) {
    return <Text>Loading</Text>;
  }

  return (
    <RepositoryComponent
      stacker={stacker}
      repository={repository}
      reload={reload}
    />
  );
};

export default App;
