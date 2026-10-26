#!/bin/sh
# Foreman start script, run by the /foreman, /foreman-create and /foreman-resume skills.
#
#   foreman-start.sh                  one HANDOVER.md per repository (no topics yet)
#   foreman-start.sh create TOPIC     new topic: handovers/TOPIC.md plus handovers/_shared.md
#   foreman-start.sh resume TOPIC     continue an existing topic
#   foreman-start.sh list             list the topics
#   foreman-start.sh rules            the shared settings, and the review-bot rules when
#                                     the shared rules name a bot (no arguments are
#                                     passed from the skills, so it is safe to inject)
#
# Handovers live in the repository's main checkout, which every worktree shares, and
# are kept out of git through the common git directory's info/exclude. A problem is
# printed as a line starting with "STOP:" and the script exits 0, so the skill shows
# it to the lead instead of failing to load.
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
mode=${1:-single}
topic=${2:-}

root=$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
[ -n "$root" ] || root=$(pwd)
handovers="$root/handovers"

exclude() {
  [ -n "$common" ] || return 0
  mkdir -p "$common/info"
  grep -qx "$1" "$common/info/exclude" 2>/dev/null || echo "$1" >> "$common/info/exclude"
}

topics() {
  for f in "$handovers"/*.md; do
    [ -f "$f" ] || continue
    n=$(basename "$f" .md)
    case $n in _*) ;; *) echo "$n" ;; esac
  done
}

stop() {
  echo "STOP: $1"
  list=$(topics | tr '\n' ' ')
  echo "Topics in $(basename "$root"): ${list:-none}"
  exit 0
}

settings() {
  setting() {
    v=$(sed -n "s/^- $1: *//p" "$handover" 2>/dev/null | head -n 1)
    [ -n "$v" ] || v=$(sed -n "s/^- $1: *//p" "$rules" 2>/dev/null | head -n 1)
    echo "$v"
  }
  bot=$(setting 'Review bot')
  echo "- Review bot: ${bot:-none}"
  echo "- Sonnet workers: $(setting 'Sonnet workers')"
  echo "- Builder: $(setting 'Builder')"
  case "$bot" in
    ''|none|None|'<'*) ;;
    *) echo; cat "$dir/review-bot.md" ;;
  esac
}

case $mode in
  single)
    if [ -d "$handovers" ]; then
      stop "this repository keeps one handover per topic. Use /foreman-resume TOPIC, or /foreman-create TOPIC for a new one."
    fi
    handover="$root/HANDOVER.md"
    rules="$handover"
    if [ -f "$handover" ]; then
      state="exists"
    else
      cp "$dir/HANDOVER.md" "$handover"
      state="just created from the template; its Standing rules are still empty"
      exclude 'HANDOVER.md'
    fi
    echo "- Repository: $(basename "$root"), main checkout $root"
    echo "- Working directory: $(pwd)"
    echo "- Handover: $handover ($state)"
    settings
    ;;
  rules)
    handover=/dev/null
    rules="$handovers/_shared.md"
    [ -f "$rules" ] || exit 0
    settings
    ;;
  list)
    echo "- Repository: $(basename "$root"), main checkout $root"
    echo "- Topics: $(topics | tr '\n' ' ')"
    ;;
  create|resume)
    [ -n "$topic" ] || stop "give a topic name: /foreman-$mode TOPIC."
    case $topic in
      *[!a-z0-9-]*|-*) stop "a topic is lowercase letters, digits and dashes, like \"browser\" or \"e2e-tests\"." ;;
    esac
    handover="$handovers/$topic.md"
    rules="$handovers/_shared.md"
    if [ "$mode" = create ]; then
      [ ! -e "$handover" ] || stop "topic \"$topic\" already exists. Use /foreman-resume $topic to continue it."
      mkdir -p "$handovers"
      exclude 'handovers/'
      [ -f "$rules" ] || { cp "$dir/handover-templates/shared.md" "$rules"; shared_state="just created from the template; its Standing rules are still empty"; }
      sed "s/<topic>/$topic/" "$dir/handover-templates/topic.md" > "$handover"
      state="just created from the template"
    else
      [ -f "$handover" ] || stop "no topic \"$topic\". Use /foreman-create $topic to start it."
      [ -f "$rules" ] || { mkdir -p "$handovers"; cp "$dir/handover-templates/shared.md" "$rules"; shared_state="just created from the template; its Standing rules are still empty"; }
      state="exists"
    fi
    echo "- Repository: $(basename "$root"), main checkout $root"
    echo "- Working directory: $(pwd)"
    echo "- Topic: $topic"
    echo "- Handover: $handover ($state)"
    echo "- Shared rules: $rules (${shared_state:-exists})"
    if [ "$mode" = resume ]; then
      lead=$(sed -n 's/^Lead: *//p' "$handover" | head -n 1)
      case $lead in ''|'<'*) lead=none ;; esac
      echo "- Lead on record: $lead"
    fi
    if [ -f "$root/HANDOVER.md" ]; then
      echo "- Old single handover: $root/HANDOVER.md (not used by topics; move what belongs to this topic across, then leave a one-line pointer in it)"
    fi
    others=$(topics | grep -vx "$topic" | tr '\n' ' ' || true)
    echo "- Other topics (not yours; don't read them): ${others:-none}"
    settings
    ;;
  *)
    echo "usage: foreman-start.sh [create|resume TOPIC | list | rules]"
    exit 1
    ;;
esac
