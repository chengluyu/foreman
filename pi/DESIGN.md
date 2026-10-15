# Foreman for Pi

Status: first local implementation; see README.md for testing and current limits.
Updated: 2026-10-13, Asia/Singapore.

## Goal

Run Foreman's lead-and-worker workflow in Pi. The lead plans, writes briefs,
dispatches workers, manages PRs, and maintains the handover. Workers execute one
scoped task in an assigned worktree and return a short report.

The lead must continue managing authorized work after its current turn ends.
Worker completions, failures, questions, background-command exits, and monitor
results must reach the originating lead and start another turn when needed.
The user must be able to steer the lead while it is working.

This behavior is the first acceptance requirement. Prompts that tell the lead to
keep working are insufficient without runtime delivery and wake-up handling.

## Decisions

- Reuse Nicobailon's `pi-subagents` for worker execution and its FleetView for
  worker visibility. The source/test comparison is in [PACKAGE-REVIEW.md](PACKAGE-REVIEW.md).
- Reuse `@aliou/pi-processes` 0.13.2 for background shell commands, with the
  Pi-1.x-compatible settings dependency pinned to 0.23.0. Foreman loads the package
  resources once and owns delivery for its processes. PR watches run in Foreman's
  scheduler, not dedicated subprocesses.
  Do not install a second worker orchestrator.
- Reuse `@pify/usage` for usage and context reporting. Verify and, where needed,
  integrate worker accounting rather than build another billing dashboard.
- Add Foreman role definitions, instructions, and a small extension for workflow
  enforcement and integration.
- Require one-hour prompt caching for supported Anthropic Foreman requests,
  including both the lead and workers.
- Track usage during execution, after each response where available. Standard
  model prices are sufficient; discount reconciliation is out of scope.
- Foreman owns task worktrees through the PR review cycle.
- Keep Markdown handovers authoritative for project plans, standing rules, and
  decisions. The lead edits them with normal file tools; there is no record tool.
  Dispatch takes a role and a Markdown brief path. The runtime saves mechanical
  execution and delivery facts automatically, separately from the handover.
- Do not commit or install anything as part of writing this design.

## Verified environment

The following versions were inspected locally while preparing this design:

| Package | Version |
|---|---|
| Pi | 1.1.0 |
| `pi-subagents` | 0.77.0 |
| `@pify/usage` | 0.12.1 |

These are an initial compatibility target, not a claim that the combined workflow
has been tested. Record the supported version range after integration tests pass.
Use the installed package's public APIs and documentation; do not import its
private runtime modules.

## Package responsibilities

| Component | Responsibility |
|---|---|
| Pi | Lead session, model requests, steering, extension lifecycle, compaction |
| `pi-subagents` | Child sessions, model/tool selection, background execution, cancellation, reports, completion delivery, FleetView |
| `@pify/usage` | Session usage, context display, history, available provider quota information |
| Foreman | Roles, Markdown brief dispatch, worktree ownership, watch scheduling, cache requirement, event delivery; the lead maintains plans and handovers |

Use `pi-subagents` public registration and delegation/event APIs. A separately
installed Pi package is not automatically a resolvable Node dependency; choose
the documented event contract or declare a dependency explicitly. Discover
capabilities at startup and report unsupported combinations before dispatch.

Do not add a second worker launcher or completion notifier alongside the existing
one. Establish which component owns each wake-up path and correlate it by run ID.

## Foreman commands and roles

Proposed commands:

- `/foreman [request]`: start with the repository's single handover.
- `/foreman-create TOPIC`: create and activate a topic handover.
- `/foreman-resume TOPIC`: resume that topic from saved state.
- `/foreman-status`: show workflow state, active work, pending events, and decisions.
- `/foreman-pause`: stop automatic dispatch and wake-ups; let existing workers
  continue and collect their results.
- `/foreman-continue`: process pending events and resume authorized work.
- `/foreman-stop`: stop management, cancel Foreman-owned workers and monitors,
  and preserve partial work. Record cancellation outcomes; do not assume success.

An Escape interrupt is not automatically permission to restart the lead. When Pi
exposes an explicit user interruption, suspend automatic management until the user
continues it. Verify this behavior against the host's actual lifecycle events.

