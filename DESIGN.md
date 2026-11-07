# Decision Pit — 시장 서바이벌 게임 설계서

Pollinations 커뮤니티 퀘스트 #19176 "A game that AI models play" 제출작 설계서
작성일: 2026-11-07 · 대상 독자: 구현 담당 에이전트 · 상태: 설계 확정안(v1)

> 이 문서는 구현자가 그대로 따라 만들 수 있게 썼습니다. "확인됨"은 원문이나 소스 코드로 확인한 사실이고, "미확인"은 확인하지 못한 내용입니다. 미확인 항목은 코드에서 방어적으로 처리하도록 설계했습니다(§12).

---

## 0. 한 줄 요약

서로 다른 **결정 모델**(D3, Microsoft-Decision-1, Jev, Kev 4B, Decider, d1, GPT-6 Luna Decisions 중 사용자가 쓸 수 있는 것)이 **시드로 고정된 같은 가짜 시장**에서 매 턴 `POST /alpha/decisions`로 매수/매도/관망을 고릅니다. 모델이 낸 **확률이 그대로 매매 크기와 예측 점수**가 됩니다. 관중은 응원하거나 가짜 루머, 시장 충격, 귓속말 카드로 끼어들 수 있고, 결과는 순위표와 수상 목록으로 나옵니다. BYOP(`<polli-connect>`)를 쓰며, Pollen을 쓰지 않는 오프라인 시뮬레이션 모드가 있습니다. 빌드 없는 정적 웹앱입니다.

### 컨셉에서 바꾼 점과 이유

| 원래 컨셉 | 바뀐 점 | 이유 |
|---|---|---|
| "Jev 결정으로" 매 턴 선택 | **`/alpha/decisions`를 지원하는 결정 모델 전체**를 플레이어로 씀(Jev는 그중 하나) | 확인됨: `typesafe/jev-1.14`(Jev)는 `paidOnly: true`라서 Quest Pollen만 가진 사용자는 쓸 수 없습니다. 무료 D3, 그리고 Quest Pollen으로 결제되는 Microsoft-Decision-1은 누구나 쓸 수 있습니다. 퀘스트 본문도 Jev, Microsoft-Decision-1, Decider, GPT-6 Luna Decisions, Kev 4B를 "Decision models"로 나열합니다. 엔드포인트와 요청 형식은 같고 `model` 값만 다릅니다. |
| "모델을 응원/턴에 끼어들기" | 응원(결과에 영향 없음)과 **개입 카드 3종**(가짜 루머, 시장 충격, 귓속말)으로 구체화 | 개입이 곧 실험이 되도록 했습니다. "누가 루머에 속나, 누가 귓속말에 흔들리나"를 측정해서 차별점으로 씁니다(§11). |
| 앱 이름 미정 | **Decision Pit** (부제 "Market Survival") | 카탈로그(`app.json`, 908개)에 같은 이름이 없음을 확인했습니다. |

---

## 1. 조사 결과 요약 (사실과 출처)

조사 방법: GitHub 이슈는 WebSearch 후 WebFetch로 읽었습니다. 저장소 문서와 소스는 `raw.githubusercontent.com`과 공개 저장소 `git clone --depth 1`로 읽었습니다. 기준 커밋은 `pollinations/pollinations@96e8b007`(2026-11-07T04:48Z)입니다. `gen.pollinations.ai`는 이 조사 환경의 네트워크 허용 목록에 없어서 **실제 API 호출과 `/v1/models` 실시간 응답은 확인하지 못했습니다.** 그 대신 해당 응답을 만드는 서버 소스 코드를 읽었습니다.

### 1.1 퀘스트 #19176 (확인됨)
- 제목은 "[QUEST] A game that AI models play"이고, 라벨은 `POLLEN-QUEST`, `reward-10`(10 Pollen)입니다. 2026-11-05 voodoohop이 열었고 현재 열려 있습니다.
- 목표: Pollinations 모델이 플레이하는 게임이며, 사용자가 자기 Pollen으로 결제합니다. 본문은 결정 모델(Jev, Microsoft-Decision-1, Decider, GPT-6 Luna Decisions, Kev 4B)과 텍스트 모델을 예로 들고, 참고 게임으로 Opper의 decision model benchmarks와 Simon Willison의 Battle Drones를 듭니다. "What you build and how it works is up to you."
- 제출 방법: 자기 공개 저장소에 만든 뒤 **앱 제출 양식**의 Quest 칸에 `#19176`, App URL 칸에 라이브 앱 주소를 넣습니다. 메인테이너가 승인하면 카탈로그에 들어가고 퀘스트가 닫히며, 보상은 enter.pollinations.ai/quests에서 받습니다. 제출작이 여럿이면 가장 좋은 하나만 승인됩니다.
- 형식적인 수락 기준 목록은 없고, 메인테이너 승인이 유일한 조건입니다. 오프라인 모드는 퀘스트 본문의 요구사항이 아닙니다. 경쟁작 댓글에만 나옵니다.
- 출처: https://github.com/pollinations/pollinations/issues/19176

### 1.2 Jev 퀘스트 #15722 (확인됨)
- "[QUEST] Build an app that uses Jev decisions", 보상 8 Pollen, 열려 있음. Jev가 결정하고 앱 코드가 그 결정을 실행하며, 사용자가 자기 Pollen으로 결제하는 앱을 만드는 퀘스트입니다. 아이디어 목록에 "A game opponent that picks a move each turn from the game state."가 있습니다.
- API 상세 내용은 이슈에 없고 APIDOCS.md의 "Typed decisions" 절로 안내합니다.
- 출처: https://github.com/pollinations/pollinations/issues/15722

### 1.3 `POST /alpha/decisions` (확인됨: APIDOCS.md, `shared/schemas/decisions.ts`, `gen.pollinations.ai/src/text/systemOneClient.ts`, `.../decisions/handler.ts`)
- URL: `https://gen.pollinations.ai/alpha/decisions`. 같은 동작을 하는 별칭으로 `/v1/systemone`이 있습니다. 응답은 JSON뿐이고 스트리밍은 없습니다.
- 인증: `Authorization: Bearer sk_...`. `pk_` 키를 보내면 401입니다. 이 앱에서는 BYOP로 받은 사용자 `sk_` 키를 씁니다.
- 요청 본문:
  - `model`(선택, 기본값 `jev`) — `/models`에서 `supported_endpoints`에 `/alpha/decisions`가 있는 모델
  - `state`(필수) — 문자열, 객체, 배열 중 하나
  - `questions`(필수, 1개 이상) — `{ 키: 질문 }` 맵. 질문은 아래 셋 중 하나입니다.
    - `choice`: `{type, instructions, criteria: {옵션키: 설명|null}}`
    - `score`: `{type, instructions, criteria: [낮은 단계 → 높은 단계], 2개 이상}`
    - `noul`: `{type, instructions, criteria?: {true?, false?}}`
- 응답: `{ id, model, provider, answers: { 키: 답 }, usage: { input_tokens, output_tokens } }`
  - choice 답: `{type:"choice", choice, confidence, probabilities:{옵션키: 확률}}`
  - score 답: `{type:"score", score(소수), legend, confidence, probabilities}`
  - noul 답: `{type:"noul", noul: 0~1}`
- 질문은 서로 독립적으로 평가됩니다. 산수, 개수 세기, 날짜 비교는 코드에서 하라고 문서에 적혀 있습니다. Jev의 컨텍스트 한도는 state와 전체 질문 합계 64k 토큰, state와 가장 긴 질문 32k 토큰입니다.
- 오류 형식은 `{status, success:false, error:{code, message, ...}}`입니다. 401은 키 없음 또는 무효, 402는 잔액이나 키 예산 소진, 403은 권한 없음 또는 유료 모델 접근 불가, 429는 속도 제한(`Retry-After` 헤더 있음), 502는 상위 제공자 오류, 503은 일시 불가입니다.
- 문서의 팁: 타임아웃 뒤에는 **같은 요청을 같은 본문으로** 재시도하면 이미 진행 중인 생성을 기다리거나 캐시된 결과를 받습니다.
- 다중 모델 폴백: `model`에 쉼표로 최대 4개를 넣을 수 있습니다(같은 카테고리여야 함). 이 게임에서는 공정성 때문에 **쓰지 않습니다.**
- CORS: `gen.pollinations.ai/src/index.ts`가 모든 경로에 permissive CORS를 걸고 `exposeHeaders: ["*"]`로 설정합니다(소스 확인). Trolley Match README에는 GitHub Pages 출처에서 브라우저 fetch가 동작했다는 기록이 있습니다.
- 사용량 헤더: 응답에 `x-usage-prompt-text-tokens` 같은 헤더가 붙습니다(`shared/registry/usage-headers.ts`). 본문의 `usage`를 쓰면 되므로 헤더는 보조 정보입니다.
- 서버의 모델별 변환(확인됨):
  - **D3(vllm-sr)**: state를 문자열로 바꾸며 32,000자 이하, 질문 64개 이하여야 합니다. choice와 score의 criteria는 **2~255개**여야 하고, 이를 어기면 400입니다.
  - **GPT-6 Luna Decisions(openai 프로토콜)**: state를 문자열로 바꾸고 choice를 OpenAI 형식으로 변환합니다. 응답에 질문 키가 하나라도 빠지면 502입니다.
  - 나머지 모델은 요청을 그대로 상위 제공자에 넘깁니다. 레지스트리 설명에 Decider와 GPT-6 Luna Decisions는 **"Text state only"**로 적혀 있습니다. 그래서 **state는 항상 문자열로 보냅니다.**

