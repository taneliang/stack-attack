import React from "react";
import { Text, Color } from "ink";

interface Props {
  name?: string;
}

const App: React.FC<Props> = ({ name = "Stranger" }) => (
  <Text>
    Hello, <Color green>{name}</Color>
  </Text>
);

export default App;
