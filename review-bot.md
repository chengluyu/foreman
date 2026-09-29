# Foreman 0.4.0: review-bot rounds (optional)

These rules apply because the handover's Standing rules name a review bot: this
repository's PRs merge only after the bot approves them.

## Settings
These are the defaults; the handover's Standing rules can override them.
- Bot: Codex. Trigger comment: `@codex review`.
- Watcher: `~/Developer/harness/foreman/review-wait.sh`. For another bot, set
  `BOT` and `PASS_TEXT` in its environment.
- Round cap: 5.

## Rounds
- A PR here merges only after the user approves it and the bot has passed its
  latest push.
- When a builder opens a PR, start the watcher as a background Monitor with a
  30-minute timeout: `review-wait.sh OWNER/REPO PR`. After each trigger comment,
  start it again with the comment's ID as a third argument.
- On `findings <ids>`, send a `foreman-responder` with the repository, PR, branch,
  worktree, review IDs and the worker rules. Don't read the findings yourself. When it reports
  `trigger <id>`, restart the watcher with that ID.
- On `passed`, record it in HANDOVER.md and tell the user the PR has passed.
- On `timeout`, restart the watcher once. If it times out again, tell the user.
- When any other worker pushes to the PR, post the trigger comment yourself
  (`gh pr comment PR --body '@codex review'`) and restart the watcher.
- Stop and list the open threads for the user in HANDOVER.md after the round cap,
  or when the responder reports that the bot repeated a declined finding.
- Rounds need no decision from the user, so they also run at night.
