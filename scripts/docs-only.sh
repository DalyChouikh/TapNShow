#!/bin/sh
# Exits 0 when every file changed between two commits is documentation, 1 otherwise.
# Documentation: anything under docs/, and *.md files anywhere. Any doubt (an empty or unknown
# base, a git error, no change at all) exits 1, so callers run everything.
# Callers: CI (.github/workflows/ci.yml) and Vercel's Ignored Build Step (vercel-ignore-build.sh).
# Usage: sh scripts/docs-only.sh <base> <head>
base=$1
head=$2
[ -n "$base" ] && [ -n "$head" ] || exit 1
# --no-renames lists both paths of a rename, so moving code into docs/ counts as a code change.
files=$(git -c core.quotePath=false diff --name-only --no-renames "$base" "$head" --) || exit 1
[ -n "$files" ] || exit 1
other=$(printf '%s\n' "$files" | grep -c -v -E '^docs/|\.md$')
echo "docs-only: $(printf '%s\n' "$files" | wc -l | tr -d ' ') changed, $other outside the documentation" >&2
[ "$other" -eq 0 ]
