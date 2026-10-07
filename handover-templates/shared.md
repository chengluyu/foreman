# Shared rules

<!--
Repository-wide settings for every Foreman topic here. Each topic has its own
file next to this one; a lead reads this file and its own topic only. Change a
rule here only when the user says so. Keep it short: every lead re-reads it on
every call. Keep it out of git.
-->

## Standing rules

Foreman settings for this repository (the start script reads the first three):
- Review bot: none
- Sonnet workers: allowed
- Builder: foreman-builder
- Worker rules, copied into every brief:
  - <commit style, test commands, anything that must never happen>

<Other preferences every lead must follow: agent limits, merge rules, what never
to do. Point to memory or docs instead of copying long rules here.>

## Merge order across topics

<The user merges; the order between topics is theirs. List PRs in the order they
should land, with the topic that owns each. Merge only on the user's word.>

## Machine use

<Who is using shared resources right now: the e2e display and focus, the clipboard,
ports, disk. One line per topic that holds one.>

## Environment

<Dev servers and ports, shared caches, and anything else a new session needs in
order to run things.>
