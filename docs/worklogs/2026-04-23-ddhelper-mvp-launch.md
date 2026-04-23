# 2026-04-23 · DDhelper MVP 첫 런치

> **최초 워크로그**. 이 문서만 읽어도 다음 세션에서 컨텍스트를 완전히 복구할 수 있도록 작성.

---

## 1. 프로젝트 개요

### 무엇을 만들고 있나
**DDhelper** (Design Discrepancy Helper) — 왓챠 프로덕트 디자인팀의 **디자인 QA 자동화 도구**.

피그마 시안과 스테이징에 배포된 웹/앱을 비교해서 **아이콘 컬러, 크기, 간격, 컴포넌트 불일치, 디자인 시스템 위반**을 AI가 자동으로 찾아준다. 원래 디자이너가 일일이 수동으로 체크하던 작업을 1차 필터링해주는 도구.

### 왜 만드나
- **문제**: 디자이너가 스테이징 서버 배포 후 시안과 구현물을 하나씩 비교해 수정 요청해야 하는 번거로움
- **타겟 사용자**: 왓챠 프로덕트 디자인팀 (만든 사람도 해당 팀 소속)
- **데모 목적**: 90분 내 MVP 배포 후 팀 데모

### 배포된 프로덕트
- **URL**: https://ddhelper-two.vercel.app (고정 alias)
- **GitHub**: https://github.com/ken-watcha/ddhelper
- **Vercel 프로젝트**: `ken-5665s-projects/ddhelper`

---

## 2. 아키텍처 요약

### 전체 흐름
```
┌─────────────────────────────────────────────────┐
│  1. Figma URL 입력                               │
│     → Figma REST API로 node JSON + 이미지 URL    │
│     → AI가 JSON에서 디자인 토큰 추출              │
├─────────────────────────────────────────────────┤
│  2. 구현물 입력 (3가지 중 택1)                    │
│     - Web URL  → HTML 크롤링 후 AI 분석          │
│     - iOS 코드 → SwiftUI 코드를 AI 분석          │
│     - Android  → Compose 코드를 AI 분석          │
├─────────────────────────────────────────────────┤
│  3. 비교하기                                      │
│     → AI가 두 토큰 리스트를 의미 기반으로 매칭     │
│     → 불일치 심각도(critical/warning) 분류        │
│     → 2가지 뷰 제공: 시각적 오버레이 / 표         │
└─────────────────────────────────────────────────┘
```

### 핵심 설계 결정: "AI를 파서로 쓴다"
복잡한 Figma JSON 파서, HTML/CSS 파서, Swift 파서, Kotlin 파서를 각각 만드는 대신 **AI에게 "이 데이터에서 디자인 토큰 뽑아줘"라고 요청**. 이게 이 프로젝트의 핵심 생산성 트릭이다. 수주일의 파서 개발을 며칠 작업으로 압축.

**단점**: 할당량/비용/속도 이슈가 모든 기능의 병목이다. 대부분의 디버깅 시간도 여기서 소요됐다.

### 기술 스택
- **프레임워크**: Next.js 16 (App Router, Turbopack)
- **스타일**: Tailwind CSS 4 (최신 `@theme` 문법)
- **폰트**: Pretendard Variable (CDN)
- **AI**: Groq (Llama 3.3 70B 주 모델) — 전환 경로 참고
- **외부 API**: Figma REST API
- **배포**: Vercel (Hobby)
- **타입**: TypeScript strict

### 디자인 시스템 (왓챠 브랜딩)
- **브랜드 컬러**: `#FF0558` (왓챠 핑크) — 모든 CTA, 포커스, 액센트
- **다크 테마 기본**: `#000000` bg, `#141414` surface 1, `#1C1C1C` surface 2
- **보더**: `rgba(255,255,255,0.06)` (매우 미묘)
- **텍스트**: white / neutral-400 / neutral-500 / neutral-600 계층
- **폰트**: Pretendard Variable
- **타이포 스타일**: `font-black` (900), `tracking-tight`
- **로고**: `/public/watcha-logo.svg` (실제 왓챠 SVG 로고, pink W 아이콘)
- **컴포넌트 룩**:
  - Chip: pill (rounded-full), active 시 흰 배경 + 검은 텍스트 (왓챠 앱과 동일)
  - CTA 버튼: 핑크 배경 + `shadow-lg shadow-[#FF0558]/20`
  - 카드: `rounded-2xl` + 매우 미묘한 보더
  - Input/Textarea: `bg-[#1C1C1C]` + focus 시 핑크 ring

