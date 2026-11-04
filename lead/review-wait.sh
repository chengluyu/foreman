#!/bin/sh
# Foreman review-bot watcher. Waits for a review bot's verdict on one round, prints
# one line and exits. Run it from the lead as a background Monitor.
#
#   review-wait.sh OWNER/REPO PR [TRIGGER-COMMENT-ID]
#
# Only events after the trigger comment count; without one, events after the PR
# was opened count. Output:
#   findings <review-id>...   the bot left one or more reviews (exit 0)
#   passed <signal>           the bot approved: a thumbs-up, or its pass comment (exit 0)
#   timeout                   nothing arrived in time (exit 2)
#
# Settings, as environment variables:
#   BOT        regex for the bot's login (default: codex)
#   PASS_TEXT  regex for the bot's "no issues" comment (default: Didn.t find)
#   TIMEOUT    seconds before giving up (default: 1800)
#   INTERVAL   seconds between checks (default: 60)
set -eu
usage='usage: review-wait.sh OWNER/REPO PR [TRIGGER-COMMENT-ID]'
repo=${1:?$usage}
pr=${2:?$usage}
comment=${3:-}
bot=${BOT:-codex}
pass=${PASS_TEXT:-Didn.t find}
interval=${INTERVAL:-60}
deadline=$(( $(date +%s) + ${TIMEOUT:-1800} ))

if [ -n "$comment" ]; then
  since=$(gh api "repos/$repo/issues/comments/$comment" --jq .created_at)
else
  since=$(gh api "repos/$repo/pulls/$pr" --jq .created_at)
fi

# Items by the bot created after $since, from one API listing.
# $1 = path, $2 = timestamp field, $3 = extra jq filter, $4 = jq output.
bot_items() {
  gh api --paginate "repos/$repo/$1" 2>/dev/null |
    jq -r --arg bot "$bot" --arg since "$since" --arg pass "$pass" \
      ".[] | select(.user.login | test(\$bot; \"i\")) | select(.$2 > \$since) | $3 | $4" ||
    true
}

while [ "$(date +%s)" -lt "$deadline" ]; do
  reviews=$(bot_items "pulls/$pr/reviews" submitted_at 'select(.body | test($pass; "i") | not)' .id)
  if [ -n "$reviews" ]; then
    echo "findings $(echo $reviews)"
    exit 0
  fi
  passed=$(bot_items "pulls/$pr/reviews" submitted_at 'select(.body | test($pass; "i"))' '"review \(.id)"')
  [ -n "$passed" ] || passed=$(bot_items "issues/$pr/reactions" created_at 'select(.content == "+1")' '"reaction on the PR"')
  if [ -z "$passed" ] && [ -n "$comment" ]; then
    passed=$(bot_items "issues/comments/$comment/reactions" created_at 'select(.content == "+1")' '"reaction on the trigger comment"')
  fi
  [ -n "$passed" ] || passed=$(bot_items "issues/$pr/comments" created_at 'select(.body | test($pass; "i"))' '"comment \(.id)"')
  if [ -n "$passed" ]; then
    echo "passed $(echo "$passed" | head -n 1)"
    exit 0
  fi
  sleep "$interval"
done
echo timeout
exit 2
