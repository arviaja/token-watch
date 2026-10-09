# Makefile of token-watch, a Claude Code mod.
# `make verify` is the one entrypoint for the checks. Run it before each commit.
# It runs the targets text, secrets, private, validate and test in this order and fails when one fails.
# `make price-report` lists the models in the store of the mod and shows how each one is priced. It informs, is not part of `verify` and always exits 0.
#
# Prerequisites:
#   - claude: the Claude Code CLI (`claude plugin validate` and `claude plugin test`)
#   - gitleaks: the secret scan
#   - perl: the dash check in scripts/check-dashes.sh (the version that ships with macOS and Linux)
#   - git and node (node runs scripts/price-report.mjs; the typecheck target also needs npx)
#   - bash: scripts/check-private.sh

.PHONY: verify text secrets private validate test typecheck price-report

verify: text secrets private validate test

# No em dash (U+2014) and no en dash (U+2013) in any text file that git tracks or does not ignore.
text:
	bash scripts/check-dashes.sh

# gitleaks scans the history, the staged changes, the unstaged changes and the untracked files.
secrets:
	gitleaks git . --no-banner --redact --log-level warn
	gitleaks git . --staged --no-banner --redact --log-level warn
	gitleaks git . --pre-commit --no-banner --redact --log-level warn
	@git ls-files -z --others --exclude-standard | xargs -0 -I{} gitleaks dir "{}" --no-banner --redact --log-level warn

# This repo is public. No home path of a real user, and with the local list .git/info/private-terms no private term,
# in a file, a new commit message or the branch name. See "This repo is public" in AGENTS.md.
private:
	bash scripts/check-private.sh

# The manifest and the mod follow the rules of Claude Code.
validate:
	claude plugin validate --strict .

# The tests in tests/, run by Claude Code.
test:
	claude plugin test .

# Type check with the TypeScript compiler. It is not in `verify` until the known errors are fixed.
# It needs tsconfig.json and .claude-plugin/types/. Claude Code generates both when the mod loads, and git ignores both.
# In a fresh checkout or a new worktree they can be missing, and then this target fails for that reason.
typecheck:
	npx -y -p typescript@5.9.3 tsc --noEmit -p .

# The models that the mod saw, and how each one is priced: exact, fallback from <key>, unpriced or alias.
# It reads the store files of the mod. The keys of the price table are a copy in scripts/price-rule.mjs, and a test checks the copy.
# Run it after a new model shows `unpriced` or `≈`. AGENTS.md says where to add the model.
price-report:
	node scripts/price-report.mjs
