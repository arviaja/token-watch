# Security policy

token-watch is a Claude Code mod. It is not sandboxed: it runs in the Claude Code process with your permissions. It reads token counts and plan limits from Claude Code and writes snapshots to the mod store (`~/.claude/plugins/store/`). It sends no network request and calls no model.

## Supported versions

Only the latest version on the `main` branch gets fixes.

## Report a vulnerability

Do not open a public issue. Report it privately: on the Security tab of this repo, select **Report a vulnerability**.

Give the steps to reproduce it, the token-watch version (`version` in `.claude-plugin/plugin.json`), the Claude Code version (`claude --version`) and the impact that you expect.
