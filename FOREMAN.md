# Foreman

Version: Foreman 0.3.0. Changes are listed in `CHANGELOG.md`.

A way to run a coding project with one lead agent and a crew of worker agents,
while paying as little as possible for them.

The lead is the foreman. It plans the work, writes a brief for each task, sends
workers out, tracks their pull requests (PRs) and keeps the handover. It does not
do the work itself. Each worker takes one brief, works in its own git worktree,
opens one PR and stops. You decide what gets built, review the PRs and approve
merges.

| File | What it is |
|---|---|
| `FOREMAN.md` | This guide. Read it once; it explains the rules and why they save money. |
| `lead.md` | The lead's rules, short enough to load into every lead session. |
| `agents/foreman-*.md` | The worker profiles: builder, investigator, clerk, scout, and the optional responder. Copy them to `~/.claude/agents/`. |
| `review-bot.md`, `review-wait.sh` | Optional: lead rules and a watcher for repositories where a review bot such as Codex must approve each PR. |
| `HANDOVER.md` | An empty handover. Copy it to a project's root and keep it out of git. |
| `VERSION`, `CHANGELOG.md` | The current version, and what changed in each version. |
| `version.sh` | Checks that every file and installed copy carries the current version, and bumps it. |

The lead reads only `lead.md`, not this guide. Everything a lead loads is re-read on
every one of its calls, so the rules it carries are kept short.

## How the cost works

Every rule below follows from five facts.

1. **Every model call re-reads the agent's whole context.** The re-read comes from
   the prompt cache at a tenth of the input price (a twentieth on Claude Opus 5.5),
   but an agent makes hundreds of calls. A task costs roughly its number of calls
   times its average context. The context grows while the agent works, so a task
   twice as long costs more than twice as much.
2. **The cache expires after a pause.** By default it lasts 5 minutes for workers.
   It lasts an hour for the lead on a Claude subscription, but only 5 minutes on an
   API key. Setup step 4 gives both an hour. The first call after a longer pause writes the whole
   context again at 1.25× or 2× the input price, which is 12 to 40 times the price
   of reading it.
3. **Some actions throw the cache away mid-session:** switching models, turning on
   fast mode, connecting or removing an MCP server, enabling a plugin that brings
   MCP servers, denying a whole tool, compacting, and upgrading Claude Code.
   Changing effort does too on most models.
4. **Every agent starts with a fixed context** (system prompt, tool definitions,
   skills, memory) and re-reads it on every call. A lead starts at about 60k
   tokens. A worker with a short tool list can start under 10k; with every tool it
   starts near 46k.
5. **Whatever a session reads stays in its context** and is re-read on every later
   call until it compacts. What an agent reads early costs the most.

What this looked like in one project (three long lead chats, 128 workers, 83 merged
PRs):
- Workers used 86–95% of the units and the lead 5–14%. The cache hit rate was
  97–98% throughout, so caching itself was never the problem.
- While workers ran to 400k–960k tokens of context, calls above 400k were 45% of the
  cost. Smaller tasks brought that to 6% and cut the cost per merged PR by 44%.
- 14% of all units went to rewriting caches that expired while agents waited,
  mostly 7–10 minutes on end-to-end (e2e) test runs.
- Workers spent 36% of their units reading and searching files and 25% on e2e runs,
  against 11% editing code.
- 41% of all units were spent between midnight and 08:00, while nobody watched.

## Roles

**You**
- Say what to build and what matters. Answer the lead's questions.
- Review PRs, and put all feedback for one PR in one message.
- Approve each merge.
- Compact the lead at natural breaks. The lead can't run `/compact` itself.

**The lead**
- Splits requests into PR-sized tasks and writes a brief for each.
- Decides what can run in parallel, and sends workers out.
- Merges approved PRs and keeps `HANDOVER.md` current.
- Does not write code, debug, run test suites or read diffs beyond a two-command
  check. A lead at 250k context pays nearly twice what a typical worker (146k
  average) pays for the same step, and whatever it reads stays in its context.

**Workers**
- One brief, one worktree, one job, then stop with a short report.
- Follow-up fixes after review go to a new worker.
- There are four types. They differ in model, effort, tools, step cap and what they
  hand back:

