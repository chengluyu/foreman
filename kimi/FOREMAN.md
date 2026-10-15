# Foreman

Version: Foreman 0.7.0, Kimi Code edition. Changes are listed in `CHANGELOG.md`.
This edition lives in `kimi/`; the Claude Code edition is at the repository root.
Paths below are relative to `kimi/`.

A way to run a coding project with one lead agent and a crew of worker agents,
while paying as little as possible for them.

The lead is the foreman. It plans the work, writes a brief for each task, sends
workers out, tracks their pull requests (PRs) and keeps the handover. It does not
do the work itself. Each worker takes one brief, works in its own git worktree,
opens one PR and stops. You decide what gets built, review the PRs and approve
merges.

This is the Kimi Code edition. It was adapted from the Claude Code edition
(versions 0.1.0–0.5.0); measurements taken on that edition are marked as such.
What does not transfer is listed under "What changed from the Claude Code
edition".

| File | What it is |
|---|---|
| `FOREMAN.md` | This guide. Read it once; it explains the rules and why they save money. |
| `../kimi.plugin.json` | Plugin manifest, at the repository root, pointing into `kimi/`. Install the whole repository as a Kimi Code plugin, or copy the pieces by hand (see "One-time setup"). |
| `skills/foreman/SKILL.md` | The foreman skill that starts a lead session in any repository. Invoke it with `/skill:foreman`, or `/foreman` for short. |
| `skills/foreman-create/`, `skills/foreman-resume/` | `/skill:foreman-create TOPIC` and `/skill:foreman-resume TOPIC`: one handover per line of work. They use the start script and rules in `skills/foreman/`, so install all three folders side by side. |
| `skills/foreman/lead.md` | The lead's rules. The skills have the lead read them. |
| `skills/foreman/foreman-start.sh` | Run by the lead on skill start: finds the repository's handover or topic handover, creates it on first use, and reads its settings. |
| `skills/foreman/HANDOVER.md` | The single-handover template. The start script copies it into each repository on first use. |
| `skills/foreman/handover-templates/` | The topic and shared-rules templates that `/skill:foreman-create` copies. |
| `agents/foreman-*.md` | The worker profiles: builder, investigator, clerk, scout, and the optional responder. |
| `skills/foreman/review-bot.md`, `review-wait.sh` | Optional: lead rules and a watcher for repositories where a review bot such as Codex must approve each PR. |
| `VERSION`, `CHANGELOG.md` | The current version, and what changed in each version. |
| `version.sh` | Checks that every file and installed copy carries the current version, and bumps it. |

The lead reads only `lead.md`, not this guide. Everything a lead loads is re-read
on every one of its calls, so the rules it carries are kept short.

## How the cost works

Every rule below follows from five facts. The first, fourth and fifth hold on any
agent host; the second and third depend on the provider's prompt cache, and the
figures quoted come from the Claude Code edition.

1. **Every model call re-reads the agent's whole context.** Where the provider
   caches the prompt, the re-read comes from the cache at a fraction of the input
   price, but an agent makes hundreds of calls. A task costs roughly its number of
   calls times its average context. The context grows while the agent works, so a
   task twice as long costs more than twice as much.
2. **A prompt cache expires after a pause.** The Claude Code edition measured
   5-minute caches for workers, and the first call after a longer pause re-wrote
   the whole context at 12 to 40 times the price of reading it. Whatever your
   provider's numbers are, the shape is the same: long idle waits inside an
   agent's turn are the expensive kind of waiting.
3. **Some actions throw the cache away mid-session:** switching models, changing
   MCP servers or plugins, compacting, and upgrading the CLI were the measured
   ones on Claude Code. Expect a similar list on any host.
4. **Every agent starts with a fixed context** (system prompt, tool definitions,
   skills) and re-reads it on every call. A lead starts large; a worker with a
   short tool list can start an order of magnitude smaller.
5. **Whatever a session reads stays in its context** and is re-read on every later
   call until it compacts. What an agent reads early costs the most.

