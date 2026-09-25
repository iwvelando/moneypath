#!/bin/sh
# One-time developer setup (see DEVELOPMENT.md).
#
# - Uses the committed .githooks/ directory for git hooks.
# - Marks the embedded-web placeholder with skip-worktree so the local
#   `make dist` overwrite stops showing up in `git status`.
set -eu

cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath .githooks
echo "core.hooksPath -> .githooks"

git update-index --skip-worktree internal/webembed/dist/index.html
echo "skip-worktree  -> internal/webembed/dist/index.html"

echo "Done. Undo with:"
echo "  git config --unset core.hooksPath"
echo "  git update-index --no-skip-worktree internal/webembed/dist/index.html"
