import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Lead, Worker } from '../types'

// Foreman 0.7.0 helper: a live board of the lead's workers, a one-line band with the
// lead's context and the number of workers running, and per-brief effort.

const PANE = 'foreman-board'
const workers = atom({ plugin: 'foreman', key: 'workers' } as const, [] as Worker[])
const lead = atom({ plugin: 'foreman', key: 'lead' } as const, { tokens: 0, window: 0 } as Lead)
const isActive = atom({ plugin: 'foreman', key: 'isActive' } as const, false)
const now = atom({ plugin: 'foreman', key: 'now' } as const, 0)

const MAX_TURNS: Record<string, number> = {
  'foreman:builder': 400, 'foreman:investigator': 150, 'foreman:clerk': 150,
  'foreman:scout': 40, 'foreman:responder': 80,
}
// $ per million tokens: input, cache write (1 hour, as subagentPromptCacheTtl sets), cache read, output.
const PRICES: Record<string, [number, number, number, number]> = {
  opus: [4, 8, 0.2, 20], sonnet: [2, 4, 0.2, 10], haiku: [1, 2, 0.1, 5],
}
const QUIET_MS = 4 * 60_000
// The lead commands, /foreman, /foreman-create and /foreman-resume. A plugin install
// records them as /foreman:foreman and so on, even when typed without the prefix.
const LEAD_SKILL = /^(foreman:)?foreman(-create|-resume)?$/
const LEAD_MARK = /command-name>\/(foreman:)?foreman(-create|-resume)?<|^\/(foreman:)?foreman(-create|-resume)?(\s|$)/m

const short = (type: string) => type.replace(/^foreman:/, '')
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'foreman-board', description: 'Show the Foreman worker board' })
    // A resumed lead: the session ran a lead command before.
    try {
      const msgs = await $.session.messages()
      if (msgs.some(m => m.role === 'user' && LEAD_MARK.test(m.text))) {
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

  on('skill.prompt', async ($, e, next) => {
    if (!LEAD_SKILL.test(e.skill)) return next(e)
    await update($, isActive, () => true)
    void $.ui.open({ id: PANE, title: 'Foreman workers' })
    return next(e)
  })

  on('command.run', { command: 'foreman-board' }, async $ => {
    await update($, isActive, () => true)
    await $.ui.open({ id: PANE, title: 'Foreman workers' })
    return { text: 'Foreman worker board opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const type = e.subagentType
    if (e.parentAgentId || !type.startsWith('foreman:')) return next(e)
    await update($, isActive, () => true)
    if (type === 'foreman:builder' && !(/Done when/i.test(e.prompt) && /Branch/i.test(e.prompt))) {
      $.ui.toast('Foreman: this builder brief has no "Done when" or "Branch"')
    }
    const r = await next(e)
    if (r.agentId) {
      const t = await $.clock.now()
      const pr = /#(\d+)/.exec(e.description)?.[1]
      const effort = /^Effort:\s*(low|medium|high|xhigh|max)\b/im.exec(e.prompt)?.[1]?.toLowerCase() ?? ''
      await patch($, r.agentId, w => ({
        ...w, type, desc: e.description, model: r.model ?? '', started: t, last: t,
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
    await update($, lead, () => ({ tokens, window: e.context.window }))
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
    return (
      <Box>
        <Text dimColor wrap="truncate">
          {`${ctx} │ ${running.length} running, ${list.length - running.length} done · workers ${fUsd(usd)} `}
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
    const t = Math.max(await read($, now), 0) || Date.now()
    const cols = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const running = list.filter(w => w.done === null).sort((a, b) => a.started - b.started)
    const done = list.filter(w => w.done !== null).sort((a, b) => (b.done ?? 0) - (a.done ?? 0))
    const byType = new Map<string, number>()
    for (const w of list) byType.set(short(w.type), (byType.get(short(w.type)) ?? 0) + w.usd)
    const rounds = new Map<number, number>()
    for (const w of list) if (w.type === 'foreman:responder' && w.pr) rounds.set(w.pr, (rounds.get(w.pr) ?? 0) + 1)
    const total = list.reduce((a, w) => a + w.usd, 0)
    const row = (w: Worker) => {
      const cap = MAX_TURNS[w.type]
      const age = (w.done ?? t) - w.started
      return `${(short(w.type) + (w.effort ? ' ' + w.effort : '')).padEnd(17)} ${cut(w.desc, 34).padEnd(34)} ${String(w.steps).padStart(3)}${cap ? '/' + cap : ''} steps  ctx ${fK(w.ctx).padStart(5)}  ${fUsd(w.usd).padStart(6)}  ${fMin(age).padStart(4)}`
    }
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate">
          {`Lead ${fK(l.tokens)}${l.window ? ' of ' + fK(l.window) : ''} · ${running.length} workers running`}
        </Text>
        <Text dimColor wrap="truncate">
          {`Workers ${fUsd(total)} (est.): ${[...byType].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fUsd(v)}`).join(', ') || 'none yet'}`}
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