Port the five existing role procedures: builder, investigator, clerk, scout, and
responder. Keep model and thinking settings configurable by role. Preserve fresh
worker contexts, scoped tools, short reports, staged testing, and the prohibition
on unrequested work. Do not adopt the package's suggested reviewer workflow in
place of Foreman's human review and optional review-bot process.

Startup can initially reuse `foreman-start.sh`, invoked relative to the package
location with the target repository as its working directory. Treat its `STOP:`
output as refusal even though it exits with status zero. Preserve topic isolation,
absolute handover paths, and existing files. Do not use Claude skill shell
interpolation syntax in Pi prompts.

## Lead prompt

The lead instructions to load are in [LEAD.md](LEAD.md). They describe the proposed
tools below; they are not a claim that this extension is installed. Startup must
provide absolute repository, topic/shared handover, and brief-directory paths,
effective role settings and limits, review permissions, and available tool names.

## Model-facing tools

Add three tools. Use existing Pi file tools for briefs and handovers, and existing
package controls for steering, supervisor replies, stopping, and process jobs.
Do not add `foreman_record` or require model-issued delivery acknowledgements.

### foreman_dispatch

```ts
{
  role: "builder" | "investigator" | "clerk" | "scout" | "responder";
  briefPath: string; // Absolute path to a saved Markdown file
}
```

Read and validate the file at dispatch, append applicable standing rules verbatim,
and save an immutable snapshot of the exact effective brief and role configuration.
Resolve model, thinking, budgets, repository, and worktree through configuration
and brief metadata. Return task ID, run ID when launched, queued/running state,
snapshot reference, worktree, branch, and effective settings. A queued task is not
a running worker.

Use the canonical brief path as the dispatch request identity within the topic.
Repeated calls return the existing receipt rather than launch twice, even if the
file has since changed. For another execution, write a new brief file; include a
`Task ID:` line referencing the existing task when reusing its worktree. An edited
brief never silently changes a queued or running request. Cancel a queued request
before replacing it, or explicitly steer an active worker.

### foreman_watch

```ts
// Create a watch
{
  action: "create";
  kind: "github-review";
  target: { repo: string; pr: number; headSha: string; requestId: string };
  timeoutMinutes?: number; // Default 30; bounded by runtime policy
}
// Inspect/cancel a watch
{ action: "get" | "cancel"; watchId: string }
// List this topic's watches
{ action: "list" }
```

`repo` is `owner/repo`, `headSha` is the full commit SHA, and `requestId` is the
review-trigger comment ID as a string. Validate them against GitHub. Registration
does not post a review request or authorize a merge. Return watch ID, target,
state, next check, and deadline immediately. An identical target in the same
topic returns the existing watch, without resetting its deadline. A new review
request or head requires a new registration.

### foreman_status

```ts
{ taskId?: string } // Omit for a compact current-topic snapshot
```

Return observed run and queue state, worktree ownership, watches/deadlines, and
recent event references and delivery state. Include artifact paths instead of
full logs. The handover remains the source for plans and decisions; status does
not infer that a task is semantically done or that an event was acted upon.

## Management behavior

The runtime remains active independently of whether the lead is generating a
response. A completed assistant response does not end the workflow.

### Evidence from Claude Code sessions

The sessions `🟢 Work on 9 Oct 2026` (ID
`5ed9bd8b-c46e-43cb-bf6a-33a537975c8f`) and `Browser foreman · 30 Sep` (ID
`cee02921-3d36-4366-a2d5-6005de165d28`) were scanned, repeated UUID records
deduplicated, and representative event sequences read. Times below are UTC+08.

- On 9 October, the Pen worker reported PR #146 at 13:48:27. The lead dispatched
  a queued builder at 13:48:49 and started the PR's review monitor at 13:48:53,
  without another user prompt.
- Findings for #146 arrived with all five slots occupied. The lead queued a
  responder, dispatched it when another builder finished, and started the next
  review monitor when the responder returned.
- In the browser session, a user instruction allowing pushes but withholding PR
  approval was forwarded to both running builders. A later client-hint scope
  addition was sent to the existing user-agent builder on the same task.
- User requests appeared as queued attachments during ongoing management. A
  benchmark request led to an investigator dispatch while review handling
  continued; a changeset rule was propagated to running browser workers.
- After compaction in the October session, a monitor result caused a responder
  dispatch without the user restarting management.

These observations establish the target interaction, not a guarantee about either
runtime. The logs also contain API failures that interrupted lead responses and
a restart notification for background commands with no recorded completion.
Do not copy session-specific permissions, model choices, or review-round overrides
into Foreman's defaults. Keep private transcripts outside this package.