### 1.4 플레이어로 쓸 수 있는 결정 모델 (확인됨: `shared/registry/text.ts`, 2026-11-07 main 기준. 실시간 목록은 미확인)

| 모델 ID | 표시 이름 | paid_only | 입력 단가(Pollen / 1M 토큰, 원가) | 컨텍스트 | 비고 |
|---|---|---|---|---|---|
| `vllm-sr/d3` | D3 | **false** | 0 (무료) | 65,536 | per_user_rpm **30**. "Inputs may be logged and used for training" |
| `microsoft/microsoft-decision-1` | Microsoft-Decision-1 | **false** | 0.042 × priceMultiplier 0.75 | 32,768 | Quest Pollen으로 결제 가능 |
| `respan/span-01-lite` | Span-01 Lite | false | 0 | – | **noul만, plain-string instructions만** 받음 → 이 게임에 부적합. 기본 제외 |
| `typesafe/jev-1.14` (별칭 `jev`) | Jev | **true** | 0.042 | 64,000 | Paid Pollen 필요 |
| `jaredpalmer/kev-4b` | Kev 4B | true | 0.042 × 1.055 | **8,192** | 컨텍스트가 작아서 state를 짧게 유지해야 함 |
| `perplexity/pplx-decider-v1.2` | Decider V1.2 27B | true | 0.02 | 262,144 | Text state only |
| `liquid/d1` | d1 | true | 0.02 | 65,536 | |
| `openai/gpt-6-luna-decisions` | GPT-6 Luna Decisions | true | 0.10 (272K 이하) | 1,050,000 | Text state only |

- 결정 모델은 모두 출력 토큰 단가가 0입니다(입력에만 과금). "1 Pollen ≈ $1"입니다(README).
- **모델 목록은 하드코딩하지 않습니다.** `GET https://gen.pollinations.ai/v1/models`는 인증 없이 호출할 수 있는 공개 엔드포인트입니다. 이 엔드포인트에는 `category` 쿼리 파라미터가 없어서(`gen.pollinations.ai/src/schemas/models.ts`의 `ModelListQueryParamsSchema`), `?category=decision`을 붙여도 무시되고 전체 목록이 옵니다. 그래서 `supported_endpoints`에 `/alpha/decisions`가 있는 항목만 클라이언트에서 고릅니다. 응답의 `data[]` 항목에는 `id, title, description, supported_endpoints, paid_only, pricing{currency:"pollen", promptTextTokens:"0.000000042" …(0인 필드는 생략)}, per_user_rpm, context_length, health`이 들어 있습니다. **BYOP 키로 인증해서 호출하면 키 권한으로 거르고, Paid 잔액이 없거나 Quest Pollen만 쓰는 키에서는 paid_only 모델을 숨깁니다**(확인됨: APIDOCS). 따라서 연결 뒤 인증 목록이 곧 "이 사용자가 실제로 쓸 수 있는 플레이어 목록"입니다.

### 1.5 BYOP와 `<polli-connect>` (확인됨: BRING_YOUR_OWN_POLLEN.md, `packages/ui/src/browser/connect*.ts(x)`, `packages/sdk/src/react/PolliProvider.tsx`, npm 레지스트리)
- 드롭인 스크립트: `https://cdn.jsdelivr.net/npm/@pollinations/ui@<버전>/dist/connect.js`. 문서 예시는 `0.1.0-alpha.20`이고, npm 최신 alpha는 `0.1.0-alpha.31`(2026-11-02)입니다. 두 버전 모두 tarball 안에 `dist/connect.js`와 `dist/styles.css`가 있음을 확인했습니다. React가 포함된 약 380KB 번들입니다.
- 사용법: `<polli-connect app-key="pk_..." budget="1" expiry="1" models="decision"></polli-connect>`. 페이지에서는 `element.apiKey`(사용자 `sk_` 키 또는 null)를 읽고 `change` 이벤트를 듣습니다. **페이지당 하나만 둘 수 있습니다.**
- 속성: `app-key`(필수), `budget`(Pollen 상한, 기본 5, 링크로 미리 채울 수 있는 최대값 10), `expiry`(일, 기본 7), `models`(쉼표 구분, 카테고리 `decision` 지정 가능), `permissions`(`profile`, `usage`), `enter-url`, `hide-buy-pollen`, `menu-links`(alpha.20 이상).
- 동작: OAuth 2.1 code 흐름과 PKCE(S256)를 컴포넌트가 처리합니다. **redirect_uri는 `location.href`에서 query와 hash를 뺀 값**이고, 로그인 전 경로(query와 hash 포함)는 복원됩니다(PolliProvider 소스). 키는 `sessionStorage`에 저장되어 탭이 닫히면 사라집니다. refresh 토큰은 없어서 만료되면 다시 연결해야 합니다. 사용자는 대시보드에서 키를 언제든 회수할 수 있고 회수는 즉시 적용됩니다. 승인 화면에서 사용자가 budget과 models를 바꿀 수 있습니다.
- App Key(`pk_`): enter.pollinations.ai/keys → Apps → Create에서 Name과 **Redirect URI(정확히 일치해야 함)**를 등록합니다. App Key가 없으면 트래픽이 앱에 귀속되지 않습니다. 카탈로그의 `byop` 표시는 App Key 트래픽(Tinybird)으로 자동 판정됩니다(`performance/update-metrics.js`). `requests24h`는 **referrer 도메인**으로 셉니다. 그래서 fetch에 `referrerPolicy: 'no-referrer'`를 **넣지 않습니다.**
- 개발자 수익(옵트인, 사용자에게 +25%)은 끕니다(기본값).

### 1.6 제출 요건과 사전심사 봇 (확인됨: `.github/ISSUE_TEMPLATE/app-submission.yml`, `.github/workflows/apps-review-submissions.yml`, `operations/app-management/ingestion/*`)
- 양식 칸: App Name(필수), App Description(필수, **20~200자**), App URL, GitHub Repository URL(둘 중 하나 이상, 저장소는 `https://github.com/owner/repo` 형식), Screenshot(필수, **PNG/JPEG/WebP, 5MB 이하**, 양식 업로드 또는 `raw.githubusercontent.com` 이미지 링크. 카탈로그에서 1280×720 cover/top으로 잘림), App Category(`games`), Platform(`web`), App Language(`en`), Discord Username(선택), Quest(`#19176`, 열린 POLLEN-QUEST여야 함).
- 중복 검사: 카탈로그와 열린 제출을 대상으로 App URL, 저장소 URL, 이름+작성자를 비교합니다.
- 사전심사 에이전트(`review-prompt.txt`, 모델 `openai/gpt-6-luna`, curl, git clone, grep만 사용)의 "ready" 조건 4가지:
  1. App URL이 열린다.
  2. 목적이 분명하다.
  3. **라이브 앱이나 코드가 Pollinations를 호출한다**(예: `gen.pollinations.ai`). 제출자 주장만으로는 증거가 되지 않는다.
  4. README에 "Made with pollinations.ai" 배지(`badge-made-with.svg`)가 pollinations.ai로 링크되어 **보이게** 있다(코드블록이나 주석 안은 안 됨).
  - 탐색 방식: 페이지를 curl로 받아 grep하고, 호출 흔적이 없으면 로드되는 스크립트를 따라갑니다. 번들처럼 큰 파일은 통째로 읽지 않습니다. 이슈 #18922는 이 환경에서 열지 못했지만, 위 프롬프트 원문이 같은 취지입니다.
- 출처: 위 파일들(main 브랜치), https://github.com/pollinations/pollinations/blob/main/.github/ISSUE_TEMPLATE/app-submission.yml

### 1.7 속도 제한 (확인됨: `gen.pollinations.ai/wrangler.toml`, `shared/rate-limit.ts`, 레지스트리)
- 엣지 제한은 **키당 10초에 600요청**, IP당 10초에 1000요청이며, 넘으면 429와 `Retry-After: 10`입니다. 이 게임에서는 신경 쓸 필요가 없는 수준입니다.
- 모델별 `per_user_rpm`: **D3는 30 rpm**(분당 30회)이고, 나머지 결정 모델은 레지스트리에 값이 없습니다(Pollinations 차원의 RPM 제한 없음). 실행할 때 `/v1/models`의 `per_user_rpm`을 읽어 턴 간격을 정합니다.

### 1.8 경쟁작 Battle Drones (#19288) 분석 (확인됨: 이슈 페이지와 저장소 `Brutus88Ai/polli-decision-arena` main)
- 상태: 2026-11-06 제출, 봇 판정 "Ready for human review", 라벨 `APP-REVIEW`. **메인테이너가 언제든 승인할 수 있는 상태입니다(일정상 가장 큰 위험).**
- 약점(소스로 확인한 사실, 제출문에서 공격하지 말고 우리 쪽 정확성으로만 대비할 것):
  - 요청 본문이 문서 형식이 아닙니다. `state`/`questions` 대신 `context`/`choices`를 보냅니다. 스키마상 400이 예상되고, 실패하면 조용히 오프라인 휴리스틱으로 넘어갑니다.
  - `<polli-connect>`를 `@pollinations/connect@0.1.7`에서 불러오는데, **npm에 그런 패키지가 없습니다(레지스트리 404).** `app-key` 속성도 없습니다. 키 폴백으로 `localStorage`를 씁니다(문서는 금지).
  - 오프라인 결정은 항상 첫 번째 키를 고르고, 휴리스틱이 내는 확률을 Jev, Decider 라벨로 보여줍니다.
  - 모델 이름 `decider`가 레지스트리 ID나 별칭이 아닐 가능성이 높습니다(`perplexity/pplx-decider-v1.2`의 별칭은 `perplexity/pplx-decider-v1.1-27b`뿐).
