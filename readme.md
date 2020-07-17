# Stack Attack 
Stack Attack is a CLI tool that helps you manage your GitHub repo and makes stacking PRs a piece of cake.

## Inspiration 
It is mildly annoying how the cascading commits hamper workflow and the Stack Attack tean wanted to build a tool that can merge and rebase all of these commits on the branch/commit one desires. As a team, we like to follow the ideologies that PR should *NOT* be big. But we understand that Big PRs are hard to break into small ones since they need to depend on each other. Also updates to earlier PRs or the base branch would require A LOT of individual rebases of every PR in the dependecy stack. To take this headache away from you, we now introduce *Stack Attack*. 

## How to Use It

1. Clone this repo 
2. Add a `sttack.config.json` file with the following format: 
`{
  "personalAccessToken": "enter your personal token, you can create from (https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token)",
  "userPublicKeyPath": "enter path to your public key, eg: /Users/phuonganh/.ssh/id_rsa.pub",
  "userPrivateKeyPath": "enter path to your private key, eg: /Users/phuonganh/.ssh/id_rsa",
  "userPassphrase": "enter your passphrase"
}`

Note: If you do not have a GitHub token, you can create one following [this](https://github.com/settings/tokens) 

3. Run `yarn install` 
4. Run `yarn cli <repo_path>` where `repo_path` is the local repository path. 



