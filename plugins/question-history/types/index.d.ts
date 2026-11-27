export type View = {
  mode: 'list' | 'answer'
  /** 고른 질문 번호 (0부터) */
  index: number
  /** 목록 화면의 첫 줄 */
  listTop: number
  /** 답변 화면의 첫 줄 */
  scroll: number
  /** 새 메시지가 오면 올려서 다시 그리게 함 */
  version: number
}

declare module 'claude-code' {
  interface PluginState {
    'question-history': { view: Shaped<View> }
  }
}