### 파일 구조
```
src/
├── app/
│   ├── page.tsx               # 메인 대시보드 (3단계 오케스트레이션)
│   ├── layout.tsx             # 루트 레이아웃 (Pretendard, ko, dark)
│   ├── globals.css            # Watcha 컬러 토큰, Pretendard 로드
│   ├── icon.svg               # favicon (왓챠 로고)
│   └── api/
│       ├── figma/route.ts     # Figma 노드 JSON + 이미지 + 토큰 추출
│       ├── extract-web/route.ts  # 웹 HTML → 토큰
│       ├── extract-code/route.ts # iOS/Android 코드 → 토큰
│       └── compare/route.ts   # 두 토큰 리스트 비교 → 결과
├── components/
│   ├── FigmaInput.tsx         # Step 1: 피그마 URL 입력
│   ├── ImplInput.tsx          # Step 2: 웹/iOS/Android 탭 입력
│   ├── TokenPreview.tsx       # 추출된 토큰 접기/펼치기 리스트
│   ├── ComparisonTable.tsx    # 결과 표 뷰 (상태 뱃지 + 색상 스와치)
│   └── VisualCompare.tsx      # 결과 시각적 뷰 (이미지 + 마커 오버레이)
├── lib/
│   ├── claude.ts              # AI 클라이언트 (Groq SDK) + JSON 파서
│   ├── figma.ts               # Figma API 호출 + 토큰/이미지/bbox 추출
│   ├── web-extractor.ts       # HTML fetch + compact + AI 토큰 추출
│   ├── code-extractor.ts      # Swift/Kotlin 프롬프트 + AI 호출
│   ├── compare.ts             # 비교 AI 호출 + bbox 병합
│   ├── fetcher.ts             # 프론트엔드용 안전한 postJson 래퍼
│   └── types.ts               # DesignToken, ComparisonResult, BoundingBox
└── public/
    └── watcha-logo.svg        # 왓챠 공식 로고
```

---

## 3. 주요 시간순 진행 내역

### Phase A: 요구사항 수렴 (계획 모드)
사용자가 90분 MVP + 데모 목표를 설정. 질문 반복을 통해 스콥 확정:

- **비교 방식**: 스크린샷 픽셀 비교 vs 코드 속성 비교 → **코드/데이터 속성 비교** 선택 (앱도 커버 가능해서)
- **결과 형태**: **웹 대시보드**
- **스택**: **Next.js**
- **앱 입력**: 사용자가 SwiftUI/Compose 코드를 **직접 붙여넣기**
- **웹 입력**: URL 넣으면 자동 크롤링

### Phase B: MVP 구현
- `create-next-app`으로 TypeScript + Tailwind 초기화
- `@anthropic-ai/sdk`로 Claude API 연결 (이게 원래 계획이었음)
- 파일 구조 생성 (위 섹션 참고)
- 각 API 라우트에 `maxDuration = 60` 설정 (Hobby 기본 10초는 AI 응답에 부족)
- 빌드 + 로컬 테스트 + Vercel 배포 (`vercel deploy --prod --yes`)

### Phase C: 무료 AI로 전환 (첫 번째)
사용자가 "Claude API는 유료인데 무료 대안 없나?" 질문 → **Gemini API**로 전환.

- `@google/generative-ai` 설치
- `src/lib/claude.ts`를 Gemini로 재작성 (파일명은 안 바꾸고 내용만 교체)
- 환경변수 `ANTHROPIC_API_KEY` → `GEMINI_API_KEY`

