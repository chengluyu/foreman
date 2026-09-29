#!/bin/sh
# Foreman: prints this repository's Foreman setup for the /foreman skill. On first
# use it creates HANDOVER.md from the template in the main checkout, which every
# worktree of the repository shares, and keeps it out of git.
dir=$(cd "$(dirname "$0")" && pwd)

root=$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$root" ] || root=$(pwd)

handover="$root/HANDOVER.md"
if [ -f "$handover" ]; then
  state="exists"
else
  cp "$dir/HANDOVER.md" "$handover"
  state="just created from the template; its Standing rules are still empty"
  if [ -n "$common" ]; then
    mkdir -p "$common/info"
    grep -qx 'HANDOVER.md' "$common/info/exclude" 2>/dev/null ||
      echo 'HANDOVER.md' >> "$common/info/exclude"
  fi
fi

setting() { sed -n "s/^- $1: *//p" "$handover" | head -n 1; }
bot=$(setting 'Review bot')

echo "- Repository: $(basename "$root"), main checkout $root"
echo "- Working directory: $(pwd)"
echo "- Handover: $handover ($state)"
echo "- Review bot: ${bot:-none}"
echo "- Sonnet workers: $(setting 'Sonnet workers')"
echo "- Builder: $(setting 'Builder')"
case "$bot" in
  ''|none|None|'<'*) ;;
  *) echo; cat "$dir/review-bot.md" ;;
esac
