import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Lead, BoardSettings, Worker } from '../types'

// Foreman 0.5.0 helper: a live board of the lead's workers, a one-line band with the
// lead's context, a guard on worker spawns, per-brief effort, and auto-compact for the lead.

const PANE = 'foreman-board'
const workers = atom({ plugin: 'foreman-board', key: 'workers' } as const, [] as Worker[])
const lead = atom({ plugin: 'foreman-board', key: 'lead' } as const, {
  tokens: 0, window: 0, compactAt: 200_000, isAuto: true, compactions: 0, lastTry: 0,
} as Lead)
const settings = atom({ plugin: 'foreman-board', key: 'settings' } as const, {
  isLoaded: false, handover: '', isSonnetAllowed: true, maxWorkers: 5, hasRules: false,
} as BoardSettings)
const isActive = atom({ plugin: 'foreman-board', key: 'isActive' } as const, false)
const isLead = atom({ plugin: 'foreman-board', key: 'isLead' } as const, false)
const now = atom({ plugin: 'foreman-board', key: 'now' } as const, 0)

const MAX_TURNS: Record<string, number> = {
  'foreman-builder': 400, 'foreman-investigator': 150, 'foreman-clerk': 150,
  'foreman-scout': 40, 'foreman-responder': 80,
}
// $ per million tokens: input, cache write (1 hour, as subagentPromptCacheTtl sets), cache read, output.
const PRICES: Record<string, [number, number, number, number]> = {
  opus: [4, 8, 0.2, 20], sonnet: [2, 4, 0.2, 10], haiku: [1, 2, 0.1, 5],
}
const COMPACT_NOTE = 'You are the Foreman lead. Keep: the HANDOVER.md path and its Standing rules; '
  + 'every running worker with its agent ID, type, task, branch and PR; open PRs with their review-bot '
  + 'round counts; decisions waiting on the user; the next tasks. Drop finished workers\' reports once '
  + 'their outcome is recorded.'
const QUIET_MS = 4 * 60_000

