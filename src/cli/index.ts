#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import meow from "meow";
import { backend } from "../NavigatorInMemoryBackend";

import App from "./App";

const cli = meow(`
	Usage
	  $ sttack [repoPath]

	Examples
	  $ sttack repoPath
	  Hello, Jane
`);

render(
  React.createElement(App, {
    // TODO: replace with Git backend
    backend,
    repoPath: cli.input[0] ?? process.cwd(),
  }),
);
