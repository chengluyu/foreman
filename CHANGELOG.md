# Changelog

Versions follow the rules under Versions in `FOREMAN.md`. Until 1.0.0, a minor
bump means behaviour or cost may change; a patch bump means it should not.

Each entry lists what changed, how to upgrade, and what to check when testing.
After a test, add what you measured under Results.

## 0.5.0 (2026-10-03)

Effort follows Anthropic's "Spending your effort" post, and an optional mod watches
the workers. The mod loaded in one session and its two commands answered; the
board, guard, effort line and auto-compact are untested with real workers.

### Added
- `mod/foreman-board/`: a Claude Code mod for lead sessions with a context band, a
  worker board, a spawn guard, per-brief effort and auto-compact. See "The
  foreman-board mod" in `FOREMAN.md`.
- A brief line `Effort: high` sets one worker's effort, applied by the mod.
- Optional handover setting `- Max workers: N` (default 5), read by the mod's guard.

### Changed
- `foreman-responder` runs at `high` effort, up from `medium`. A review-bot finding
  is a bug fix in existing code, and in the first run 15 of 22 PRs used all 5
  rounds at `medium`. Expect each round to cost more and, if it works, fewer rounds.
- `lead.md` tells the lead when to add `Effort: high` to a builder's brief.
- `version.sh` also stamps the mod.

### Upgrade from 0.4.0
1. Copy `agents/foreman-*.md` to `~/.claude/agents/`.
2. Optional: add `mod/foreman-board` to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block
   of `~/.claude/settings.json`.
3. Run `./version.sh`.

### To check when testing
- Review rounds per PR at `high` against the 0.4.0 run (15 of 22 PRs at the cap),
  and the cost per round against about $0.63.
- A builder with `Effort: high` in its brief shows `builder high` on the board.
- The guard refuses a sixth worker and a brief without Rules.
- Auto-compact fires after a turn above 200k, also while workers keep waking the
  lead, and the lead keeps its rules and worker list afterwards.

### Results of the 0.4.0 run (2026-10-02)
- About $170 at API prices for 7 hours, 118 workers, 93 of them review rounds.
- Worked: no cache rewrites, workers started at about 10k tokens, none above 223k.
- Did not work: the lead reached 809k tokens before its first compaction and took
  41% of the cost; `/compact` typed mid-turn arrived as plain text; each worker
  woke the lead twice; the lead posted 126 messages.

## 0.4.0 (2026-09-30)

Foreman works in any repository with one command and no per-project files. Untested
in a real lead session. The start script was checked in a scratch repository with a
worktree.

### Added
- `/foreman` skill (`skills/foreman/SKILL.md`), installed once in
  `~/.claude/skills/`. It runs the start script, loads `lead.md` into the session,
  and has the lead read the handover and report in five lines. `/foreman <task>`
  passes a first request. Claude Code re-attaches the skill after compaction, so
  the lead keeps its rules. Only you can run it (`disable-model-invocation`).
- `foreman-start.sh`: finds the repository's main checkout through
  `git worktree list`, so every worktree session uses the same `HANDOVER.md`. On
  first use it creates the handover from the template and adds it to
  `.git/info/exclude`. It prints the handover's Foreman settings, and appends
  `review-bot.md` when the handover names a review bot.