### Phase D: Gemini 모델 삽질 루프
Gemini로 전환 후 연쇄적 에러:
1. `gemini-2.0-flash` → "limit: 0" 이슈 (404 유사)
2. `gemini-1.5-flash`로 변경 → 404 (모델명이 구식)
3. 실제 모델 목록 조회 (`curl` + `/v1beta/models`) → `gemini-2.5-flash` 사용
4. 503 과부하 에러 → 재시도 + 모델 폴백 로직 추가
5. JSON 파싱 실패 → `responseMimeType: "application/json"` + `repairTruncatedArray` 함수 구현
6. 속도 느림 → `gemini-2.5-flash-lite` 우선, JSON 입력 40K로 축소, 프롬프트 "최대 40개 토큰, 간결하게"
7. 최종 429 할당량 초과 (무료 티어 일일 소진)

### Phase E: 시각적 비교 뷰 추가
사용자 요청: "단순 텍스트 나열 말고 화면에 마커로 표시해줘"

- `types.ts`에 `BoundingBox`, `FigmaFrameInfo` 타입 추가
- `figma.ts`에 `fetchFigmaImage()` (Figma `/v1/images` 엔드포인트), `collectNodes()` (재귀적 노드 순회 → bbox 수집), `getFrameInfo()` 추가
- 프롬프트 수정: 각 토큰에 `nodeId` 포함 요구
- `compare.ts`: AI 응답에 nodeId가 있으면 디자인 토큰에서 bbox 복원
- 새 컴포넌트 `VisualCompare.tsx`: Figma 이미지 + 절대 위치 박스 오버레이 + 번호 배지 + hover/click 연동
- 메인 페이지에 `[화면] [표]` 토글 추가

### Phase F: 왓챠 디자인 시스템 정식 반영
사용자가 왓챠 로고 파일 공유 + "제대로 디자인 시스템 따라줘".

- `WATCHA_icon_Square.svg` → `public/watcha-logo.svg` + `src/app/icon.svg` (favicon)
- **실제 브랜드 컬러 `#FF0558` 확인** (이전에 임의로 쓴 퍼플 `#9B59F6` 폐기)
- `globals.css` 완전 재작성: 왓챠 컬러 토큰 + Pretendard Variable 로드 + 선택 컬러 등
- `page.tsx`, `FigmaInput.tsx`, `ImplInput.tsx`, `ComparisonTable.tsx`, `TokenPreview.tsx`, `VisualCompare.tsx` 모두 `#FF0558` 톤으로 통일
- Hero 섹션에 왓챠 핑크 blur 그라디언트 + "AI DESIGN QA" 배지 추가
- 헤더/푸터에 실제 왓챠 로고 표시
- Pill-shaped 뷰 토글 (왓챠 앱의 "전체/영화/시리즈" 칩 스타일 모방)

### Phase G: 에러 UX 개선
사용자가 "비교할 때 Unexpected token 'A' 에러 자주 나네" 보고.

원인: 서버리스 함수 타임아웃 시 Vercel이 HTML 에러 페이지 반환 → 프론트엔드는 JSON으로 파싱 시도 → `JSON.parse()` 실패.

대응:
- `src/lib/fetcher.ts` 생성: `postJson()` 래퍼가 content-type 체크, 504/5XX 상황별 한국어 메시지
- `page.tsx`, `FigmaInput.tsx`, `ImplInput.tsx`의 raw fetch 호출을 `postJson()`으로 통일
- AI 호출에 20초 타임아웃 race 추가 (무한 대기 방지)

### Phase H: Groq로 전환 (두 번째)
Gemini 일일 할당량 완전 소진. 사용자 요청으로 **Groq**로 전환.

- `groq-sdk` 설치
- `src/lib/claude.ts` 재작성 (Groq API, OpenAI 호환 chat completions)
- 모델 체인: `llama-3.3-70b-versatile` → `llama-3.1-8b-instant` → `gemma2-9b-it`
- 환경변수 `GEMINI_API_KEY` → `GROQ_API_KEY`
- `toKoreanError()` 함수 추가: 영문 에러를 사용자 친화적 한국어로 변환 (429 할당량/401 인증/503 과부하/504 타임아웃 등)

### Phase I: GitHub 커밋 + 원격 저장소 생성
- `git add -A` + `git commit -m "feat: DDhelper MVP..."`
- `brew install gh` → `gh auth login` (사용자가 디바이스 코드로 인증)
- `gh repo create ddhelper --public --source=. --remote=origin --push` → 푸시 완료