What this looked like in one project on the Claude Code edition (three long lead
chats, 128 workers, 83 merged PRs):
- Workers used 86–95% of the units and the lead 5–14%. The cache hit rate was
  97–98% throughout, so caching itself was never the problem.
- While workers ran to 400k–960k tokens of context, calls above 400k were 45% of
  the cost. Smaller tasks brought that to 6% and cut the cost per merged PR by 44%.
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
- There are four types, plus an optional fifth. Kimi Code runs every subagent on
  the session's secondary model (see "The model"), so the types differ in tools,
  step budget and what they hand back:

| Type | Job | Hands back | Step budget |
|---|---|---|---|
| `foreman-builder` | Build or fix something whose cause is known | A PR and a 15-line report | ~150 per task, stop at 400 |
| `foreman-investigator` | Find the cause of a bug, flaky test or odd behaviour | Cause, evidence and a fix brief; no PR | ~100 |
| `foreman-clerk` | Merges, conflicts, renumbering, merging approved PRs, full test runs | A 10-line report | ~150 |
| `foreman-scout` | One factual question from the web, docs or code | 10 lines with sources | ~20–40 |
| `foreman-responder` (optional) | One round of a review bot's findings on a PR | Fixes, replies and a new review request | ~80 |

Step budgets are instructions, not enforced caps: the profiles tell the worker to
stop and report past its budget, and the lead restates the budget in the brief.

Why these four:
- **Investigations run long and wait the most.** In one chat they took 7.6% of the
  units, and a single flaky-test investigation took 274 steps and 3.8% of the
  chat. It kept re-running tests with no point at which to stop. A step budget,
  batched test runs and a report instead of a PR fit this work.
- **Chores kept the lead's context growing.** Git and GitHub work was 19–29% of
  the lead's units, all done at about 250k context. A clerk starts small, and
  whatever it reads leaves with it, so the lead stays small.
- **Lookups are cheap in a small context and expensive in a big one.** 40 of 97
  builders searched the web, and one lead made about 45 web calls itself. A
  scout's answer goes into the brief, so builders start with the facts.
- **No reviewer type.** You review. Follow-up work came from behaviour you wanted
  changed after trying a feature, which a code review would not have caught.

## The model

Kimi Code runs the lead on the session's model and every subagent on the
secondary model, chosen with `/secondary-model` (or `subagent_model` in
`config.toml`). There is no per-worker model or effort setting, so the Claude
edition's Opus/Sonnet split does not transfer.

The Claude edition measured the split with API prices: Sonnet cost half as much
per token except for cache reads, which cost the same, so replaying three chats
with the cheaper model everywhere saved 24% on long jobs and 43% on short ones,
and the saving vanished if the cheaper model needed about a third more tokens.
The lesson that transfers: if your secondary model is cheaper and weaker, give it
the short, well-defined jobs by setting it for a session of clerks and scouts,
and measure before trusting it with builders.

What the profiles keep from the Claude edition's prompt tuning:
- **"Finish the job."** A long unattended task sometimes ends with a report that
  announces the next step. For a worker, that report is its last message, so the
  lead gets half the work back. The profiles name those early stops and forbid
  them, and say that the final message is the whole handoff.
- **No additions.** Workers suggest extra tests, docs and files in the report
  instead of adding them.
- **Real checks.** A check that failed to start doesn't count, and a check that
  can't run must be named.
- **Search, don't recall.** The scout must look things up.
- **Answer first.** Asked for ideas or a plan, the lead answers and waits.

These were written against observed model behaviour. Re-check them against the
models you actually run, and change the profiles when a model misbehaves
differently.

## One-time setup

Once per machine; nothing is needed per project.

1. Install the plugin. In any Kimi Code session:
   ```text
   /plugins install https://github.com/chengluyu/foreman
   ```
   or from a local checkout, `/plugins install ~/Developer/harness/foreman`.
   Then `/reload` or start a new session. This registers the three foreman skills
   and the five worker profiles at once.
   To install the pieces by hand instead:
   ```bash
   mkdir -p ~/.kimi-code/skills && cp -r ~/Developer/harness/foreman/kimi/skills/foreman* ~/.kimi-code/skills/
   ```
   ```bash
   mkdir -p ~/.agents/agents && cp ~/Developer/harness/foreman/kimi/agents/foreman-*.md ~/.agents/agents/
   ```
   (`~/.agents/agents/` is shared with other agent tools; `~/.kimi-code/agents/`
   works too.) A plugin install is copied into
   `~/.kimi-code/plugins/managed/foreman/`, so after updating the repository you
   must reinstall the plugin; hand-copied files just need new sessions.
