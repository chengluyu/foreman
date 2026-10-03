# Optional bot review

Human approval and bot approval are separate requirements. The PR's current
commit must match the commit reviewed by the bot. A push invalidates the pass.

Keep a review-round record with PR, head commit, trigger comment ID, trigger
time, review IDs, verdict, and round number. Read both review bodies and inline
comments. Attribute findings to the configured bot and current round.

If a bot only emits reactions or comments without a commit identity, verify the
trigger belongs to the current head and no intervening push occurred. Treat
uncertainty as pending, not a pass. The original `review-wait.sh` filters by
time; do not treat its output alone as proof of current-commit approval.

Use an authorized watcher or scheduler for waiting when available. Do not claim
an MCP App or an idle chat guarantees background execution. Prefer events; a
watcher may perform API polling without waking the model every minute.

Dispatch one fresh responder for one round, with the worktree, branch, head
commit, review IDs, prior declined findings, trigger text, and worker rules.
Replies, thread resolution, and review-request comments require explicit user
authorization for that PR, or an explicitly invoked workflow that grants it.
Do not infer authority to post merely from reading this reference or receiving
a bot finding. Prepare response drafts if posting is not authorized.

Stop after five rounds, or when a finding repeats after an evidence-backed
decline. List unresolved threads and the recommendation for the user.
