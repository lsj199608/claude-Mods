import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'question-history',
  component: 'Pane',
  requestId: 'question-history',
  props: {
    title: '질문 목록',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
  viewport: { columns: 80, rows: 20 },
} as const

const ROWS = [
  { role: 'user', text: '<system-reminder>알림</system-reminder>mod 만들어줘', toolUses: [] },
  { role: 'assistant', text: '만들게요.', toolUses: [] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't', text: 'ok', isError: false }] },
  { role: 'assistant', text: '완성했습니다.', toolUses: [] },
  { role: 'user', text: '<command-name>/tokens</command-name><command-message>tokens</command-message><command-args></command-args>', toolUses: [] },
  { role: 'user', text: '<local-command-stdout>세션 0턴</local-command-stdout>', toolUses: [] },
  { role: 'user', text: '<system-reminder>배경 작업 끝</system-reminder>', toolUses: [] },
  { role: 'user', text: '한글로 번역해줘', toolUses: [] },
  { role: 'assistant', text: '번역입니다.', toolUses: [] },
]

test('질문 목록과 답변', async ($, on) => {
  on('session.messages', () => ({ value: ROWS }))
  on('command.register', () => ({ value: { command: 'questions' } }))
  const opened: { id: string; title?: string }[] = []
  on('ui.open', (_, e) => (opened.push({ id: e.id, title: e.title }), { value: { isPlaced: true } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'q-0' }))?.text).toContain('1. mod 만들어줘')
  expect((await ui.find({ key: 'q-1' }))?.text).toContain('2. /tokens')
  expect((await ui.find({ key: 'q-2' }))?.text).toContain('3. 한글로 번역해줘')
  expect(await ui.find({ key: 'q-3' })).toBeUndefined()

  await ui.press({ key: 'q-0' })
  expect(opened.at(-1)).toEqual({ id: 'question-answer', title: '답변 1' })

  const answer = await $.ui.mount({ ...PANE, requestId: 'question-answer', surface: 'terminal' })
  expect((await answer.find({ type: 'Text', text: /완성했습니다/ }))?.text).toBe('완성했습니다.')
  expect(await answer.find({ type: 'Text', text: /만들게요/ })).toBeDefined()

  await answer.press({ key: 'next' })
  expect(await answer.find({ type: 'Text', text: /세션 0턴/ })).toBeDefined()
  expect(opened.at(-1)).toEqual({ id: 'question-answer', title: '답변 2' })

  await answer.press({ key: 'back' })
  expect(opened.at(-1)).toEqual({ id: 'question-history', title: '질문 목록' })
  await answer.unmount()
  await ui.unmount()
})

// 예전에는 질문을 3줄까지만 그려 긴 질문의 뒷부분이 잘렸다 → 질문 전체가 답변과 함께 스크롤돼야 한다
test('긴 질문도 끝까지 보인다', async ($, on) => {
  const longQuestion = Array.from({ length: 12 }, (_, i) => `줄${i + 1} 아주 긴 질문 문장입니다`).join('\n') + '\n질문끝표시'
  on('session.messages', () => ({
    value: [
      { role: 'user', text: longQuestion, toolUses: [] },
      { role: 'assistant', text: '답변첫줄\n답변끝표시', toolUses: [] },
    ],
  }))
  on('command.register', () => ({ value: { command: 'questions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const narrow = { ...PANE.props, scroll: { offset: 0, bodyRows: 8 } }
  const list = await $.ui.mount({ ...PANE, props: narrow, surface: 'terminal' })
  await list.press({ key: 'q-0' })
  const answer = await $.ui.mount({ ...PANE, props: narrow, requestId: 'question-answer', surface: 'terminal' })

  expect(await answer.find({ type: 'Text', text: /줄1 / })).toBeDefined()
  expect(await answer.find({ type: 'Text', text: /질문끝표시/ })).toBeUndefined() // 첫 화면엔 아직 안 보임

  for (let i = 0; i < 5 && !(await answer.find({ type: 'Text', text: /답변끝표시/ })); i++) {
    await answer.press({ key: 'down' })
  }
  expect(await answer.find({ type: 'Text', text: /답변끝표시/ })).toBeDefined()

  await answer.press({ key: 'up' })
  await answer.press({ key: 'up' })
  await answer.press({ key: 'up' })
  // 스크롤로 질문의 모든 줄을 지나며 마지막 줄까지 닿을 수 있어야 한다
  let sawEnd = false
  for (let i = 0; i < 6; i++) {
    if (await answer.find({ type: 'Text', text: /질문끝표시/ })) { sawEnd = true; break }
    await answer.press({ key: 'down' })
  }
  expect(sawEnd).toBe(true)
  await answer.unmount()
  await list.unmount()
})
