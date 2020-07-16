import Octokit from "@octokit/rest";
//const { createAppAuth } = require("@octokit/auth-app");
//const jwt = require("jsonwebtoken");
import fs from "fs";

let cachedOctokit: Octokit.Octokit | undefined;
let repoPathForCachedOctokit: string | undefined;

function octokitConstructor(repoPath: string): Octokit.Octokit {
  let personalAccessToken: string;
  try {
    const configFileContents = fs
      .readFileSync(`${repoPath}/sttack.config.json`)
      .toString();
    personalAccessToken = JSON.parse(configFileContents);
  } catch (e) {
    console.log(e);
    console.log(
      "Please create a token on GitHub (https://github.com/settings/tokens) and set it up on a sttack.config.json file",
    );
    process.exit(1);
  }
  const octokit = new Octokit.Octokit({
    auth: personalAccessToken,
  });
  return octokit;
}

export function getOctokit(repoPath: string): Octokit.Octokit {
  if (repoPathForCachedOctokit === repoPath && cachedOctokit) {
    return cachedOctokit;
  }
  cachedOctokit = octokitConstructor(repoPath);
  repoPathForCachedOctokit = repoPath;
  return cachedOctokit;
}