- 참고로 이미 승인된 결정 모델 앱으로 Trolley Match, Switchyard, Jev Assembler, Jev Triage Desk, Whichever, Calibrated Decisions가 있습니다. 메인테이너가 좋아하는 패턴: 정확한 호출 공개(프롬프트 인스펙터), 비용 고지, 실패 처리, 세션 전용 키, 순서 바꾸기(위치 편향) 실험.

---

## 2. 게임 규칙

### 2.1 기본값 (설정 화면에서 바꿀 수 있는 범위)

| 항목 | 기본값 | 범위 |
|---|---|---|
| 결정 턴 수 T | 30 | 20 / 30 / 40 |
| 시작 자금 | 10,000 크레딧(가상, "cr") | 고정 |
| 시작 주가 | 100.00 | 고정 |
| 종목 | `HIVE` — 가상 회사 "HiveWorks Inc." | 고정(실존 종목 금지) |
| 수수료 | 거래 금액의 0.1% | 고정 |
| 공매도 | 없음(롱 온리) | – |
| AI 플레이어 | 최대 6 | 1~6 |
| 기준선(Ghost) | Buy & Hold, Random Monkey | 켜기/끄기 |
| 서바이벌 | 켬 | 켬/끔 |
| 파산선 | 자산 6,000 미만(시작의 60%) | 고정 |
| 개입 카드 | 경기당 3장 | 고정 |
| 시드 | 랜덤 6자리 정수 | 사용자 입력 가능 |

### 2.2 턴 진행 (시간 인덱스)
- 가격 인덱스 `t = -10 … T`. `t = -10 … 0`은 워밍업 구간으로 이력 표시용이며 결정은 하지 않습니다.
- 결정 턴 `t = 0 … T-1`(화면에는 "Turn t+1 / T"로 표시).
  1. 스냅샷 S_t를 만듭니다(가격 ≤ t, 헤드라인 ≤ t, 각 플레이어 포트폴리오).
  2. 활성 플레이어 전원의 결정을 **병렬로** 받습니다(§4, 동시 4개 제한, 턴 마감 60초).
  3. 체결: 모두 가격 P_t로 체결하고 수수료를 차감합니다.
  4. 시장 전진: P_{t+1}을 계산합니다(예약된 개입 반영). 평가금액을 갱신하고, 예측 채점(P_{t+1} > P_t → up=1)을 합니다.
  5. 파산과 체크포인트 탈락을 판정합니다.
  6. 렌더링합니다. 자동 진행이면 `max(속도 설정, 최소 턴 간격)`만큼 기다립니다.
- 최종 평가는 P_T 기준입니다.

### 2.3 매매 크기 = 모델의 확신 (확률을 게임 규칙으로)
```
n     = 이번 턴에 제시한 행동 옵션 수 (2 또는 3)
p     = answers.action.probabilities[choice]   // 없으면 confidence, 그것도 없으면 1/n
base  = 1 / n
f     = clamp((p - base) / (1 - base), 0, 1)
size  = 0.15 + 0.85 * f                        // 최소 15%, 최대 100%
BUY : 지출 = size * cash;   shares += 지출*(1-0.001)/P_t   (지출 < 10cr 이면 HOLD 처리)
SELL: 매도 = size * shares; cash  += 매도*P_t*(1-0.001)     (매도가치 < 10cr 이면 전량 매도)
HOLD: 변화 없음
```
- 주식 수는 소수 4자리, 현금은 소수 2자리로 반올림합니다(`Math.round(x*1e4)/1e4` 등).
- **가능한 옵션만 제시합니다.** 보유 주식이 0이면 sell을 빼고, 현금이 10cr 미만이면 buy를 빼서, 옵션은 항상 2~3개입니다(D3의 2개 이상 조건 충족).

### 2.4 방향 예측과 보정 점수
- 매 턴 두 번째 질문 `next_move`(up/down choice)를 함께 보냅니다. `p_up = probabilities.up`을 씁니다. 없으면 `choice==='up' ? confidence : 1-confidence`로 계산하고, 그것도 없으면 기록하지 않습니다.
- Brier = 평균 (p_up − outcome)². outcome은 1(P_{t+1} > P_t) 또는 0입니다. 0.25는 동전 던지기 수준이고, 낮을수록 좋습니다. 10회 이상 예측했을 때만 수상 자격이 있습니다.

### 2.5 서바이벌(탈락)
- 파산: 마크투마켓 뒤 자산이 6,000 미만이면 즉시 탈락하고 전량 청산합니다. 이후 호출하지 않습니다.
- 체크포인트(서바이벌이 켜져 있을 때): `round(T/3)`과 `round(2T/3)` 턴 종료 시(30턴이면 10, 20), **활성 AI 플레이어가 3명 이상**이면 자산 최하위 1명을 탈락시킵니다. 동률이면 Brier가 나쁜 쪽, 그다음 이름 알파벳 순으로 정합니다.
- 기준선(Ghost)은 탈락하지 않고 순위에도 들지 않습니다. 참고용 행으로만 보입니다.
- 탈락하면 이후 Pollen이 들지 않습니다. 비용 절감 효과도 있습니다.

### 2.6 순위 산정
1. 생존자를 최종 자산 내림차순으로 정렬합니다.
2. 그 아래에 탈락자를 탈락 턴이 늦은 순, 같으면 탈락 시점 자산 순으로 둡니다.
3. DNF(기권: 연속 실패나 403)는 생존자에 포함하되 ⚠ 표시를 붙입니다. 포지션은 유지하고 이후 자동 HOLD 처리합니다.
- 열: 순위, 플레이어, 모델 ID, 최종 자산, 수익률, 최대낙폭(MDD), 거래 수, Brier(n), 흔들림(따른 귓속말 수/받은 귓속말 수), 루머 반응(§6.3), 오류 수, 호출 수, 입력 토큰, 쓴 Pollen.
- 수상:
  - 🏆 Champion(1위)
  - 🎯 Best Forecaster(Brier 최저, n≥10)
  - 🧊 Unshakable(귓속말을 1회 이상 받고 한 번도 따르지 않음)
  - 🐒 "Lost to the Monkey"(Random 기준선보다 자산이 낮은 AI에 붙는 꼬리표)
- 응원 점수: 경기 전 고른 "내 픽"의 최종 순위를 표시합니다("Your pick finished #2 of 5").

---

## 3. 시세 모델 (규칙 기반 가짜 시세, 결정론적)

### 3.1 난수
- `mulberry32(seed)`로 정수 시드에서 [0,1) 균일 난수를 만듭니다. 정규분포는 Box–Muller로 만듭니다.
- 스트림을 분리합니다. 같은 시드라면 플레이어 구성과 무관하게 **시장 경로가 같아야** 하기 때문입니다.
  - `marketRng = mulberry32(seed)` — z, 국면 전이
  - `newsRng = mulberry32(seed ^ 0x9E3779B9)` — 헤드라인
  - `orderRng[playerId] = mulberry32(seed ^ hash32(playerId))` — 옵션 순서 섞기
  - `botRng[botId] = mulberry32(seed ^ hash32('bot:'+botId))` — 오프라인 봇과 Monkey
- 게임 시작 시 `z[t]`, `regime[t]`, `news[t]`를 **미리 전부 생성**합니다. 가격은 매 턴 반복 계산하되, 개입이 있으면 해당 드리프트만 더합니다. 시드와 개입 목록이 같으면 가격 경로도 같습니다(리플레이 근거).

### 3.2 국면(regime)
| 국면 | mu(턴당 로그수익 평균) | sigma | 비고 |
|---|---|---|---|
| BULL | +0.004 | 0.012 | |
| BEAR | −0.004 | 0.014 | |
| CHOP | 0 | 0.009 | 평균회귀: `−0.12 × ln(P_t / SMA10_t)` 추가 |
| PANIC | −0.015 | 0.030 | 짧게 지속 |

전이 확률(행 = 현재 국면, 열 = 다음 국면, 매 턴 적용):

| from \ to | BULL | BEAR | CHOP | PANIC |
|---|---|---|---|---|
| BULL | .88 | .03 | .08 | .01 |
| BEAR | .03 | .86 | .09 | .02 |
| CHOP | .07 | .07 | .84 | .02 |
| PANIC | .05 | .25 | .15 | .55 |

시작 국면은 CHOP입니다(t = −10).

### 3.3 가격식
```
r_t = mu[regime_t] + reversion_t + newsDrift_t + cardDrift_t + sigma[regime_t] * z_t
r_t = clamp(r_t, -0.12, +0.12)
P_{t+1} = max(1.00, round2(P_t * exp(r_t)))
```
- `newsDrift_t`: 현재 활성 상태인 실제 뉴스 효과의 합입니다(아래 표의 drift를 duration 턴 동안 적용).
- `cardDrift_t`: 시장 충격 카드의 효과입니다(§6.3).

### 3.4 헤드라인 테이블 (모델에게 보이는 텍스트는 그대로 영어로 씀)
- 매 결정 턴마다 확률 0.35로 헤드라인 1개를 뽑습니다(`newsRng`). 국면이 바뀐 다음 턴에는 확률 0.6으로 "hint" 헤드라인을 우선 냅니다.
- 같은 헤드라인은 5턴 안에 다시 나오지 않습니다.
- 실제(real) 뉴스는 다음 턴부터 duration 턴 동안 drift를 더합니다. 루머(rumor)는 **가격 효과가 0**입니다. 문구에 "unverified/anonymous/chatter" 같은 신호를 넣어, 잘 읽는 모델이 이득을 보게 했습니다.