| Type | Job | Hands back | Model, effort | Step cap |
|---|---|---|---|---|
| `foreman-builder` | Build or fix something whose cause is known | A PR and a 15-line report | Opus 5.5, medium | 400 |
| `foreman-investigator` | Find the cause of a bug, flaky test or odd behaviour | Cause, evidence and a fix brief; no PR | Opus 5.5, high | 150 |
| `foreman-clerk` | Merges, conflicts, renumbering, merging approved PRs, full test runs | A 10-line report | Sonnet 5.5, medium | 150 |
| `foreman-scout` | One factual question from the web, docs or code | 10 lines with sources | Sonnet 5.5, medium | 40 |
| `foreman-responder` (optional) | One round of a review bot's findings on a PR | Fixes, replies and a new review request | Opus 5.5, medium | 80 |

Why these four:
- **Investigations run long and wait the most.** In one chat they took 7.6% of the
  units, and a single flaky-test investigation took 274 steps, 18 cache rewrites
  and 3.8% of the chat. It kept re-running tests with no point at which to stop. A
  step budget, batched test runs and a report instead of a PR fit this work.
- **Chores kept the lead's context growing.** Git and GitHub work was 19–29% of the
  lead's units, all done at about 250k context. A clerk starts under 10k, and
  whatever it reads leaves with it, so the lead stays small.
- **Lookups are cheap in a small context and expensive in a big one.** 40 of 97
  builders searched the web, and one lead made about 45 web calls itself. A scout's
  answer goes into the brief, so builders start with the facts.
- **No reviewer type.** You review. Follow-up work came from behaviour you wanted
  changed after trying a feature, which a code review would not have caught.

## Models and effort

API prices per million tokens:

| Model | Input | 5-minute write | 1-hour write | Cache read | Output |
|---|---|---|---|---|---|
| Opus 5.5 | $4 | $5 | $8 | $0.20 | $20 |
| Sonnet 5.5 | $2 | $2.50 | $4 | $0.20 | $10 |

Sonnet 5.5 costs half as much per token, except for cache reads, which cost the
same. Cache reads were 68% of all units. Replaying the three chats with Sonnet 5.5
for every agent, at the same token counts, costs 24% less, not 50%. The saving
depends on the job:
- **Long jobs save least:** 24% for builders, 26% for chores and 17% for a long
  investigation, because they are mostly re-reads.
- **Short jobs save most:** 43% for scouts, because most of their cost is the first
  write of their context.
- **The saving vanishes** if Sonnet needs about a third more tokens for the same
  task. Anthropic reports that Opus 5.5 finishes coding tasks in fewer steps, and
  recommends Opus for the hardest long work.

These are API figures; a subscription may count each model differently.

So: Opus for long work, and for anything judged from screenshots, which Opus 5.5
reads better. Sonnet for short, well-defined jobs.

Effort, per Anthropic's model guides:
- **Opus 5.5** defaults to `medium`, which matched or beat Opus 5 at `high` on
  coding in fewer steps. Use `high` only for hard reasoning, such as investigations.
  Keep `xhigh` and `max` for work where you have measured a gain; they think much
  longer.
- **Sonnet 5.5**: `medium` for well-specified agentic work, `high` for harder work.
  At `low` it can report work as done without running a check, and it stops to ask
  before the work is finished. At `xhigh` and `max` it starts review rounds nobody
  asked for.
- Effort lives in the profile. The Agent tool can override a worker's model for one
  task, but not its effort, so a different effort needs a separate profile.

What the profiles take from the guides:
- **"Finish the job."** Opus 5.5 sometimes ends a long task with a report that
  announces the next step. For a worker, that report is its last message, so the
  lead gets half the work back. The profiles name those early stops and forbid them.
- **No additions.** Sonnet 5.5 adds tests, docs and files nobody asked for, at
  every effort. Every profile says to suggest them in the report instead.
- **Real checks.** A check that failed to start doesn't count, and a check that
  can't run must be named.
- **Search, don't recall.** Sonnet 5.5 sometimes answers from training when a search
  would find newer facts. The scout must look things up.
- **Answer first.** Asked for ideas or a plan, a model may start building. The
  lead's rules say to answer and wait.