| Event | Action |
|---|---|
| Worker completes | Deliver report reference; lead records outcome and starts eligible queued work |
| Worker fails, stops, or asks for help | Deliver status and evidence; lead resolves within authority or asks the user |
| Background command exits | Deliver exit code and bounded log reference |
| Review monitor reports a verdict | Deliver PR/head/round identity; lead applies review policy |
| User steers | Deliver direction at Pi's next supported steering boundary |
| No actionable event | Remain subscribed without making model calls to poll |

Proposed workflow states are `active`, `waiting_for_events`, `waiting_for_user`,
`paused`, and `finished`. Waiting for one user decision does not block independent
authorized tasks. `paused` suppresses automatic turns; `finished` means no queued
authorized work, active run, or monitor remains.

Pi supports extension-triggered turns. The inspected `pi-subagents` implementation
also has an idle-parent wake helper. Reuse those capabilities and test their
behavior when the lead is idle, busy, compacting, or being reloaded.

### Delivery and recovery

Maintain a durable Foreman event inbox with event ID, source/run or watch ID,
target session and topic, event type, artifact reference, creation time, and
delivery state. Keep full worker logs outside the lead's model context.

1. Persist an event before requesting delivery.
2. Route it only to its owning lead session/topic.
3. If active and idle, request a new turn. If busy, queue it through the supported
   Pi delivery path. Coalesce nearby completions without delaying urgent failures
   or user input.
4. Record transport acceptance and the receiving turn identity automatically.
   Distinguish pending, accepted, and observed-in-turn where host evidence permits.
   Do not call an event processed merely because a send succeeded or a turn ended.
5. On reload/resume, reconcile pending events with canonical package run artifacts.
   Retry delivery with bounded backoff. Never relaunch a job solely because its
   notification was lost.

Use retryable delivery and idempotent handling. Persist dispatch claims before
launch and retain package run IDs so recovery cannot dispatch duplicate workers.
Handle completion racing with the end of a lead turn. Do not let two wake handlers
start duplicate management work. If delivery repeatedly fails, show a persistent
failure state rather than spending tokens in an endless retry loop.

The package's completion replay files are temporary; the Foreman inbox must not
depend on them as permanent project history. Persist references and dispositions
needed for recovery without duplicating the entire package run database.

Worker reports and task lifecycle notifications may arrive separately for the
same execution. Correlate them by run and execution attempt; record the report
once and release its concurrency slot once. A status notification without a report
must not be treated as successful completion. A resumed execution can terminate
again, so a reusable worker ID alone is not a sufficient deduplication key.

The lead records its scheduling decision in the handover: dispatch, queue with a
dependency or capacity reason, await a specific user decision, or finish. The
runtime records actual dispatch/control calls without interpreting prose as an
acknowledgement. An announcement alone does not discharge management work.
On interrupted or failed delivery turns, expose the retained event in status for
reconciliation; retries must be bounded and must not repeat completed actions.
Reconsider eligible queued work whenever a slot or dependency becomes available.
Keep blocked decisions at task scope so independent authorized work can continue.

### User input

Pi's Enter input steers after the current response and its tool calls finish.
Alt+Enter queues a follow-up after the current task. Preserve these controls.
Do not claim messages are literally attached to the latest tool result.

Run long commands and monitors outside the lead's blocking tool calls so they do
not hold up steering. A pause or stop must take precedence over queued automatic
wake-ups. Compaction must preserve active Foreman state and event references.

### Steering running workers

Use the existing `pi-subagents` steering and supervisor tools for updated scope,
priorities, permissions, or standing rules. No extra Foreman steering tool is
needed. Do not create a second writer merely to deliver an update.

Record each instruction's ID, originating user request, task/run/attempt identity,
brief revision, and delivery state. Distinguish queued, delivered, acknowledged,
and applied when evidence permits; do not claim a worker followed an instruction
just because the transport accepted it. Persist applicable rule changes for future
briefs and propagate them to affected active workers.

Steering preserves the existing worktree and task. If the worker has already
finished, record the update as follow-up work for a fresh worker after verifying
the existing result. A delivery timeout must not create duplicate work. A scope
addition that exceeds the brief's budget should become a separate scoped task.