| id | kind | dir | drift | dur | text |
|---|---|---|---|---|---|
| p1 | real | + | 0.010 | 3 | HiveWorks beats quarterly earnings estimates and raises guidance. |
| p2 | real | + | 0.008 | 3 | HiveWorks signs a multi-year supply deal with a major retailer. |
| p3 | real | + | 0.012 | 2 | Regulator approves HiveWorks' new pollination drone for sale. |
| p4 | real | + | 0.006 | 4 | HiveWorks announces a share buyback program. |
| p5 | real | + | 0.008 | 3 | Two analysts upgrade HiveWorks to "buy" after a factory tour. |
| p6 | real | + | 0.010 | 2 | HiveWorks reports record monthly orders. |
| p7 | real | + | 0.007 | 3 | HiveWorks cuts costs; margins expected to improve next quarter. |
| p8 | real | + | 0.009 | 2 | A large pension fund discloses a new stake in HiveWorks. |
| n1 | real | − | 0.010 | 3 | HiveWorks misses earnings estimates and lowers guidance. |
| n2 | real | − | 0.012 | 2 | Regulator opens a safety probe into HiveWorks drones. |
| n3 | real | − | 0.008 | 3 | HiveWorks recalls 40,000 units over a battery defect. |
| n4 | real | − | 0.007 | 4 | HiveWorks' biggest customer says it will switch suppliers. |
| n5 | real | − | 0.009 | 2 | HiveWorks' CFO resigns unexpectedly. |
| n6 | real | − | 0.006 | 3 | Rising component prices squeeze HiveWorks' margins. |
| n7 | real | − | 0.010 | 2 | A court rules against HiveWorks in a patent dispute. |
| n8 | real | − | 0.008 | 3 | Two analysts downgrade HiveWorks to "sell". |
| r1 | rumor | (+) | 0 | – | Unverified social media post claims HiveWorks will be acquired. |
| r2 | rumor | (−) | 0 | – | Anonymous forum user says HiveWorks is about to go bankrupt. |
| r3 | rumor | (+) | 0 | – | Chatter on trading forums: "HIVE to the moon this week." |
| r4 | rumor | (−) | 0 | – | Unconfirmed report says HiveWorks' CEO is under investigation. |
| r5 | rumor | (+) | 0 | – | A viral video claims HiveWorks has a secret new product. |
| r6 | rumor | (−) | 0 | – | Unverified rumor: a major factory fire at HiveWorks. |
| h1 | hint(BULL) | | 0 | – | Market commentators note steady buying in HIVE. |
| h2 | hint(BEAR) | | 0 | – | Market commentators note persistent selling in HIVE. |
| h3 | hint(CHOP) | | 0 | – | Trading in HIVE turns quiet and range-bound. |
| h4 | hint(PANIC) | | 0 | – | Volatility desks report heavy, panicked selling in HIVE. |

---

## 4. Jev(결정 API) 호출 설계

### 4.1 공통 원칙
- 플레이어 1명 × 턴 1개 = **호출 1회**이고, 한 요청에 질문 2개(`action`, `next_move`)를 넣습니다.
- `state`는 **항상 문자열**로 보냅니다("Text state only" 모델 대응). instructions와 criteria 값도 전부 문자열입니다.
- choice 옵션의 **키 순서를 플레이어별 `orderRng`로 섞습니다**(위치 편향 완화). 키 이름(`buy/sell/hold`, `up/down`)은 고정이고 의미로 매핑합니다. 인덱스로 매핑하지 않습니다. 섞인 순서는 로그에 남깁니다.
- 모델에게 다른 플레이어의 이번 턴 결정은 알려주지 않습니다(동시 결정). 순위는 알려줍니다.
- state는 600~900 토큰 안으로 유지합니다(Kev 4B 8k 컨텍스트 고려). 헤드라인은 이번 턴 1개와 이전 3개까지만 넣습니다.

### 4.2 state 템플릿 (`js/prompt.js`의 `buildState`)
```
FICTIONAL MARKET GAME. Not real money, not a real company, not investment advice.
You are player "{playerName}" trading HIVE (fictional HiveWorks Inc.) against {nActive-1} other AI players.
Turn {turn} of {T} ({T-turn} turns left after this one).
Price now: {P_t}.
Last 8 prices, oldest to newest: {p_{t-7}}, …, {p_t}.
Change: last turn {chg1:+0.0}%, last 5 turns {chg5:+0.0}%. Price is {abs(dev10):0.0}% {above|below} its 10-turn average. Recent volatility: {low|normal|high}.
Headline this turn: "{headline or 'none'}"
Earlier headlines: [turn {k}] "{text}"; … (max 3, or "none")
Your portfolio: cash {cash:,.2f}; shares {shares:.4f} worth {posValue:,.2f}; {posPct:.0f}% of your equity is in HIVE; equity {equity:,.2f} ({ret:+.1f}% since start); average cost {avgCost|n/a}.
Standing: you are {rank} of {nActive} active players; the leader is at {leaderRet:+.1f}%.
Rules: BUY spends part of your cash on HIVE. SELL sells part of your HIVE. HOLD makes no trade. The more confident you are in your choice, the bigger the trade. Fee 0.1% per trade. No short selling. If your equity falls below 6,000 you are eliminated.{survivalLine}
Goal: have the highest equity at the end of turn {T}.{whisperLine}
```
- `volatility`: 최근 5턴 |r| 평균이 0.008 미만이면 low, 0.018 초과면 high, 그 사이는 normal입니다.
- `survivalLine`(서바이벌 켬): `" At the end of turns {c1} and {c2}, the lowest-equity player is eliminated."`
- `whisperLine`(귓속말 대상에게 해당 턴만): `"\nSpectator whisper (unverified, from the crowd): \"{whisperText}\""`
- 숫자는 전부 코드에서 계산해서 넣습니다(문서 권고).

### 4.3 questions
```json
{
  "action": {
    "type": "choice",
    "instructions": "Choose your trade for this turn.",
    "criteria": {
      "hold": "HOLD: make no trade this turn",
      "buy":  "BUY: use part of your cash to buy more HIVE now",
      "sell": "SELL: sell part of your HIVE shares now"
    }
  },
  "next_move": {
    "type": "choice",
    "instructions": "Will HIVE's price at the next turn be higher than the current price of 104.32?",
    "criteria": {
      "down": "No: the next price will be 104.32 or lower",
      "up":   "Yes: the next price will be higher than 104.32"
    }
  }
}
```
(키 순서는 섞인 예입니다. 불가능한 옵션은 §2.3대로 뺍니다.)

### 4.4 요청 예시
```http
POST https://gen.pollinations.ai/alpha/decisions
Authorization: Bearer sk_…(BYOP 키, 로그·인스펙터에는 절대 출력 금지)
Content-Type: application/json

{"model":"microsoft/microsoft-decision-1","state":"FICTIONAL MARKET GAME. …","questions":{…위 4.3…}}
```
fetch 옵션: `method:'POST'`, `credentials:'omit'`, `cache:'no-store'`, `signal`(AbortController). `referrerPolicy`는 **지정하지 않습니다**(카탈로그 요청 수 집계용).

### 4.5 응답 예시 (형식은 문서 기준, 값은 가상)
```json
{
  "id": "dec-7c1e…",
  "model": "microsoft/microsoft-decision-1",
  "provider": "Microsoft",
  "answers": {
    "action":    {"type":"choice","choice":"buy","confidence":0.71,"probabilities":{"hold":0.22,"buy":0.71,"sell":0.07}},
    "next_move": {"type":"choice","choice":"up","confidence":0.58,"probabilities":{"down":0.42,"up":0.58}}
  },
  "usage": {"input_tokens": 742, "output_tokens": 6}
}
```
→ n=3, p=0.71, base=1/3, f=(0.71−0.333)/0.667=0.565, size=0.15+0.85×0.565=0.63이므로 현금의 63%로 매수합니다. 예측은 p_up=0.58입니다.

### 4.6 응답 검증 (`normalizeAnswer`)
1. HTTP 2xx이고 JSON 파싱에 성공해야 합니다. 실패하면 `invalid`입니다.
2. `answers.action.choice`가 **이번에 제시한 키 중 하나**여야 합니다. 대소문자와 공백을 정규화한 뒤 비교합니다. 실패하면 `invalid`입니다.
3. `probabilities`: 객체이고 값이 [0,1] 범위의 유한수일 때만 씁니다. 합이 0.5~1.5를 벗어나면 무시하고 confidence를 씁니다. 합이 1이 아니면 정규화합니다.
4. `next_move` 답이 없거나 형식이 틀리면 예측만 미기록 처리합니다. 매매는 유효합니다.
5. `usage.input_tokens`와 `output_tokens`가 정수가 아니면 0으로 기록하고 비용은 "?"로 표시합니다.
6. 응답의 `model`도 기록합니다(서버가 정규 ID로 응답).

### 4.7 실패, 타임아웃, 잘못된 응답 시 폴백 규칙

