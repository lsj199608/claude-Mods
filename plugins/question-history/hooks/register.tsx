import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { View } from '../types'

/**
 * 질문 목록 → 하나 고르면 그 답변.
 *
 * 대화 기록은 $.session.messages() 에서 읽는다 (이 세션, 마지막 압축(/compact) 이후 남은 것).
 * - 질문 = 사람이 쓴 user 메시지 (도구 결과·시스템 알림·명령 출력은 질문이 아님)
 * - 답변 = 그 질문 다음, 다음 질문 전까지 Claude가 쓴 글 전부 (+ 슬래시 명령이면 그 출력)
 * 창에는 세로 스크롤이 없어서 답변은 직접 줄을 나눠 [위]/[아래]로 넘긴다.
 */

const PANE = 'question-history'
const TITLE = '질문 목록'

const view = atom(
  { plugin: 'question-history', key: 'view' } as const,
  { mode: 'list', index: 0, listTop: 0, scroll: 0, version: 0 } as View,
  { shape: 'view-1' },
)

type Qa = { question: string; answer: string }

const TAG_BLOCK = (tag: string) => new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g')

function clean(text: string): string {
  return text
    .replace(TAG_BLOCK('system-reminder'), '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .trim()
}

/** 슬래시 명령 메시지면 "/이름 인자" */
function commandOf(text: string): string | null {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim()
  if (!name) return null
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
  return `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`
}

function stdoutOf(text: string): string {
  const out: string[] = []
  for (const m of text.matchAll(/<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/g)) {
    if (m[1]?.trim()) out.push(m[1].trim())
  }
  return out.join('\n')
}

function toQa(rows: readonly SessionMessage[]): Qa[] {
  const list: Qa[] = []
  let cur: { question: string; parts: string[] } | null = null
  const flush = () => {
    if (cur) list.push({ question: cur.question, answer: cur.parts.join('\n\n').trim() })
    cur = null
  }

  for (const row of rows) {
    if (row.role === 'assistant') {
      const t = row.text.trim()
      if (t && cur) cur.parts.push(t)
      continue
    }
    if (row.toolResults && row.toolResults.length > 0) continue // 도구 결과
    const raw = row.text
    const command = commandOf(raw)
    const stdout = stdoutOf(raw)
    // 질문과 별개로 들어온 명령 출력 → 앞 질문(명령)의 답
    let body = clean(raw.replace(TAG_BLOCK('local-command-stdout'), '').replace(TAG_BLOCK('local-command-stderr'), ''))
    body = body
      .replace(TAG_BLOCK('command-name'), '')
      .replace(TAG_BLOCK('command-message'), '')
      .replace(TAG_BLOCK('command-args'), '')
      .trim()

    if (!command && !body) {
      if (stdout && cur) cur.parts.push(stdout)
      continue // 시스템 알림만 있는 메시지 등
    }
    flush()
    const question = command ? (body ? `${command}\n${body}` : command) : body
    cur = { question, parts: stdout ? [stdout] : [] }
  }
  flush()
  return list
}

async function load($: EngineInterface): Promise<Qa[]> {
  try {
    return toQa(await $.session.messages())
  } catch {
    return []
  }
}

/** 터미널 칸 수: 한글·한자·전각은 2칸 */
function cellWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  if (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
  ) return 2
  return 1
}

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\t/g, '  ').split('\n')) {
    if (para === '') { out.push(''); continue }
    let line = ''
    let w = 0
    for (const ch of para) {
      const cw = cellWidth(ch)
      if (w + cw > width) { out.push(line); line = ''; w = 0 }
      line += ch
      w += cw
    }
    out.push(line)
  }
  return out
}

function oneLine(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  let w = 0
  let out = ''
  for (const ch of flat) {
    const cw = cellWidth(ch)
    if (w + cw > width - 1) return out + '…'
    out += ch
    w += cw
  }
  return out
}

const setView = ($: EngineInterface, patch: Partial<View>) => update($, view, v => ({ ...v, ...patch }))

const ANSWER = 'question-answer'
/** 창 크기 요청: 대화 옆에 붙는 창은 엔진이 터미널 폭 45%에서 자른다. 입력창 위 창은 높이만 */
const SIZE = { columns: 400, rows: 30 } as const

async function openList($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE, focus: true, ...SIZE })
}