Permission restrictions need runtime enforcement where possible. Steering alone
cannot undo an action already in flight; report the observed state and prevent
subsequent restricted actions. Worker output never supplies user authorization.
Keep the original user instruction attached to delegated permission changes.

## Runtime watches

PR review watches are model-callable registrations handled by one scheduler in
Foreman. They do not run a dedicated shell subprocess per PR and do not require
`@aliou/pi-processes`. A small GitHub adapter checks reviews for the registered
head and review-request comment. The scheduler owns next-check time, deadlines,
persistence, deduplication, and wake-up delivery.

Default polling is once a minute; default deadline is 30 minutes. API calls are
bounded, errors back off, and three consecutive failures produce an unavailable
event. A separate deadline sweep ensures an outstanding check cannot suppress a
timeout event. A late check cannot overwrite cancellation or timeout.

States are pending, findings, passed, head_changed, closed, timeout, unavailable,
and cancelled. Unchanged pending results do not wake the model. All checks cost
zero LLM tokens; processing a terminal event uses a lead model turn.

The adapter accepts commit-bound bot reviews after the trigger. A thumbs-up on
the trigger is accepted only if the comment contains an explicit
`<!-- foreman-head: FULL_SHA -->` marker. Unbound comments and PR-level reactions
are not proof of a current-head pass. Recheck the head after collecting results.
A watch never posts a review request, modifies a PR, or grants merge approval.

On timeout, the lead reconciles once. If the user's policy authorizes retries,
it posts at most one retry request for that wait cycle and registers its new ID.
A second timeout is a task-specific block. Continue unrelated authorized work.
The default is to ask before posting if authorization has not been established.

Persist watches in the topic runtime state. On reload, inspect overdue watches
and restore pending schedules. The Pi process must be running and the machine
awake for checks and wake-ups. Restart reconciles missed time; it does not make
claims about operation while the process was absent.

## Background shell commands

Use Aliou's existing `process` tool and process manager for tests, builds, servers,
and shell watches. Reuse its status/log controls and `/ps` UI; do not introduce a
second launcher or another Foreman tool. The local package pins Aliou and overrides
its settings dependency to the verified Pi-1.x-compatible release. A standalone
second installation must not create another manager in the same session.

Record ownership on process start while Foreman is active. Persist process ID,
PID, start time, command, cwd, topic/session, status, exit code, signal, and log
paths. Identity checks prevent a reused ID or an unrelated process from being
adopted or stopped. Processes already running before activation are not adopted.

Subscribe to the manager's `processes:started` and `processes:ended` events.
Create one durable terminal event for success, failure, or stop. Use the underlying
ended event rather than relying on notify defaults: intentional stops upstream
produce context-only notifications. Intercept the core notification delivery
listener only for Foreman-owned processes; Foreman then supplies the sole wake-up
path while other package listeners can still update their UI. Unowned processes
keep normal package behavior. Log-match events requesting attention also use the
Foreman delivery path and respect pause.

Defer pending events while paused. Record delivery when the receiving lead turn
starts or a steering message enters an active turn, not just when a message is
queued. Bound retries for unstarted/failed
delivery. Explicit Foreman stop disables wake-ups before cancellation requests.
A failed/timed-out stop produces attention and does not prove termination.

On orderly shutdown/reload, stop owned processes while listeners still exist so
their actual results can be saved. The package also tears down its manager on
shutdown. A crash with missing manager state is unknown, not successful. Never
automatically replay arbitrary side-effecting commands. Worker/process/watch
events must not cause duplicate management actions.

The real Pi process smoke test covers success, exit 7, intentional tool stop,
external SIGTERM, `/ps:kill`, busy delivery, paused completion, continue, and
Foreman stop using the full installed package and a deterministic provider.

## Briefs, limits, and dispatch

The lead writes the brief with normal file tools. Builder briefs have nonempty
Task, Rule or cause, Start here, Done when, Tests, and Out of scope Markdown
sections. Other roles require Task, Start here, and Done when. Optional plain
metadata lines are `Branch:`, `Base:`, `Effort: medium|high`, and `Task ID:` for a
follow-up. The runtime chooses a unique branch if omitted and snapshots the base
commit, paths, and applicable standing rules. Reject incomplete briefs before
launching. See LEAD.md for a complete example.

Reserve concurrency slots atomically. Serialize writers to the same worktree and
tasks known to touch the same busy files. Respect the configured worker limit and
the existing two-worker night limit.