2. Pick the model workers run on with `/secondary-model`. All workers share it.
3. Start a new session to pick up the worker profiles, then check them with the
   smoke test prompt at the end of this guide.

The profiles hold no project rules. Workers follow the project's `AGENTS.md` and
the Rules at the end of each brief, which the lead copies from the handover.

## Starting a lead session

In any repository, start a new session and type:
```text
/skill:foreman
```
or `/foreman <what to work on first>` (the shorthand works because no built-in
command takes the name). The lead then:
- runs `foreman-start.sh`, which finds the repository's main checkout, which
  every worktree shares, and its `HANDOVER.md`. On first use it creates the file
  from the template and keeps it out of git through `.git/info/exclude`;
- reads `lead.md` from the skill's folder, and `review-bot.md` too when the
  handover names a review bot;
- reads the handover and tells you in five lines where things stand.

If a compaction drops the skill's rules, run `/skill:foreman` again to re-attach
them. The first time in a repository, the lead asks for the handover's Standing
rules, the repository's Foreman settings:
- `Review bot`: `none`, or `Codex` to load the review-bot rules.
- `Builder`: `foreman-builder`, or a project's own builder profile.
- Worker rules, which the lead copies into every brief: commit style, test commands,
  and anything that must never happen, such as agent names in branches or commits.

## The daily loop

1. Start a lead session with `/skill:foreman`. Pick the model and secondary model
   now and keep them for the session.
2. Say what you want. The lead splits it into tasks, writes the briefs and tells
   you the plan in a few lines.
3. The lead sends workers out, as background agents so several run at once. Tasks
   that edit the same busy files wait for each other; the rest run in parallel.
4. Each worker opens a PR and reports back. The lead updates `HANDOVER.md` and
   tells you what is ready to review.
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
  14% of its chat on its own. No tool enforces a worker limit in this edition, so
  the lead counts them itself; the handover's Standing rules can set a maximum.

## Testing

- Workers test in stages: type check, then unit tests for what they changed, then
  only the e2e specs named in their brief, each once. To get detail on a failure,
  they rerun that one test.
- The lead runs the full suite after merges, at a quiet time, one run at a time.
  Parallel e2e runs slow each other down, and slow runs stall every agent that
  waits on them.

## Waiting

- No agent blocks on a command for more than 4 minutes. Long jobs run as
  background Bash tasks with output to a log. A finished task notifies the agent
  on its own; to check progress, the agent greps the log instead of sitting in a
  blocking wait:
  ```sh
  timeout 210 sh -c 'until grep -qE "passed|failed|^exit" run.log; do sleep 10; done'; tail -n 20 run.log
  ```
  Each check is a cheap step; a 10-minute blocking wait stalls the turn and, on
  providers with short-lived prompt caches, rewrites the cache afterwards.
- The lead does not poll workers. Their reports wake it.

## Review and follow-ups

- Batch your feedback. One message per PR means one follow-up worker per PR.
- Follow-ups go to a fresh worker with the brief, the PR link and the feedback.
  After this became the rule, the share of a PR-opening worker's units spent after
  opening its PR fell from 52% to 8%.
- Never resume a worker that has been idle for more than an hour. On the Claude
  edition its cache was gone and its context large; a fresh worker starts cheaper
  either way.

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
  lead runs it as a background Bash task, so waiting costs no tokens. It counts
  only events after the latest trigger comment, so an old 👍 never passes a new
  push.
- **A fresh responder per round.** It reads that round's findings, fixes or
  declines each one, replies, resolves the fixed threads, pushes and posts
  `@codex review`. It starts small and never waits, and its context doesn't pile
  up over the rounds. The replies and the open declined threads on GitHub carry
  the history between rounds.
