# claude-mods

Claude Code용 mod(플러그인) 모음입니다.

| mod | 명령 | 하는 일 |
|---|---|---|
| `token-usage` | `/tokens` | 상태 줄에 토큰·컨텍스트·사용 한도·비용, 창에 세션/오늘/모델별 사용량 |
| `question-history` | `/questions` | "질문 목록" 탭에서 질문을 고르면 "답변" 탭에 그 답변. `/questions 3` = 3번 답변 바로 열기 |

## 설치

터미널의 Claude Code 입력창에서:

```
/plugin install token-usage --marketplace lsj199608/claude-Mods
/plugin install question-history --marketplace lsj199608/claude-Mods
```

처음에는 `Add marketplace?`에 `y`, 그다음 범위(user)를 Enter로 고릅니다.

셸에서:

```
claude plugin install token-usage --marketplace lsj199608/claude-Mods
```

데스크톱 앱에서는 입력창 옆 + → Plugins → Add marketplace에 `lsj199608/claude-Mods` → Add plugin.

## 사용법

### /tokens (token-usage)
- 세션 합계는 mod가 켜진 뒤 끝난 턴부터 셈 (서브에이전트 턴 포함)
- 오늘 합계는 한국 날짜 기준, 여러 세션 합산 (이 PC에만 저장)
- 비용은 `/cost`와 같은 추정치

### /questions (question-history)
- 이 세션의 대화만 (`/compact` 이전 대화는 없음)
- 답변 탭: `b` 목록, `j`/`k` 아래/위, `p`/`n` 이전/다음 질문

## 개발 (이 저장소를 고칠 때)

`~/.claude/settings.json`의 `env.CLAUDE_CODE_PLUGIN_DIRS`에 `plugins/<mod>` 폴더들을 `;`로 이어 적으면 모든 세션에서 이 폴더의 mod가 켜지고, 파일을 고치면 다시 읽힙니다. 같은 mod를 `/plugin install`로도 설치하면 두 번 켜지므로 둘 중 하나만 씁니다.

```
cd plugins/question-history && claude plugin test .
claude plugin validate plugins/token-usage
```

## 라이선스

MIT
