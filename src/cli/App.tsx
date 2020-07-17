import type { NavigatorBackend, Repository } from "../NavigatorBackendType";

import React, { useState, useEffect, useCallback } from "react";
import { Text } from "ink";
import { RepositoryComponent } from "./RepositoryComponent";

interface Props {
  repoPath: string;
  backend: NavigatorBackend;
}

const App: React.FC<Props> = ({ backend, repoPath }) => {
  const [repository, setRepository] = useState<Repository>();
  const [isLoading, setIsLoading] = useState(false);

  async function reload() {
    setIsLoading(true);
    const {
      repo,
      remoteRepoInfoPromise,
    } = await backend.getRepositoryInformation(repoPath);
    setRepository({ ...repo });
    setIsLoading(false);
    setRepository({ ...(await remoteRepoInfoPromise) });
  }

  useEffect(() => {
    reload();
  }, [backend, repoPath]);

  if (isLoading) {
    return <Text>Loading</Text>;
  }

  if (!repository) {
    return <Text>Could not load repo</Text>;
  }

  return (
    <RepositoryComponent
      reload={reload}
      backend={backend}
      repository={repository}
    />
  );
};

export default App;