- **The lead only dispatches.** It never reads the findings itself.

Why not let the builder loop? It would wait 10–15 minutes a round, with a context
that grows every round.

Rules, in `review-bot.md`:
- A PR merges only after your approval and a pass on its latest push. Any push,
  including fixes for your feedback, needs another round.
- Rounds start as soon as the PR opens, in parallel with your review.
- After 5 rounds, or when the bot repeats a finding the responder declined, the
  lead stops and lists the open threads for you.

To turn it on in a repository:
1. Set `- Review bot: Codex` in the handover's Standing rules. The next
   `/skill:foreman` loads the rules; in a running session, tell the lead to read
   `review-bot.md` from the skill's folder.
2. If the bot isn't Codex, or you want another round cap, say so in the Standing
   rules too: the bot, its trigger comment, and `BOT` and `PASS_TEXT` for the
   watcher.
3. Make sure `gh` is signed in. The responder profile is installed with the others.

## The lead's context

- Compact at a natural break once the lead passes about 200k tokens, while the
  session is warm. A compaction after a long break re-processes the whole history
  cold, so start a new session from `HANDOVER.md` instead. (The 200k figure was
  measured against Claude API prices; treat it as a starting heuristic and
  re-measure on your plan.)
- Keep status updates to a few lines. They stay in the lead's context too.
- Run one lead session per day or per phase of work, not one session for days.
  A lead that ran for 2.6 days averaged 251k tokens of context and was compacted
  only at 308k, 493k and 489k.

## Breaks and nights

A long break ends every cache, warm or not. What you control is how big the lead
is when it goes cold, and how much runs unwatched. The arithmetic below came from
Claude API prices; the rule it produced is what carries over: **compact first if
the lead is large (it measured about 170k tokens); otherwise just go. Keep-alive
check-ins aren't worth setting up.**

For a lead of C tokens, away for 8 hours, the Claude-edition figures were:

| Option | Units | Cheapest when |
|---|---|---|
| Just go | 2C (one rewrite when you return) | never for a big lead, but under 0.1% of a week below 170k |
| Check in every 50 minutes | 9 × (0.1C + 3.5k) + 0.1C, about C + 31.5k | a narrow middle band where it saves almost nothing |
| Compact first, then go | 0.1C + 45k + 2 × 70k, about 0.1C + 185k | C above about 170k |

**Before you sleep**
- Compact the lead if it is over about 170k.
- Queue only tasks that need no decision from you.
- Run fewer workers than in the day, about 2. Hitting a usage limit at 2 am stops
  every worker mid-task.
- Give every task a step budget. Send the night-shift prompt below.

**In the morning**
- Read the lead's summary before sending anything new.
- If workers were stopped overnight, start fresh ones from their worktrees instead
  of resuming them.
- If you forgot to compact and the lead is big, start a new session from
  `HANDOVER.md` instead of compacting it cold.

## Topics: one handover per line of work

When a repository has several lines of work that barely touch, give each its own
handover instead of one long file. Every lead re-reads its whole handover on every
call, so a lead should carry only its own line.

- `/skill:foreman-create browser` makes `handovers/browser.md` and, the first time,
  `handovers/_shared.md`, in the main checkout, kept out of git as a folder.
- `/skill:foreman-resume browser` continues it. Use it when you retire a lead and start
  a new one: the handover belongs to the topic, not the session. The new lead
  replaces the `Lead:` line; it does not look for the old session.
- A topic is lowercase letters, digits and dashes. A wrong or missing name prints a
  `STOP:` line with the topics that exist; nothing is created by accident.
- `_shared.md` holds what is true for every topic: the Standing rules (review bot,
  builder, worker rules), the merge order across topics, who is using the
  machine (e2e focus, clipboard, ports) and the environment. A lead reads its topic
  and `_shared.md`, and never another topic's file.
- Once `handovers/` exists, plain `/skill:foreman` stops and points to the two commands.
  Repositories without it keep one `HANDOVER.md` and work as before.
