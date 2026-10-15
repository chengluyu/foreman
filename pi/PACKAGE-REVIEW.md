# Pi package review

Reviewed: 2026-10-13, Asia/Singapore.

Later design decision: PR watches now run in Foreman’s runtime scheduler. Aliou
is an optional shell-process integration, not a prerequisite for PR monitoring.
The lead edits Markdown handovers directly; there is no record/acknowledgement
tool. See DESIGN.md and README.md for the current implementation.

Implementation follow-up: Aliou 0.13.2 is now a pinned local dependency with
`@aliou/pi-utils-settings` overridden to 0.23.0, whose peer range supports Pi 1.x.
Local installation with omitted host peers succeeds. Foreman composes the actual
manager/log/dock extensions and routes owned lifecycle events through its inbox.
An intentional stop is context-only upstream, so setting `onKilled: "turn"` alone
would not satisfy our requirement. Real Pi tests now cover that path as well as
success, failure, external kill, paused delivery, and duplicate wake prevention.
The earlier installation failure below remains the historical finding for the
unmodified 0.19.x dependency tree, not the status of this pinned integration.

## Decision

Use Nicobailon's `pi-subagents` as Foreman's worker runtime. Keep `@pify/usage`.
Select `@aliou/pi-processes` for background commands and monitors, subject to
resolving its dependency declaration and passing the combined Foreman tests.
Do not install a second worker orchestrator or require `pi-intercom` for normal
lead/worker communication.

This settles the implementation direction. It does not declare the assembled
system ready for unattended work. None of the packages supplies Foreman's whole
contract without integration. In particular, Foreman must own explicit pause,
event disposition, PR/worktree lifetime, cache enforcement, and live usage
reconciliation.

The recommendation favors recovery and public integration APIs over similarity
of tool names. `@tintinweb/pi-subagents` is closer to Claude Code's immediate
interaction style, but its shutdown behavior and accounting interface create
more work for this design. Herdsman has substantial recovery support, but brings
a separate session/placement system that the first Foreman release does not need.

## Scope and method

Compared the candidates against the behavior observed in the two Claude Code
sessions recorded in DESIGN.md: idle-lead wake-up, event-to-dispatch continuation,
worker steering, task-specific blocking, monitor exits, and compaction/recovery.
Also checked extension loading for cache enforcement, live usage, and retained
worktrees.

Read community posts and upstream guides, then inspected source and focused tests
in temporary checkouts. Ran tests locally against Pi 1.1.0 without launching paid
model requests or real delegated coding work. No packages were registered in the
user's Pi configuration. Dependencies used for review were placed in temporary
checkouts or linked to the already installed host. Nothing was committed.

| Candidate | Inspected source |
|---|---|
| Nicobailon `pi-subagents` | 0.77.0, `8fcc3c787a6e7d9da0f21bafb604fe937084c21b` |
| `@tintinweb/pi-subagents` | 0.21.0, `e819a82ae364a2b0432881b89b0c784b413a88c1` |
| `@aliou/pi-processes` | 0.13.2, `434fa0a860b1fa4fe9fccdc986964d865ef98e47` |
| `pi-herdsman` | checkout reports 0.26.0, `897810003200ed68475e0aac2cb8cf09d4f5ea91` |
| `@jtsang/pi-extensions` | 0.6.1, `c767f22d58b3796cd3ffcf23e5d59dc1c26b3477` |
| `@pify/usage` | installed 0.12.1; source inspection, no new test run |

Versions here describe inspected source, not a promise that every checkout is a
published npm release. Cached web metadata differed from the Herdsman checkout;
the commit above identifies what was tested.

## Worker runtimes

### Nicobailon: selected

Its documented event-bus RPC includes spawn, status, steer, interrupt, stop,
resume, and cost. Steering receipts distinguish queued and delivered messages.
RPC steering deliberately does not silently pause and revive a child, so Foreman
retains control over whether a finished task becomes a new run.

The native supervisor channel supports blocking questions, structured questions,
and progress updates. Parent replies are correlated to the originating session
and question. This does not require Intercom. Steering is not a substitute for
replying to a pending supervisor request.

