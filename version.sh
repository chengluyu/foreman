#!/bin/sh
# Foreman version stamps.
#   ./version.sh                   check that every file carries the version in VERSION,
#                                  and that no copied install is left in ~/.claude
#   ./version.sh bump NEW          write NEW to VERSION and restamp this folder's files
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
v=$(cat "$dir/VERSION")
stamped="$dir/lead/lead.md $dir/lead/review-bot.md $dir/FOREMAN.md $dir/agents/*.md $dir/skills/run/SKILL.md $dir/skills/create/SKILL.md $dir/skills/resume/SKILL.md $dir/hooks/register.tsx"
pattern='Foreman [0-9]+\.[0-9]+\.[0-9]+'

stamp_of() { grep -Eo "$pattern" "$1" | head -n 1; }

if [ "${1:-check}" = bump ]; then
  new=${2:?usage: ./version.sh bump NEW}
  echo "$new" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "not a version: $new"; exit 1; }
  # sed -i takes different arguments on macOS and Linux, so write a copy and move it back.
  edit() { sed -E "$1" "$2" > "$2.tmp" && mv "$2.tmp" "$2"; }
  for f in $stamped; do edit "s/$pattern/Foreman $new/" "$f"; done
  edit 's/"version": "[0-9]+\.[0-9]+\.[0-9]+"/"version": "'"$new"'"/' "$dir/.claude-plugin/plugin.json"
  echo "$new" > "$dir/VERSION"
  echo "Foreman $v -> $new. Add a CHANGELOG.md entry, commit, tag v$new and push;"
  echo "then run claude plugin marketplace update foreman and"
  echo "claude plugin update foreman@foreman, and start new sessions."
  exit 0
fi

status=0
for f in $stamped; do
  [ -f "$f" ] || continue
  found=$(stamp_of "$f")
  if [ "$found" != "Foreman $v" ]; then
    echo "stale: $f (${found:-no stamp})"
    status=1
  fi
done
# The plugin replaces copies installed by hand, which would otherwise win.
for f in "$HOME"/.claude/agents/foreman-*.md "$HOME"/.claude/skills/foreman*; do
  [ -e "$f" ] || continue
  echo "old copy left, delete it: $f"
  status=1
done
[ "$status" = 0 ] && echo "All files at Foreman $v."
exit "$status"
