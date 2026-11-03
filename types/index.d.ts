export type Worker = {
  id: string
  type: string
  desc: string
  model: string
  started: number
  last: number
  done: number | null
  status: string
  steps: number
  ctx: number
  peak: number
  usd: number
  lastTool: string
  lastCmd: string
  repeats: number
  pr: number | null
  effort: string
}

export type Lead = {
  tokens: number
  window: number
}

declare module 'claude-code' {
  interface PluginState {
    foreman: {
      workers: Worker[]
      lead: Lead
      isActive: boolean
      now: number
    }
  }
}
