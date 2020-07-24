import type { Stacker } from "../stacker";
import type { Repository } from "../shared/types";

import React from "react";
import { Text } from "ink";
import { RepositoryComponent } from "./RepositoryComponent";

interface Props {
  stacker: Stacker;
  repository: Repository | null;
  reload: () => void;
}

const App: React.FC<Props> = ({ stacker, repository, reload }) => {
  if (!repository) {
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
