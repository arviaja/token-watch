# Contributing

Bug reports, ideas and pull requests are welcome.

## Before you start

- For a bug, open an issue. Give the steps to reproduce it, the Claude Code version (`claude --version`) and the surface (CLI or desktop app).
- For a new function, open an issue first and describe the use case. A small fix can come directly as a pull request.
- For a security problem, do not open an issue. See [SECURITY.md](SECURITY.md).

## Set up

Prerequisites: the `claude` CLI (Claude Code 2.1.287 or later), `gitleaks`, `perl` and `git`. `make typecheck` and `make prices` also need Node.js.

1. Fork the repo and clone your fork.
2. Run the mod from the clone in one session: `claude --plugin-dir /path/to/token-watch`.
3. Run `make verify`. It must pass before you change anything.

[AGENTS.md](AGENTS.md) describes the architecture, the commands and the rules of the mods API. Read it before you change code.

## Make a change

- Make one branch for each change. Name it `type/topic`, for example `fix/band-width`. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
- Add or change tests with every change of behaviour. Tests are in `tests/` and run with `claude plugin test .`.
- Update the design doc in `docs/design/` when behaviour changes, and the README when users see the change.
- Write docs and commit messages in Simplified Technical English: short sentences, active voice, one word for one meaning.
- Use the ASCII hyphen-minus (`-`) for every dash. `make verify` checks this.
- Put no secret, personal data, name of a private repo, home path or real spend figure in a file, a commit message or a screenshot. Use neutral examples such as `webshop`.
- A price change in `hooks/prices.ts` names its source and the date that you read it.

## Pull requests

- Keep one change in each pull request.
- Say what changes and why, and how you tested it: `make verify`, and for a change that draws, a manual check in the CLI and in the desktop app.
- `make verify` must pass.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE) of this repo.
