# Privacy policy

This policy describes the data that token-watch, a Claude Code mod, reads, stores and sends.

## Summary

token-watch collects no personal data. It sends no data to the author, to Anthropic or to a third party. It makes no network request and calls no model. All data that it stores stays on your computer.

## What the mod reads

The mod reads from Claude Code, in the Claude Code process on your computer:

- the token counts and the model of each model request (input, output, cache read and cache write tokens)
- the plan limits that Claude Code measures (weekly and 5-hour percent used, reset time)
- the session ID, and the name of the folder of the repo that the session runs in (the last part of the path, not the full path)
- the subagent type of each subagent (for example `Explore`)
- the context breakdown of the session, when you open the Why tab: categories, names of memory files, MCP servers and custom agents, with their token counts

To count tokens, the mod hooks each model request. Claude Code passes the hook the request and its result, as it does for every hook of that event. The mod uses only the token counts and the model from them. It does not keep, store or send your prompts, the replies of the model, tool calls or the content of your files.

## What the mod stores

- One snapshot for each conversation in the mod store of Claude Code, `~/.claude/plugins/store/` on your computer. A snapshot holds the session ID, the repo folder name, the model, timestamps, the context size, the plan limit readings and the token counts and estimated costs for each hour, model and scope.
- The context breakdown stays in the memory of the session. The mod does not write it to disk.

The mod deletes snapshots older than 8 days when a session that runs the mod starts. To delete all data now, delete the files `~/.claude/plugins/store/token-watch_*.json`.

## What the mod sends

Nothing. The band and the pane are drawn only on your screen.

Each `/token-watch` adds a short note of the command to the conversation, as every slash command does. Claude Code sends the conversation to Anthropic as usual. The mod adds no other content to it.

## Contact

Ask questions about this policy in an issue: <https://github.com/arviaja/token-watch/issues>. Report a security problem privately, as [SECURITY.md](SECURITY.md) describes.