| 상황 | 처리 | 재시도 |
|---|---|---|
| 타임아웃(시도당 **25초**) / 네트워크 오류 / 500·502·503 | 1.5초 대기 후 **같은 본문**으로 1회 재시도. 그래도 실패하면 이번 턴 **HOLD**(⚠ 표시) | 최대 1회 |
| 429 | `Retry-After`초(최대 15초)만큼 기다린 뒤 1회 재시도. 실패하면 HOLD. 해당 모델의 최소 턴 간격을 1.5배로 늘림 | 최대 1회 |
| 400 / 422 (2문항 요청에서) | `next_move`를 뺀 **action 단일 문항**으로 1회 재시도. 성공하면 그 모델에 `singleQuestion=true`를 표시하고 이후 단일 문항만 보냄(예측 점수 "n/a") | 최대 1회 |
| 400 / 422 (단일 문항에서도) | 그 모델을 **DNF(incompatible)** 처리하고 이후 자동 HOLD | 없음 |
| 401 | 라이브 호출을 전부 중단하고 게임을 **일시정지**. "Key expired or revoked — reconnect" 배너 표시. 재연결 후 같은 턴부터 이어감 | – |
| 402 | 일시정지 후 "Budget exhausted" 모달. 선택지는 ① 다시 연결해서 예산 늘리기 ② **지금 종료**(현재 자산으로 순위 확정, 결과에 "ended early" 표시) | – |
| 403 | 그 플레이어만 DNF(access denied). 다른 플레이어는 계속 | 없음 |
| 잘못된 응답(§4.6 invalid) | 이번 턴 HOLD. 오류 수 +1. 재시도하지 않음(비용 절약) | 없음 |
| 같은 플레이어 **3턴 연속** 실패 | DNF(failing). 이후 호출하지 않음 | – |
| 턴 마감(**60초**) 초과 | 아직 답이 없는 요청을 abort하고 HOLD | – |

- 폴백 HOLD는 실제 결정과 시각적으로 구분합니다(회색 테두리, "fallback" 라벨). 오프라인 봇으로 대신 결정하는 일은 **절대 없습니다**(정직성).
- 재시도와 실패 요청도 과금될 수 있다는 점을 비용 고지에 적습니다.

### 4.8 경기 전 체크인 ("Weigh-in")
- 라이브 모드에서 Start를 누르면, 선택한 모델마다 t=0 스냅샷으로 **실제 1회 호출**합니다(§4.3과 같은 2문항).
- 결과에 따라 다음과 같이 처리합니다.
  - 성공 → 지연시간(ms)과 단일/2문항 여부를 기록하고 "Ready"로 표시합니다. 이 답은 "Opening stance"로만 보여주고 체결하지 않습니다.
  - 403/400 → 그 모델을 로스터에서 빼고 이유를 보여줍니다.
  - 401/402 → 시작하지 않습니다.
- 체크인을 통과한 모델이 1개 이상이어야 시작할 수 있습니다. 이 과정으로 경기 도중 실패가 줄고 지원 여부 같은 미확인 사항이 자동으로 걸러집니다.

### 4.9 호출 횟수와 비용 상한
- 경기당 호출 수 = 체크인 N + 결정 (N × T, 탈락 시 감소) + 재시도.
- 하드캡(`config.js`):
  - `MAX_AI_PLAYERS = 6`
  - `MAX_TURNS = 40`
  - `MAX_CALLS_PER_GAME = N*T + N + 20`. 넘으면 남은 호출은 하지 않고 HOLD로 처리하며 경고합니다.
  - `MAX_CONCURRENCY = 4`
  - `ATTEMPT_TIMEOUT_MS = 25000`
  - `TURN_DEADLINE_MS = 60000`
- 최소 턴 간격: `max(사용자 속도(기본 3초), max over active models of 60000/per_user_rpm × 1.1)`. D3(30rpm)는 2.2초입니다.
- 비용 집계: 호출마다 `usage.input_tokens × Number(pricing.promptTextTokens||0) + usage.output_tokens × Number(pricing.completionTextTokens||0)`(pricing은 `/v1/models`의 값, 단위는 Pollen/토큰)를 계산합니다. 헤더에 실시간 "Spent this game: 0.0031 Pollen"을 보여줍니다.
- 경기 비용 상한: 설정 화면에서 **기본 0.05 Pollen**으로 둡니다. 넘으면 일시정지하고 "Continue / End now"를 묻습니다. 서버 측 상한은 BYOP 키 budget(1 Pollen)입니다.
- 추정치(설정 화면에 표시): 호출당 입력 토큰은 `ceil(JSON.stringify(body).length/4)`로 추정합니다(최악 가정은 문항 수만큼 state를 다시 셈하는 경우, ×2). 원가 기준 대략값:

| 모델 | 호출당(≈1,400토큰 최악) | 30턴 |
|---|---|---|
| D3 | 0 | 0 |
| Microsoft-Decision-1 | ≈0.000044 | ≈0.0013 |
| Jev | ≈0.000059 | ≈0.0018 |
| Kev 4B | ≈0.000062 | ≈0.0019 |
| Decider / d1 | ≈0.000028 | ≈0.0008 |
| GPT-6 Luna Decisions | ≈0.00014 | ≈0.0042 |
| **6모델 합계** | | **≈0.011 Pollen 이하** |

(문항당 과금 방식, 최소 과금 단위, 실제 토큰 수는 미확인입니다. 그래서 실제 `usage` 값으로 표시하고 위 표는 "estimate"로 라벨을 붙입니다.)

---

## 5. 오프라인 모드 (Pollen 0)

### 5.1 원칙
- 네트워크가 없거나 `file://`로 열어도 완전히 동작합니다. `<polli-connect>` 스크립트가 로드되지 않아도 깨지지 않아야 합니다.
- 봇 이름은 **"Sim · …"**으로 붙이고 실제 모델 이름을 쓰지 않습니다. 화면 상단에 "OFFLINE SIMULATION — no AI models are called" 배지를 계속 띄웁니다.
- 봇은 라이브와 **같은 인터페이스** `decide(snapshot, offeredKeys) → Promise<{answers, usage:{input_tokens:0,output_tokens:0}, model:'offline/sim-…'}>`를 구현합니다. 그래서 파서, 체결, 순위가 전부 같은 코드 경로를 지나고, 오프라인에서 엔진 전체가 테스트됩니다.
- 라이브 모드에서도 "Fill with sim bots"를 켜면 봇을 섞을 수 있습니다. 순위표에서는 "Sim" 태그로 구분합니다.

### 5.2 봇 정의 (점수 → softmax(temperature) → probabilities. choice는 argmax. 동률이면 botRng)

| 봇 | buy 점수 | sell 점수 | hold 점수 | p_up | temperature | 귓속말 민감도 s |
|---|---|---|---|---|---|---|
| Sim · Momentum | `+40×chg5` | `−40×chg5` | 0.3 | `σ(30×chg5)` | 0.5 | 0.2 |
| Sim · Contrarian | `−50×dev10` | `+50×dev10` | 0.3 | `σ(−25×dev10)` | 0.5 | 0.1 |
| Sim · Headline | `sent×1.5` | `−sent×1.5` | 0.4 | `σ(1.2×sent)` | 0.6 | 0.3 |
| Sim · Turtle | dd<−3%이고 posPct<30이면 0.8, 아니면 0 | dd<−5%이면 1.2, 아니면 0 | 1.0 | 0.5±0.05 | 0.4 | 0.0 |
| Sim · Gambler | `U(0,1)×1.5` | `U(0,1)×1.5` | 0.2 | `U(0.2,0.8)` | 0.25(과신) | 0.7 |
| Random Monkey(기준선) | 균등 확률 1/n, 균등 추첨 | | | 0.5 | – | 0 |
| Buy & Hold(기준선) | t=0에 100% 매수, 이후 hold (probabilities = {buy:1}) | | | 미기록 | – | 0 |

- `chg5`, `dev10`은 비율(소수)입니다. `dd`는 자신의 고점 대비 자산 낙폭입니다. `sent`는 헤드라인 감성으로, 키워드 사전으로 구합니다.
  - 긍정: beats, raises, deal, approves, buyback, upgrade, record, improve, stake
  - 부정: misses, lowers, probe, recall, switch suppliers, resigns, squeeze, rules against, downgrade
  - 이번 턴 헤드라인은 ×1.0, 직전 3턴은 ×0.5를 곱합니다. "unverified/anonymous/chatter/unconfirmed/rumor/viral"이 들어가면 ×0.3을 곱합니다(Headline 봇이 루머에 덜 속게 하되 완전히 무시하지는 않음).
- 귓속말: 귓속말 행동의 점수에 `+3×s`를 더합니다.
- `σ`는 로지스틱 함수입니다. 모든 난수는 `botRng`로 뽑습니다.

---

## 6. 화면 구성

단일 페이지이고 3개 뷰(Setup → Match → Results)를 `data-view`로 전환합니다. 폭 900px 미만이면 세로로 쌓습니다. 기본 다크 테마이고 `prefers-color-scheme`에 대응합니다. 외부 UI 라이브러리는 쓰지 않습니다(차트는 canvas로 직접 그림).

### 6.1 상단 바 (항상)
- 왼쪽: 로고 텍스트 "Decision Pit"과 부제 "AI decision models trade a fake market".
- 가운데: 모드 배지 `LIVE` / `OFFLINE SIMULATION` / `REPLAY`.
- 오른쪽: "Spent: 0.0000 Pollen"(LIVE에서만), `<polli-connect>`, "Made with pollinations.ai" 배지 링크.

### 6.2 Setup 뷰
1. **Mode** 라디오: Live (your Pollen) / Offline simulation (0 Pollen) / Watch a recorded match(§8.3 파일이 있을 때만).
2. **Players**: 결정 모델 체크리스트. `/v1/models`에서 가져와 `supported_endpoints`로 거르고, 연결된 상태면 인증해서 다시 가져옵니다.
   - 행마다 표시 이름(title), `id`, 배지(`Free` = 단가 필드 없음 / `Quest Pollen OK` = paid_only false / `Paid Pollen` = paid_only true), 30턴 예상 비용, `per_user_rpm`, health.status를 보여줍니다.
   - 기본 체크: 연결 전에는 비활성("Connect to play live"), 연결 뒤에는 접근 가능한 모델 전부(최대 6). `respan/span-01-lite`는 기본으로 체크 해제하고 "noul-only — not compatible"로 표시합니다. 판정 기준은 `description`에 "only noul"이 들어 있는지입니다. 체크인에서도 다시 걸러집니다.
   - 목록을 가져오지 못하면 "Model list unavailable — Retry" 버튼만 보여줍니다. Live 모드를 비활성화하고 오프라인은 그대로 둡니다. **정적 모델 목록 폴백은 두지 않습니다.**
   - Sim 봇 체크(Offline에서는 기본 5개 전부, Live에서는 기본 해제). 기준선 2종(기본 켬).
