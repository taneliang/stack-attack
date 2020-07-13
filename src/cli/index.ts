#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import meow from "meow";

import App from "./ui";

const cli = meow(`
	Usage
	  $ sttack

	Options
		--name  Your name

	Examples
	  $ sttack --name=Jane
	  Hello, Jane
`);

render(React.createElement(App, cli.flags));