The idle-parent helper records the notification and sends a short wake prompt.
Busy-parent delivery uses the existing message mechanism. The notifier batches
completions, tracks pending delivery, and the result watcher retains unaccepted
results for retry. Tests cover stale session ownership, paused results followed
by terminal results, transient delivery failures, and duplicate handling.

Background workers use a detached runner; they can outlive parent shutdown.
The parent watcher itself does not survive shutdown, so completed work still
requires reconciliation when the lead returns. Foreground/in-process children
have a different lifecycle. Foreman should explicitly use background native Pi
workers for its normal execution path.

Required child extensions and launch preflight are particularly useful: Foreman
can require its cache/telemetry extension rather than hope ambient extensions
were inherited. Verify runtime acknowledgement and actual outgoing requests;
registration alone is not evidence that one-hour caching took effect.

Limits:

- Notifier acceptance is not proof that the lead processed an event. Foreman
  still needs dispositions and idempotent dispatch claims.
- The cost RPC reads session/run artifacts and is documented for turn boundaries,
  not repeated timer polling. It is not by itself our required live telemetry feed.
- The structured delegation API's live updates are for configured foreground leaf
  execution; do not assume they cover detached workers identically.
- Explicit pause must suppress or defer automatic wakes without losing reports.
  No ready-made Foreman pause contract was established by this review.
- Do not load all parent extensions in workers. Use explicit child resources to
  avoid duplicate process managers, orchestration hooks, and unnecessary context.

