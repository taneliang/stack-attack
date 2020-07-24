#!/usr/bin/env node

import type { Repository } from "../shared/types";
import type { StackerRepositoryUpdateListener } from "../stacker";

import React from "react";
import { render } from "ink";
import meow from "meow";

import App from "./App";
import { constructStacker } from "../shared/constructStacker";

const cli = meow(`
	Usage
	  $ sttack [repoPath]

	Examples
	  $ sttack repoPath
	  Hello, Jane
`);

const repoPath = cli.input[0] ?? process.cwd();

let repository: Repository | null = null;

const repositoryUpdateListener: StackerRepositoryUpdateListener = (repo) => {
  repository = repo;
};
const stacker = constructStacker(repoPath, repositoryUpdateListener);
stacker.loadRepositoryInformation();

function reload() {
  stacker.loadRepositoryInformation();
}

render(React.createElement(App, { stacker, repository, reload }));