- To move an existing `HANDOVER.md` over: create the topic, move the topic's
  sections across and the Standing rules and Environment into `_shared.md`, and
  leave a one-line pointer in the old file.

## Handover and new sessions

- **A new session starts from `HANDOVER.md`, never by reading the previous chat.**
  One lead read two old chats in 15 calls and carried the extra 36k tokens through
  166 later calls, about 1.0M units in all. A 5k-token handover would have cost
  about 0.1M.
- **One handover per repository, in its main checkout.** Sessions in the app run in
  their own worktrees, so a relative `HANDOVER.md` would be a different file each
  time. The start script prints the absolute path, and the lead always uses it.
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

- `/usage` shows the session's token usage, context consumption and quota.
- Every week or so, check against transcripts:
  - cost per merged PR, and its trend
  - the share of tokens from calls above 400k context, aiming for under 10% (the
    best chat was at 6%, the worst at 45%)
  - the share spent by agents waiting on long commands, aiming for under 5% (on
    the Claude edition, cache rewrites after waits took 8–17% before the waiting
    rules)
  - the lead's share, aiming for under 10% (5–14% seen)
  - the longest workers, aiming for none above about 400k context

## What changed from the Claude Code edition

If you used Foreman on Claude Code, this is what to expect here:

- **One model for the lead, one for all workers.** There is no per-worker model or
  effort, so the profiles no longer pin `model` or `effort`, the `Sonnet workers`
  handover setting is gone, and briefs have no `Effort:` line. Set the workers'
  model once per machine with `/secondary-model`.
- **Step caps are budgets, not limits.** The profiles' `maxTurns` caps are gone;
  each profile now states its step budget in prose and stops itself.
- **The foreman-board mod does not exist here.** No live worker board, no spawn
  guard, no auto-compact. The lead counts running workers itself, and you compact
  it at natural breaks as before.
- **The skill is invoked, not injected.** `/skill:foreman` tells the lead to run
  the start script and read `lead.md`, instead of pre-expanding their contents.
  The skill folder is self-contained, so no file refers to where you cloned the
  repository.
- **The cache settings are gone.** `subagentPromptCacheTtl` and friends were
  Claude Code settings; there is nothing to set here. The waiting rules stay,
  because background tasks with log checks are the cheap pattern regardless.

## Versions

Foreman changes as you test it, so every measurement needs to say which version it
measured.
- `VERSION` holds the current version. `lead.md`, `review-bot.md`, this guide, the
  skill and each worker profile carry it as "Foreman x.y.z", so an installed copy
  shows which version it is. The lead writes the version into `HANDOVER.md`.
- Until 1.0.0, any change that can alter behaviour or cost (a rule, a prompt, a
  step budget) bumps the minor version: 0.6.0 to 0.7.0. Fixes to wording or
  figures that change nothing bump the patch version: 0.6.0 to 0.6.1. Call the
  first version you have tested and kept 1.0.0.
- To release a change, run `kimi/version.sh bump 0.7.0`, add an entry to
  `CHANGELOG.md`, commit, and tag the commit `v0.7.0`. Then reinstall the plugin
  or copy the profiles and the skill to where you installed them, and start new
  sessions. `git diff v0.6.0 v0.7.0` shows exactly what changed between two
  tested versions. Profiles load when a session starts, so a running session
  keeps the old version. The skill reads `lead.md`, `review-bot.md` and the
  scripts from its own folder, so those take effect at the next start of
  any of the three skills.
- Run `kimi/version.sh` before a test to find stale installed copies of the profiles
  and the skill. It checks `~/.kimi-code/skills/foreman*/`, `~/.agents/agents/` and
  `~/.kimi-code/agents/`; pass any other directory of `foreman-*.md` copies to
  check that too.
- Compare versions on whole days of work with the checks under Measuring, and
  write the results into the version's changelog entry.

## Prompts

Start a lead session: `/skill:foreman` (or `/foreman`), or with a first request:
`/skill:foreman <what to work on first>`.

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
Every worker should name the session's secondary model and only the tools in its
profile.