### Phase J: Vercel ↔ GitHub 자동 배포 연결 (미완)
- `vercel git connect https://github.com/ken-watcha/ddhelper`
- 실패: "Failed to link ken-watcha/ddhelper. You need to add a Login Connection to your GitHub account first"
- **사용자가 Vercel 대시보드에서 직접 GitHub Login Connection 설정 필요**
- 설정 후 다시 `vercel git connect` 실행하면 완료

---

## 4. 현재 상태 스냅샷

### 동작하는 기능
- ✅ 피그마 URL로 디자인 토큰 추출 (bbox 포함)
- ✅ 피그마 렌더링 이미지 가져오기
- ✅ 웹 URL HTML fetch + 토큰 추출
- ✅ iOS (SwiftUI) 코드 붙여넣기 → 토큰 추출
- ✅ Android (Compose) 코드 붙여넣기 → 토큰 추출
- ✅ AI 의미 기반 비교 + severity 분류
- ✅ **시각적 뷰**: Figma 이미지 + 마커 오버레이 + 이슈 리스트 연동
- ✅ **표 뷰**: 컬러 스와치 포함 상세 테이블
- ✅ 한국어 에러 메시지
- ✅ Vercel 프로덕션 배포

### 환경변수 (로컬 `.env.local` + Vercel production)
```
GROQ_API_KEY=gsk_...       # Groq (AI 분석)
FIGMA_ACCESS_TOKEN=figd_... # 피그마 REST API
```

⚠️ **보안**: `.env.local`은 `.gitignore`에 포함 → GitHub에 노출 안 됨. 새 세션에서는 Vercel 대시보드의 환경변수를 확인하거나 `vercel env pull` 사용.

### 미해결 / 중단된 작업
1. **Vercel ↔ GitHub 자동 배포 연결** — 사용자가 Vercel 대시보드에서 GitHub Login Connection 추가해야 완료 가능
2. **구현물 시각적 비교** — 현재는 Figma 이미지 위에만 마커. 웹/앱 스크린샷 비교 옵션은 아직 없음
3. **저장/히스토리 기능** — 없음. 매번 처음부터 입력
4. **인증** — 없음. 공개 URL 누구나 접근

---

## 5. 주요 기술 결정과 트레이드오프

### AI = 파서
- **결정**: 모든 파싱을 AI에 위임 (Figma JSON / HTML / SwiftUI / Kotlin / 비교 매칭)
- **이득**: 수주 → 수시간
- **손해**: 할당량/속도/비용 이슈가 핵심 병목. 언어별 정확한 파서 대비 정밀도 다소 떨어짐

### Puppeteer 대신 단순 `fetch`
- Vercel 서버리스에서 Chromium 부팅 어려움 + 번들 크기 이슈
- `fetch(url)` → HTML만 받아서 inline/embedded styles를 AI로 분석
- **제약**: 외부 CSS 파일이나 JS 렌더링 콘텐츠는 놓침
- **완화**: HTML에서 `<script>`, 주석, 긴 SVG path 제거하는 `compactHtml()` 전처리

### 클라이언트 무상태
- DB 없음. 각 단계의 토큰/결과를 React state로만 보유
- 이유: MVP 시간 절약 + 데모 목적
- 결과: 새로고침 시 다시 입력해야 함

### Groq vs Gemini
- Gemini 무료 티어는 모델별 할당량이 너무 빡빡하고 모델 이름도 자주 바뀜 (1.5-flash 404 경험)
- Groq 무료 티어는 14,400 req/day + 분당 30회 + Llama 3.3 70B 같은 큰 모델 포함
- 속도도 Groq가 2-3배 빠름 (평균 0.5-1초 vs Gemini 2-5초)

---

## 6. 시행착오와 배운 것들

### 1) 쉬운 게 어려운 것: Gemini JSON 파싱
`responseMimeType: "application/json"`을 설정해도 **응답이 `max_output_tokens` 한계로 잘리면** JSON이 유효하지 않음. `max_output_tokens`를 키우는 것도 응답 시간을 늘려 타임아웃 위험을 키운다.