Most of the rest of both guides covers API plumbing that Claude Code already
handles, such as thinking display, `max_tokens`, JSON parsing and refusal handling.

## One-time setup

1. Copy the `agents/foreman-*.md` files to `~/.claude/agents/`, or to a project's
   `.claude/agents/`. Edit each Project rules section: commit style, test commands,
   merge method, anything that must never happen. `foreman-responder` is needed
   only with a review bot (see Review bots).
2. Load the lead rules into lead sessions. Add this line to the project's
   `CLAUDE.md`:
   ```text
   @~/Developer/harness/foreman/lead.md
   ```
   Or paste `lead.md` as the first message of a lead session.
3. Copy `HANDOVER.md` to the project root. Keep it out of git with `.gitignore` or
   `.git/info/exclude`.
4. Give workers an hour of cache (Claude Code 2.1.242 or later). In
   `~/.claude/settings.json`:
   ```json
   { "subagentPromptCacheTtl": "1h" }
   ```
   On an API key, also add `"promptCacheTtl": "1h"` for the lead; a subscription
   already gives the lead an hour. It works on a subscription too: on 30 Sep 2026 a
   test worker's writes came back as 1-hour writes, with no restart. A 1-hour write
   costs 2× the input price instead of 1.25×, but it survives waits of up to an
   hour. Replaying one project's chats at API prices, an hour for workers saved 13%,
   and the default 5-minute lead cache would have added 12%. The setting also
   covers workflows and Claude Code's background helper requests.
5. Start a new session to pick up the worker profiles, then check them with the
   smoke test prompt at the end of this guide.

## The daily loop

1. Start a lead session from `HANDOVER.md` (prompt below). Pick the model and
   effort now and keep them for the session.
2. Say what you want. The lead splits it into tasks, writes the briefs and tells
   you the plan in a few lines.
3. The lead sends workers out. Tasks that edit the same busy files wait for each
   other; the rest run in parallel.
4. Each worker opens a PR and reports back. The lead updates `HANDOVER.md` and tells
   you what is ready to review.
5. You review. The lead sends one fresh worker per PR with all your feedback.
6. You approve merges. The lead merges, then runs the full test suite at a quiet
   time.
7. At the end of the day, or before any break longer than an hour, follow Breaks
   and nights below.

## Briefs

The brief is the most valuable thing the lead writes. Without file pointers,
workers re-explore code the lead already knows. Without "done when" checks, work
comes back for a second round: follow-up workers took 15% of one chat.

```text
Task: <one sentence, the result the user will see>
Rule or cause: <root cause, or the reference behaviour already checked, with source>
Start here: <files with line ranges>
Done when: <3–5 checks the user will do in review>
Tests: <unit test files; e2e specs by name>
Out of scope: <what not to touch>
Branch: <branch name, base, stacked or not>
```

## Task size and parallel work

- **One task is one PR, about 150 steps**, roughly an hour of agent time. In one
  chat the 7 longest workers (240–290 steps) cost 24% of it.
- **Investigations get a budget** of about 100 steps and report what they found.
  The fix is a separate task.
- **A worker that finds its task bigger than the brief stops and reports a plan.**
- **Tasks that edit the same busy files run one after another,** so nobody spends a
  worker on merge conflicts.
- **Avoid stacked PRs unless they are needed.** Merge the main branch into a PR only
  when it conflicts, and don't rebase. Syncing branches cost 4% of one chat.
- **The number of workers matters less than their size.** Up to 15 small workers
  at once was cheap; one worker that ran 859 steps and grew to 964k context used
  14% of its chat on its own.

## Testing

- Workers test in stages: type check, then unit tests for what they changed, then
  only the e2e specs named in their brief, each once. To get detail on a failure,
  they rerun that one test.
- The lead runs the full suite after merges, at a quiet time, one run at a time.
  Parallel e2e runs slow each other down, and slow runs let caches expire.

## Waiting

- No agent blocks on a command for more than 4 minutes. Long jobs run in the
  background with output to a log, and the agent checks the log every 3–4 minutes:
  ```sh
  timeout 210 sh -c 'until grep -qE "passed|failed|^exit" run.log; do sleep 10; done'; tail -n 20 run.log
  ```
  Each check is a cheap cache read. A 10-minute blocking wait is a full rewrite.
