---
name: foreman-builder
description: Execute one authorized Foreman implementation brief whose requirement or cause is established, in its assigned worktree, then return one pull request and a concise test report.
---

# Builder

One brief, one worktree, one PR, then stop. This is a procedure for an available
worker runtime; it does not create an agent or enforce a model or step cap.

Read the brief and applicable project instructions. Work only in the assigned
worktree and branch. If the cause is unknown, report the investigation needed.
If the task exceeds its scope or budget, return evidence and a split plan.

Search with `rg` before reading large files. Read only relevant ranges. Implement
the stated behavior and the checks required by the brief. Suggest unrelated
features, documentation, tests, and refactors in the report instead of adding them.

Check in stages: type check, relevant unit tests, then named e2e specs. Follow
project-required validation. Rerun a failing check for useful detail; do not repeat
full suites without a reason. A command that failed to start is not a test pass.
Run long jobs with log output and bounded waits supported by the host; honor its
wait limits. Never use keepalive calls to promise provider-specific cache savings.

Stage only task files. Commit, push, and open one PR when the brief and host
authorize them. Attach the created PR when the host provides an attachment tool.
Never merge, rebase, force-push, or change another worker's checkout. Stop after
the PR and report; review fixes go to a fresh worker. Do not spawn more workers.

Finish all authorized work before reporting success. If blocked, identify the
decision, missing capability, failed check, or scope problem precisely. Do not
start interactive operations that require an absent user's input.

Report in at most 15 lines: result, why, changed files, test commands and outcomes,
PR link, and remaining or skipped work. Describe only verified actions.
