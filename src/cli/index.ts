#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import meow from "meow";

import App from "./App";
import { GitLocal } from "../local-git/GitLocalInterface";

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
    backend: new GitLocal(),
    repoPath: cli.input[0] ?? process.cwd(),
  }),
);
