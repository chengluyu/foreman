"""Build data.json for the Foreman homepage from local Claude Code transcripts.

The published numbers were measured on the original Claude Code edition of
Foreman, so this script reads the transcripts that edition wrote; this Kimi
Code edition keeps them as the historical record. It reads the sessions listed
in sessions.local.json (kept out of git), measures every model call of the
lead and its workers, and writes one anonymous JSON file:
no session IDs, project names, PR numbers, PR titles, task descriptions, commands
or message text. Pull requests are renumbered from 1 in the order they were opened
and keep only their kind (feat, fix, docs), their times and their size.

sessions.local.json:
  {"sessions": [{"id": "<session id>", "project": "<folder under ~/.claude/projects>",
                 "kind": "foreman" | "baseline", "repo": "<owner/name, for gh>"}]}

Units weight tokens by price relative to fresh input: cache read 0.1x, 5-minute
cache write 1.25x, 1-hour cache write 2x, output 5x.

Usage: python3 site/build.py
"""

import collections
import glob
import json
import os
import re
import statistics
import subprocess
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECTS = os.path.expanduser('~/.claude/projects/')
W = dict(inp=1.0, cw5=1.25, cw1h=2.0, cr=0.1, out=5.0)
PRICES = {  # API $ per million tokens: input, 5-minute write, 1-hour write, cache read, output
    'opus': (4.0, 5.0, 8.0, 0.20, 20.0),
    'sonnet': (2.0, 2.5, 4.0, 0.20, 10.0),
    'haiku': (1.0, 1.25, 2.0, 0.10, 5.0),
}
PR_KINDS = ('feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'style')
OWN_WORK = ('edit', 'test', 'build', 'shell', 'read')


def epoch(s):
    return int(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp())


def text_of(content):
    if isinstance(content, str):
        return content
    return '\n'.join(b.get('text', '') for b in content or [] if isinstance(b, dict) and b.get('type') == 'text')


def result_text(b):
    c = b.get('content')
    if isinstance(c, str):
        return c
    return ' '.join(x.get('text', '') for x in (c or []) if isinstance(x, dict))


def activity(tools):
    """Name what one model call asked for, from the tools it called."""
    names = [n for n, _ in tools]
    if not tools or names == ['SubagentHandback']:
        return 'reply'
    if any(n in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') for n in names):
        return 'edit'
    for n, cmd in tools:
        if n != 'Bash':
            continue
        if re.search(r'e2e|playwright|pnpm (-\S+ )*(test|check|typecheck|lint)|vitest|tsc\b|node --test|ctest|smoke', cmd):
            return 'test'
        if re.search(r'cmake|ninja|emcc|build', cmd):
            return 'build'
        if re.search(r'(^|&&|;)\s*(git|gh) ', cmd):
            return 'git'
        if re.search(r'(^|&&|;|\|)\s*(sed -n|cat|grep|rg|head|tail|ls|find|wc|awk)\b', cmd):
            return 'read'
        return 'shell'
    if any(n in ('Read', 'Grep', 'Glob') for n in names):
        return 'read'
    if any(n in ('Agent', 'Task', 'SendMessage', 'TaskStop', 'Monitor', 'ListAgents', 'ReadNotifications') for n in names):
        return 'agents'
    return 'other'


def classify_user(e, txt):
    if e.get('isCompactSummary') or txt.startswith('This session is being continued'):
        return 'compact'
    if 'Subagent hand-back' in txt or '<agent-message' in txt:
        return 'handback'
    if '<task-notification' in txt:
        return 'task'
    if e.get('isMeta') or txt.startswith('<') or txt.startswith('[Request interrupted'):
        return 'meta'
    return 'human'


def read_agent(path, is_main):
    """Return the calls and events of one transcript file."""
    calls, order = {}, []
    users, compacts, limits, created = [], [], [], []
    pending_create, seen_users = set(), set()
    visible = collections.Counter()
    msg_tools = collections.defaultdict(dict)
    trigger, first_prompt = 'start', ''
    for line in open(path):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get('type')
        m = e.get('message') or {}
        if t == 'system' and e.get('subtype') == 'compact_boundary':
            compacts.append([epoch(e['timestamp']), (e.get('compactMetadata') or {}).get('preTokens') or 0])
            continue
        if t == 'user':
            if e.get('uuid') in seen_users:
                continue
            seen_users.add(e.get('uuid'))
            c = m.get('content')
            if isinstance(c, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c):
                for b in c:
                    if isinstance(b, dict) and b.get('type') == 'tool_result' and b.get('tool_use_id') in pending_create:
                        created += [int(x) for x in re.findall(r'/pull/(\d+)', result_text(b))]
                trigger = 'tool'
                continue
            txt = text_of(c)
            kind = classify_user(e, txt)
            if not first_prompt and not is_main:
                first_prompt = txt
                continue
            if kind == 'human' and is_main:
                users.append(epoch(e['timestamp']))
            trigger = kind
            continue
        if t != 'assistant':
            continue
        is_limit = False
        for b in m.get('content') or []:
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'text':
                txt = b.get('text', '')
                visible[m.get('id')] += len(txt)
                if m.get('model') == '<synthetic>' and 'hit your' in txt:
                    is_limit = True
                    limits.append(epoch(e['timestamp']))
            elif b.get('type') == 'tool_use':
                inp = b.get('input') or {}
                visible[m.get('id')] += len(json.dumps(inp))
                msg_tools[m.get('id')][b['id']] = (b['name'], inp.get('command') or '')
                if b['name'] == 'Bash' and 'gh pr create' in (inp.get('command') or ''):
                    pending_create.add(b['id'])
        u = m.get('usage')
        if not u or m.get('model') == '<synthetic>' or is_limit:
            continue
        mid = m.get('id') or e.get('uuid')
        cc = u.get('cache_creation') or {}
        c5, c1 = cc.get('ephemeral_5m_input_tokens'), cc.get('ephemeral_1h_input_tokens')
        if c5 is None and c1 is None:
            c5, c1 = u.get('cache_creation_input_tokens', 0), 0
        call = dict(t=epoch(e['timestamp']), inp=u.get('input_tokens', 0), cw5=c5 or 0, cw1h=c1 or 0,
                    cr=u.get('cache_read_input_tokens', 0), out=u.get('output_tokens', 0),
                    trigger=trigger, ver=e.get('version') or '', model=m.get('model') or '')
        if mid not in calls:
            order.append(mid)
            trigger = 'tool'
        else:
            call['trigger'] = calls[mid]['trigger']
        calls[mid] = call
    out = []
    for mid in order:
        c = calls[mid]
        c['chars'] = visible.get(mid, 0)
        c['kind'] = activity(list(msg_tools.get(mid, {}).values()))
        out.append(c)
    out.sort(key=lambda c: c['t'])
    return dict(calls=out, users=users, compacts=compacts, limits=limits, created=created, prompt=first_prompt)


def cost_state(path):
    last = None
    for line in open(path):
        if '"type":"cost-state"' in line:
            last = json.loads(line)
    return last


def price_usd(c):
    fam = next((k for k in PRICES if k in c['model']), 'opus')
    pi, p5, p1, pr, po = PRICES[fam]
    return (c['inp'] * pi + c['cw5'] * p5 + c['cw1h'] * p1 + c['cr'] * pr + c['out'] * po) / 1e6


def gh_prs(repo):
    if not repo:
        return {}
    try:
        raw = subprocess.check_output(
            ['gh', 'pr', 'list', '-R', repo, '--state', 'all', '--limit', '600', '--json',
             'number,title,createdAt,mergedAt,additions,deletions'], text=True)
    except (OSError, subprocess.CalledProcessError) as err:
        print('gh pr list failed for one repository, its PR data is left out:', type(err).__name__)
        return {}
    return {p['number']: p for p in json.loads(raw)}


def ctx_of(c):
    return c['inp'] + c['cw5'] + c['cw1h'] + c['cr']


def units_of(c):
    return sum(c[k] * W[k] for k in W)


def is_miss(c, first):
    """A call that wrote most of a large context again: the cache had expired."""
    ctx = ctx_of(c)
    return not first and c['trigger'] != 'compact' and ctx > 20000 and (c['cw5'] + c['cw1h']) > 0.5 * ctx


def load(cfg):
    """Read one session: the lead and every sub-agent, with output corrected where the transcript undercounts it."""
    base = os.path.join(PROJECTS, cfg['project'], cfg['id'])
    files = [('main', base + '.jsonl', {})]
    for f in sorted(glob.glob(base + '/subagents/*.jsonl')):
        mp = f[:-6] + '.meta.json'
        files.append((os.path.basename(f), f, json.load(open(mp)) if os.path.exists(mp) else {}))
    agents = []
    for aid, path, meta in files:
        facts = read_agent(path, aid == 'main')
        if facts['calls']:
            agents.append(dict(main=aid == 'main', meta=meta, **facts))
    cs = cost_state(base + '.jsonl')
    all_calls = [c for a in agents for c in a['calls']]
    estimated = False
    if cs and any(c['ver'] >= '2.1.281' for c in all_calls):
        # Output is logged when a reply starts; spread the session's real total by what each call wrote.
        true_out = sum(v['outputTokens'] for v in cs['modelUsage'].values())
        tot = sum(c['chars'] + 300 for c in all_calls)
        for c in all_calls:
            c['out'] = true_out * (c['chars'] + 300) / tot
    elif not cs:
        lead = agents[0]['calls']
        subs = [c for a in agents[1:] for c in a['calls']]
        lead_vis, sub_vis = sum(c['chars'] for c in lead) / 4, sum(c['chars'] for c in subs) / 4
        if lead_vis and subs and sum(c['out'] for c in subs) < 0.5 * sub_vis:
            ratio = max(1.0, sum(c['out'] for c in lead) / lead_vis)
            for c in subs:
                c['out'] = max(c['out'], c['chars'] / 4 * ratio)
            estimated = True
    usd = cs['totalCostUSD'] if cs else sum(price_usd(c) for c in all_calls)
    return agents, usd, (not cs) or estimated


def measure(agents):
    """Totals for a set of sessions' agents, lead and workers apart."""
    lead_calls = [c for a in agents if a['main'] for c in a['calls']]
    subs = [a for a in agents if not a['main']]
    sub_calls = [c for a in subs for c in a['calls']]
    every = lead_calls + sub_calls
    total = sum(units_of(c) for c in every)
    miss_units, miss_n = 0.0, 0
    for a in agents:
        for i, c in enumerate(a['calls']):
            if is_miss(c, i == 0):
                miss_n += 1
                miss_units += (c['cw5'] * W['cw5'] + c['cw1h'] * W['cw1h']) - (c['cw5'] + c['cw1h']) * W['cr']
    read = sum(c['cr'] for c in every)
    inputs = sum(ctx_of(c) for c in every)
    peaks = sorted(max(ctx_of(c) for c in a['calls']) for a in subs)
    starts = [ctx_of(a['calls'][0]) for a in subs]
    big = sum(units_of(c) for c in every if ctx_of(c) > 400000)
    return dict(
        workers=len(subs), calls=len(every), tokens=sum(ctx_of(c) + c['out'] for c in every), units=round(total),
        cacheHit=read / inputs, missN=miss_n, missShare=miss_units / total,
        startMedian=round(statistics.median(starts)), peakMedian=round(statistics.median(peaks)), peakMax=peaks[-1],
        under200k=sum(1 for p in peaks if p < 200000) / len(peaks),
        over400kShare=big / total,
        leadShare=sum(units_of(c) for c in lead_calls) / total,
        leadAvgCtx=round(sum(ctx_of(c) for c in lead_calls) / len(lead_calls)),
        leadPeak=max(ctx_of(c) for c in lead_calls),
        leadOwnWork=sum(1 for c in lead_calls if c['kind'] in OWN_WORK) / len(lead_calls),
        peaks=[round(p / 1000) for p in peaks])


def short_type(agent_type):
    return agent_type[8:] if agent_type.startswith('foreman-') else 'other'


def session_out(n, cfg, agents, usd, estimated, prs):
    """The anonymous record of one Foreman session, for the timeline."""
    t0 = min(c['t'] for a in agents for c in a['calls'])
    t1 = max(c['t'] for a in agents for c in a['calls'])
    lead = agents[0]
    subs = sorted(agents[1:], key=lambda a: a['calls'][0]['t'])
    # Link each worker to the PR it opened, or the one its brief names.
    linked = {}
    for a in subs:
        nums = sorted(set(a['created']))
        if not nums:
            desc = a['meta'].get('description') or ''
            nums = [int(x) for x in re.findall(r'#(\d{1,5})\b', desc)]
        if not nums:
            found = set(int(x) for x in re.findall(r'(?:PR |#|/pull/)(\d{1,5})\b', a['prompt'][:3000]))
            nums = sorted(found) if len(found) == 1 else []
        linked[id(a)] = [x for x in nums if x in prs]
    real = sorted({x for v in linked.values() for x in v}, key=lambda x: prs[x]['createdAt'])
    anon = {x: i + 1 for i, x in enumerate(real)}
    rounds = collections.Counter()
    seq = collections.Counter()
    rows, calls = [], []
    for idx, a in enumerate([lead] + subs):
        kind = 'lead' if a['main'] else short_type(a['meta'].get('agentType', ''))
        cs = a['calls']
        pr = next((anon[x] for x in linked.get(id(a), []) if x in anon), None)
        seq[kind] += 1
        label = 'lead' if a['main'] else f'{kind} {seq[kind]}'
        rnd = None
        if kind == 'responder' and pr:
            rounds[pr] += 1
            rnd = rounds[pr]
        misses = 0
        for i, c in enumerate(cs):
            miss = is_miss(c, i == 0)
            misses += miss
            calls.append([idx, c['t'] - t0, round(ctx_of(c) / 1000), 1 if miss else 0])
        gaps = [b['t'] - a_['t'] for a_, b in zip(cs, cs[1:])]
        row = dict(k=kind, label=label, first=cs[0]['t'] - t0, last=cs[-1]['t'] - t0, calls=len(cs),
                   start=round(ctx_of(cs[0]) / 1000), peak=round(max(ctx_of(c) for c in cs) / 1000),
                   units=round(sum(units_of(c) for c in cs)), work=round(sum(g for g in gaps if g <= 1800) / 60),
                   opened=bool(a['created']))
        if pr:
            row['pr'] = pr
        if rnd:
            row['round'] = rnd
        if misses:
            row['misses'] = misses
        rows.append(row)
    calls.sort(key=lambda c: c[1])
    pr_rows = []
    for x in real:
        p = prs[x]
        m = re.match(r'\s*([a-z]+)[(:!]', p['title'])
        pr_rows.append(dict(n=anon[x], kind=m.group(1) if m and m.group(1) in PR_KINDS else 'change',
                            opened=epoch(p['createdAt']) - t0,
                            merged=epoch(p['mergedAt']) - t0 if p['mergedAt'] else None,
                            lines=p['additions'] + p['deletions'], rounds=rounds.get(anon[x], 0)))
    opened = [p for p in pr_rows if 0 <= p['opened'] <= t1 - t0]
    by_type = collections.Counter(r['k'] for r in rows[1:])
    return dict(
        label=f'Session {n}', project='Project ' + 'ABCDEFGH'[n - 1], start=t0, end=t1,
        usd=round(usd), usdEstimated=estimated, byType=dict(by_type),
        prsOpened=len(opened), prsMerged=sum(1 for p in opened if p['merged'] is not None),
        rounds=by_type.get('responder', 0), prsReviewed=len(rounds), prsWorked=len(pr_rows),
        users=[t - t0 for t in lead['users']],
        compacts=[[t - t0, round(pre / 1000)] for t, pre in sorted({(t, pre) for t, pre in lead['compacts']})],
        limits=sorted({t - t0 for a in agents for t in a['limits']}),
        agents=rows, calls=calls, prs=pr_rows)


def main():
    cfg = json.load(open(os.path.join(HERE, 'sessions.local.json')))
    groups = dict(foreman=[], baseline=[])
    sessions, usd_total = [], 0.0
    for c in cfg['sessions']:
        agents, usd, estimated = load(c)
        groups[c['kind']] += agents
        m = measure(agents)
        print(f"{c['kind']:9} workers {m['workers']:4} calls {m['calls']:6} hit {m['cacheHit']:.3f} "
              f"rewrites {m['missShare']:.3f} start {m['startMedian']:6} peak {m['peakMedian']:7}/{m['peakMax']:7} "
              f"lead {m['leadShare']:.2f} avg {m['leadAvgCtx']:7} own {m['leadOwnWork']:.2f} ${usd:.0f}")
        if c['kind'] == 'foreman':
            usd_total += usd
            sessions.append(session_out(len(sessions) + 1, c, agents, usd, estimated, gh_prs(c.get('repo'))))
    score = dict(foreman=measure(groups['foreman']), baseline=measure(groups['baseline']))
    f = score['foreman']
    f.update(sessions=len(sessions), usd=round(usd_total),
             hours=round(sum(s['end'] - s['start'] for s in sessions) / 3600),
             prsOpened=sum(s['prsOpened'] for s in sessions), prsMerged=sum(s['prsMerged'] for s in sessions),
             rounds=sum(s['rounds'] for s in sessions), prsReviewed=sum(s['prsReviewed'] for s in sessions),
             prsWorked=sum(s['prsWorked'] for s in sessions),
             leadCompactions=sum(len(s['compacts']) for s in sessions),
             byType=dict(sum((collections.Counter(s['byType']) for s in sessions), collections.Counter())))
    score['baseline']['sessions'] = sum(1 for c in cfg['sessions'] if c['kind'] == 'baseline')
    version = open(os.path.join(HERE, '..', 'VERSION')).read().strip()
    data = dict(generated=datetime.now(timezone.utc).strftime('%Y-%m-%d'), weights=W, version=version, score=score, sessions=sessions)
    out = os.path.join(HERE, 'data.json')
    with open(out, 'w') as fh:
        json.dump(data, fh, separators=(',', ':'))
    print('wrote', out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
