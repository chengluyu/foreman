# Pi Foreman

Local first version for Pi 1.1.0 and Nicobailon's `pi-subagents` 0.77.0.
No build step is needed. Install the pinned local process-manager dependencies
once (also after pulling a changed lockfile):

```sh
cd /Users/chengluyu/Developer/harness/foreman/pi
npm ci --omit=peer --ignore-scripts
```

Pi supplies the omitted host peers at load time. Foreman bundles Aliou's manager,
logs, and dock extensions; do not also load standalone `@aliou/pi-processes` in
the same session. Nothing here changes your global Pi package list unless you
run the optional installation command.

## Try with Kimi K3

From the Git repository you want Foreman to manage:

```sh
pi -e /Users/chengluyu/Developer/harness/foreman/pi/extensions/foreman.ts \
  --provider kimi-coding --model k3
```

Your installed model list includes `kimi-coding/k3` and `kimi-coding/k3-256k`.
Use `--model k3-256k` for the latter. Authenticate with your normal Kimi Coding
setup if Pi asks. Do not put an API key in a brief or handover.

Your installed `pi-subagents` and `@pify/usage` load normally. If testing on a
different machine, install Nicobailon's package first:

```sh
pi install npm:pi-subagents@0.77.0
```

Start Foreman in Pi:

```text
/foreman
```

If the repository already has `handovers/`, use `/foreman-resume TOPIC`, or
`/foreman-create TOPIC` for a new topic. Do not create a new topic to evade another
lead's active worktree ownership.

Then send this first test request:

```text
Use Foreman for a read-only smoke test. Write two separate scout briefs.
First: inspect this repository and report its test commands with file references.
When that scout finishes, dispatch the second scout to inspect the build commands.
Do not edit product files, commit, push, open PRs, or post review requests.
Update the handover yourself after each report. End your turn while waiting so
we can verify that the worker completion wakes you again.
```

Expected behavior:

1. The lead writes a Markdown brief and calls `foreman_dispatch`.
2. You get a task/run receipt and see a worker in the package's FleetView.
3. The lead ends its turn. Worker completion starts another lead turn.
4. The lead writes and dispatches the second brief, then updates the handover.
5. `/foreman-status` shows both jobs and their retained worktrees. Usage appears
   in the Foreman status line as workers produce responses.

This live test spends Kimi API/subscription usage. The automated tests below use
a deterministic provider and do not call Kimi or Anthropic.

## Test steering and pause

During a longer scout task, say:

```text
Tell the running scout to include Windows-specific commands in its report.
Keep it read-only and use the same worker.
```

The lead should use `subagent` steering, check the receipt, and retain the task.
To pause management while a worker runs:

```text
/foreman-pause
/foreman-status
/foreman-continue
```

Paused workers may finish, but Foreman blocks model requests and new dispatches
until you continue. Escape also pauses Foreman after an aborted lead run.
`/foreman-stop` requests worker cancellation, stops Foreman-owned commands, and
cancels watches; it retains all worktrees. Check the recorded terminal outcome
rather than assuming a stop request has already finished.

## Background command tests

The existing `process` tool now uses `@aliou/pi-processes` 0.13.2. Foreman records
owned process starts/exits and controls their wake-ups. No extra Foreman tool was
added. `/ps`, `/ps:logs`, `/ps:kill`, `/ps:pin`, and `/ps:dock` are available.

After starting Foreman, ask:

```text
Start three background command tests using the process tool:
1. sleep 2; printf 'success\n'
2. sleep 2; printf 'failure\n' >&2; exit 7
3. sleep 60
End your turn while waiting. Report each terminal event once, including its
exit code or signal. Do not commit, push, or start other work.
```

The first two should wake the lead on success and failure. Stop the third using
`/ps:kill PROCESS_ID`; that should also wake the lead with a stopped result.
Stopping through `process({action:"stop",id:"..."})` works the same way.

Repeat with `/foreman-pause` before the commands finish. Results should be visible
in `/foreman-status` without model calls. `/foreman-continue` delivers the pending
events. `/foreman-stop` deliberately suppresses wake-ups while cancelling owned
commands. It does not stop processes created before Foreman activated.

