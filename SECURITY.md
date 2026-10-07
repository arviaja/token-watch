# Security policy

token-watch is a Claude Code mod. It is not sandboxed: it runs in the Claude Code process with your permissions. It reads token counts and plan limits from Claude Code and writes snapshots to the mod store (`~/.claude/plugins/store/`). It calls a model only for `/token-watch recommend`, after you confirm the cost in a dialog. That call goes through the API client of the Claude Code session (`$.model.complete`) and sends only the usage data that the tabs show. The mod sends no other network request.

## Supported versions

Only the latest version on the `main` branch gets fixes.

## Report a vulnerability

Do not open a public issue. Report it privately: on the Security tab of this repo, select **Report a vulnerability**.

Give the steps to reproduce it, the token-watch version (`version` in `.claude-plugin/plugin.json`), the Claude Code version (`claude --version`) and the impact that you expect.