- Foreman settings in the handover's Standing rules: `Review bot`, `Sonnet
  workers`, `Builder`, and worker rules. On first use the lead asks for them and
  offers guesses from the repository's CLAUDE.md.

### Changed
- Every brief ends with Rules, the worker rules copied from the handover. Workers
  can't see the lead's memory.
- The worker profiles' Project rules sections no longer hold template
  placeholders, including a commit style that applied to every project. Workers
  follow the project's CLAUDE.md and the Rules in their brief; the brief wins when
  they disagree.
- The lead passes `model: "opus"` to clerks and scouts when the handover says
  Sonnet workers aren't allowed, and uses the builder the handover names.
- `lead.md` says where the handover lives. `review-bot.md` is switched on by the
  handover instead of a CLAUDE.md import.
- Setup is once per machine. There is no CLAUDE.md import, and no handover to copy
  per project.
- `version.sh` also stamps and checks the skill.

### Upgrade from 0.3.0
1. Copy `agents/foreman-*.md` to `~/.claude/agents/`, and `skills/foreman/` to
   `~/.claude/skills/foreman/`.
2. Remove any `@~/Developer/harness/foreman/*.md` lines you added to a CLAUDE.md;
   `/foreman` loads those files now.
3. Run `./version.sh`.

### To check when testing
- `/foreman` in a worktree session finds the handover in the main checkout, and
  `git status` there stays clean.
- After a compaction, the lead still follows its rules without re-reading anything.
- Every brief ends with the worker rules. In repositories with no-trace rules, no
  branch, commit or comment names an agent.
- With `Sonnet workers: not allowed`, clerks and scouts run on Opus.
- With `Review bot: Codex`, the lead starts the watcher when a builder opens a PR.

### Results
Not tested yet.

## 0.3.0 (2026-09-30)

Optional review-bot rounds for repositories where a bot such as Codex must approve
each PR, and an hour of cache for workers. Untested with Foreman. The watcher was
checked against two past rounds on two merged PRs.

### Added
- `review-bot.md`: lead rules that a repository loads only when it uses a review
  bot. A PR merges only after the user's approval and a bot pass on its latest
  push. There is a 5-round cap, and a finding the bot repeats after a decline goes
  to the user.
- `review-wait.sh`: a watcher the lead runs as a background Monitor. It checks
  GitHub every minute and prints `findings <review ids>`, `passed <signal>` or
  `timeout`. It counts only events after the latest trigger comment, and it
  detects a pass by a 👍 on the PR, a 👍 on the trigger comment, or a "no issues"
  comment or review.
- `foreman-responder` (Opus 5.5, medium effort, 80-step cap): handles one round.
  It reads findings per review, fixes or declines each one with evidence, replies
  on every thread, resolves fixed threads, pushes and posts `@codex review`. The
  `gh` commands are in its profile, so it doesn't rediscover them each round.
- In `FOREMAN.md`, a Review bots section with the reasons for the split and the
  steps to turn it on.

### Changed
- Setup step 4 now recommends `"subagentPromptCacheTtl": "1h"` on a subscription
  too. On 30 Sep 2026 a test worker's cache writes came back as 1-hour writes
  (8,796 and 2,171 tokens, none at 5 minutes), with no restart.
- The cache comments in the builder, investigator and clerk profiles now refer to
  that setting.
- `version.sh` also stamps `review-bot.md`.

### Upgrade from 0.2.0
1. Add `"subagentPromptCacheTtl": "1h"` to `~/.claude/settings.json`.
2. Copy `agents/foreman-*.md` to where you installed them, including the new
   `foreman-responder.md`, and fill in its Project rules.
3. In each repository that uses a review bot, add
   `@~/Developer/harness/foreman/review-bot.md` to its `CLAUDE.md`.
4. Start new sessions and run `./version.sh`.

### To check when testing
- Workers' cache writes show up as `ephemeral_1h_input_tokens` in their
  transcripts, and rewrites after waits fall close to zero. Before: 14% of all
  units went to rewrites after waits.
- Each round costs one small responder. Its context stays near its starting size
  and it never waits.
- Rounds per PR, and findings fixed vs declined. Baseline: 11 rounds and 19
  findings (3 declined) on one PR; 7 rounds on another.
- The watcher never passes a stale 👍, and it restarts after every push.
- The lead never reads findings, and each round adds only a few lines to its
  context.

### Results
Not tested yet.

## 0.2.0 (2026-09-30)

Four worker types instead of one, with a model and effort for each, and prompt
changes taken from Anthropic's prompting guides for Opus 5.5 and Sonnet 5.5.
Untested.

### Added
- `foreman-investigator` (Opus 5.5, high effort, 150-step cap): finds a cause and
  reports evidence and a fix brief; opens no PR. It runs flaky tests in background
  batches, at most 3 per hypothesis, within about 100 steps.
- `foreman-clerk` (Sonnet 5.5, medium effort, 150-step cap): merges the base branch
  into PRs, resolves conflicts, renumbers, merges approved PRs and runs the full
  test suite. It aborts and reports when a conflict needs a design decision, and it
  never rebases or force-pushes.
- `foreman-scout` (Sonnet 5.5, medium effort, 40-step cap): read-only answer to one
  question in 10 lines with sources. It must search rather than answer from memory.
- In every worker, a "Finish the job" section that names the early stops Opus 5.5
  makes on long unattended tasks and forbids them, and says to skip status notes
  between steps.
- In every worker, a rule to suggest extra features, tests, docs or refactors in the
  report instead of adding them (Sonnet 5.5 adds them unasked).
- In the builder and clerk, a rule that a check which failed to start doesn't count,
  and that a check which couldn't run must be named.
- In `lead.md`, "Answer first": when asked a question or for ideas, options or a
  plan, answer and wait instead of starting work.
- In `lead.md`, which worker type to use for each job, and what each type needs in
  its brief.
- In `FOREMAN.md`, a table of worker types, a Models and effort section with API
  prices and a replay of three chats, and a Versions section.
- `VERSION`, this changelog, `version.sh`, a version stamp in every file, and a
  version field in the `HANDOVER.md` template.
- A git repository with a tag for each version, starting at `v0.2.0`. Version
  0.1.0 predates it.

### Changed
- `foreman-worker` is now `foreman-builder`. Its model is pinned to
  `claude-opus-5-5` (it was `inherit`), with a 400-step cap.
- The lead no longer researches the web itself; it sends a scout.
- The lead sends conflicting merges and full test runs to a clerk.
- The night-shift and smoke-test prompts name the new types.

### Removed
- `agents/foreman-worker.md`.

### Upgrade from 0.1.0
1. Delete `~/.claude/agents/foreman-worker.md` if you installed it.
2. Copy `agents/foreman-*.md` to `~/.claude/agents/` and fill in each Project rules
   section.
3. Start a new lead session, then run `./version.sh`.

### To check when testing
Baselines come from the 23–26 Sep 2026 chats, before Foreman existed.
- Smoke test: builder and investigator say Opus 5.5, clerk and scout say Sonnet
  5.5, and each first call uses under about 10k context.
- Early stops: fewer workers resumed or followed up for unfinished work. Before:
  35 of 128 workers were resumed at least once.
- Clerks: reports show check output, conflicts are resolved correctly, and there
  are no rebases or force-pushes. If a clerk gets a conflict wrong, move the clerk
  to Opus 5.5.
- Investigators stop by about 100 steps and return a usable fix brief. Before: one
  investigation ran 274 steps with 18 cache rewrites.
- Scouts: their answers hold up when builders use them.
- The lead makes no web calls, and git and GitHub work falls below 19–29% of its
  units. The lead's share of the chat falls below 10% (12.8% on 26 Sep).
- Cost per merged PR is below 6.0M units (26 Sep).

### Results
Not tested yet.

## 0.1.0 (2026-09-30)

First version, written from the token and cache analysis of three long lead chats
(23, 24 and 26 Sep 2026: 128 workers, 83 merged PRs).

### Added
- `FOREMAN.md`: the guide, covering the cost model, roles, setup, daily loop,
  briefs, task size, testing, waiting, review, the lead's context, breaks and
  nights, handover, estimates, measuring and prompts.
- `lead.md`: the lead's rules. Coordinate and don't implement, brief fields, about
  150 steps per task, at most 2 workers at night, compact over about 200k (170k
  before a break), and keep `HANDOVER.md` current.
- `agents/foreman-worker.md` (model `inherit`, medium effort): one brief, one
  worktree, one PR. Its cost rules are search before reading, trimmed output,
  staged tests, and waits of at most 3.5 minutes so the 5-minute cache survives.
- `HANDOVER.md`: an empty handover template.
