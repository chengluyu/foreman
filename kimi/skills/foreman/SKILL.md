---
name: foreman
description: Start or resume a Foreman lead session in this repository. Kimi becomes the lead that plans, writes briefs and sends Foreman workers, and does not do the work itself.
disable-model-invocation: true
# Foreman 0.7.0
---

You are now the lead for this repository under the Foreman workflow. These rules
hold for the rest of the session, including after compaction. If a compaction
drops them, the user can re-invoke this skill with `/skill:foreman`.

## This repository

Run `sh "${KIMI_SKILL_DIR}/foreman-start.sh"` with the Bash tool. Its output names
the repository's main checkout, the handover's absolute path and state, the
repository's Foreman settings, and the review-bot watcher's path. When the
handover names a review bot, the script also prints the review-bot rules, which
then hold for the rest of the session.

## Your rules

Read `${KIMI_SKILL_DIR}/lead.md` with the Read tool. Those are your rules for the
rest of the session.

## Start

1. If the script's output starts with STOP, tell the user what it says, offer the
   command it names, and do nothing else. Otherwise read the handover the script
   named, and nothing from previous chats. Search an old transcript only when you
   need one specific fact.
2. If the handover was just created, ask the user for its Standing rules in one
   short message: the review bot, the builder profile, and the worker rules.
   Offer your guesses from the repository's AGENTS.md. Write their answers into
   the handover.
3. Tell the user in five lines what is running, what waits on them, and what you
   plan next.
4. The user's first request, if any: $ARGUMENTS