/** 답변 탭에 index 번 질문을 띄운다. 제목에 번호를 넣어 탭에서도 보이게 */
async function showAnswer($: EngineInterface, index: number) {
  await setView($, { index, scroll: 0 })
  await $.ui.open({ id: ANSWER, title: `답변 ${index + 1}`, focus: true, ...SIZE })
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'questions',
      aliases: ['history'],
      description: '내가 한 질문 목록 (고르면 답변을 보여 줌). /questions 3 = 3번 답변을 바로 출력',
    })
    return started
  })

  // 턴이 끝나면 새 질문·답변이 생겼으니 다시 그린다
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await update($, view, v => ({ ...v, version: v.version + 1 }))
    return r
  })

  on('command.run', { command: 'questions' }, async ($, e) => {
    const n = Number(e.args.trim())
    const list = await load($)
    if (e.args.trim() && Number.isInteger(n)) {
      if (!list[n - 1]) return { text: `${n}번 질문이 없습니다 (1~${list.length}).` }
      await showAnswer($, n - 1)
      return { text: `${n}번 답변을 "답변" 탭에 열었습니다.` }
    }
    await setView($, { listTop: Math.max(0, list.length - 10) })
    await openList($)
    return { text: `질문 ${list.length}개 — "질문 목록" 탭에서 고르면 "답변" 탭에 나옵니다.` }
  })

  // 사람이 탭을 닫으면 다음 열기 때 다시 만든다 (따로 할 일 없음)

  // ── 답변 탭 ──
  on('ui.render', { component: 'Pane', requestId: ANSWER }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const list = await load($)
    const cols = Math.max(20, (e.props.bodyColumns ?? 80) - 1)
    const rows = Math.max(6, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24)
    const qa = list[v.index]
    if (!qa) return <Text dimColor>질문 목록 탭에서 질문을 고르세요.</Text>

    // 질문은 자르지 않는다: 질문 전체 + 구분선 + 답변을 한 덩어리로 스크롤 (긴 질문도 [아래]로 끝까지 볼 수 있게)
    type Line = { text: string; kind: 'question' | 'rule' | 'answer' }
    const body: Line[] = [
      ...wrap(`${v.index + 1}. ${qa.question}`, cols).map(text => ({ text, kind: 'question' as const })),
      { text: '─'.repeat(Math.min(cols, 60)), kind: 'rule' },
      ...wrap(qa.answer || '(아직 답변이 없습니다)', cols).map(text => ({ text, kind: 'answer' as const })),
    ]
    const room = Math.max(3, rows - 2)
    const maxScroll = Math.max(0, body.length - room)
    const scroll = Math.min(v.scroll, maxScroll)
    const shown = body.slice(scroll, scroll + room)
    const go = (index: number) => showAnswer($, index)

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="back" hotkey="b" label="목록" onPress={() => openList($)} />
          <Text> </Text>
          <Button key="up" hotkey="k" label="위" onPress={() => setView($, { scroll: Math.max(0, scroll - room + 1) })} />
          <Text> </Text>
          <Button key="down" hotkey="j" label="아래" onPress={() => setView($, { scroll: Math.min(maxScroll, scroll + room - 1) })} />
          <Text> </Text>
          {v.index > 0 ? <Button key="prev" hotkey="p" label="이전 질문" onPress={() => go(v.index - 1)} /> : null}
          <Text> </Text>
          {v.index < list.length - 1 ? <Button key="next" hotkey="n" label="다음 질문" onPress={() => go(v.index + 1)} /> : null}
          <Text dimColor>  {body.length === 0 ? 0 : scroll + 1}-{scroll + shown.length}/{body.length}줄</Text>
        </Box>
        {shown.map((l, i) =>
          l.kind === 'question' ? (
            <Text key={`l${scroll + i}`} bold color="cyan">{l.text || ' '}</Text>
          ) : l.kind === 'rule' ? (
            <Text key={`l${scroll + i}`} dimColor>{l.text}</Text>
          ) : (
            <Text key={`l${scroll + i}`} bold={/^#{1,6} /.test(l.text)}>{l.text || ' '}</Text>
          ),
        )}
      </Box>
    )
  })

  // ── 질문 목록 탭 ──
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const list = await load($)
    const cols = Math.max(20, (e.props.bodyColumns ?? 80) - 1)
    const rows = Math.max(6, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24)

    if (list.length === 0) {
      return <Text dimColor>아직 질문이 없습니다. (/compact 이전 대화는 남아 있지 않습니다)</Text>
    }

    const room = Math.max(3, rows - 2)
    const top = Math.min(Math.max(0, v.listTop), Math.max(0, list.length - room))
    const shown = list.slice(top, top + room)
    const numWidth = String(list.length).length

    return (
      <Box flexDirection="column">
        <Box>
          {top > 0 ? <Button key="lup" hotkey="k" label="위" onPress={() => setView($, { listTop: Math.max(0, top - room + 1) })} /> : null}
          <Text> </Text>
          {top + room < list.length ? <Button key="ldown" hotkey="j" label="아래" onPress={() => setView($, { listTop: top + room - 1 })} /> : null}
          <Text dimColor>  질문 {list.length}개 · 고르면 "답변" 탭</Text>
        </Box>
        {shown.map((qa, i) => {
          const index = top + i
          const mark = index === v.index ? '▶' : ' '
          const label = `${mark}${String(index + 1).padStart(numWidth)}. ${oneLine(qa.question, cols - numWidth - 7)}`
          return <Button key={`q-${index}`} label={label} onPress={() => showAnswer($, index)} />
        })}
      </Box>
    )
  })
}
