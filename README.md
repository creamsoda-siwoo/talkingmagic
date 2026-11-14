# 말로 하는 마법 대결

주문을 버튼이 아니라 **문장으로 직접 적는** 마법 결투 게임입니다.
"얼음 벽을 세우고 그 뒤로 숨는다"처럼 쓰면 AI 심판(Claude)이 읽고 결과를 만들어 냅니다. 창의적일수록 강해집니다.

- 주문마다 창의력·개연성 점수를 매기고, 점수에 따라 피해가 정해집니다.
- 세워 둔 벽, 깔린 안개 같은 효과가 전장에 남아 다음 턴에 영향을 줍니다.
- 같은 주문을 또 쓰면 상대가 간파합니다.
- 상대 마법사도 성격에 맞는 주문으로 반격합니다. 세 명을 차례로 쓰러뜨리면 승리.

## 실행

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # https://platform.claude.com 에서 발급
npm start                             # http://localhost:3000
```

API 키가 없으면 **연습 모드**로 켜집니다. 화면과 흐름은 같지만, 글을 이해하지 못하고 낱말 수와 속성 낱말만 보는 단순 규칙으로 판정합니다.

## 배포 (Vercel)

저장소를 그대로 Vercel에 올리면 됩니다. `public/`은 정적 파일로, `api/judge.js`는 서버리스 함수로 배포됩니다.
프로젝트 환경 변수에 `ANTHROPIC_API_KEY`를 넣어 주세요. 키는 서버에서만 쓰이고 브라우저로 나가지 않습니다.

## 구조

| 파일 | 역할 |
|---|---|
| `public/index.html`, `style.css`, `game.js` | 게임 화면 |
| `public/rivals.js` | 상대 목록과 수치 (서버·화면 공용) |
| `lib/judge.js` | 심판 프롬프트, Claude 호출, 판정 값 범위 고정 |
| `lib/mock.js` | 연습 모드 판정 |
| `api/judge.js` | Vercel용 `POST /api/judge` |
| `server.js` | 로컬 서버 (정적 파일 + `/api/judge`, IP당 분당 20회 제한) |

난이도는 `public/rivals.js`의 체력·최대 피해, 판정 성향은 `lib/judge.js`의 `SYSTEM` 프롬프트에서 바꿀 수 있습니다.
