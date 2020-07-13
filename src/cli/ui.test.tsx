import React from "react";
import chalk from "chalk";
import { render } from "ink-testing-library";
import App from "./ui";

test("greet unknown user", () => {
  const { lastFrame } = render(<App />);

  expect(lastFrame()).toEqual(chalk`Hello, {green Stranger}`);
});

test("greet user with a name", () => {
  const { lastFrame } = render(<App name="Jane" />);

  expect(lastFrame()).toEqual(chalk`Hello, {green Jane}`);
});
