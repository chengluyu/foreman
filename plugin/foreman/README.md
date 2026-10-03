# Foreman plugin draft

Version 0.1.0 adapts the workflow from Foreman 0.4.0, source commit
`0349d8cc0686776557dbb0a98baa7be671ec22fe`.

This release contains six portable skills: a lead and five worker procedures.
It removes Claude-only command expansion, fixed model aliases, tool lists, and
cache claims from the portable instructions. It does not register worker agents,
provide an MCP server, dispatch runtime, interactive board, or background service.
Execution depends on tools available in the host and the user's authorization.
The original Claude Code files remain the source for that runtime.

## Proposed complete plugin

One plugin with three parts:

1. **Skills:** lead policy, brief format, role procedures, review policy, and
   handover. Load detailed role instructions only for the selected worker.
2. **MCP server and app:** persistent project state, a project board, brief editor,
   review queue, settings, and task context attachments. Use a global Projects
   entrypoint and a thread Project board entrypoint. Prefer fullscreen for these
   work surfaces; reserve inline for a specific action or approval.
3. **Worker adapters:** start with the existing local Claude Code workflow. Add
   Codex or remote workers behind the same task/brief/report interface after the
   adapter is implemented and verified. Model and cache settings belong to the
   adapter, not the portable lead policy.

A cloud server cannot access a local checkout merely from its filesystem path.
For web/mobile operation, a local authenticated runner can make outbound
connections to a hosted service, claim authorized jobs, execute them in scoped
worktrees, and return compact reports. GitHub credentials stay with the runner.
Remote execution uses provisioned checkouts and separately configured credentials.

## State and tools

Store project, task, brief revision, worker run, PR, head commit, review round,
approval, standing rules, and handover revision. Use stable identifiers and
version checks. Avoid competing copies of state: for a local first release,
HANDOVER.md stays authoritative; a later structured store imports it explicitly
and exports Markdown as a compatibility view. Preserve manual changes with
conflict detection. Do not silently reconcile two writable authorities.

The lead needs a short summary, one selected brief, or one report; the board can
read fuller lists without feeding every log into model context. Selecting a task
can attach its brief and status. A context attachment alone never dispatches it.
Desktop mentions and deep links can expose projects, tasks, and PRs when supported.
Do not register a handler for every .md file; use normal handover imports/exports
or a dedicated Foreman file type if a file handler becomes useful.

Candidate tool groups (not implemented in this release):

- Project summary, task lookup, and app opener.
- Brief creation/update with revision checks.
- Authorized worker dispatch, status, and compact report retrieval.
- PR review state and batched follow-up preparation.
- Approval recording tied to the current PR commit, and a separately authorized
  merge operation that revalidates the head and required checks.
- Handover import/export and project settings.

Worker completion and bot-review waiting belong in a runtime service, event
subscription, or authorized scheduler. An app view does not keep workers alive.
Long-term unattended work needs a persistent execution service; a skill or idle
chat is insufficient. Cost metrics should use actual runtime telemetry; show
unavailable data explicitly and do not extrapolate Claude prices to other hosts.

## Implementation order

1. Verify the portable skills in a host with one harmless planning task.
2. Build a local MCP state adapter and project-board app against the existing
   handover and worker runtime; verify app placement and real data round trips.
3. Add a hosted coordination service and authenticated outbound local runner for
   use away from the machine. Test reconnection, cancellation, and duplicate jobs.
4. Add remote worker execution using the same interface and provisioned runtime.

Before operational use, check isolated worktrees, scoped permissions, task budgets,
reports, current-commit bot verdicts, approval invalidation after a push, the round
cap, interrupted runs, and clean handover resumption. Measure cost per merged PR
using observed data. The upstream changelog marks Foreman 0.4.0 as not yet tested
in a real lead session; this draft does not establish its cost savings.

## Sources

- OpenAI's Claude plugin migration guide:
  https://developers.openai.com/plugins/guides/submit-claude-plugin
- MCP Apps UI guidance:
  https://developers.openai.com/plugins/concepts/ui-guidelines
- OpenAI MCP Extensions specification (capability support varies by host):
  https://github.com/openai/mcp-extensions/blob/main/docs/spec.md
