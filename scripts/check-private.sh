#!/usr/bin/env bash
# This repo is public. This check stops private data before it reaches GitHub.
#
# 1. No home path of a real user in a text file: a path below /Users or /home with a user name other than `me`,
#    with or without a slash after the name.
# 2. With a local list of private terms: none of the terms in a text file, in a commit message that is
#    not on origin/main yet, or in the name of the current branch.
#    The list has one extended regular expression on each line and is case-insensitive. A line that starts with # is a comment.
#    Its place is .git/info/private-terms, which git never commits. PRIVATE_TERMS_FILE names another file.
#    Without the list, only check 1 runs.
set -euo pipefail

status=0

files() {
  git ls-files -z --cached --others --exclude-standard
}

# 1. Home paths. Examples use the user `me`. The match ends with the user name, so a path without a slash after the name
#    counts too: a name before a quote, or at the end of a line. The user `me` stays allowed, and a longer name that starts with `me` does not.
if files | xargs -0 grep -I -n -o -E '/(Users|home)/[A-Za-z0-9._-]+' -- 2>/dev/null | grep -v -E ':/(Users|home)/me$'; then
  echo "check-private: a file contains a home path of a real user. Use /Users/me/ in examples." >&2
  status=1
fi

# 2. Private terms from the local list
list="${PRIVATE_TERMS_FILE:-$(git rev-parse --git-path info/private-terms)}"
if [ -f "$list" ]; then
  patterns="$(grep -v -E '^[[:space:]]*(#|$)' "$list" || true)"
  if [ -n "$patterns" ]; then
    if files | xargs -0 grep -I -n -i -E -f <(printf '%s\n' "$patterns") -- 2>/dev/null; then
      echo "check-private: a file contains a private term." >&2
      status=1
    fi
    range=HEAD
    if git rev-parse -q --verify origin/main >/dev/null; then
      range=origin/main..HEAD
    fi
    if git log --format='%h %s%n%b' "$range" | grep -i -E -f <(printf '%s\n' "$patterns"); then
      echo "check-private: a commit message that is not on origin/main contains a private term." >&2
      status=1
    fi
    branch="$(git branch --show-current)"
    if [ -n "$branch" ] && printf '%s\n' "$branch" | grep -q -i -E -f <(printf '%s\n' "$patterns"); then
      echo "check-private: the branch name '$branch' contains a private term." >&2
      status=1
    fi
  fi
fi

exit "$status"