The package's native completion notification is suppressed only for Foreman-owned
jobs, so there is one delivery path. Log-match wake-ups also pass through Foreman.
Only an actual ended-process event counts as terminal: a stop timeout remains
unresolved and produces an attention event. After a crash, absent manager records
are marked unknown rather than successful or automatically restarted.

An orderly Pi shutdown/reload stops these background commands and records the
confirmed outcome when possible. The handover and process records remain; commands
are never restarted automatically. Detached subagents have a separate lifecycle.
Aliou owns the temporary log files and may remove them on cleanup; save any log
evidence you need before shutting down or clearing finished processes.

## Markdown briefs and tools

While this extension is loaded, **Ctrl+O** also collapses `edit` diffs: collapsed
rows show only the file header, expanded rows use Pi's original diff display.
Errors remain visible when collapsed. This changes rendering only, not tool
execution, stored results, or model context.

The agent instructions and examples are in [LEAD.md](LEAD.md). The three tools are:

| Tool | Arguments |
|---|---|
| `foreman_dispatch` | `role`, absolute `briefPath` |
| `foreman_watch` | `action` plus target/deadline or watch ID |
| `foreman_status` | Optional `taskId` |

Roles are builder, investigator, clerk, scout, and responder. There is no record
tool: the lead edits the Markdown handover with normal file tools. Runtime state
contains only mechanical facts. Do not edit state JSON to make a job appear done.

Builder briefs need nonempty `## Task`, `## Rule or cause`, `## Start here`,
`## Done when`, `## Tests`, and `## Out of scope`. Other roles need Task, Start
here, and Done when. Optional metadata lines are:

```text
PR: 809
Branch: fix/downloads
Base: origin/main
Effort: high
Task ID: <existing-task-id-for-a-follow-up>
```

Omit Task ID for new work. Use a new brief file for every fresh execution.
Repeated dispatch of the same canonical path returns the original receipt;
editing a dispatched file does not change its immutable snapshot. The one
exception is a dispatch that failed before any worker launched: fix the brief or
the cause and dispatch the same path again. Explicitly steer running workers.

Where the worker works:

- `PR: N` checks out that open PR's branch (via `gh pr view`). Fork PRs are refused.
- `Branch:` naming an existing branch uses it. If another worktree has it checked
  out, the worker works in that worktree, and the brief snapshot lists any
  uncommitted files already there. Otherwise a new worktree checks out the local
  branch, or tracks `origin/BRANCH`. A branch checked out in the main checkout is
  refused.
- Otherwise the task gets a new branch (named by `Branch:` or generated) from Base,
  which defaults to the main checkout's `HEAD`.

Each role has a tool-call budget (soft/hard): builder 150/250, investigator 80/120,
clerk 60/120, responder 50/80, scout 20/40. At the soft limit pi-subagents blocks
further exploration; at the hard limit it stops the worker.

## Runtime PR watches

Requires authenticated `gh` with access to the target repository. Foreman itself
does not post review requests, fix findings, or merge PRs. Those remain authorized
agent actions.

After an authorized review request, ask the lead to register:

```js
foreman_watch({
  action: "create",
  kind: "github-review",
  target: {
    repo: "owner/repo",
    pr: 123,
    headSha: "FULL_COMMIT_SHA",
    requestId: "REVIEW_REQUEST_COMMENT_ID"
  },
  timeoutMinutes: 30
})
```

The scheduler polls about once a minute, backs off transient errors, and wakes
the lead on findings, pass, head change, PR closure, timeout, or three consecutive
API failures. Deadlines are checked separately. No dedicated watcher subprocess,
LLM polling calls, or process-manager plugin is required.

Only bot reviews on the watched commit after the trigger qualify. To accept a
thumbs-up on the trigger, include this marker in the review-request comment:

```text
@codex review
<!-- foreman-head: FULL_COMMIT_SHA -->
```

Without the marker, unbound reactions/comments are ignored; the watch may time
out rather than invent a pass. The default bot logins are
`chatgpt-codex-connector[bot]` and `codex[bot]`. A pass never grants merge approval.
Cancel with `foreman_watch({action:"cancel",watchId:"..."})`.

To exercise a timeout, use `timeoutMinutes: 1` on an actual pending request.
This only observes GitHub. The lead must reconcile and follow the user's retry
policy; the runtime never posts a retry on its own.

