#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import React from "react";

import { constructStacker } from "../shared/constructStacker";

import App from "./App";

const defaultRepoPath = process.cwd();

const program = new Command();

program
  .name("sttack")
  .description(
    "Stack Attack: a CLI tool that helps you work with stacked pull requests.",
  )
  .on("--help", function () {
    console.log("");
    console.log("Examples:");
    console.log("");
    console.log("  $ sttack interactive");
    console.log("  $ sttack interactive --repo ~/covid/vaccine");
    console.log("  $ sttack i");
    console.log("  $ sttack rebase 40cddfe b85b476");
    console.log("  $ sttack pr-commit 40cddfe");
    console.log("  $ sttack pr-stack 40cddfe");
  });

program
  .command("interactive")
  .alias("i")
  .description("Stack Attack's interactive terminal UI")
  .option("-r, --repo <repoPath>", "path to Git repository")
  .action(async ({ repo = defaultRepoPath }: Command) => {
    render(React.createElement(App, { repoPath: repo }));
  });

program
  .command("rebase <rebaseRootCommit> <rebaseTargetCommit>")
  .alias("r")
  .description("replay a commit tree onto another commit")
  .option("-r, --repo <repoPath>", "path to Git repository")
  .action(
    async (
      rebaseRootCommitHash: string,
      rebaseTargetCommitHash: string,
      { repo = defaultRepoPath }: Command,
    ) => {
      const stacker = await constructStacker(repo, () => {});
      const rebaseRootCommit = await stacker.getCommitByHash(
        rebaseRootCommitHash,
      );
      if (!rebaseRootCommit) {
        console.error(`Commit ${rebaseRootCommitHash} could not be found.`);
        return;
      }
      const targetCommit = await stacker.getCommitByHash(
        rebaseTargetCommitHash,
      );
      if (!targetCommit) {
        console.error(`Commit ${rebaseTargetCommitHash} could not be found.`);
        return;
      }
      await stacker.rebaseCommits(rebaseRootCommitHash, rebaseTargetCommitHash);
    },
  );

// program
//   .command("amend")
//   .alias("a")
//   .description(
//     "amend a commit and rebase all commits originally above it onto the new commit",
//   )
//   .option("-r, --repo <repoPath>", "path to Git repository")
//   .action(async ({ repo = defaultRepoPath }: Command) => {
//     const stacker = constructStacker(repo, () => {});
//     await stacker.amendAndRebase();
//   });

program
  .command("pr-commit <commit>")
  .alias("prc")
  .description("create/update a PR for the given commit")
  .option("-r, --repo <repoPath>", "path to Git repository")
  .action(async (commitHash: string, { repo = defaultRepoPath }: Command) => {
    const stacker = await constructStacker(repo, () => {});
    const baseCommit = await stacker.getCommitByHash(commitHash);
    if (!baseCommit) {
      console.error(`Commit ${commitHash} could not be found.`);
      return;
    }
    await stacker.createOrUpdatePRContentsForSingleCommit(baseCommit);
  });

program
  .command("pr-stack <commit>")
  .alias("prs")
  .description(
    "create/update a PR for a commit stack based on the given commit",
  )
  .option("-r, --repo <repoPath>", "path to Git repository")
  .action(async (commitHash: string, { repo = defaultRepoPath }: Command) => {
    const stacker = await constructStacker(repo, () => {});
    const baseCommit = await stacker.getCommitByHash(commitHash);
    if (!baseCommit) {
      console.error(`Commit ${commitHash} could not be found.`);
      return;
    }
    await stacker.createOrUpdatePRContentsForCommitTreeRootedAtCommit(
      baseCommit,
    );
  });

program.parse(process.argv);
