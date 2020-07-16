import { Octokit } from "@octokit/rest";
import fs from "fs";

let cachedOctokit: Octokit | undefined;
let repoPathForCachedOctokit: string | undefined;

function octokitConstructor(repoPath: string): Octokit {
  let personalAccessToken: string;
  try {
    const configFileContents = fs
      .readFileSync(`${repoPath}/sttack.config.json`)
      .toString();
    personalAccessToken = JSON.parse(configFileContents);
  } catch (error) {
    console.log(error);
    console.log(
      "Please create a token on GitHub (https://github.com/settings/tokens) and set it up on a sttack.config.json file",
    );
    process.exit(1);
  }

  const octokit = new Octokit({
    auth: personalAccessToken,
  });
  return octokit;
}

export function getOctokit(repoPath: string): Octokit {
  if (repoPathForCachedOctokit === repoPath && cachedOctokit) {
    return cachedOctokit;
  }

  cachedOctokit = octokitConstructor(repoPath);
  repoPathForCachedOctokit = repoPath;
  return cachedOctokit;
}