## Configuration and files

Optional `.foreman/config.json` in the main checkout:

```json
{
  "maxWorkers": 3,
  "baseRef": "origin/main",
  "reviewBots": ["chatgpt-codex-connector[bot]", "codex[bot]"]
}
```

Settings are read at activation. `workerExtensions` may additionally list trusted
absolute extension paths required by a custom provider. Only those extensions
and the generated Foreman policy extension load in workers; ambient parent
extensions are not blindly copied. Built-in Kimi Coding needs no extra extension.

- Single-handover mode: `HANDOVER.md` in the main checkout.
- Topic mode: `handovers/TOPIC.md` and `handovers/_shared.md`.
- Briefs/state/snapshots/telemetry: `.foreman/pi/TOPIC/`.
- Retained worktrees: `.foreman/worktrees/TASK_ID/`.

The startup command adds these paths to the repository's local Git exclude file;
it does not untrack already tracked handovers. One local process owns each topic.
Concurrent writers to the same task worktree are serialized. Worktrees are not
automatically removed; inspect uncommitted/unpushed work before manual cleanup.

## Caching and usage

Workers inherit the lead's selected model at dispatch. Kimi Coding uses its own
cache behavior, even when its wire format resembles Anthropic's. Foreman labels
that as provider-managed and does not promise a one-hour Kimi cache.

For the direct Anthropic provider, the lead and child policy extension set cache
breakpoints to one hour. Foreman also sets `PI_CACHE_RETENTION=long` while active
as a fallback for provider calls outside the normal hook and restores the lead's
previous value at shutdown. This does not guarantee cache hits.

Worker usage is written after each completed response, preserving Pi's cache
token counts and priced cost categories. The status line refreshes about every
two seconds. `foreman_status` includes each worker's totals. Missing telemetry
is labelled. This first version does not modify Pify's private child tally, so
use Foreman's worker total rather than assuming `/usage` includes it. Compaction
and provider-internal usage outside normal message events are not yet fully
reconciled in the worker tally.

## Automated tests

From this repository:

```sh
node --test pi/tests/*.test.mjs
node pi/tests/smoke.mjs
FOREMAN_SMOKE_PAUSE=1 node pi/tests/smoke.mjs
node pi/tests/process-smoke.mjs
```

The smoke test uses installed Pi and `pi-subagents` in a temporary repository,
with a deterministic test-only provider. Set `PI_BIN` or `PI_SUBAGENTS_PATH` if
they are not at the standard locations. It keeps artifacts and prints their path.
It verifies an ended lead turn, completion wake, second dispatch, two completed
workers, and child policy/telemetry files. The pause variant also checks that no
model call occurs while paused. Unit tests cover real Git worktrees, immutable
briefs, duplicate dispatch, capacity, follow-ups, cache payloads, and review races.
The process smoke test loads the actual Aliou package and runs real local shell
commands with the mock provider. It checks success, failure, tool/UI/external stop,
busy/paused delivery, duplicate suppression, and Foreman stop.

## First-version limits

- Keep Pi running and the machine awake. Detached workers can survive the parent;
  there is no daemon that continues lead management after Pi closes.
- A normal Pi session reload restores the saved Foreman activation. After a crash,
  resume the same Pi session before continuing; `pi-subagents` owns notification
  routing. A different lead can read retained runtime facts, but automatic
  adoption of another session's live workers is not implemented.
- An ambiguous launch stays `unknown` and reserves capacity. Inspect the package's
  status/artifacts before any recovery; automatic retry could duplicate a worker.
- Recovered terminal states do not prove product correctness. Review the report
  and handover. Transport acceptance does not prove the lead acted on an event.
- This is not an OS sandbox. Role instructions constrain behavior; shell tools
  still have the process's filesystem and network permissions.
- No automatic merge, worktree deletion, or nightly scheduling is included.
  Configure maxWorkers to two for unattended night work.
- Live Kimi K3 behavior and real Codex/GitHub review cycles require your trial;
  automated provider tests do not establish their reliability.

## Optional installation

After testing, make the package available in every Pi session:

```sh
pi install /Users/chengluyu/Developer/harness/foreman/pi
```

Then omit `-e` when launching Pi. Do not load the same package twice.
