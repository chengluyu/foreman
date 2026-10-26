# Changelog

Versions follow the rules under Versions in `FOREMAN.md`. Until 1.0.0, a minor
bump means behaviour or cost may change; a patch bump means it should not.

Each entry lists what changed, how to upgrade, and what to check when testing.
After a test, add what you measured under Results.

## 0.7.0 (2026-10-16)

Topics, ported from the Claude Code edition's 0.6.0 (2026-10-07): one handover per
line of work. The edition now lives in `kimi/` on main, beside the Claude Code
edition. The start script was checked in a scratch repository with a worktree
(single, create, resume, wrong and duplicate names, list, rules, git exclusion),
and all three skills load in Kimi Code. Untested in a live lead session.

### Added
- `/skill:foreman-create TOPIC` and `/skill:foreman-resume TOPIC`
  (`skills/foreman-create/`, `skills/foreman-resume/`). The first word is the topic
  and the rest is the first request. They run the start script and read `lead.md`
  from `skills/foreman/` through `${KIMI_SKILL_DIR}/../foreman/`, so the three
  folders must sit side by side, as they do in the plugin.
- `handovers/<topic>.md` per topic and `handovers/_shared.md` for the Standing rules,
  merge order across topics, machine use and environment. Templates in
  `skills/foreman/handover-templates/`, without the `Sonnet workers` line.
- `foreman-start.sh` modes `create`, `resume`, `list` and `rules`. Problems print a
  `STOP:` line naming the `/skill:` command to use.

### Changed
- The Kimi Code edition moves from its own branch into `kimi/` on main
  (`kimi/skills/`, `kimi/agents/`, and its own guide, changelog, `VERSION` and
  `version.sh`). `kimi.plugin.json` stays at the repository root and points into
  `kimi/`, so `/plugins install https://github.com/chengluyu/foreman` installs this
  edition. The Claude Code edition at the root is unchanged.
- `lead.md` tells a lead to read its topic and `_shared.md` only, and to update only
  its own topic. Its other mentions of `HANDOVER.md` now say "your handover".
- With a `handovers/` directory, plain `/skill:foreman` stops and points to the new
  commands. Without one, nothing changes.
- `version.sh` stamps and checks the new skills.

### Upgrade from 0.6.0
1. Reinstall the plugin, or copy `kimi/skills/foreman*` to `~/.kimi-code/skills/`
   and `kimi/agents/foreman-*.md` to `~/.agents/agents/`.
2. Run `kimi/version.sh`.
3. To use topics in a repository, run `/skill:foreman-create TOPIC` there, then move
   the old handover over as described in "Topics" in `FOREMAN.md`.

### To check when testing
- `${KIMI_SKILL_DIR}/../foreman/` resolves both for the plugin install and for
  hand-copied skills.
- `/skill:foreman-resume` loads `lead.md` and, with a review bot, the review-bot
  rules, and the lead reads only its own topic.
- The lead runs the start script with just the topic word.
- After a compaction the lead still has its topic and paths; if not, re-invoke
  `/skill:foreman-resume TOPIC`.

## 0.6.0 (2026-10-04)

The Kimi Code edition. Foreman is adapted from Claude Code to Kimi Code: the skill,
the five worker profiles, the scripts and the guide. Untested in a real lead
session; the start script was checked in a scratch repository with a worktree.

### Added
- `kimi.plugin.json`: the whole repository installs as one Kimi Code plugin
  (`/plugins install <path-or-url>`), registering the skill and the workers.
- FOREMAN.md: a "What changed from the Claude Code edition" section.

### Changed
- The skill folder `skills/foreman/` is now self-contained: it holds `lead.md`,
  `foreman-start.sh`, `review-bot.md`, `review-wait.sh` and the `HANDOVER.md`
  template, and the skill finds them through `${KIMI_SKILL_DIR}`. No file refers
  to where the repository is cloned.
- The skill is invoked instead of injected: it tells the lead to run the start
  script and read `lead.md`, replacing Claude Code's `!` command expansion.
  Invoke it with `/skill:foreman`, or `/foreman` for short.
- Worker profiles are Kimi Code custom agents: `tools` now name Kimi Code tools
  (FetchURL, WebSearch, TaskOutput, TaskStop). `model`, `effort`, `maxTurns` and
  the `experimental.cacheTtl` comment are gone — Kimi Code runs every subagent on
  the session's secondary model (`/secondary-model`), has no effort setting, and
  does not enforce step caps. Each profile now states its step budget in prose
  and stops itself, and says that its final message is the whole handoff.
- Project rules in every profile follow the project's `AGENTS.md` (or CLAUDE.md).
- The handover's `Sonnet workers` setting is removed; the start script no longer
  prints it and now prints the review-bot watcher's path.
- The review-bot watcher runs as a background Bash task instead of a Monitor.
- Long waits run as background Bash tasks with log checks; the profiles no longer
  cite Claude's 5-minute cache as the reason.

### Removed
- `mod/foreman-board/` (a Claude Code mod: worker board, spawn guard, per-brief
  effort, auto-compact). The lead counts running workers itself, and compaction
  is yours to run at natural breaks.
- `plugin/` (the agent-plugins.org draft), superseded by `kimi.plugin.json`.
- The `Effort: high` brief line and the `Max workers` guard setting, which only
  the mod applied.

### Upgrade from 0.5.0
This edition replaces the Claude Code installation rather than upgrading it.
1. Install the plugin (`/plugins install <path-or-url>`) or copy `skills/foreman/`
   to `~/.kimi-code/skills/foreman/` and `agents/foreman-*.md` to
   `~/.agents/agents/`.
2. Pick the workers' model with `/secondary-model`.
3. Start new sessions. Existing handovers keep working; delete the `Sonnet
   workers` line when you next edit one.

### To check when testing
- `/skill:foreman` in a worktree session finds the handover in the main checkout,
  and `git status` there stays clean.
- Each worker type starts with only its own tools, names the secondary model in
  the smoke test, and stops near its step budget without being capped.
- After a compaction, the lead still follows its rules; if not, re-invoke
  `/skill:foreman`.
- The review-bot watcher, as a background Bash task, wakes the lead on
  `findings`, `passed` and `timeout`.

### Results
Not tested yet.

## Before 0.6.0

0.1.0 to 0.5.0 are Claude Code versions; see `CHANGELOG.md` at the repository root.