**해결책**: `repairTruncatedArray()` 함수로 **마지막 완전한 객체까지만 추출**해 파싱. `parseJsonFromResponse()`는 4단계 복구를 시도 (직접 → 마크다운 → 배열 복구 → 객체 복구).

### 2) 503 무한 반복
모델이 과부하일 때 503을 받으면 재시도를 너무 많이 하면 총 대기 시간이 기하급수적으로 늘어남. 결과: Vercel 60초 타임아웃 초과 → 504 → 프론트 "An error occurred..." HTML 파싱 실패.

**해결책**:
- 모델별 재시도 최대 2회, 재시도 간격 0.5초
- AI 호출 자체에 20초 타임아웃 race
- 초과 시 바로 다음 모델로 폴백 (5개 → 체인 순회)

### 3) 에러 메시지가 영어로 그대로 노출
Groq/Gemini 에러는 영어로 "You exceeded your current quota...". 디자이너 사용자에게 이건 무의미함.

**해결책**: `claude.ts`의 `toKoreanError()` 함수가 메시지 패턴을 검사해 한국어로 변환. 프론트엔드의 `fetcher.ts`도 HTTP 상태별 한국어 메시지.

### 4) 큰 피그마 프레임 = 큰 JSON = 느린 응답 = 잘린 출력
Figma API가 돌려주는 노드 JSON은 벡터 패스, 효과, 트랜지션 등 디자인 토큰 추출에 불필요한 필드가 80% 이상.

**해결책**: `trimFigmaJson()`이 `EXCLUDE_KEYS` 세트로 `fillGeometry`, `vectorPaths`, `exportSettings`, `effects`, `blendMode` 등 제거. 입력이 100K → 40K로 축소.

### 5) 잘못된 브랜드 컬러
왓챠 앱 스크린샷을 눈으로 보고 "CTA 버튼이 핑크니까 #EB4457쯤이겠네" 추측으로 시작했는데, 사용자가 **공식 로고 SVG**를 주니 실제 브랜드 컬러는 `#FF0558`이었음.

**교훈**: 디자인 시스템은 무조건 **공식 에셋에서 토큰 추출**. 이 도구 자체의 존재 이유이기도 함.

---

## 7. 다음 세션에서 이어갈 수 있는 일감

### 시급도 높음
1. **Vercel ↔ GitHub 자동 배포 완결**
   - 사용자가 https://vercel.com/account/login-connections 에서 GitHub 연결
   - 그 후 `vercel git connect https://github.com/ken-watcha/ddhelper` 실행
   - main push 시 자동 프로덕션, 기타 브랜치는 preview 배포

2. **실제 데모 피드백 반영**
   - 팀 데모 후 나온 피드백은 아직 없음 (데모 전 단계)
   - 가장 먼저 들어올 요청: 정확도, 속도, UI 개선 등

### 기능 확장
3. **구현물 이미지도 이미지 비교**
   - 현재 Figma 이미지 위에만 마커
   - 웹은 스크린샷 API (microlink.io 등 무료) 사용 고려
   - 앱은 사용자가 스크린샷 업로드
   - 좌/우 side-by-side 뷰 추가

4. **비교 결과 공유/저장**
   - 현재는 페이지 상태만 유지. 새로고침 시 소실
   - URL에 hash로 직렬화 or 서버 저장 (Vercel KV 활용)
   - 슬랙 공유용 이미지 생성

5. **피드백/수정 요청 자동 생성**
   - 개발자에게 전달할 이슈 리스트를 Markdown/GitHub Issue 형식으로 자동 생성
   - "이 버튼의 색을 #FF0558에서 #EB4457로 바꿔야 함" 같은 문장

6. **Figma 플러그인으로**
   - 지금은 웹 대시보드에서 URL 붙여넣기
   - Figma 플러그인 형태로 만들면 디자이너가 현재 선택한 프레임 바로 비교 가능

### 기술 부채
7. **`src/lib/claude.ts` 파일명 교체**
   - 이름은 `claude.ts`인데 실제로는 Groq Llama 호출 중 → `ai.ts` 또는 `llm.ts`로 리네임
   - 지금 당장 리스크는 없지만 혼동 유발

