import type { NavigatorBackend, Repository } from "../NavigatorBackendType";

import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { RepositoryComponent } from "./RepositoryComponent";

interface Props {
  repoPath: string;
  backend: NavigatorBackend;
}

const App: React.FC<Props> = ({ backend, repoPath }) => {
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
      setRepository(await remoteRepoInfoPromise);
    })();
  }, [backend, repoPath, repository, isLoading, setRepository, setIsLoading]);

  if (!repository) {
    return <Text>{isLoading ? "Loading" : "Could not load repo"}</Text>;
  }

  return <RepositoryComponent repository={repository} />;
};

export default App;
