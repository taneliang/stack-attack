# Stack Attack

Stack Attack is a CLI tool that helps you manage your GitHub repo and makes stacking PRs a piece of cake.

## Inspiration

It is mildly annoying how the cascading commits hamper workflow and we wanted to build a tool that can merge and rebase all of these commits on the branch/commit one desires. As a team, we like to follow the ideologies that PR should _NOT_ be big. But we understand that Big PRs are hard to break into small ones since they need to depend on each other. Also updates to earlier PRs or the base branch would require A LOT of individual rebases of every PR in the dependecy stack. To take this headache away from you, we now introduce _Stack Attack_.

## Prerequisites

- Node.js
- Yarn
- A repo to work hack on

## How to Use It

1. Clone this repo
2. Add a `sttack.config.json` file with the following format:

```{
  "personalAccessToken": "enter your github personal token",
  "userPublicKeyPath": "enter path to your public key, eg: /Users/phuonganh/.ssh/id_rsa.pub",
  "userPrivateKeyPath": "enter path to your private key, eg: /Users/phuonganh/.ssh/id_rsa",
  "userPassphrase": "enter your passphrase"
}
```

Note: If you do not have a GitHub token, you can create one following [this](https://github.com/settings/tokens)

3. Run `yarn install`
4. Run `yarn cli <repo_path>` where `repo_path` is the local repository path.

## Features 

### Rebase 

### PR Stack 

## Built With

- [Nodejs](https://nodejs.org/en/) :computer: - A JavaScript runtime built on Chrome's V8 JavaScript engine.
- [Git](https://www.git-scm.com/doc) :smile: - Version Control Management
- [Typescript](https://www.typescriptlang.org/) :heart: - Semantics

## Contributors

Thanks goes to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://github.com/taneliang"><img src="https://avatars2.githubusercontent.com/u/12784593?s=400&u=0a8be59a4172b51c0e7c4993eef9b451831c6f56&v=4" width="100px;" alt=""/><br /><sub>
    <a href="https://github.com/taneliang" title="Frontend/Backend">E-Liang Tan</a> </sub></a><br />
    <td align="center"><a href="https://github.com/manyaagarwal"><img src="https://avatars0.githubusercontent.com/u/44937027?s=400&v=4" width="100px;" alt=""/><br /><sub>
    <a href="https://github.com/manyaagarwal" title="Github Integration">Manya Agarwal</a></sub></a><br /> 
    <td align="center"><a href="https://github.com/jessieAnhNguyen"><img src="https://avatars1.githubusercontent.com/u/47696418?s=400&u=fcf97bc3760d3cbb6da2b1f94e363907b4752fe3&v=4" width="100px;" alt=""/><br /><sub>
    <a href="https://github.com/jessieAnhNguyen" title="Github Integration">Jessie Anh</a></sub></a><br /> 
    <td align="center"><a href="https://github.com/saphal1998"><img src="https://avatars0.githubusercontent.com/u/31125345?s=460&v=4" width="100px;" alt=""/><br /><sub>
    <a href="https://github.com/saphal1998" title="Local Git">Saphal Patro</a></sub></a><br /> 
  </tr>
</table>

<!-- markdownlint-enable -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