const short = (type: string) => type.replace(/^foreman-/, '')
const fK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1e3) + 'k')
const fUsd = (v: number) => '$' + v.toFixed(2)
const fMin = (ms: number) => (ms < 60_000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 60_000) + 'm')
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function price(model: string, u: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }) {
  const fam = Object.keys(PRICES).find(k => model.includes(k)) ?? 'opus'
  const [pi, pw, pr, po] = PRICES[fam] ?? [4, 8, 0.2, 20]
  return (u.input_tokens * pi + u.cache_creation_input_tokens * pw + u.cache_read_input_tokens * pr + u.output_tokens * po) / 1e6
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const isEffort = (v: string | undefined): v is (typeof EFFORTS)[number] => EFFORTS.includes(v as (typeof EFFORTS)[number])

function blank(id: string, t: number): Worker {
  return {
    id, type: '?', desc: id, model: '', started: t, last: t, done: null, status: 'running',
    steps: 0, ctx: 0, peak: 0, usd: 0, lastTool: '', lastCmd: '', repeats: 0, pr: null, effort: '',
  }
}

function warnings(w: Worker, t: number): string[] {
  const out: string[] = []
  const cap = MAX_TURNS[w.type]
  if (w.ctx > 150_000) out.push(`ctx ${fK(w.ctx)}`)
  if (cap && w.steps >= cap * 0.8) out.push(`${w.steps}/${cap} steps`)
  if (w.done === null && t - w.last > QUIET_MS) out.push(`quiet ${fMin(t - w.last)}`)
  if (w.repeats >= 2) out.push(`same command ${w.repeats + 1}×`)
  return out
}

async function patch($: EngineInterface, id: string, fn: (w: Worker) => Worker) {
  const t = await $.clock.now()
  await update($, workers, list => {
    const all = list ?? []
    const i = all.findIndex(w => w.id === id)
    const next = fn(all[i] ?? blank(id, t))
    return i >= 0 ? all.map((w, k) => (k === i ? next : w)) : [...all, next].slice(-300)
  })
}

async function loadSettings($: EngineInterface) {
  const s: BoardSettings = { isLoaded: true, handover: '', isSonnetAllowed: true, maxWorkers: 5, hasRules: false }
  try {
    const wt = await $.process.run(['git', 'worktree', 'list', '--porcelain'])
    const root = /^worktree (.+)$/m.exec(wt.stdout)?.[1]
    if (root) {
      const text = await $.fs.read(`${root}/HANDOVER.md`)
      s.handover = `${root}/HANDOVER.md`
      const sonnet = /^- Sonnet workers:\s*(.*)$/m.exec(text)?.[1] ?? ''
      s.isSonnetAllowed = !/not allowed|never|no\b/i.test(sonnet)
      const max = /^- Max workers:\s*(\d+)/m.exec(text)?.[1]
      if (max) s.maxWorkers = Number(max)
      const rules = /^- Worker rules[^\n]*\n((?:[ \t]+[^\n]*\n?)+)/m.exec(text)?.[1] ?? ''
      s.hasRules = rules.split('\n').some(l => l.trim() !== '' && !l.includes('<'))
    }
  } catch {
    // No handover or no git: the guard keeps its defaults.
  }
  await update($, settings, () => s)
  return s
}

async function compactLead($: EngineInterface) {
  const l = await read($, lead)
  $.ui.toast(`Foreman: compacting the lead at ${fK(l.tokens)} tokens`)
  try {
    const r = await $.session.compact({ instructions: COMPACT_NOTE })
    if (!('skip' in r && r.skip)) await update($, lead, x => ({ ...x, compactions: x.compactions + 1 }))
  } catch {
    // A turn started first; the next measurement tries again.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'foreman-board', description: 'Show the Foreman worker board' })
    await $.command.register({
      name: 'foreman-autocompact',
      description: 'Foreman lead auto-compact: on, off, or a token threshold such as 250k',
    })
    // A resumed lead: the session ran /foreman before.
    try {
      const msgs = await $.session.messages()
      if (msgs.some(m => m.role === 'user' && /command-name>\/foreman<|^\/foreman\b/m.test(m.text))) {
        await update($, isLead, () => true)
        await update($, isActive, () => true)
      }
    } catch {
      // Nothing to read yet.
    }
    $.clock.every(20_000, () => {
      void (async () => {
        if (!(await read($, isActive))) return
        const t = await $.clock.now()
        await update($, now, () => t)
        const listed = await $.agent.list()
        const status = new Map(listed.map(a => [a.id, a.status]))
        await update($, workers, list => (list ?? []).map(w => {
          const st = status.get(w.id)
          return w.done === null && st && st !== 'running' ? { ...w, done: t, status: st } : w
        }))
      })()
    })
    return next(e)
  })

  on('skill.prompt', { skill: 'foreman' }, async ($, e, next) => {
    await update($, isLead, () => true)
    await update($, isActive, () => true)
    await loadSettings($)
    void $.ui.open({ id: PANE, title: 'Foreman workers' })
    return next(e)
  })

  on('command.run', { command: 'foreman-board' }, async $ => {
    await update($, isActive, () => true)
    await $.ui.open({ id: PANE, title: 'Foreman workers' })
    return { text: 'Foreman worker board opened.' }
  })

  on('command.run', { command: 'foreman-autocompact' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const m = /^(\d+)(k?)$/.exec(arg)
    if (m) {
      const at = Number(m[1]) * (m[2] ? 1000 : 1)
      await update($, lead, l => ({ ...l, compactAt: at, isAuto: true }))
      return { text: `Foreman auto-compact on at ${fK(at)} tokens.` }
    }
    if (arg === 'on' || arg === 'off') {
      await update($, lead, l => ({ ...l, isAuto: arg === 'on' }))
    }
    const l = await read($, lead)
    return { text: `Foreman auto-compact is ${l.isAuto ? `on at ${fK(l.compactAt)} tokens` : 'off'}${(await read($, isLead)) ? '' : '; it acts only in a /foreman lead session'}.` }
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.parentAgentId || !e.subagentType.startsWith('foreman-')) return next(e)
    await update($, isActive, () => true)
    const cur: BoardSettings = await read($, settings)
    const s: BoardSettings = cur.isLoaded ? cur : await loadSettings($)
    const running = (await read($, workers)).filter(w => w.done === null).length
    if (running >= s.maxWorkers) {
      return { deny: `Foreman guard: ${running} workers are already running (limit ${s.maxWorkers}). Wait for one to finish, or raise "- Max workers:" in HANDOVER.md's Standing rules.` }
    }
    if (s.hasRules && !/\bRules\b/.test(e.prompt)) {
      return { deny: `Foreman guard: the brief has no Rules section. End it with "Rules:" and the worker rules from ${s.handover || 'HANDOVER.md'}'s Standing rules, word for word; workers can't see your memory.` }
    }
    let spawn = e
    if (!s.isSonnetAllowed && /clerk|scout/.test(e.subagentType) && !/opus|fable/i.test(e.model ?? '')) {
      spawn = { ...e, model: 'opus' }
      $.ui.toast(`Foreman: ${short(e.subagentType)} moved to Opus (Sonnet workers aren't allowed here)`)
    }
    if (e.subagentType === 'foreman-builder' && !(/Done when/i.test(e.prompt) && /Branch/i.test(e.prompt))) {
      $.ui.toast('Foreman: this builder brief has no "Done when" or "Branch"')
    }
    const r = await next(spawn)
    if (r.agentId) {
      const t = await $.clock.now()
      const pr = /#(\d+)/.exec(e.description)?.[1]
      const effort = /^Effort:\s*(low|medium|high|xhigh|max)\b/im.exec(e.prompt)?.[1]?.toLowerCase() ?? ''
      await patch($, r.agentId, w => ({
        ...w, type: e.subagentType, desc: e.description, model: r.model ?? '', started: t, last: t,
        pr: pr ? Number(pr) : null, effort,
      }))
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (!id) return yield* next(e)
    // A brief's "Effort: high" line sets that worker's effort; the profile's stands otherwise.
    const want = (await read($, workers)).find(w => w.id === id)?.effort
    const it = next(isEffort(want) ? { ...e, effort: want } : e)
    let r = await it.next()
    while (!r.done) {
      const c = r.value
      if (c.kind === 'stop' && c.usage) {
        const u = c.usage
        const ctx = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
        const cost = price(u.model || e.model, u)
        void $.clock.now().then(t => patch($, id, w => ({
          ...w, steps: w.steps + 1, ctx, peak: Math.max(w.peak, ctx), usd: w.usd + cost, last: t,
          model: w.model || u.model,
        }))).catch(() => undefined)
      }
      yield c
      r = await it.next()
    }
    return r.value
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id && (await read($, isActive))) {
      const cmd = e.tool === 'Bash' ? e.command : ''
      const label = e.tool === 'Bash' ? (e.description || e.command) : e.tool
      void $.clock.now().then(t => patch($, id, w => ({
        ...w, last: t, lastTool: cut(label.replace(/\s+/g, ' '), 70), lastCmd: cmd || w.lastCmd,
        repeats: cmd && cmd === w.lastCmd ? w.repeats + 1 : cmd ? 0 : w.repeats,
      }))).catch(() => undefined)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id && (await read($, isActive))) {
      const t = await $.clock.now()
      const st = e.reason === 'answer' ? 'completed' : e.reason
      await patch($, id, w => ({ ...w, done: t, last: t, status: st }))
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const tokens = e.context.tokens ?? 0
    await update($, lead, l => ({ ...l, tokens, window: e.context.window }))
    const l = await read($, lead)
    if ((await read($, isLead)) && l.isAuto && tokens >= l.compactAt) {
      const t = await $.clock.now()
      if (t - l.lastTry > 60_000) {
        await update($, lead, x => ({ ...x, lastTry: t }))
        $.clock.after(1500, () => void compactLead($))
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isActive))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const l = await read($, lead)
    const list = await read($, workers)
    const t = Math.max(await read($, now), 0) || Date.now()
    const running = list.filter(w => w.done === null)
    const usd = list.reduce((a, w) => a + w.usd, 0)
    const warn = running.filter(w => warnings(w, t).length).length
    const ctx = l.window ? `Lead ${fK(l.tokens)}/${fK(l.window)}` : 'Lead'
    const auto = (await read($, isLead)) && l.isAuto ? ` · compacts at ${fK(l.compactAt)}` : ''
    return (
      <Box>
        <Text dimColor wrap="truncate">
          {`${ctx}${auto} │ ${running.length} running, ${list.length - running.length} done · workers ${fUsd(usd)} `}
        </Text>
        {warn > 0 && <Text color="yellow">{`⚠ ${warn} `}</Text>}
        <Button key="board" label="Board" plain onPress={() => void $.ui.open({ id: PANE, title: 'Foreman workers' })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, workers)
    const l = await read($, lead)
    const s = await read($, settings)
    const t = Math.max(await read($, now), 0) || Date.now()
    const cols = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const running = list.filter(w => w.done === null).sort((a, b) => a.started - b.started)
    const done = list.filter(w => w.done !== null).sort((a, b) => (b.done ?? 0) - (a.done ?? 0))
    const byType = new Map<string, number>()
    for (const w of list) byType.set(short(w.type), (byType.get(short(w.type)) ?? 0) + w.usd)
    const rounds = new Map<number, number>()
    for (const w of list) if (w.type === 'foreman-responder' && w.pr) rounds.set(w.pr, (rounds.get(w.pr) ?? 0) + 1)
    const total = list.reduce((a, w) => a + w.usd, 0)
    const row = (w: Worker) => {
      const cap = MAX_TURNS[w.type]
      const age = (w.done ?? t) - w.started
      return `${(short(w.type) + (w.effort ? ' ' + w.effort : '')).padEnd(17)} ${cut(w.desc, 34).padEnd(34)} ${String(w.steps).padStart(3)}${cap ? '/' + cap : ''} steps  ctx ${fK(w.ctx).padStart(5)}  ${fUsd(w.usd).padStart(6)}  ${fMin(age).padStart(4)}`
    }
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate">
          {`Lead ${fK(l.tokens)}${l.window ? ' of ' + fK(l.window) : ''} · auto-compact ${l.isAuto ? 'at ' + fK(l.compactAt) : 'off'} · compacted ${l.compactions}×`}
        </Text>
        <Text dimColor wrap="truncate">
          {`Workers ${fUsd(total)} (est.): ${[...byType].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fUsd(v)}`).join(', ') || 'none yet'}`}
        </Text>
        <Text dimColor wrap="truncate">
          {`Guard: limit ${s.maxWorkers} running · Sonnet ${s.isSonnetAllowed ? 'allowed' : 'not allowed'} · Rules ${s.hasRules ? 'required' : 'not checked'}`}
        </Text>
        {rounds.size > 0 && (
          <Text dimColor wrap="truncate">
            {'Review rounds: ' + [...rounds].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => `#${n} ${k}${k >= 5 ? ' (cap)' : ''}`).join(', ')}
          </Text>
        )}
        <Text> </Text>
        <Text bold>{`Running (${running.length})`}</Text>
        {running.length === 0 && <Text dimColor>No workers running.</Text>}
        {running.map(w => {
          const warn = warnings(w, t)
          return (
            <Box key={w.id} flexDirection="column">
              <Text wrap="truncate">{'● ' + row(w)}</Text>
              <Text dimColor wrap="truncate">{'    ' + (w.lastTool || 'starting')}</Text>
              {warn.length > 0 && <Text color="yellow" wrap="truncate">{'    ⚠ ' + warn.join(' · ')}</Text>}
            </Box>
          )
        })}
        <Text> </Text>
        <Text bold>{`Finished (${done.length})`}</Text>
        {done.slice(0, Math.max(3, Math.floor(cols / 10))).map(w => (
          <Text key={w.id} dimColor={w.status === 'completed'} color={w.status === 'completed' ? undefined : 'red'} wrap="truncate">
            {(w.status === 'completed' ? '✓ ' : '✗ ') + row(w)}
          </Text>
        ))}
      </Box>
    )
  })
}
