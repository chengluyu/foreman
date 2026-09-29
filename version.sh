#!/bin/sh
# Foreman version stamps.
#   ./version.sh                   check that every file, and every installed copy
#                                  in ~/.claude/agents, carries the version in VERSION
#   ./version.sh check DIR...      also check the foreman-*.md copies in each DIR
#   ./version.sh bump NEW          write NEW to VERSION and restamp this folder's files
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
v=$(cat "$dir/VERSION")
stamped="$dir/lead.md $dir/FOREMAN.md $dir/agents/foreman-*.md"
pattern='Foreman [0-9]+\.[0-9]+\.[0-9]+'

stamp_of() { grep -Eo "$pattern" "$1" | head -n 1; }

if [ "${1:-check}" = bump ]; then
  new=${2:?usage: ./version.sh bump NEW}
  echo "$new" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "not a version: $new"; exit 1; }
  for f in $stamped; do sed -i '' -E "s/$pattern/Foreman $new/" "$f"; done
  echo "$new" > "$dir/VERSION"
  echo "Foreman $v -> $new. Add a CHANGELOG.md entry, commit, tag v$new, then copy"
  echo "agents/foreman-*.md to wherever you installed them and start new sessions."
  exit 0
fi

[ "${1:-}" = check ] && shift
files="$stamped $HOME/.claude/agents/foreman-*.md"
for d in "$@"; do files="$files $d/foreman-*.md"; done
status=0
for f in $files; do
  [ -f "$f" ] || continue
  found=$(stamp_of "$f")
  if [ "$found" != "Foreman $v" ]; then
    echo "stale: $f (${found:-no stamp})"
    status=1
  fi
done
if [ -f "$HOME/.claude/agents/foreman-worker.md" ]; then
  echo "old profile left: ~/.claude/agents/foreman-worker.md"
  status=1
fi
[ "$status" = 0 ] && echo "All files at Foreman $v."
exit "$status"