Keep planning targets distinct from enforced limits. The existing roughly
150-step builder target is not automatically equivalent to a package tool-call
budget. Define counters and use supported hard budgets and runtime deadlines;
report unavailable enforcement instead of implying it exists.

## Worktree lifecycle

A task owns its branch and worktree; a worker run temporarily uses them. A fresh
responder gets a fresh conversation but may use the same task worktree.

1. Allocate from the explicit selected base. Record the task ID, absolute path,
   branch, and resolved base commit.
2. Verify the path and branch before launch; pass the path as the worker's `cwd`.
3. Allow one writing worker per task worktree. Keep ownership across lead reloads.
4. Retain the directory after a PR opens for review fixes and conflict handling.
5. After merge or explicit abandonment, verify there are no active owners,
   uncommitted changes, or unaccounted-for commits before cleanup. Otherwise retain
   it and report why. Do not force deletion or discard partial work.

Initially use ordinary Git worktrees managed by Foreman. The package's documented
managed-worktree workflow captures patches and cleans up temporary branches;
that lifetime must not silently replace Foreman's PR lifecycle.

Worktrees isolate Git files, not ports, databases, displays, or browser sessions.
Keep shared resource claims in the existing shared handover rules.

## One-hour prompt cache

When Foreman is active, require one-hour cache requests for direct Anthropic
lead and worker requests. The user has also requested Kimi K3 testing: non-Anthropic
providers use provider-managed caching and must be labelled without a one-hour
guarantee. Kimi Coding can use the Anthropic wire format; provider identity, not
wire format alone, determines this policy. Apply `cacheRetention: "long"` at a verified request
configuration boundary. Confirm the exact host hook/API during implementation;
environment inheritance alone is not enforcement.

Load the cache policy in children through a supported required-child-extension
mechanism or another verified request configuration path. Reject an unsupported direct-Anthropic request path rather than silently using
five minutes. For other providers report provider-managed caching explicitly. Changes to this requirement must be explicit.

Verify outgoing requests request `ttl: "1h"` and inspect Anthropic's one-hour
cache-write counters when writes occur. A cache hit need not produce a write
counter. One-hour retention does not guarantee a hit: prefix changes, eligibility,
and expiration still apply. Restore normal request settings when Foreman is off.

## Live usage

Show lead cost, worker cost, combined cost, and cache read/write token and cost
totals as execution progresses. Per-response updates are sufficient; do not wait
until the worker finishes. Treat missing counters as unavailable, not zero.

Pi's inspected Anthropic adapter reads separate cache counters, including one-hour
writes. Its cost calculation prices short writes using the model's cache-write
rate and one-hour writes at twice the input rate. Reuse Pi's priced usage instead
of maintaining a second model-price table.

`@pify/usage` updates on completed messages. Its documented child tally integrates
Pify's own agent packages; automatic coverage of `pi-subagents` is not established.
The latter has its own cost reporting and public cost API. Verify whether those
interfaces expose sufficient live detail, including cache costs.

Use a supported bridge where possible. If only final worker costs are exposed,
add per-response telemetry through a required child extension or propose an
upstream integration. Do not depend on a private global tally as a stable API.
Deduplicate by run/attempt/message identity and reconcile live snapshots with
terminal totals without counting them twice. Cover compaction, retries, cancelled
runs, and reloads. Clearly label any usage that cannot yet be captured live.

## PRs and reviews

Workers commit, push, and open PRs only within their authorized briefs. The lead
records reports and batches human feedback into one fresh responder per PR.
Keep explicit user approval for merges.

Track PR number, head SHA, review trigger, round, verdict, and approval. New pushes
invalidate the recorded pass. The existing `review-wait.sh` remains for Claude; Pi uses the runtime
GitHub adapter with current-head and trigger correlation. Preserve the five-round escalation rule and repeated-declined-
finding escalation. A monitor verdict wakes the lead but never grants merge
authorization.

## Storage and implementation shape

Keep handovers in the main checkout using existing single/topic conventions.
Store ignored runtime records under a proposed `.foreman/pi/` directory there:
task-to-run mappings, immutable brief snapshots, ownership, dispatch claims, watch
registrations, usage telemetry, and automatic delivery records. The lead edits
Markdown handovers itself; runtime code does not rewrite plans or decisions.
Use atomic writes, revision checks, and locks where concurrent leads can write.
Do not overwrite unrelated handover edits or other topics' state.

