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
  compactAt: number
  isAuto: boolean
  compactions: number
  lastTry: number
}

export type BoardSettings = {
  isLoaded: boolean
  handover: string
  isSonnetAllowed: boolean
  maxWorkers: number
  hasRules: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'foreman-board': {
      workers: Worker[]
      lead: Lead
      settings: BoardSettings
      isActive: boolean
      isLead: boolean
      now: number
    }
  }
}
