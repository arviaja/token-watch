# Makefile of token-watch, a Claude Code mod.
# `make verify` is the one entrypoint for the checks. Run it before each commit.
# It runs the targets text, secrets, validate and test in this order and fails when one fails.
# `make prices` lists the models in the store of the mod and shows how each one is priced. It informs, is not part of `verify` and always exits 0.
#
# Prerequisites:
#   - claude: the Claude Code CLI (`claude plugin validate` and `claude plugin test`)
#   - gitleaks: the secret scan
#   - perl: the dash check in scripts/check-dashes.sh (the version that ships with macOS and Linux)
#   - git and node (node runs scripts/prices.mjs; the typecheck target also needs npx)

.PHONY: verify text secrets validate test typecheck prices

verify: text secrets validate test

# No em dash (U+2014) and no en dash (U+2013) in any text file that git tracks or does not ignore.
text:
	bash scripts/check-dashes.sh

# gitleaks scans the history, the staged changes, the unstaged changes and the untracked files.
secrets:
	gitleaks git . --no-banner --redact --log-level warn
	gitleaks git . --staged --no-banner --redact --log-level warn
	gitleaks git . --pre-commit --no-banner --redact --log-level warn
	@git ls-files -z --others --exclude-standard | xargs -0 -I{} gitleaks dir "{}" --no-banner --redact --log-level warn

# The manifest and the hooks module follow the rules of Claude Code.
validate:
	claude plugin validate --strict .

# The tests in tests/, run by Claude Code.
test:
	claude plugin test .

# Type check with the TypeScript compiler. It is not in `verify` until the known errors (200 today) are fixed.
# It needs tsconfig.json and .claude-plugin/types/. Claude Code generates both when the mod loads, and git ignores both.
# In a fresh checkout or a new worktree they can be missing, and then this target fails for that reason.
typecheck:
	npx -y -p typescript@5.9.3 tsc --noEmit -p .

# The models that the mod saw, and how each one is priced: exact, fallback from <key> or unpriced.
# It reads ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store/token-watch_*.json and the keys of hooks/prices.ts.
# Run it after a new model shows `unpriced` or `≈`, then add the model to PRICES in hooks/prices.ts.
prices:
	node scripts/prices.mjs