Proposed package layout, subject to implementation needs:

```text
pi/
  DESIGN.md
  README.md
  LEAD.md
  package.json
  extensions/foreman.ts
  src/                 # startup, dispatch adapter, events, worktrees, cache, usage
  agents/              # five Foreman role definitions
  tests/
```

Package shared policy/templates explicitly so installed copies do not depend on
`~/Developer/harness/foreman`. Keep Claude-specific and Pi-specific settings apart.

## Implementation order and acceptance

1. Prove wake-up delivery with the installed Pi and `pi-subagents` versions.
2. Add startup, role registration, brief validation, and one retained task worktree.
3. Add worker steering, durable event handling, pause/stop, recovery, and monitors.
4. Enforce and verify one-hour caching in lead and worker requests.
5. Integrate and reconcile live worker accounting with the existing usage display.
6. Exercise the full PR and fresh-lead resumption workflow.

The first integration test must dispatch a background worker, let the lead end
its turn, and observe the lead wake and dispatch the next authorized task without
user input. Repeat across several completions, not just one.

### Event-to-dispatch scenarios

For each scenario, assert recorded state and actual dispatch/control calls, not
just assistant text. Capture event arrival, delivery, lead-turn start,
receiving-turn identity where available, and dispatch timestamps to expose delays without assuming Claude
Code's observed timings are a Pi latency guarantee.

| Scenario | Required outcome |
|---|---|
| Builder finishes while lead is idle | Lead records the report, releases one slot, launches an eligible queued task, and registers any required PR monitor without user input |
| Review findings arrive at full capacity | Responder remains queued; the next released slot causes dispatch without another user prompt |
| Responder finishes | Lead records the new head, invalidates the prior pass, and starts the next authorized review round and monitor |
| User changes rules during execution | Lead persists the revision, steers affected active workers, and uses the revision for future dispatches |
| User adds scope to an active task | Update reaches the owning worker; no second writer starts; completion racing with delivery becomes explicit follow-up work |
| User asks a question while completions arrive | Lead answers and still processes pending reports and scheduling decisions |
| One task needs user approval | That task remains blocked while unrelated authorized tasks continue |
| Report and terminal notification both arrive | One recorded report, one slot release, no duplicate downstream dispatch |
| Compaction occurs with monitors active | Next monitor result wakes the lead and leads to the appropriate dispatch |
| Lead request fails after event delivery | Event remains visible for reconciliation; failed delivery is retryable; recovery does not rerun completed work |
| Restart finds a command with no terminal record | Reconcile process evidence, report unknown/stopped state as supported, and never invent successful completion |

Run a multi-stage fixture from builder to review monitor to responder to another
monitor while the user sends a steering message. Let the lead end its turn between
stages. Require the entire authorized sequence to advance without manual nudges.

Required checks:

- Completion while idle and while busy; completion racing with turn settlement.
- Several simultaneous completions without duplicate dispatch or lost reports.
- Worker failure, explicit stop, supervisor question, command exit, and monitor event.
- User steering during work, plus pause/stop with a completion already queued.
- Markdown brief validation, immutable snapshots, path deduplication, and follow-up task reuse.
- No record tool: the lead updates the handover through file tools without runtime prose parsing.
- Watch timeout without a Codex response; cancellation racing with an API response.
- Reload with pending events; late results routed only to the owning topic/session.
- Lost delivery followed by recovery without rerunning completed work.
- Two tasks in separate worktrees; fresh responder reusing the correct task worktree.
- Cache TTL on actual lead and worker requests, plus unsupported-provider behavior.
- Live usage before worker completion, including short/one-hour writes and cache hits.
- PR head changes invalidating old review passes; no merge without user approval.
- Final handover sufficient for a fresh lead without reading the previous chat.

Use controlled fixtures for delivery races and accounting math, then a small real
Pi run for end-to-end behavior. Record measured outcomes and limitations. Source
inspection alone does not establish unattended reliability.

## References

- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Pi interactive usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)
- [pi-subagents extension API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md)
- [pi-subagents agents](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md)
- [pi-subagents workflows](https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md)
- [pi-subagents observability](https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md)
- [Pify usage](https://github.com/pifydev/usage)
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

Upstream links can change. The locally inspected versions above are the basis for
this design; recheck their contracts when implementation begins.
