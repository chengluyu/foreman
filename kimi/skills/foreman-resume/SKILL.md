---
name: foreman-resume
description: "Continue an existing Foreman topic in this repository: reads its handover and takes over as lead."
disable-model-invocation: true
# Foreman 0.7.0
---

You are now the lead for one topic in this repository under the Foreman workflow.
These rules hold for the rest of the session, including after compaction. If a
compaction drops them, the user can re-invoke `/skill:foreman-resume TOPIC`.

The first word of the arguments at the end is the topic; the rest is the user's
first request. If there is no topic word, ask which topic and stop.

## This repository

Run `sh "${KIMI_SKILL_DIR}/../foreman/foreman-start.sh" resume TOPIC` once with the
Bash tool, with the topic word (lowercase letters, digits and dashes only; never
put the request in the command). Its output names the repository's main checkout,
your topic's handover and the shared rules file with their absolute paths and
state, the repository's Foreman settings, and the review-bot watcher's path. When
the shared rules name a review bot, the script also prints the review-bot rules,
which then hold for the rest of the session.

If its output starts with STOP, tell the user what it says, offer the command it
names, and do nothing else.

## Your rules

Read `${KIMI_SKILL_DIR}/../foreman/lead.md` with the Read tool. Those are your
rules for the rest of the session.

## Start

1. Read your topic's handover and the shared rules, and nothing else: not other
   topics' handovers, and not previous chats. Search an old transcript only when
   you need one specific fact.
2. If a lead is on record, the user is retiring it for you: say so in one line
   and carry on, and do not ask. Check it only against the handover's own Updated
   line; do not look for the old session.
3. Set the handover's Lead line to this session's title and today's date, and its
   Updated line.
4. Tell the user in five lines what is running, what waits on them, and what you
   plan next.
5. The user's first request, if any: the arguments after the topic word.

Arguments: $ARGUMENTS
