#!/bin/sh
# Vercel's Ignored Build Step ("ignoreCommand" in vercel.json): exit 0 skips the build, any
# other code builds. It skips only when documentation alone changed (scripts/docs-only.sh) since
# the branch's last successful deployment, or since the production branch on a branch's first
# deployment (VERCEL_GIT_PREVIOUS_SHA is empty then). Vercel clones only the last 10 commits: an
# older commit is missing, and docs-only.sh then builds.
here=$(dirname "$0")
# The production branch; .github/workflows/ci.yml runs on pushes to the same one.
production_branch=main
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  exec sh "$here/docs-only.sh" "$VERCEL_GIT_PREVIOUS_SHA" HEAD
fi
[ -n "$VERCEL_GIT_REPO_OWNER" ] && [ -n "$VERCEL_GIT_REPO_SLUG" ] || exit 1
# The repository is public, so the fetch needs no credentials; a stalled fetch gives up after 10 s.
GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=10 git fetch --quiet --depth=1 \
  "https://github.com/$VERCEL_GIT_REPO_OWNER/$VERCEL_GIT_REPO_SLUG.git" "$production_branch" || exit 1
exec sh "$here/docs-only.sh" FETCH_HEAD HEAD