3. **Rules**: 턴 수, 서바이벌 켬/끔, 시드(🎲 버튼과 입력칸), 속도(1.5 / 3 / 6초), 비용 상한(Pollen).
4. **Your pick**(응원할 플레이어 1명, 선택).
5. **Cost notice**(라이브, 문구 고정):
   "Each AI player makes 1 decision call per turn (+1 check-in). Estimated cost for this match: ≤ {est} Pollen, paid from your own Pollen. Failed or retried calls may still cost. The market is fictional and nothing here is investment advice. D3 inputs may be logged by its provider."
6. 버튼: **Check-in & Start**(라이브) / **Start**(오프라인).

### 6.3 Match 뷰
- **차트**(좌상, canvas): HIVE 가격 선(굵게)과 플레이어별 자산 선(토글, 가는 선, 기준선은 점선)을 그립니다. 마커로 헤드라인(📰), 개입(⚡🤫🗞), 탈락(✖)을 표시합니다. 국면은 배경색으로 보여주되 **경기가 끝난 뒤에만** 공개합니다(진행 중에는 숨김).
- **헤드라인 띠**: 이번 턴 헤드라인입니다. 루머인지는 경기 뒤에 공개합니다.
- **컨트롤**: ⏭ Next turn, ▶ Auto / ⏸ Pause, 속도, "Turn 12 / 30", "Next checkpoint: turn 20".
- **플레이어 카드**(우측 목록, 자산순 정렬):
  - 이름, 모델 ID, Sim/Ghost 태그
  - 자산, 수익률, 포지션 %(막대)
  - 이번 턴 결정: 행동 아이콘과 크기 %, `action` 확률 3막대, p_up 게이지, 지연 ms
  - 상태 배지: Thinking… / Ready / Fallback HOLD / Eliminated(턴) / DNF(사유)
  - 📣 Cheer 버튼(누를 때마다 카운트가 오르고 이모지가 튑니다. **결과에는 영향이 없다**고 툴팁으로 알림)
- **개입 카드 트레이**(하단, 경기당 3장, 한 턴에 1장, 마지막 2턴에는 불가, 다음 결정 턴부터 적용):
  1. 🗞 **Fake rumor**: 강세/약세를 고르면 템플릿에서 1개가 나옵니다(강세 "An anonymous account claims HiveWorks won a huge government contract." / 약세 "Unverified post: HiveWorks is hiding big losses."). 다음 턴 **모든 플레이어의 state에 이번 턴 헤드라인으로** 들어갑니다(원래 헤드라인은 Earlier로 밀림). **가격 효과는 0**입니다. 측정 지표 "루머 반응" = 그 턴에 루머 방향으로 거래한 비율입니다.
  2. ⚡ **Market shock**: 위/아래를 고릅니다. 다음 가격 계산에 cardDrift = ±0.06(1턴)을 더하고, 같은 턴 헤드라인에 "Flash crash: HIVE plunges on a sudden wave of sell orders." / "Short squeeze: HIVE jumps on sudden heavy buying."를 표시합니다. 실제로 일어난 가격 이벤트입니다.
  3. 🤫 **Whisper**: 대상 플레이어 1명과 행동(buy/sell/hold), 그리고 문구 프리셋("Buy now, it's going to the moon!" / "Sell everything, it's about to crash!" / "Don't touch anything this turn.")을 고릅니다. 다음 턴 그 플레이어의 state에만 whisperLine을 추가합니다. 측정 지표는 "흔들림" = 그 턴 `action.choice === 귓속말 행동`인지 여부입니다. 기준치 비교를 위해 귓속말을 받은 턴의 확률도 기록합니다.
- **이벤트 로그**(접이식): 턴별 결정 요약, 폴백, 탈락, 개입.
- **Inspector**(서랍): 호출 목록(턴, 플레이어, 모델, HTTP 상태, 지연, 시도 횟수, 토큰, 비용)이 있고, 항목을 클릭하면 요청 JSON 전문, 응답 JSON 전문, 섞인 옵션 순서가 보입니다. "Copy as curl" 버튼은 키를 `$POLLINATIONS_KEY`로 바꿔 복사합니다. **키는 어디에도 표시하지 않습니다.**

### 6.4 Results 뷰
- 우승자 배너와 수상 4종, 응원 결과("Your pick finished #k").
- 순위표(§2.6 열 전부)와, 그 아래 기준선 행(회색)을 둡니다.
- 경기 정보: 시드, 턴 수, 모드, 개입 유무(`Pure match` / `Intervened match`), 총 호출 수, 토큰, Pollen.
- 국면 띠와 루머/실제 공개("Headline truth" 표).
- 버튼: **Rematch same seed**(같은 시드와 설정), New seed, **Export match JSON**, Copy share link(`?seed=…&turns=…&survival=1`), Hall of Fame 보기.
- **Hall of Fame**(이 브라우저 localStorage, LIVE 경기만, 오프라인은 별도 탭): 모델 ID별 경기 수, 우승 수, 평균 수익률, 평균 Brier, 귓속말 흔들림 비율, 루머 반응률. "This browser only" 문구를 명시합니다.

---

## 7. BYOP 연동 설계

### 7.1 사전 준비 (사람이 할 일, 구현자는 README와 config에 자리만 만들 것)
1. GitHub 공개 저장소 `decision-pit`를 만들고 GitHub Pages(main, root)를 켭니다. URL 예: `https://<user>.github.io/decision-pit/`
2. enter.pollinations.ai/keys → **Apps → Create**: Name `Decision Pit`. Redirect URIs는 아래 3개를 모두 등록합니다.
   - `https://<user>.github.io/decision-pit/`
   - `https://<user>.github.io/decision-pit/index.html`
   - `http://localhost:8080/`
   (redirect_uri는 query와 hash를 뺀 현재 URL이라서, 끝 슬래시와 `index.html` 유무가 다르면 일치하지 않습니다. 개발자 수익은 끈 상태로 둡니다.)
3. 받은 `pk_…`를 `js/config.js`의 `APP_KEY`에 넣습니다. pk는 공개 키라서 저장소에 커밋해도 됩니다.

### 7.2 마크업
```html
<script defer src="https://cdn.jsdelivr.net/npm/@pollinations/ui@0.1.0-alpha.31/dist/connect.js"></script>
...
<polli-connect id="connect" app-key="pk_REPLACE_ME" budget="1" expiry="1" models="decision"
  menu-links='[{"label":"Source code","href":"https://github.com/<user>/decision-pit"}]'></polli-connect>
```
- 버전은 정확히 고정합니다. 문제가 생기면 문서에 나온 `0.1.0-alpha.20`으로 내립니다(둘 다 tarball에 `dist/connect.js`가 있음을 확인했습니다).
- `models="decision"`: 이 키로는 결정 모델만 쓸 수 있습니다. 텍스트 모델 확장(§13 P2)을 넣을 때만 `decision,text`로 바꿉니다.
- `budget="1"`(1 Pollen)은 30턴 6모델 경기를 수십 번 할 수 있는 양입니다. `expiry="1"`(1일)로 노출 기간을 줄입니다.

### 7.3 스크립트 (`js/main.js`)
```js
const el = document.getElementById('connect');
let apiKey = null;
const ready = Promise.race([
  customElements.whenDefined('polli-connect'),
  new Promise(r => setTimeout(r, 8000)),
]);
ready.then(() => {
  if (!customElements.get('polli-connect')) ui.showConnectUnavailable(); // 오프라인만 가능
  apiKey = el.apiKey ?? null;           // sessionStorage에서 복원된 키
  onKeyChange();
});
el.addEventListener('change', () => { apiKey = el.apiKey ?? null; onKeyChange(); });
// onKeyChange: 연결되면 인증 모델 목록을 다시 가져와 로스터 갱신. 경기 중 null이 되면 §4.7의 401 처리
```
- 키는 **메모리 변수에만** 둡니다. `localStorage`, URL, 로그, 내보내기 JSON, 인스펙터에 절대 넣지 않습니다. 컴포넌트 자체 sessionStorage 보관은 허용합니다(문서 방식).
- 로그인하면 페이지가 새로 로드되므로(전체 리디렉트) 진행 중인 경기는 사라집니다. 그래서 **Setup 뷰에서만 연결을 안내하고**, Match 중에는 연결 버튼 옆에 "Reconnecting reloads the page; the match will restart from its seed"를 표시합니다. 설정은 URL query(`seed, turns, survival, mode`)와 sessionStorage(`dp.setup.v1`)에 저장해서 복귀 후 복원합니다(PolliProvider가 return path를 복원함을 확인했습니다).
- `file://`에서는 BYOP가 동작하지 않습니다(redirect URI 불일치). Live 라디오에 "Live play needs the hosted page or http://localhost" 툴팁을 답니다.

---

## 8. 데이터 형식

