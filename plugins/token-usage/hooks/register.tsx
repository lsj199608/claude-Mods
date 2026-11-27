import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'

import type { Tokens, Usage } from '../types'

/**
 * Claude 토큰 사용량.
 *
 * - 세션 합계·모델별·마지막 턴: turn.complete 의 usage(그 턴의 실제 요청 토큰 합)를 더한다.
 *   서브에이전트 턴도 따로 끝나므로 함께 더해진다.
 * - 오늘 합계: $.store(세션을 넘어 유지)에 한국 날짜별로 더한다 → 여러 세션 합산.
 * - 컨텍스트 창·사용 한도(5시간/7일)·비용: $.session.usage() — 상태 줄과 같은 값.
 *   비용은 /cost 와 같은 추정치(구독 요금제면 실제 청구와 다름).
 */

const PANE = 'token-usage'

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 })

const usage = atom({ plugin: 'token-usage', key: 'usage' } as const, { session: zero(), byModel: {}, last: null } as Usage, {
  shape: 'usage-1',
})

const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
const dayKey = (ms: number) => `day:${kstDay(ms)}`

function add(a: Tokens, u: TurnUsage): Tokens {
  return {
    input: a.input + u.input_tokens,
    output: a.output + u.output_tokens,
    cacheRead: a.cacheRead + u.cache_read_input_tokens,
    cacheWrite: a.cacheWrite + u.cache_creation_input_tokens,
    turns: a.turns + 1,
  }
}

const totalIn = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite
const cacheRate = (t: Tokens) => (totalIn(t) === 0 ? 0 : Math.round((t.cacheRead / totalIn(t)) * 100))

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

const LIMIT_NAME: Record<string, string> = { five_hour: '5시간', seven_day: '7일', spend_limit: '지출 한도' }
const limitName = (k: string) => LIMIT_NAME[k] ?? k

