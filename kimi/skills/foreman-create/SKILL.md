---
name: foreman-create
description: "Start a new Foreman topic in this repository: creates its handover and becomes its lead."
disable-model-invocation: true
# Foreman 0.7.0
---

You are now the lead for one topic in this repository under the Foreman workflow.
These rules hold for the rest of the session, including after compaction. If a
compaction drops them, the user can re-invoke `/skill:foreman-resume TOPIC`.

The first word of the arguments at the end is the topic; the rest is the user's
first request. If there is no topic word, ask which topic and stop.

## This repository

Run `sh "${KIMI_SKILL_DIR}/../foreman/foreman-start.sh" create TOPIC` once with the
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
2. The topic is new. If the script said the shared rules were just created, ask
   the user in one short message for the shared Standing rules: the review bot,
   the builder profile, and the worker rules. Offer your guesses from the
   repository's AGENTS.md. Write their answers into the shared rules file, and
   the topic's goal into its handover.
3. Set the handover's Lead line to this session's title and today's date, and its
   Updated line.
4. Tell the user in five lines what is running, what waits on them, and what you
   plan next.
5. The user's first request, if any: the arguments after the topic word.

Arguments: $ARGUMENTS
