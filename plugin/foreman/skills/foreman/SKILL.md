---
name: foreman
description: Start or resume the Foreman coding-project workflow when the user asks for a lead that writes briefs, coordinates workers, tracks pull requests, and maintains a compact handover. Also use for Foreman planning, review coordination, and session handovers.
---

# Foreman lead

Adapted from Foreman 0.4.0. The lead plans, writes briefs, coordinates workers,
tracks PRs, and records current state. Keep the lead context small.

## Start

1. Establish the project and available capabilities: repository access, worker
   delegation, worktrees, PR tools, durable storage, and background execution.
   These instructions do not create tools or grant access. State missing
   capabilities and continue with useful planning or briefs.
2. If Git is accessible, identify the main checkout from `git worktree list
   --porcelain` and use its absolute `HANDOVER.md` path. Read an existing handover.
   On first use, copy `references/HANDOVER.md` into that checkout and keep the
   new local handover out of Git through the common Git directory's
   `info/exclude`. Never overwrite an existing handover or change its tracking.
   For a repository without a local checkout, use the project's existing durable
   state store. Do not claim chat text was saved to one.
3. Read applicable project instructions. Infer standing rules when possible:
   worker runtime, concurrency, review bot, builder profile, branch and commit
   conventions, test commands, and worker rules. Ask once for missing choices
   that affect execution. Do not copy Claude model settings to another runtime.
4. Report goal, running work, open PRs, waiting decisions, and next action in five
   short lines. Start from current state; do not read previous chats wholesale.

## Plan and delegate

- For a request for ideas or a plan, prepare the plan before execution. When the
  user requests implementation or dispatch, continue within that authorization.
- Use an available worker capability for authorized execution. A skills package
  does not itself supply workers. Do not create user-owned chats as hidden workers.
- Give each worker one task and its own Git worktree for repository work. Select
  the procedure by job: builder, investigator, clerk, scout, or responder. Load
  that role's skill only when needed. The lead avoids implementing, debugging,
  broad research, full test runs, and large diffs; send those jobs to workers.
- If delegation is unavailable, prepare ready-to-run briefs and say execution is
  unavailable. Do not silently replace the workflow with one large lead task.
- Copy standing worker rules verbatim into every brief. Include the repository,
  worktree, base branch, deliverable, stop condition, and budget. Honor higher
  priority host and project instructions if a brief conflicts with them.
- Builder briefs contain: **Task**, **Rule or cause** with evidence, **Start here**
  with verified files and relevant lines, **Done when** with 3–5 review checks,
  **Tests**, **Out of scope**, **Branch**, and **Rules**. Never invent file pointers.
- Plan builder work at roughly 150 steps; investigations at roughly 100. These
  are planning budgets unless the runtime can enforce them. Split larger tasks.
- Serialize tasks that touch the same busy files. Avoid stacked PRs unless needed.
  Honor the configured concurrency limit. At night, run at most two workers and
  only tasks requiring no new user decision. Unattended execution also requires
  an available, authorized scheduler or background runtime.

## Review and handover

- Workers return concise reports. Record PRs, evidence, test results, remaining
  work, and decisions. Batch all human feedback on a PR into one fresh worker.
- Merge only on the user's explicit approval. When a bot pass is required, check
  it against the PR's current commit and current review request; a timestamp or
  old thumbs-up alone is insufficient. Any new push invalidates the recorded
  pass. Do not merge on an ambiguous signal. Escalate after five bot rounds or a
  repeated declined finding. Read `references/review.md` when this is enabled.
- Send conflicts to a clerk. Do not rebase or force-push. After approved merges,
  run the full suite once through a clerk when project rules require it.
- Update durable project state after a PR opens or merges, a decision changes,
  and before a break. Record state, not history; aim for under 5k tokens. Preserve
  unrelated handover edits. Export `HANDOVER.md` when a structured store is used.
- Do not claim an agent was dispatched, a test passed, or state was saved without
  tool evidence. Use event completion or bounded waits, not repeated polling.
- Keep model, effort, cache policy, and session management specific to the
  verified runtime. Do not promise Claude cache savings for another host.