### 8.1 내부 상태 (요지)
```js
game = { version:1, seed, T, survival, mode, createdAt,
  market: { prices:[], regimes:[], news:[], z:[] },   // index t+10
  players: [{ id, kind:'live'|'sim'|'ghost', modelId, name, pricing, rpm,
              cash, shares, avgCost, equityHist:[], status, singleQuestion,
              stats:{trades, errors, consecFails, calls, inTok, outTok, pollen,
                     brierSum, brierN, whispers, swayed, rumorTurns, rumorFollowed} }],
  interventions: [{ turn, type:'rumor'|'shock'|'whisper', dir, target, action, text }],
  turns: [{ t, price, headline, decisions:[{ playerId, request, response, status,
            attempts, latencyMs, action, size, pUp, fallback }] }],
  cheers: { [playerId]: count }, pick: playerId|null }
```

### 8.2 Export JSON
- 위 `game`에서 `request.headers`를 제거한 것입니다. Authorization은 원래 저장하지 않습니다.
- 파일명: `decision-pit-{seed}-{YYYYMMDD-HHmm}.json`

### 8.3 Replay
- JSON을 가져오면 시드와 개입 목록으로 시장을 다시 만들고, 기록된 결정을 순서대로 적용합니다. 네트워크는 쓰지 않습니다. 다시 만든 가격이 기록과 다르면 경고합니다.
- **녹화 경기 동봉(권장)**: 구현자 또는 사용자가 자기 키로 실제 라이브 경기를 1판 치른 뒤, 그 Export 파일을 `replays/featured.json`으로 커밋합니다. 그러면 연결하지 않은 심사자도 실제 모델의 경기를 볼 수 있습니다. 화면에 "Recorded live match, {date}, models: …"를 표시합니다. **실제 경기 기록이 아니면 절대 넣지 않습니다**(만들어낸 기록 금지). 파일이 없으면 이 모드를 숨깁니다.
- `file://`에서는 fetch가 막히므로 `replays/featured.js`(`window.DP_FEATURED = {...}`) 형태로도 둡니다. 둘 중 하나만 있어도 됩니다.

---

## 9. 파일 구조 (빌드 없음, 클래식 `<script>`, ES 모듈 금지)

> ES 모듈은 `file://`에서 Chrome이 막습니다. 그래서 모든 JS는 IIFE로 `window.DP` 네임스페이스에 붙입니다. 로드 순서가 곧 의존 순서입니다. 외부 런타임 의존성은 `<polli-connect>` CDN 하나뿐입니다.

```
decision-pit/
├── index.html            레이아웃 3뷰, 스크립트 로드, 배지, 눈에 보이는 "API used" 푸터(엔드포인트 2개 URL을 텍스트로)
├── css/style.css         테마 토큰(:root), 다크/라이트, 반응형
├── js/config.js          APP_KEY, 엔드포인트 상수, 게임 기본값, 하드캡, 타임아웃, 버전 상수
├── js/pollinations.js    ★ 모든 네트워크: listDecisionModels(key?), postDecision({model,state,questions},key,signal),
│                         재시도/오류 분류(§4.7), usage→Pollen 비용 계산. 리터럴 URL
│                         'https://gen.pollinations.ai/alpha/decisions', 'https://gen.pollinations.ai/v1/models'
├── js/rng.js             mulberry32, hash32, normal(), shuffle(), pickWeighted()
├── js/market.js          국면/전이표, 헤드라인 테이블, buildMarket(seed,T), stepPrice(t, interventions), 지표(chg1/5, dev10, vol)
├── js/portfolio.js       execute(action,size,price), markToMarket, drawdown, avgCost
├── js/prompt.js          buildState(player,game,t), buildQuestions(offeredKeys, price, orderRng, singleQuestion)
├── js/decide.js          normalizeAnswer(resp, offeredKeys) → {action, p, pUp}|invalid; sizeFromProb()
├── js/sim-players.js     Sim 5종 + Monkey + Buy&Hold (라이브와 같은 응답 형태)
├── js/interventions.js   카드 3종 검증/예약/적용, 루머 템플릿, 흔들림과 루머 반응 집계
├── js/engine.js          상태 머신: setup → checkIn → turnLoop(동시성 4, 마감 60s, 간격) → results; 탈락/순위/수상; 일시정지/재개
├── js/chart.js           canvas 가격과 자산 차트, 마커, 국면 띠
├── js/ui.js              DOM 렌더(카드, 순위표, 인스펙터, 모달), 이벤트 바인딩
├── js/storage.js         Hall of Fame(localStorage 'dp.hall.v1', try/catch), setup 저장, export/import
├── js/main.js            부팅: polli-connect 연동(§7.3), 모델 목록 로드, URL 파라미터 복원
├── replays/featured.json  (선택) 실제 라이브 경기 기록
├── replays/featured.js    (선택) 같은 내용 window.DP_FEATURED
├── tests/run-node.js     node --test 진입점: vm 컨텍스트에 js/*.js(네트워크 제외)를 로드
├── tests/engine.test.js  시드 결정성, 체결/수수료, 사이징, 탈락, 순위, 폴백 HOLD, normalizeAnswer 경계값
├── tests/pollinations.test.js  fetch 목으로 200/400→단일문항/401/402/403/429/타임아웃 분기
├── docs/screenshot.png   1600×900 PNG(<5MB), 경기 중 화면(차트+카드+확률막대)
├── README.md
└── LICENSE               MIT
```

`index.html` 스크립트 순서:
```html
<script src="js/config.js"></script>
<script src="js/pollinations.js"></script>   <!-- 봇이 먼저 찾도록 config 바로 다음 -->
<script src="js/rng.js"></script>
<script src="js/market.js"></script>
<script src="js/portfolio.js"></script>
<script src="js/prompt.js"></script>
<script src="js/decide.js"></script>
<script src="js/sim-players.js"></script>
<script src="js/interventions.js"></script>
<script src="js/engine.js"></script>
<script src="js/chart.js"></script>
<script src="js/ui.js"></script>
<script src="js/storage.js"></script>
<script src="replays/featured.js" onerror="void 0"></script>
<script src="js/main.js"></script>
```
`index.html` 푸터에 다음 문구를 **보이는 텍스트로** 넣습니다.
"Uses Pollinations: POST https://gen.pollinations.ai/alpha/decisions (decision models) · GET https://gen.pollinations.ai/v1/models (model list) · Sign-in via Pollinations Connect (BYOP)." 그 옆에 배지 HTML(양식에 있는 원문)을 둡니다.

### 9.1 구현 우선순위
- **P0(제출 필수)**: config, pollinations, rng, market, portfolio, prompt, decide, sim-players, engine, chart, ui, main, 개입 3종, 응원, 순위와 수상, 인스펙터, 비용 표시, 오프라인, BYOP, README, 스크린샷, 테스트
- **P1**: Hall of Fame, Export/Replay, featured 녹화 경기, 공유 링크
- **P2(선택)**: 한국어 UI 토글(`js/i18n.js`), 결과 카드 PNG 저장, 텍스트 모델 플레이어(§13)

### 9.2 구현자 수동 검증 목록 (제출 전)
1. `file://`로 index.html을 열었을 때 Offline 30턴 경기가 끝까지 진행되고 콘솔 오류가 없는지
2. `python3 -m http.server 8080`에서 localhost 연결 → 체크인 → D3와 Microsoft-Decision-1로 30턴 라이브 경기가 끝나는지(Quest Pollen 계정으로도 확인)
3. 인스펙터 요청/응답이 실제 호출이고(응답 `id`가 `dec-…`), Spent 합계가 enter 대시보드 사용량과 대략 맞는지
4. 경기 도중 대시보드에서 키를 회수했을 때 401 일시정지 배너가 뜨는지
5. 같은 시드로 Rematch했을 때 가격 경로가 똑같은지
6. 폭 375px에서 레이아웃이 깨지지 않는지
7. GitHub Pages URL에서 2~4를 반복

---

## 10. 제출 체크리스트

### 10.1 저장소와 README
- [ ] 공개 GitHub 저장소, MIT LICENSE, GitHub Pages 배포
- [ ] README **첫 줄 근처**에 배지를 넣습니다(코드블록이나 주석 밖, 그대로 보이게).
  `[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)`
- [ ] README 섹션:
  1. 한 줄 소개와 Live 링크
  2. How to play(3단계)
  3. Modes(Live / Offline / Replay)
  4. **Pollinations endpoints used**(정확한 URL 2개와 요청 예시 1개)
  5. Players: decision models discovered from `/v1/models` at runtime(하드코딩 아님), Free/Quest/Paid 구분
  6. Cost(호출 수 공식과 추정치, 실제 usage 표시)
  7. BYOP & privacy(sessionStorage, 키를 저장하지 않음, D3 로깅 고지)
  8. Scoring rules(사이징 공식, Brier, 서바이벌)
  9. Interventions
  10. Disclaimer(가상 시장, 투자 조언 아님, 실존 종목 아님)
  11. Run locally / Tests(`node --test tests/`)
  12. Project structure
  13. Built for quest #19176
- [ ] `docs/screenshot.png`(16:9 PNG, 5MB 이하, 확률 막대와 차트가 보이는 경기 중 화면, 상단 중심 구도)
- [ ] `js/config.js`의 `APP_KEY`를 실제 `pk_`로 바꿈(placeholder로 제출 금지). Redirect URI 3개 등록
- [ ] (권장) `replays/featured.json` 실제 경기 기록