- The lead does not poll workers. Their reports wake it.

## Review and follow-ups

- Batch your feedback. One message per PR means one follow-up worker per PR.
- Follow-ups go to a fresh worker with the brief, the PR link and the feedback.
  After this became the rule, the share of a PR-opening worker's units spent after
  opening its PR fell from 52% to 8%.
- Never resume a worker that has been idle for more than an hour. Its cache is gone
  and its context is large; a fresh worker is cheaper.

## Review bots (optional)

Some repositories require a review bot, such as OpenAI's Codex reviewer, to approve
each PR. Each round works like this: the bot posts findings, someone fixes or
declines each one and replies on its thread, then comments `@codex review`. This
repeats until the bot reacts 👍, sometimes also posting that it found no major
issues. In one session that took 11 rounds on one PR (19 findings, 3 declined) and
7 on another. Each round took 10–15 minutes from request to verdict.

Foreman splits each round three ways:
- **A watcher waits.** `review-wait.sh` checks GitHub every minute and prints one
  line, `findings <review ids>`, `passed <signal>` or `timeout`, then exits. The
  lead runs it as a background Monitor, so waiting costs no tokens. It counts only
  events after the latest trigger comment, so an old 👍 never passes a new push.
- **A fresh responder per round.** It reads that round's findings, fixes or
  declines each one, replies, resolves the fixed threads, pushes and posts
  `@codex review`. It starts small and never waits, so no round pays a cache
  rewrite, and its context doesn't pile up over the rounds. The replies and the open
  declined threads on GitHub carry the history between rounds.
- **The lead only dispatches.** It never reads the findings itself.

Why not let the builder loop? It would wait 10–15 minutes a round, with a context
that grows every round. On the default 5-minute cache that is a full rewrite each
round.

Rules, in `review-bot.md`:
- A PR merges only after your approval and a pass on its latest push. Any push,
  including fixes for your feedback, needs another round.
- Rounds start as soon as the PR opens, in parallel with your review.
- After 5 rounds, or when the bot repeats a finding the responder declined, the
  lead stops and lists the open threads for you.

To turn it on in a repository:
1. Add a second line to its `CLAUDE.md`, under the lead.md one:
   ```text
   @~/Developer/harness/foreman/review-bot.md
   ```
2. If the bot isn't Codex, or you want another round cap, say so in the same
   `CLAUDE.md`, below that line: the bot, its trigger comment, and `BOT` and
   `PASS_TEXT` for the watcher.
3. Install `agents/foreman-responder.md`, fill in its Project rules, and make sure
   `gh` is signed in.

## The lead's context

- Compact at a natural break once the lead passes about 200k tokens, while its
  cache is warm. A warm compaction reads the history from the cache. A compaction
  after a long break re-processes the whole history at full price, so start a new
  session from `HANDOVER.md` instead.
- Keep status updates to a few lines. They stay in the lead's context too.
- Run one lead session per day or per phase of work, not one session for days.
  A lead that ran for 2.6 days averaged 251k tokens of context and was compacted
  only at 308k, 493k and 489k.

## Breaks and nights

A cache can't be paused, so every long break ends cold. What you control is how
big the lead is when it goes cold, and how much runs unwatched.

For a lead of C tokens, away for 8 hours:

| Option | Units | Cheapest when |
|---|---|---|
| Just go | 2C (one rewrite when you return) | never for a big lead, but under 0.1% of a week below 170k |
| Check in every 50 minutes | 9 × (0.1C + 3.5k) + 0.1C, about C + 31.5k | a narrow middle band where it saves almost nothing |
| Compact first, then go | 0.1C + 45k + 2 × 70k, about 0.1C + 185k | C above about 170k |

The rule: **compact first if the lead is over about 170k; otherwise just go.**
Keep-alive check-ins aren't worth setting up.

**Before you sleep**
- Compact the lead if it is over about 170k.
- Queue only tasks that need no decision from you.
- Run fewer workers than in the day, about 2. Hitting a usage limit at 2 am stops
  every worker mid-task, and their caches go cold.
- Give every task a step budget. Send the night-shift prompt below.

**In the morning**
- Read the lead's summary before sending anything new.
- If workers were stopped overnight, start fresh ones from their worktrees instead
  of resuming them.
