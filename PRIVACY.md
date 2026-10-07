# Privacy policy

This policy describes the data that token-watch, a Claude Code mod, reads, stores and sends.

## Summary

token-watch collects no personal data. It sends no data to the author or to a third party. It sends data to Anthropic only for `/token-watch recommend`, after you confirm the cost in a dialog: one model call through your Claude Code session, with the usage data that the tabs show. It makes no other network request. All data that it stores stays on your computer.

## What the mod reads

The mod reads from Claude Code, in the Claude Code process on your computer:

- the token counts and the model of each model request (input, output, cache read and cache write tokens)
- the plan limits that Claude Code measures (weekly and 5-hour percent used, reset time)
- the session ID, and the name of the folder of the repo that the session runs in (the last part of the path, not the full path)
- the subagent type of each subagent (for example `Explore`)
- the context breakdown of the session, when you open the Why tab or run `/token-watch recommend`: categories, names of memory files, MCP servers and custom agents, with their token counts

To count tokens, the mod hooks each model request. Claude Code passes the hook the request and its result, as it does for every hook of that event. The mod uses only the token counts and the model from them. It does not keep, store or send your prompts, the replies of the model, tool calls or the content of your files.

## What the mod stores

- One snapshot for each conversation in the mod store of Claude Code, `~/.claude/plugins/store/` on your computer. A snapshot holds the session ID, the repo folder name, the model, timestamps, the context size, the plan limit readings and the token counts and estimated costs for each hour, model and scope.
- The context breakdown stays in the memory of the session. The mod does not write it to disk.
- The prompt and the reply of `/token-watch recommend` stay in the memory of the session while the dialog is open. The mod does not write them to disk or into the conversation. The token counts and the estimated cost of the call go into the snapshot, under the scope `recommend`.

The mod deletes snapshots older than 8 days when a session that runs the mod starts. To delete all data now, delete the files `~/.claude/plugins/store/token-watch_*.json`.

## What the mod sends

The band, the pane and the dialog are drawn only on your screen.

`/token-watch recommend` sends one request to Anthropic, and only after you press **Ask** in its dialog. The request goes through the API client and the credentials of your Claude Code session, to the model that the option `recommendModel` names (default `sonnet`). It holds:

- a fixed system prompt that describes the task
- the data of the Session, Week and Why tabs: token counts, estimated costs, plan limit readings, the cache history and the resumes of this conversation, the context breakdown with the names of memory files (the paths as the Why tab shows them), MCP servers and custom agents, and the repo folder names and costs of the sessions on this computer in the current week
- the API prices of the price table of the mod

It holds no prompt, no reply of the session model, no tool call, no transcript text and no file content. Anthropic processes the request as it processes the other requests of your Claude Code session.

Each `/token-watch` adds a short note of the command to the conversation, as every slash command does. Claude Code sends the conversation to Anthropic as usual. The mod adds no other content to it.

## Contact

Ask questions about this policy in an issue: <https://github.com/arviaja/token-watch/issues>. Report a security problem privately, as [SECURITY.md](SECURITY.md) describes.