function resetIn(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.floor(ms / 3600_000)
  const m = Math.round((ms % 3600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간 뒤 초기화`
  return h > 0 ? `${h}시간 ${m}분 뒤 초기화` : `${m}분 뒤 초기화`
}

const bar = (pct: number, width = 20) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const pctColor = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green')

async function liveUsage($: EngineInterface): Promise<SessionUsage | null> {
  try {
    return await $.session.usage()
  } catch {
    return null
  }
}

async function today($: EngineInterface): Promise<Tokens> {
  const v = (await $.store.get(dayKey(await $.clock.now()))) as Tokens | undefined
  return v && typeof v.output === 'number' ? v : zero()
}

function statusText(u: Usage, ctxPct: number | undefined, limits: SessionRateLimit[], usd: number | undefined): string {
  const parts = [`토큰 출력 ${fmt(u.session.output)} · 입력 ${fmt(totalIn(u.session))}`]
  if (ctxPct !== undefined) parts.push(`컨텍스트 ${ctxPct}%`)
  for (const l of limits) parts.push(`${limitName(l.kind)} ${l.percentUsed}%`)
  if (usd !== undefined) parts.push(`$${usd.toFixed(2)}`)
  return parts.join(' · ')
}

async function refreshStatus($: EngineInterface) {
  const u = await read($, usage)
  const live = await liveUsage($)
  $.ui.status(statusText(u, live?.context.percent, live?.rateLimits ?? [], live?.cost?.usd))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'tokens',
      description: 'Claude 토큰 사용량 창 (세션·오늘·모델별·컨텍스트·사용 한도·비용)',
    })
    void refreshStatus($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const u = result.usage ?? e.usage
    if (u) {
      const now = await $.clock.now()
      await update($, usage, s => ({
        session: add(s.session, u),
        byModel: { ...s.byModel, [u.model]: add(s.byModel[u.model] ?? zero(), u) },
        last: { ...add(zero(), u), model: u.model, isSubagent: e.agentId !== undefined, at: now },
      }))
      const key = dayKey(now)
      const prev = ((await $.store.get(key)) as Tokens | undefined) ?? zero()
      await $.store.set(key, add(prev, u))
      void refreshStatus($)
    }
    return result
  })

  // 컨텍스트·사용 한도·비용이 바뀔 때마다 (턴 끝, 한도 1%p 이동)
  on('session.measure', async ($, e, next) => {
    const u = await read($, usage)
    $.ui.status(statusText(u, e.context.percent, e.rateLimits, e.cost?.usd))
    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Claude 토큰 사용량' })
    const u = await read($, usage)
    const t = await today($)
    const live = await liveUsage($)
    const lines = [
      `세션  입력 ${fmt(totalIn(u.session))} (캐시 읽기 ${cacheRate(u.session)}%) · 출력 ${fmt(u.session.output)} · ${u.session.turns}턴`,
      `오늘  입력 ${fmt(totalIn(t))} · 출력 ${fmt(t.output)} · ${t.turns}턴 (모든 세션 합산, mod 켠 뒤부터)`,
    ]
    if (live?.context.percent !== undefined) lines.push(`컨텍스트  ${live.context.percent}% (${fmt(live.context.tokens ?? 0)} / ${fmt(live.context.window)})`)
    for (const l of live?.rateLimits ?? []) lines.push(`${limitName(l.kind)} 한도  ${l.percentUsed}%`)
    if (live?.cost) lines.push(`비용(추정)  $${live.cost.usd.toFixed(2)}`)
    return { text: '```\n' + lines.join('\n') + '\n```' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const u = await read($, usage)
    const t = await today($)
    const live = await liveUsage($)
    const now = await $.clock.now()

    const row = (label: string, x: Tokens) => (
      <Box flexDirection="column">
        <Text bold>{label}</Text>
        <Text>
          {'  '}입력 {fmt(totalIn(x)).padStart(6)}  <Text dimColor>(새로 {fmt(x.input)} · 캐시 읽기 {fmt(x.cacheRead)} · 캐시 쓰기 {fmt(x.cacheWrite)})</Text>
        </Text>
        <Text>
          {'  '}출력 {fmt(x.output).padStart(6)}  <Text dimColor>{x.turns}턴 · 캐시 적중 {cacheRate(x)}%</Text>
        </Text>
      </Box>
    )

    const models = Object.entries(u.byModel).sort((a, b) => totalIn(b[1]) + b[1].output - (totalIn(a[1]) + a[1].output))
    const ctx = live?.context

    return (
      <Box flexDirection="column">
        {ctx ? (
          <Box flexDirection="column">
            <Text bold>컨텍스트 창</Text>
            <Text>
              {'  '}<Text color={pctColor(ctx.percent ?? 0)}>{bar(ctx.percent ?? 0)}</Text> {ctx.percent ?? 0}%{' '}
              <Text dimColor>({fmt(ctx.tokens ?? 0)} / {fmt(ctx.window)})</Text>
            </Text>
          </Box>
        ) : null}

        {(live?.rateLimits ?? []).length > 0 ? (
          <Box flexDirection="column">
            <Text bold>사용 한도</Text>
            {(live?.rateLimits ?? []).map(l => (
              <Text key={l.kind}>
                {'  '}{limitName(l.kind).padEnd(5)} <Text color={pctColor(l.percentUsed)}>{bar(l.percentUsed)}</Text> {l.percentUsed}%{' '}
                <Text dimColor>{resetIn(l.resetsAt, now)}</Text>
              </Text>
            ))}
          </Box>
        ) : null}

        <Text> </Text>
        {row('이 세션', u.session)}
        {row(`오늘 (${kstDay(now)}, 모든 세션)`, t)}

        {models.length > 0 ? (
          <Box flexDirection="column">
            <Text bold>모델별 (이 세션)</Text>
            {models.map(([model, x]) => (
              <Text key={model}>
                {'  '}{model.padEnd(22)} 입력 {fmt(totalIn(x)).padStart(6)} · 출력 {fmt(x.output).padStart(6)} <Text dimColor>{x.turns}턴</Text>
              </Text>
            ))}
          </Box>
        ) : null}

        {u.last ? (
          <Text dimColor>
            마지막 턴{u.last.isSubagent ? '(서브에이전트)' : ''}: 입력 {fmt(totalIn(u.last))} · 출력 {fmt(u.last.output)} · {u.last.model}
          </Text>
        ) : (
          <Text dimColor>아직 기록된 턴이 없습니다 (mod를 켠 뒤 끝난 턴부터 셉니다).</Text>
        )}
        {live?.cost ? (
          <Text dimColor>
            비용(추정, /cost 와 같음): ${live.cost.usd.toFixed(2)}{live.cost.hasUnknownPrice ? ' — 가격을 모르는 모델 포함' : ''}
          </Text>
        ) : null}
      </Box>
    )
  })
}