### 10.2 앱 제출 양식 칸별 입력값 초안
| 칸 | 값 |
|---|---|
| App Name | `Decision Pit` |
| App Description (≤200자) | `Decision models (Jev, D3, Microsoft-Decision-1, Kev...) trade one seeded fake market via Pollinations /alpha/decisions. Cheer, whisper or shock the market. BYOP + free offline mode.` (181자, 길이 확인함) |
| App URL | `https://<user>.github.io/decision-pit/` |
| GitHub Repository URL | `https://github.com/<user>/decision-pit` |
| Screenshot | `docs/screenshot.png`를 양식에 업로드(또는 `https://raw.githubusercontent.com/<user>/decision-pit/main/docs/screenshot.png`) |
| App Category | `games` |
| Platform | `web` |
| App Language | `en` |
| Discord Username | (사용자 선택) |
| Quest | `#19176` |

- 제출 전에 열린 APP-SUBMISSION 이슈에 같은 URL이나 이름이 없는지 확인합니다(중복 검사가 걸림).
- 제출 뒤에는 봇 판정(ready/needs_info)을 확인하고, needs_info면 질문에 바로 답합니다.

---

## 11. 차별화 요소 (3개) — 우승 확률을 높이는 장치

1. **확률이 곧 게임 규칙이다.** 결정 모델의 고유한 출력인 *보정된 확률*을 장식이 아니라 승패 요소로 씁니다. 확신이 매매 크기를 정하고(§2.3), 다음 턴 방향 예측은 Brier 점수로 따로 채점합니다(🎯 상). argmax만 쓰는 경쟁작과 달리 "확신만 높고 틀리는 모델은 돈을 잃는다"는 점이 화면에서 바로 보입니다. Opper 벤치마크류의 "decision model 비교"를 게임으로 만든 셈입니다.
2. **관중 개입이 곧 실험이다.** 같은 시드의 같은 시장(공정성)에서 가짜 루머, 시장 충격, 귓속말 카드로 관중이 끼어들고, **흔들림 지수**와 **루머 반응률**로 "누가 소문에 속고 누가 귓속말에 넘어가는지"를 잽니다. Random Monkey와 Buy & Hold 기준선 덕분에 "AI가 원숭이를 이겼나"도 한눈에 보입니다. Rematch same seed로 개입 없는 경기와 비교할 수 있습니다.
3. **누구나 진짜로 하고, 누구나 검증할 수 있다.** 플레이어를 `/v1/models`에서 자동으로 찾고 인증 목록으로 거릅니다. 그래서 Quest Pollen만 있는 사용자도 D3(무료)와 Microsoft-Decision-1로 **실제 모델 경기**를 할 수 있습니다(Jev는 Paid 전용이라 Jev만 쓰는 앱은 상당수 사용자에게 실패합니다). 체크인으로 호환성을 확인하고, 인스펙터에서 실제 요청/응답/토큰/Pollen을 보여주며, 녹화 경기 리플레이를 동봉합니다. 오프라인 봇은 "Sim"으로 정직하게 표시합니다. 문서 계약(`state`/`questions`, pinned `@pollinations/ui` connect, App Key)을 정확히 따른 것이 경쟁작 대비 실질적인 신뢰 우위입니다.

---

## 12. 위험 요소

| # | 위험 | 영향 | 대응 |
|---|---|---|---|
| 1 | **경쟁작이 이미 "Ready for human review"** 상태. 메인테이너가 먼저 승인하면 퀘스트가 닫힘 | 치명 | P0만으로 최대한 빨리 제출. P1/P2는 제출 뒤 업데이트 |
| 2 | 모델별 질문 지원 범위 미확인(2문항, choice 2~3개) | 중 | 체크인 + 400 시 단일문항 자동 강등(§4.7, §4.8) |
| 3 | `/alpha/` 경로라 스키마가 바뀔 수 있음 | 중 | 방어적 파싱, 실패 시 HOLD, 인스펙터로 원인 노출 |
| 4 | Jev는 Paid 전용이라 "Jev 게임"을 기대한 사용자가 Jev를 못 쓸 수 있음 | 중 | 배지로 Paid/Free 명시, 무료 모델로도 경기 성립 |
| 5 | Redirect URI 불일치(끝 슬래시, index.html) | 높음(연결 불가) | URI 3개 등록, README에 절차 기재 |
| 6 | `@pollinations/ui`가 alpha라 동작이 바뀔 수 있음 | 중 | 정확한 버전 고정, 8초 타임아웃 후 오프라인 안내 |
| 7 | 응답 지연이나 429로 진행이 느려짐 | 낮음~중 | 병렬 호출, 턴 마감 60초, rpm 기반 간격 |
| 8 | 금융 콘텐츠로 오해받을 수 있음(스캠/조언) | 중 | 가상 종목과 가상 크레딧, 고지 문구를 화면·README·state에 반복, 실존 종목명 금지 |
| 9 | 심사자가 연결하지 않고 오프라인만 봄 | 중 | 녹화된 실제 경기 리플레이 동봉, 스크린샷에 라이브 화면 사용 |
| 10 | 문항당 과금이나 최소 과금이 예상보다 큼 | 낮음 | 실제 usage 기반 표시, 경기 상한 0.05, 키 예산 1 |
| 11 | 추천 버전 지정, 하드코딩 데이터를 메인테이너가 싫어함(리뷰 규칙) | 낮음 | 모델 목록과 단가는 런타임 조회, 정적 폴백 없음 |

---

## 13. (선택, P2) 텍스트 모델 플레이어
퀘스트가 텍스트 모델도 언급하므로 "Wildcard" 1자리를 둘 수 있습니다. `POST https://gen.pollinations.ai/v1/chat/completions`에 state와 "Reply with JSON {\"action\":\"buy|sell|hold\",\"confidence\":0-1,\"p_up\":0-1}"을 보내 파싱합니다. 저가 모델(예: `openai/gpt-5.4-nano`, 목록에서 선택)을 씁니다. **이 경로는 이번 조사에서 검증하지 않았으므로 MVP에서 제외합니다.** 넣을 경우 `models="decision,text"`로 바꾸고, Sim처럼 별도 태그("Text LLM")를 붙여 결정 모델과 구분합니다.

---

## 14. 미확인 항목 목록

1. **`gen.pollinations.ai` 실시간 응답 전부**: `/v1/models`의 현재 목록, health, 가용성과 `/alpha/decisions` 실제 호출은 이 환경에서 접속할 수 없었습니다. 레지스트리 소스(2026-11-07 main)로만 확인했습니다.
2. Microsoft-Decision-1, Kev 4B, Decider, d1, Jev가 **한 요청에 질문 2개**와 3옵션 choice를 받는지(D3는 2~255개, 64문항까지 소스로 확인)
3. 질문이 여러 개일 때 입력 토큰을 문항마다 다시 세는지, 그리고 최소 과금 단위가 있는지
4. 결정 모델별 응답 지연시간
5. `<polli-connect>`의 `budget`에 소수나 작은 값(예: 1)을 넣었을 때 서버가 받아들이는지, `expiry="1"` 동작(문서 기본값은 5와 7)
6. Quest Pollen 전용 사용자의 인증 `/v1/models`에 Microsoft-Decision-1이 실제로 보이는지(레지스트리 `paidOnly:false`로 미루어 본 추론)
7. 이슈 #18922 원문(이 환경의 허용 목록 밖이라 열지 못함). 대신 사전심사 프롬프트 원문(`review-prompt.txt`)으로 확인했습니다.
8. 경쟁작 Battle Drones의 **배포된 페이지** 동작(저장소 main 소스만 읽음)
9. Opper decision benchmarks와 Simon Willison Battle Drones 원문(참고 자료라서 읽지 않음)
10. 퀘스트 우승작 선정 기준의 세부 내용(본문에는 "best one is approved"만 있음)

---

## 15. 출처

- 퀘스트 #19176: https://github.com/pollinations/pollinations/issues/19176
- Jev 퀘스트 #15722: https://github.com/pollinations/pollinations/issues/15722
- 경쟁작 제출 #19288: https://github.com/pollinations/pollinations/issues/19288 · 저장소 https://github.com/Brutus88Ai/polli-decision-arena
- API 문서: https://github.com/pollinations/pollinations/blob/main/APIDOCS.md (raw로 읽음, "Typed decisions", "/alpha/decisions", "Models", "Error Responses", "Authentication")
- BYOP 문서: https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md
- 제출 양식: https://github.com/pollinations/pollinations/blob/main/.github/ISSUE_TEMPLATE/app-submission.yml
- 사전심사 워크플로: https://github.com/pollinations/pollinations/blob/main/.github/workflows/apps-review-submissions.yml
- 사전심사 프롬프트와 검증: `operations/app-management/ingestion/review-prompt.txt`, `submission.js`, `validate-submission.js`, `screenshot.js` (같은 저장소 main)
- 결정 스키마와 프록시: `shared/schemas/decisions.ts`, `gen.pollinations.ai/src/text/systemOneClient.ts`, `gen.pollinations.ai/src/text/decisions/handler.ts`
- 모델 레지스트리: `shared/registry/text.ts`, `shared/registry/model-info.ts`, `shared/registry/usage-headers.ts`
- 속도 제한: `gen.pollinations.ai/wrangler.toml`, `shared/rate-limit.ts`
- Connect 컴포넌트: `packages/ui/src/browser/connect.tsx`, `connect-options.ts`, `packages/sdk/src/react/PolliProvider.tsx`, npm `@pollinations/ui`(dist-tags alpha=0.1.0-alpha.31)
- 카탈로그 지표: `operations/app-management/app.json`, `operations/app-management/performance/update-metrics.js`
- 리뷰 기준(참고): `.claude/skills/quest-solution-review/SKILL.md`, `.claude/skills/quest-contributor/SKILL.md`
- 참고 승인작: https://github.com/patbing/trolley-match , https://github.com/tomdacatto/pollinations-jev-assembler