- If you forgot to compact and the lead is big, start a new session from
  `HANDOVER.md` instead of compacting it cold.

## Handover and new sessions

- **A new session starts from `HANDOVER.md`, never by reading the previous chat.**
  One lead read two old chats in 15 calls and carried the extra 36k tokens through
  166 later calls, about 1.0M units in all. A 5k-token handover would have cost
  about 0.1M.
- **Keep `HANDOVER.md` under about 5k tokens,** because every line is re-read on
  every call. Record state, not history: what is running, open PRs, the queue,
  decisions waiting on you, standing rules.
- **The lead updates it** whenever a PR opens or merges, a decision is made, or you
  say you are leaving.
- **When the lead needs one fact from an old chat,** it searches the transcript for
  that fact instead of reading the chat.

## Estimates (optional)

Ask the lead for minute ranges before tasks start, and log the actual agent time
per PR. In one project, 3 of 12 estimated tasks finished inside the range, 7 early
and 2 late. Overall the agents took 76% of the middle of the estimates. A time log
makes the next estimates better; story points added nothing here.

## Measuring

- `/usage` shows a "Prompt cache (main)" line with the hit ratio, the misses and
  the likely cause of the last one (Claude Code 2.1.251 or later).
- Every week or so, check against transcripts:
  - cost per merged PR, and its trend
  - the share of units from calls above 400k context, aiming for under 10% (the
    best chat was at 6%, the worst at 45%)
  - the share lost to cache rewrites after waits, aiming for under 5% (8–17% before
    the waiting rules)
  - the lead's share, aiming for under 10% (5–14% seen)
  - the longest workers, aiming for none above about 400k context

## Versions

Foreman changes as you test it, so every measurement needs to say which version it
measured.
- `VERSION` holds the current version. `lead.md`, this guide and each worker
  profile carry it as "Foreman x.y.z", so an installed copy shows which version it
  is. The lead writes the version into `HANDOVER.md`.
- Until 1.0.0, any change that can alter behaviour or cost (a rule, a prompt, a
  model, an effort level, a step cap) bumps the minor version: 0.2.0 to 0.3.0.
  Fixes to wording or figures that change nothing bump the patch version: 0.2.0 to
  0.2.1. Call the first version you have tested and kept 1.0.0.
- To release a change, run `./version.sh bump 0.3.0`, add an entry to
  `CHANGELOG.md`, commit, and tag the commit `v0.3.0`. Then copy the profiles to
  where you installed them and start new sessions. `git diff v0.2.0 v0.3.0` shows
  exactly what changed between two tested versions. Profiles load when a session starts, so a running session keeps the
  old version.
- Run `./version.sh` before a test to find stale installed copies. Pass a project's
  `.claude/agents` folder to check that too.
- Compare versions on whole days of work with the checks under Measuring, and
  write the results into the version's changelog entry.

## Prompts

Start a lead session:
```text
You are the lead for this project. Follow lead.md. Read HANDOVER.md and nothing
from previous chats; search an old transcript only if you need one specific fact.
Tell me in five lines what is running, what waits on me, and what you plan next.
```

Night shift (compact the lead first if it is over about 170k):
```text
Night shift: I'm away for about 8 hours. Run at most 2 workers at a time, with
full briefs, and only for tasks that need no decision from me. Investigators stop
after about 100 steps and report what they found. Builders stop once their PR is
open. When one finishes, start the next queued task; don't
review, debug or run tests yourself. If a usage limit stops workers, leave them for
the morning. Update HANDOVER.md before you go quiet. Updates: one line per worker.
```

Review feedback:
```text
All my feedback on #<PR>: <items>. Send one fresh worker to fix all of it. Check
the reference behaviour first for anything that changes how the feature works.
```

End of the day:
```text
Update HANDOVER.md for a fresh session tomorrow: running workers, open PRs, queue,
decisions waiting on me. Keep it under 5k tokens. Then stop.
```

Worker smoke test, after installing the profiles:
```text
Spawn one of each foreman worker type with this prompt: "Setup check, not a task.
Don't edit anything. Name your model, then list the tools you can call on one line,
and say in one sentence whether anything in your instructions is unclear." Show me
each reply and the context each first call used.
```
