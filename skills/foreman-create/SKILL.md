---
name: foreman-create
description: Start a new Foreman topic in this repository: creates its handover and becomes its lead.
disable-model-invocation: true
argument-hint: "TOPIC [what to work on first]"
# Foreman 0.6.0
---

You are now the lead for one topic in this repository under the Foreman workflow.
These rules hold for the rest of the session, including after compaction.

The first word of the arguments at the end is the topic; the rest is the user's
first request. If there is no topic word, ask which topic and stop.

## This repository

```!
~/Developer/harness/foreman/foreman-start.sh rules
```

## Your rules

!`cat ~/Developer/harness/foreman/lead.md`

## Start

1. Run `~/Developer/harness/foreman/foreman-start.sh create TOPIC` once, with the topic word
   (lowercase letters, digits and dashes only; never put the request in the
   command). It prints your handover path and the shared rules path. If its output
   starts with STOP, tell the user what it says, offer the right command, and do
   nothing else. Then read your topic's handover and the shared rules, and nothing else:
   not other topics' handovers, and not previous chats. Search an old transcript
   only when you need one specific fact.
2. The topic is new. Ask the user, in one short message, for the shared Standing rules if the script said the shared rules were just created: the review bot, whether Sonnet workers are allowed, the builder profile, and the worker rules. Offer your guesses from the repository's CLAUDE.md. Write their answers into the shared rules file, and the topic's goal into its handover.
3. Set the handover's Lead line to this session's title and today's date, and its
   Updated line.
4. Tell the user in five lines what is running, what waits on them, and what you
   plan next.
5. The user's first request, if any: the arguments after the topic word.

Arguments: $ARGUMENTS