8. **타입 안정성**
   - AI가 반환한 JSON이 `DesignToken[]` 형태인지 런타임 검증 없음 (zod 등 도입 여지)
   - 현재는 `parseJsonFromResponse<T>()`가 그냥 캐스팅만 함

9. **테스트 0**
   - 전체 프로젝트에 테스트 없음
   - 프롬프트 변경 시 회귀 감지 어려움

### 데모/프로덕션 리스크
10. **인증 없음 + 공개 URL**
    - 누구나 `https://ddhelper-two.vercel.app` 접근 가능
    - 왓챠 내부 피그마 토큰이 서버에서 사용되므로 **남용 시 할당량 소진** 위험
    - 간단한 비밀번호나 Vercel Password Protection 활성화 고려

---

## 8. 세션 상호작용 패턴 (이어 작업 시 참고)

- **언어**: 사용자와 AI 모두 **한국어로 소통**. 코드 주석도 한국어 OK.
- **설명 수준**: 사용자는 **비개발자 디자이너**. 기술 용어는 항상 쉽게 풀어서 설명할 것. 선택지 제공 시 각 옵션을 무엇/왜/단점 세 줄로 설명.
- **의사결정 방식**: AskUserQuestion 도구로 2-3개 옵션 제공 → 추천 하나 표시 → 사용자가 선택
- **배포 방식**: 기능 추가/수정 후 대부분 즉시 `vercel deploy --prod --yes`로 프로덕션 반영 (사용자가 데모 전이라 빠른 피드백 루프가 우선)
- **에러 보고**: 사용자가 브라우저에서 본 에러 메시지를 그대로 복붙. 그대로 Vercel 로그 안 보고 디버깅 가능했음.
- **디자인 피드백**: 사용자가 이미지(스크린샷)를 주는 경우 많음. Watcha 앱 실제 스크린샷을 여러 장 주면서 디자인 시스템 파악 요청함.

---

## 9. 환경/실행 참조 정보

### 로컬 개발
```bash
npm run dev      # http://localhost:3000
npm run build    # 프로덕션 빌드 확인
```

### 배포
```bash
vercel deploy --prod --yes   # 프로덕션 배포
vercel env ls                # 환경변수 확인
```

### 테스트 URL (실제 기능 검증 시)
- Figma URL: 사용자의 왓챠 컴포넌트 파일 (file key: `qu4ffs0i9bj7XfRzU79fGW`), 파운데이션 파일 (`prUnvbABE5TM5lMRnd3gKr`)
- 스테이징 URL: https://watcha.com/tv/home (실제 프로덕션이지만 웹 테스트용으로 활용)

### 주요 파일 빠른 참조
- `src/lib/claude.ts` — AI 호출 허브 (Groq), 모델 체인, 에러 한국어 변환
- `src/lib/figma.ts` — Figma API + JSON 축소 + 이미지 + bbox 추출
- `src/app/page.tsx` — 메인 대시보드 (Step 1/2/3 오케스트레이션 + view mode toggle)
- `src/components/VisualCompare.tsx` — 이미지 위 마커 오버레이의 핵심 로직 (scale 계산, 절대 좌표 변환)

### Git / 배포 인프라
- **원격**: https://github.com/ken-watcha/ddhelper (main 브랜치)
- **Vercel**: `ken-5665s-projects/ddhelper` 프로젝트. 자동 배포 링크는 **미설정** (Phase J 미완)
- **로컬 경로**: `/Users/ken/Projects/DDhelper`
- **계획 파일**: `~/.claude/plans/hidden-mapping-snowflake.md` (초기 MVP 설계 플랜)

---

## 10. 메모리에 저장된 관련 정보

`~/.claude/projects/-Users-ken-Projects-DDhelper/memory/` 폴더의 메모리들:
- `user_role.md` — 사용자는 왓챠 프로덕트 디자이너 (비개발자)
- `user_preferences.md` — 한국어, 비개발자 눈높이 설명
- `project_ddhelper.md` — 프로젝트 개요 (이 워크로그에 포함된 내용의 요약본)

다음 세션 시작 시 `MEMORY.md`가 자동 로드되므로 저 파일들은 이미 컨텍스트에 있음.

---

**End of log.**
