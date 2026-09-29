# Changelog

Versions follow the rules under Versions in `FOREMAN.md`. Until 1.0.0, a minor
bump means behaviour or cost may change; a patch bump means it should not.

Each entry lists what changed, how to upgrade, and what to check when testing.
After a test, add what you measured under Results.

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
