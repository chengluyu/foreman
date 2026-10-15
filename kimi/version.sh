#!/bin/sh
# Foreman version stamps.
#   kimi/version.sh                check that every file, and every installed copy in
#                                  ~/.kimi-code/skills/foreman*, ~/.agents/agents and
#                                  ~/.kimi-code/agents, carries the version in VERSION
#   kimi/version.sh check DIR...    also check the foreman-*.md copies in each DIR
#   kimi/version.sh bump NEW       write NEW to VERSION and restamp this folder's files
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
v=$(cat "$dir/VERSION")
stamped="$dir/FOREMAN.md $dir/agents/foreman-*.md $dir/skills/foreman/SKILL.md $dir/skills/foreman/lead.md $dir/skills/foreman/review-bot.md $dir/skills/foreman-create/SKILL.md $dir/skills/foreman-resume/SKILL.md"
pattern='Foreman [0-9]+\.[0-9]+\.[0-9]+'

stamp_of() { grep -Eo "$pattern" "$1" | head -n 1; }

if [ "${1:-check}" = bump ]; then
  new=${2:?usage: kimi/version.sh bump NEW}
  echo "$new" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "not a version: $new"; exit 1; }
  for f in $stamped; do sed -i '' -E "s/$pattern/Foreman $new/" "$f"; done
  sed -i '' -E 's/"version": "[0-9]+\.[0-9]+\.[0-9]+"/"version": "'"$new"'"/' "$dir/../kimi.plugin.json"
  echo "$new" > "$dir/VERSION"
  echo "Foreman $v -> $new. Add a CHANGELOG.md entry, commit, tag v$new, then reinstall"
  echo "the plugin or copy skills/foreman* and agents/foreman-*.md to where you"
  echo "installed them, and start new sessions."
  exit 0
fi

[ "${1:-}" = check ] && shift
files="$stamped $HOME/.kimi-code/skills/foreman*/SKILL.md $HOME/.kimi-code/skills/foreman/lead.md $HOME/.kimi-code/skills/foreman/review-bot.md $HOME/.agents/agents/foreman-*.md $HOME/.kimi-code/agents/foreman-*.md"
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
for d in "$HOME/.agents/agents" "$HOME/.kimi-code/agents"; do
  if [ -f "$d/foreman-worker.md" ]; then
    echo "old profile left: $d/foreman-worker.md"
    status=1
  fi
done
[ "$status" = 0 ] && echo "All files at Foreman $v."
exit "$status"
