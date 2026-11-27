export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

export type LastTurn = Tokens & { model: string; isSubagent: boolean; at: number }

export type Usage = {
  session: Tokens
  byModel: Record<string, Tokens>
  last: LastTurn | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-usage': { usage: Shaped<Usage> }
  }
}