Sources: [extension APIs](https://github.com/nicobailon/pi-subagents/blob/8fcc3c787a6e7d9da0f21bafb604fe937084c21b/docs/extension-api.md),
[supervisor workflow](https://github.com/nicobailon/pi-subagents/blob/8fcc3c787a6e7d9da0f21bafb604fe937084c21b/docs/workflows.md),
[wake helper](https://github.com/nicobailon/pi-subagents/blob/8fcc3c787a6e7d9da0f21bafb604fe937084c21b/src/shared/parent-wake.ts).

### Tintin: do not switch for this release

This package explicitly implements Claude Code-like delivery. Completions wait
for the busy parent's tool-batch boundary; an idle parent gets a short batching
delay. Steering, fresh/custom roles, concurrency queues, and package-shipped agent
definitions are available. Focused tests exercise real extension wiring with
mocked child execution, including completion racing with parent settlement.

The differences that matter to Foreman:

- The inspected shutdown handler aborts agents, disposes the completion outbox,
  and closes child sessions without distinguishing a reload in that handler.
  Tests explicitly expect pending notifications to be dropped on shutdown.
- Completion after Escape deliberately starts another parent turn. That matches
  its stated Claude behavior, but conflicts with DESIGN.md's current interruption
  policy unless Foreman adds control over it.
- Steering can be queued before a child session exists; manager code treats it
  as accepted and catches asynchronous delivery errors. That is weaker evidence
  than confirmed application of a brief revision.
- Per-message usage is accumulated, but parent reporting drains it through a
  later tool result. The exported cost breakdown fills individual categories with
  zero and preserves only total cost. This is unsuitable as our sole live cache-
  cost source, even though total billed cost is retained.
- Its documented public RPC is smaller: ping, spawn, stop, and consume. Additional
  control would require the documented in-process manager or further adaptation.

Neither its worktree helper nor Nicobailon's temporary worktree workflow replaces
Foreman's retained task worktree. Pass a verified existing cwd.

Sources: [completion outbox](https://github.com/tintinweb/pi-subagents/blob/e819a82ae364a2b0432881b89b0c784b413a88c1/src/completion-outbox.ts),
[shutdown and extension wiring](https://github.com/tintinweb/pi-subagents/blob/e819a82ae364a2b0432881b89b0c784b413a88c1/src/index.ts),
[usage implementation](https://github.com/tintinweb/pi-subagents/blob/e819a82ae364a2b0432881b89b0c784b413a88c1/src/usage.ts),
[RPC contract](https://github.com/tintinweb/pi-subagents/blob/e819a82ae364a2b0432881b89b0c784b413a88c1/docs/rpc.md).

### Herdsman: reserve for a future multi-lead environment

Herdsman has a substantial durable mailbox and ownership model. Assignments,
questions, replies, acknowledgement, and cleanup are correlated. Its lifecycle
distinguishes working, blocked, settling, unknown, and lost. Recovery tests cover
undelivered results, cleanup retries, replacement ownership, and missing parents.
This is a credible alternative, not merely a UI for launching agents.

It relies on Herdr for processes, panes, and placement and introduces Lead,
Manager, and other supervision concepts. That duplicates decisions already owned
by Foreman's handovers and task registry unless we adopt its wider model. We did
not run a real Herdr environment, so passing mailbox tests is not evidence that
the complete stack works on this machine.

Use it if persistent multi-lead placement becomes a requirement. Do not add it
beside another runtime to manage the same workers.

Sources: [lifecycle](https://github.com/boadij/pi-herdsman/blob/897810003200ed68475e0aac2cb8cf09d4f5ea91/docs/concepts/lifecycle.md),
[recovery tests](https://github.com/boadij/pi-herdsman/blob/897810003200ed68475e0aac2cb8cf09d4f5ea91/extension/recovery.test.ts).

## Commands and monitors

### Aliou: selected with a compatibility gate

The process package provides logs, status, process control, log matchers, and
typed notification events. It separates the process event stream from delivery
and UI. That gives Foreman an integration point without scraping rendered text.
Its delivery code handles idle-parent wakes, busy-parent steering, and log-match
rate limiting. There are explicit success, failure, crash, killed, and log-match
event kinds.

Corrections to the earlier recommendation:

- Killed-process notifications default to `context`, not `turn`. Foreman must
  configure `onKilled: "turn"` for jobs whose termination needs management, while
  keeping explicit Foreman pause/stop authoritative.
- Shutdown disposes delivery listeners and kills managed processes. It does not
  preserve monitors across reload by itself. Save monitor specifications and
  reconstruct read-only watches after reconciliation; never replay arbitrary
  side-effecting commands automatically.
- The notification listener catches a failed idle wake but does not itself supply
  Foreman's durable acknowledged inbox. Owning that inbox is still necessary.
- Independently operating worker and process notifiers can race. Test combined
  wakes and central pause gating, not only each package separately.

A normal source-checkout npm install failed with ERESOLVE: the package's Pi 1.0.0
development dependency conflicts with `@aliou/pi-utils-settings` 0.19.2, whose peer
range is `>=0.74.0 <1`. Registry metadata for 0.19.1 has the same upper bound.
The outer process package's wildcard Pi peer declaration does not remove that
conflict. This is a packaging compatibility finding, not proof of runtime failure.

Focused notification/cleanup tests passed using the temporary Tintin test runtime
with Pi 1.1.0 and a separate test configuration. That bypassed the conflicting
dependency tree and did not exercise settings UI or the full installed extension.
Do not present it as an installation smoke test. Resolve the declaration through
a compatible upstream release or a reviewed pinned packaging change before
making this a required user installation. Do not silently force peer resolution
or downgrade Pi.

Sources: [notification delivery](https://github.com/aliou/pi-processes/blob/434fa0a860b1fa4fe9fccdc986964d865ef98e47/extensions/processes/handlers/notifications.ts),
[notification defaults](https://github.com/aliou/pi-processes/blob/434fa0a860b1fa4fe9fccdc986964d865ef98e47/extensions/processes/notifications/registry.ts),
[shutdown](https://github.com/aliou/pi-processes/blob/434fa0a860b1fa4fe9fccdc986964d865ef98e47/extensions/processes/hooks/cleanup.ts),
[settings dependency metadata](https://registry.npmjs.org/@aliou/pi-utils-settings/0.19.2).

### Jtsang Monitor: useful reference, not selected

The monitor is compact and directly resembles Claude's Monitor: output is batched,
capped, and sent with a turn trigger and steering delivery. It reports normal
exit and timeout, and supports explicit stop. Its three focused tests passed,
including real shell execution through Pi's local bash operations with a mocked
extension host.

It stops monitors on shutdown, explicitly discards queued output on stop, and
has no durable delivery/recovery layer. Stop therefore does not provide the same
automatic management event as the desired stopped-task behavior. Its smaller API
and output-driven design would leave more process integration work to Foreman.
Select only this resource if experimenting; the bundle's separate subagent
implementation is not needed.

Source: [monitor implementation](https://github.com/jtsang4/pi-extensions/blob/c767f22d58b3796cd3ffcf23e5d59dc1c26b3477/extensions/monitor.ts).

## Usage, cache, and messaging

Keep Pify's existing user-facing dashboard. Its installed child tally is shared
among Pify packages, not a verified automatic bridge to Nicobailon. Foreman should
require a small child telemetry extension, preserve Pi's per-response priced
usage including cache categories, and reconcile by run/attempt/message ID.
Do not sum cumulative snapshots as deltas or count a terminal report again.

The same required child extension can enforce and verify one-hour Anthropic cache
requests. Pi 1.1.0 exposes a provider-request payload hook, but the final adapter
must cover every relevant cache-control location and supported call path. No
candidate was verified here to enforce this requirement out of the box.

Do not require Intercom for parent/child questions. Add it only when independent
Foreman leads need explicit session-to-session messages. Keep its origin and
authorization separate from human instructions.

## Executed tests

All 520 selected tests passed. These are focused upstream tests, not the complete
project suites and not an end-to-end Foreman certification.

| Candidate | Tests | Coverage and limits |
|---|---:|---|
| Nicobailon | 109 unit + 65 integration | Parent wake, notifier, steering ledger, required child extensions, usage reconciliation, result watcher, workflow steering inbox; mocked hosts/providers and temporary artifacts |
| Tintin | 106 | Outbox, completion delivery/wiring, worker steering, child shutdown, usage reporting, RPC; Vitest with mocked child execution |
| Aliou | 73 | Notification sender/service, idle delivery, classification, log matching, cleanup; isolated configuration with shared temporary test dependencies |
| Herdsman | 164 | Mailbox, recovery, supervision; no real Herdr deployment |
| Jtsang | 3 | Monitor start/list/stop and UI behavior; local shell commands, mocked extension host |

Nicobailon commands used Node's test runner on `parent-wake`, `notify`, `steering`,
`required-child-extensions`, and `usage-reconciliation` unit files, then its
documented loader for `result-watcher` and `workflow-steer-inbox` integration files.
Tintin used Vitest on the eight corresponding completion/steering/shutdown/usage/
RPC files. Herdsman used its test environment bootstrap on `mailbox`, `recovery`,
and `supervision`. Aliou used a temporary Vitest include list for the six listed
notification/cleanup files, without its normal memfs setup. Jtsang used Node's
test runner on `tests/monitor.test.ts`.

The initial Tintin test attempt occurred before its native bundler dependency
finished downloading and failed to start; the retry passed after that dependency
loaded. The first Herdsman attempt lacked host modules; after linking installed Pi
modules, the selected tests passed. Neither setup failure is counted as a product
test failure or a passing run.

## Remaining release gates

1. Resolve Aliou's package compatibility and load the complete selected stack on
   Pi 1.1.0 without changing the user's existing environment during development.
2. Prove builder completion -> next dispatch -> monitor findings -> responder ->
   next monitor in an actual Pi session, with idle periods and user steering.
3. Pause during simultaneous worker and process completion; retain both events
   without an unwanted turn or duplicate dispatch.
4. Reload during work; retain detached workers and reconcile/recreate monitors.
5. Prove the lead applies a steering revision, rather than merely accepting it.
6. Verify one-hour cache request payloads and live worker usage before completion.

These are integration work for the chosen stack, not reasons to keep browsing
for another orchestrator. Reopen selection only if a required contract cannot be
implemented through supported interfaces at reasonable scope.

## Community context

The [Herdsman author's post](https://www.reddit.com/r/PiCodingAgent/comments/1woif1b/i_built_pi_herdsman_for_async_subagents_with/)
describes the same ownership and lead-context concerns. The
[async-workflow discussion](https://www.reddit.com/r/PiCodingAgent/comments/1w9e6zo/my_pi_agent_setup_part_2_native_async_operation/)
also describes composing a worker runtime with a separate process watcher.
These helped identify candidates. Source and test evidence, rather than popularity
or anecdotes, determined the recommendation.
