# 2026-04-28 · 확장 기반 캡처 + 비교 정확도 대수술

> **2번째 워크로그**. 첫 워크로그(`2026-04-23-ddhelper-mvp-launch.md`)에서 MVP를 런칭한 후 약 5일간 33개 커밋이 누적된 대규모 개편 기록. 다음 세션에서 이 문서만 읽어도 컨텍스트를 완전히 복구할 수 있도록 작성.

---

## 0. 들어가기 전에 — 큰 변화 한눈에 보기

| 영역 | MVP (2026-04-23) | 현재 (2026-04-28) |
|---|---|---|
| **타겟 플랫폼** | Web + iOS + Android 3종 | **Web 전용** (iOS/Android 탭 삭제) |
| **Figma 입력** | 단일 프레임 URL | **페이지 URL 가능** — 여러 시안 자동 추출, SECTION별 그룹화 |
| **Figma 토큰 추출** | AI(Groq Llama)로 노드 JSON 분석 | **코드 직접 파싱** (AI 없음) |
| **스테이징 입력** | 서버 fetch로 HTML만 받음 → AI 분석 | **Chrome 확장이 본인 세션으로 페이지 띄워 캡처** + DOM에서 직접 토큰 추출 |
| **비교** | AI 호출로 의미 기반 매칭 | **코드 직접 매칭** (Jaccard + 값 일치 점수) |
| **이미지 비교** | Figma 이미지 + 마커만 | Figma + 스테이징 좌우 비교, 풀 페이지 스크롤·스티칭 |
| **AI 사용** | 거의 모든 단계 (4 군데) | **거의 사용 안 함** (`/api/extract-web` fallback에만 남음) |
| **Vercel 자동배포** | 미설정 | 여전히 미설정 — `vercel --prod --yes`로 매번 수동 |

이 5일은 사실상 "AI 의존을 줄이고 결정적(deterministic) 추출로 전환"하는 작업이었음. AI rate limit과 응답 신뢰성 문제 때문.

---

## 1. 핵심 아키텍처 (현재)

### 데이터 흐름 (현재)
```
┌─────────────────────────────────────────────────────────────────────────┐
│                  📐 DDhelper 도구 (ddhelper-two.vercel.app)               │
│                                                                           │
│   Step 1: Figma URL                                                       │
│     → /api/figma → src/lib/figma.ts                                       │
│     → Figma REST API로 노드 트리 + 이미지 받음                              │
│     → discoverFrames(): SECTION/CANVAS/GROUP 재귀 탐색                     │
│         · sectionName 추적 (SECTION 노드의 name)                           │
│         · viewport 280~2560px 사이 FRAME만 시안으로 채택                    │
│         · 너비 범위 밖 FRAME은 wrapper로 보고 children 재탐색                │
│     → simplifyFigmaNode() + classifyElement() (휴리스틱) 으로              │
│         · button/heading/text/card/icon/image/input/tag/divider 분류        │
│     → parseViewportRange(): 시안 이름의 "1280 미만"/"600 미만" 패턴 인식    │
│         · 이걸로 '실제 적용되는 viewport 범위' 결정                         │
│     → 토큰: 노드의 fills/strokes/cornerRadius/padding/typography 직접 추출   │
│         · ★ AI 호출 0회                                                    │
│                                                                           │
│   Step 2: 스테이징 URL                                                    │
│     ① extensionInfo가 있으면 (대부분의 케이스):                             │
│        → src/lib/staging-client.ts: chrome.runtime.connect로 Port 연결    │
│        → 확장이 popup window 띄워 캡처 + DOM 토큰 추출 (★ AI 호출 0회)      │
│        → slices(JPEG) + raw token JSON 받음                              │
│        → src/lib/client-stitch.ts: HTMLCanvas로 슬라이스 합쳐 단일 PNG      │
│     ② 확장 없으면 fallback:                                               │
│        → /api/extract-web (HTML→AI 토큰)                                  │
│        → /api/capture-staging (Playwright) — 미테스트 코드 (보존만)          │
│                                                                           │
│   Step 3: 비교                                                            │
│     → /api/compare → src/lib/compare.ts                                   │
│     → elementType별 그룹화 → 그룹 안에서 그리디 매칭                         │
│         · score = (값 정확 일치 100) + (값 등가 90) + (이름 유사도 0~50)    │
│         · MIN_MATCH_SCORE = 15                                            │
│     → 매칭된 짝의 값 비교 → severity 판정                                   │
│         · 컬러 → critical                                                  │
│         · font-size 2px+ → critical                                       │
│         · 그 외 mismatch → warning                                        │
│     → 결과 JSON 반환                                                       │
│         · ★ AI 호출 0회                                                    │
└────────────────┬───────────────────────────────────┬───────────────────┘
                 │                                   │
                 │ Figma REST API                    │ chrome.runtime.connect
                 ▼                                   ▼
        ┌──────────────────┐               ┌──────────────────────────┐
        │   🎨 Figma API    │               │ 🔌 DDhelper Capture 확장   │
        └──────────────────┘               │   v0.5.3 (extension/)     │
                                           │                            │
                                           │  Port 통신 (long-running)  │
                                           │  하트비트 2초/회 (진단용)   │
                                           │                            │
                                           │  Sequence:                 │
                                           │  ① readSessionFromExisting │
                                           │     Tab — 메인 브라우저의   │
                                           │     watcha 탭 localStorage │
                                           │     읽기                    │
                                           │  ② chrome.windows.create   │
                                           │     focused:true popup     │
                                           │  ③ injectLocalStorage +    │
                                           │     reload → 로그인 상태    │
                                           │     으로 재렌더링           │
                                           │  ④ waitForContent          │
                                           │     (8s, img+bg 8개+)      │
                                           │  ⑤ extractTokensFromTab    │
                                           │     (button/h*/p/input/    │
                                           │     tag/card 컴퓨티드 스타일│
                                           │     직접 추출)             │
                                           │  ⑥ captureFullPageStitched │
                                           │     스크롤하며 viewport     │
                                           │     단위 JPEG 슬라이스      │
                                           │     수집(클라이언트로 전달) │
                                           │     · MAX_PAGE_HEIGHT=8000 │
                                           │     · MAX_TIME_MS=25000    │
                                           │     · 첫 슬라이스 후       │
                                           │       hideOverlay (GNB 중복│
                                           │       방지)                 │
                                           │  ⑦ chrome.windows.remove   │
                                           └──────────┬────────────────┘
                                                      │
                                                      ▼
                                           ┌──────────────────────────┐
                                           │ 🌐 staging.watcha.com     │
                                           │  사용자 본인 세션          │
                                           │  (cookies + 주입된 LS)    │
                                           └──────────────────────────┘
```

### 핵심 설계 결정 (오늘 만들어진 것들)

**A. AI는 fallback으로만**
- MVP 시작 시 "AI = 파서" 전략이 핵심이었음. 5일 동안 rate limit, 응답 잘림, 비결정성 등으로 핵심 경로에서 AI 제거.
- 현재 AI 호출 위치: `/api/extract-web` (확장 미설치 사용자용 폴백 1군데)
- 그 외 Figma 토큰, 스테이징 토큰, 비교 모두 결정적 코드.

**B. 무거운 작업은 클라이언트(페이지)에서**
- service worker(SW)는 MV3에서 30초+ 작업 시 종료 위험.
- 결정: PNG 스티칭(12MP+ canvas)을 **확장이 아니라 도구 페이지**의 HTMLCanvas로 이전.
- `src/lib/client-stitch.ts`가 그 역할.

**C. 확장-도구 통신은 Port 기반**
- `chrome.runtime.sendMessage` (one-shot)는 SW가 idle 종료되면 "channel closed" 에러.
- `chrome.runtime.connect`로 Port 열면 살아있는 동안 SW 종료 안 됨 (이론상).
- 실제론 setInterval(2s 하트비트) + 클라이언트가 disconnect 책임 — 두 겹 안전장치.

**D. SECTION + 프레임 이름 둘 다 평가**
- Watcha 디자이너는 SECTION 이름에 케이스 구분 키워드를 넣지만(`SVOD_로그인/구독 케이스_WEB`), 한 SECTION 안에 다른 상태의 프레임도 있음(예: 위 SECTION에 `비로그인/비구독_600 미만` 프레임).
- `frameLoginRank()`가 프레임 이름을 우선, SECTION 이름을 보조로 평가.

**E. Figma 프레임 너비 = 스테이징 캡처 너비**
- 디자이너가 375px에서 디자인했으면 375px에서 비교해야 의미 있음.
- `deriveCaptureWidths()`는 활성 프레임의 width를 그대로 사용 (이전엔 viewportRange max로 계산해서 어긋났음).
- 더 나아가 **Figma의 모든 unique 너비를 한 번에 캡처** (케이스/사이즈 chip 전환 시 재캡처 불필요).

**F. localStorage 주입으로 로그인 상태 유지**
- popup window는 같은 프로필이라 cookies는 자동 공유. 하지만 Watcha가 JWT를 localStorage에 저장하면 popup의 fresh localStorage엔 토큰 없음 → 비로그인 화면 캡처됨.
- 해결: 사용자 메인 브라우저의 watcha 탭에서 localStorage 읽어서 popup에 주입 → 새로고침 → 로그인 상태로 재렌더.

---

## 2. 시간순 진행 내역

### 2.1 비교 정확도 개선 (오전 초반)
**계기**: 사용자가 "오류 잡았다고 표기한 부분이 실제로는 잘 적용된 부분이 많음" 보고.

- `src/components/VisualCompare.tsx`에 박스 라벨 + 그룹핑 + 카테고리 chip 추가
- `src/lib/compare.ts`에 컬러 정규화 (`normalizeColor` — hex/rgb/rgba 등가 비교)
- 이름 유사도(Jaccard)로 매칭, 같은 nodeId끼리 그룹화

### 2.2 AI 분리 (1차) — Figma 토큰 추출 결정화
**계기**: "피그마에서 CSS 코드를 바로 추출해서 비교하는 게 낫지 않아?"

- `src/lib/figma.ts`를 거의 재작성
- `discoverFrames()`: 노드 트리 재귀 탐색
- `simplifyFigmaNode()` + `classifyElement()`: 휴리스틱으로 elementType 추론
- 노드의 fills, strokes, cornerRadius, padding, characters 등 직접 추출
- 결과: 토큰 추출이 결정적, 빠르고, AI 호출 0회

### 2.3 iOS/Android 탭 제거 — Web MVP 집중
**계기**: "MVP 단계에선 웹만 먼저 하자"

- 삭제: `src/app/api/extract-code/route.ts`, `src/lib/code-extractor.ts`
- `src/components/ImplInput.tsx`에서 탭 UI 제거, 웹 입력 단일화
- 사용자가 한 번 더 "iOS/AOS 아직 있다 진짜 똑바로 처리해라" 항의 후 완전 제거 확인

### 2.4 페이지 URL → 멀티 프레임 자동 추출
**계기**: "프레임 URL 말고 페이지 URL 넣으면 그 페이지의 모든 사이즈 시안을 한 번에 분석"

- `src/lib/figma.ts`의 `extractFramesFromPage()` 작성 — 페이지 노드의 자식 시안들 모두 수집
- viewport 280~2560px 사이 FRAME만 채택, 작은 wrapper는 children 더 탐색
- `parseViewportRange()`: 시안 이름의 "1280 미만"/"600 미만"/"~767"/"X-Y" 패턴 정규식 매칭
- `classifyViewportSmart()`: 범위가 명시되면 그 max로 카테고리 결정 (예: "1280 미만" → 1024 → large)
- `src/lib/types.ts`에 `FrameSet`, `ViewportCategory` 추가
- `src/components/FigmaInput.tsx`에 chip 그룹 UI

### 2.5 SECTION 기반 그룹화
**계기**: 사용자가 한 페이지에 "로그인/구독 케이스" + "비로그인/비구독 케이스" 같은 SECTION으로 나눠둠 → 도구가 다 평면화해서 잘못 비교.

- `discoverFrames`를 `drillDown(node, depth, currentSection)` 재귀 함수로 재작성
- SECTION을 만나면 sectionName 갱신해서 자식들에 전달
- `FrameSet.sectionName`로 보존 → UI에서 같은 섹션끼리 묶어 표시

### 2.6 헤드리스 크롬 시도 → 폐기
**계기**: 스테이징 페이지를 서버에서 크롤링해야 한다는 인식.

1. Playwright + `@sparticuz/chromium` Vercel 함수에 도입 시도
2. **로그인 필요한 스테이징은 서버에선 못 잡음** (사용자 세션 없음)
3. 헤드리스 크롬은 보안 문제도 있음 (User-Agent 검증)
4. 대화형 옵션 토론 후 **Chrome 확장(F-2 안)** 으로 결정
5. 폐기 코드는 `src/lib/staging-capture.ts`로 보존만 함 (실제 fallback 경로로는 사용 안 함)

### 2.7 Chrome 확장 F-2 단계 1~3 완료
- **단계 1** (커밋 안 됨, 별도): manifest + popup + background 골격
- **단계 2**: viewport별 백그라운드 캡처 로직 (chrome.windows.create + captureVisibleTab)
- **단계 3**: 확장 ↔ 도구 통신 (`externally_connectable` + `useExtensionInfo` hook)
- **단계 4**: 디자이너 배포용 zip + 설치 가이드 — **여전히 pending**

### 2.8 캡처 결과 빈 화면 / 스켈레톤만 잡히는 문제
- 페이지 로드 직후 캡처해서 React SPA가 데이터 fetch 못 끝낸 상태
- `triggerLazyLoad`: 페이지 끝까지 스크롤했다가 맨 위로 → IntersectionObserver 트리거
- `waitForContent`: 600ms 간격 polling — `<img>` + CSS background-image 합계 8개 이상 또는 DOM 안정화 3회 연속
- 원래 background-image 안 보다가 이걸로 watcha 포스터(`background-image:url(...)`) 인식
- `focused:true`로 변경 — 백그라운드 탭은 throttle 돼서 API 응답 못 받음

### 2.9 AI 분리 (2차) — 비교 단계 결정화
**계기**: 사용자가 비교 시 "AI 분당 사용량 초과" rate limit 에러 반복.

- `src/lib/compare.ts` 재작성
- `nameSimilarity()`: 토큰 단위 Jaccard 계산 (stop word 제외)
- `judgeSeverity()`: 컬러 critical, font 2px+ critical 등 룰 기반
- `matchWithinGroup()`: elementType별 그룹화 후 그리디 매칭
- AI 호출 0회

### 2.10 시안 이름 viewport 범위 파싱 (정밀화)
**계기**: 사용자가 "피그마 section 안에 1280미만, 600미만 이렇게 적어놓은 이유는 가로사이즈가 1280 미만에서 해당 화면처럼 보인다는거" 명확화.

- `parseViewportRange`이 더 다양한 패턴 인식 ("1280 미만", "1280 이상", "(~767)", "600~1279")
- `findMatchingCapture()` 우선순위 변경: viewportRange를 카테고리 매핑보다 우선

### 2.11 UI 폴리시 (가로 레이아웃, 버튼 통일 등)
- Step 1, Step 2 박스를 `lg:grid-cols-2`로 가로 배치 (URL 붙여넣기 편의)
- 두 박스 동일 높이로 보이도록 `h-full flex flex-col`
- "비교할 케이스 / 사이즈 선택" 안내 문구 추가
- 불러오기/분석하기 버튼: rounded-2xl + text-[13px] (인풋과 동일 radius로 시각적 일관성)
- Step 2 헤더: "구현물" → "스테이징"
- Step 2의 redundant "DDhelper Capture 확장 연결됨" 박스 제거 (헤더 옆 태그로 충분)
- 분석하기 버튼을 URL 입력 옆 인라인으로 (Step 1과 동일 패턴)
- VisualCompare 양쪽 maxWidth 제거 → 그리드 셀 꽉 채우게 (좌우 동일 너비 비교)

### 2.12 풀 페이지 스크롤 캡처 (Stitching) — 첫 시도
**계기**: 사용자가 "스테이징에선 해당 화면 아래로는 쭉 아무것도 안 뜸" 보고.

- `chrome.tabs.captureVisibleTab`은 보이는 영역만 캡처 → 긴 페이지는 위쪽만 잡힘
- 해결: 스크롤하며 슬라이스 N장 → OffscreenCanvas로 합성 → 단일 PNG
- `captureFullPageStitched()`: viewport 높이 단위 스크롤 + captureVisibleTab + 0.5s settle
- `stitchSlices()`: SW 안에서 OffscreenCanvas로 그림
- `blobToDataUrl`: ArrayBuffer → btoa (FileReader는 SW에서 호환 이슈)
- sticky/fixed 헤더 처리: 첫 슬라이스에서만 보이게, 두번째부터 `visibility:hidden`

### 2.13 캡처 시간 단축
**계기**: 사용자가 "254초 걸림. 어떻게 좀 해줘"

- 기본 viewport 4개 → 2개 (375 + 1024) — 나중에 또 변경
- triggerLazyLoad 제거 (스티칭 스크롤이 어차피 lazy 트리거)
- waitForContent 타임아웃 20s → 8s
- 슬라이스 settle 700 → 450ms
- viewport당 30초 하드 캡 (`MAX_TIME_MS`)
- 페이지 높이 30000 → 12000 → 8000 (캐치업 식 축소)
- 결정적 변화: **활성 Figma 프레임 1개의 너비만 캡처** (케이스 chip 클릭 후 분석하기)

### 2.14 AI 분리 (3차) — 스테이징 토큰 추출도 확장으로
**계기**: extract-web의 AI 응답이 max_tokens=1024에서 잘리고, rate limit도 자주 침.

- 확장의 `extractTokensFromTab()`에서 `getComputedStyle()`로 직접 추출
- button/heading/text/input/tag/card 6종, 각 최대 8개 후보
- 컬러 정규화 (rgb → #RRGGBB)
- 도구는 확장 사용 시 `/api/extract-web` 호출 안 함 (확장 응답에 토큰 포함됨)

### 2.15 Service Worker 종료 사투
**계기**: 캡처 도중 "확장 통신이 응답 전에 끊어졌습니다" 반복 발생.

이 부분이 오늘 가장 시간 많이 든 부분. 시도한 것들:
1. `chrome.runtime.connect` Port 기반 통신 (one-shot 대신)
2. 응답 후 disconnect 책임을 클라이언트에 이전 (race 방지)
3. `chrome.alarms.create` 24초 주기 keepalive (일시적, 나중에 제거)
4. `setInterval(5s)` keepalive로 chrome API 강제 호출 → 효과 부족
5. **하트비트 추가**: 확장이 2초마다 진행 단계 정보 전송, disconnect 시 어디서 끊겼는지 메시지에 포함 — 진단으로는 매우 유용
6. 진단 결과: 38초 / `1024px:stitching` 단계 / 18 하트비트 받고 종료
   → SW가 38초 동안 멀쩡히 살아있다가 stitching 중 종료
7. **결론**: PNG 인코딩(`canvas.convertToBlob`)이 12MP 캔버스에서 5+초 걸리는데 그동안 SW가 다른 일 못 해서 Chrome이 종료시킴

### 2.16 클라이언트 측 스티칭 (정답)
- 확장은 슬라이스 raw로만 보냄 (PNG 합성 안 함)
- 도구 페이지의 `HTMLCanvasElement`에서 합성 (페이지는 SW 수명과 무관)
- `src/lib/client-stitch.ts` 신규
- `src/lib/staging-client.ts`가 응답 받자마자 `stitchClientSide()` 호출 후 기존 `StagingCaptureItem.capture.imageDataUrl` 형태로 변환 (기존 컴포넌트 무수정)
- **이걸로 SW 종료 문제 해결**

### 2.17 슬라이스 PNG → JPEG (사이즈 축소)
- 그래도 응답이 큼 (12 슬라이스 × 1MB+) → port 직렬화 시간 오래 걸림 위험
- `format: "jpeg", quality: 92`로 변경 → 사이즈 5~10배 감소
- 디자인 QA에 화질 차이 거의 없음

### 2.18 멀티 너비 캡처 + 정확 매칭
**계기**: 사용자가 케이스 chip 전환 시 사이즈가 안 맞을 수 있다고 지적.

- `FigmaInput`에서 로드된 모든 시안의 unique 너비 추출 (예: `[375, 768, 1560]`)
- `onFramesLoaded` 콜백으로 부모(page.tsx)에 전달
- `ImplInput`이 `targetWidths`로 모두 받아 한 번에 캡처
- `findMatchingCapture()`: 활성 프레임 너비 정확 일치(±1px)를 0순위로 매칭

### 2.19 로그인 케이스 자동 매칭 + 토글
- `frameLoginRank()`: 프레임 이름 우선, SECTION 이름 보조로 로그인 상태 평가
  - rank 0 = 로그인/구독 (위)
  - rank 1 = 중립
  - rank 2 = 비로그인/비구독 (아래)
- "비로그인"이 "로그인"의 부분 문자열이라 negative 체크가 먼저
- 로드 후 정렬 → 첫 프레임 자동 활성 → 로그인 케이스가 기본 노출
- "로그인 케이스 ↔ 비로그인 케이스" 빠른 토글 버튼 추가
  - 양쪽 모두 시안 있을 때만 표시
  - 클릭 시 같은 viewport 시안으로 즉시 전환

### 2.20 localStorage 주입 (가장 마지막)
**계기**: Figma는 로그인 케이스인데 스테이징 캡처는 비로그인 화면으로 잡힘.

- 원인: popup이 fresh localStorage라 Watcha JWT 못 가짐
- 해결: 메인 브라우저에 같은 origin 탭이 있으면 거기서 localStorage 읽어 popup에 주입 후 reload
- `readSessionFromExistingTab()` + `injectLocalStorage()` 함수 추가
- 사용자가 watcha.com 탭을 메인 브라우저에 열어둔 채로 분석하기 누르면 자동 인증 상태로 캡처

---

## 3. 현재 상태 스냅샷

### 동작하는 것
- ✅ Figma 페이지 URL → 모든 시안(SECTION 그룹화) 자동 추출 + 토큰 + 이미지 (AI 0회)
- ✅ "로그인 케이스 ↔ 비로그인 케이스" 토글로 즉시 전환
- ✅ 활성 시안의 viewport 정보 헤더에 SECTION 이름 + 시안명 표시
- ✅ 확장 v0.5.3으로 스테이징 풀 페이지 캡처 + 토큰 추출 + 본인 세션 사용
- ✅ 클라이언트 측 슬라이스 합성 (SW 종료 위험 0)
- ✅ Figma 프레임 너비 = 스테이징 캡처 너비 (1:1 비교)
- ✅ 비교: elementType별 그리디 매칭 + severity 분류 (AI 0회)
- ✅ 시각적 비교 뷰: 좌우 동일 너비, 마커, 카테고리 chip
- ✅ 표 뷰
- ✅ 한국어 에러 메시지
- ✅ Vercel 프로덕션 배포 (`vercel --prod --yes` 수동)

### 알려진 한계 / 미해결
1. **F-2 단계 4 (디자이너 배포용 zip + 설치 가이드)** — 여전히 pending. 다른 디자이너 동료한테 배포하려면 이게 필요.
2. **Watcha가 sessionStorage 쓰는 경우** — 현재 localStorage만 카피. sessionStorage는 popup으로 못 옮겨감 (per-tab/window). 만약 스테이징이 sessionStorage 인증이면 비로그인 잡힐 수 있음 (현재 케이스에선 잘 동작 중인 것으로 보임).
3. **Figma 멀티 너비 캡처 시간** — `[375, 768, 1024, 1440]` 모두 잡으면 viewport당 ~30초 × 4 = 2분. 사이즈 적은 시안만 있으면 빠름.
4. **F-1 (서버 헤드리스 크롬) fallback** — 코드는 보존돼 있지만 프로덕션에서 미테스트. 확장 미설치 사용자는 사실상 비로그인 페이지만 잡힘.
5. **`/api/extract-web` (AI fallback) 코드는 살아있음** — 확장 미설치 시에만 호출. max_tokens 1024 → 8192로 키워둔 상태.
6. **Vercel ↔ GitHub 자동배포** — 여전히 미설정.

### Service Worker 안정성 메모
> 다음 세션에서 또 SW 종료 이슈 만나면 이 노트 참고.

- MV3 service worker는 30초 idle + 무거운 동기 작업 시 Chrome이 강제 종료
- Port 통신은 SW를 살려 두지만 100% 보장 아님 (Chrome 버전/환경에 따라)
- 무거운 PNG/캔버스 작업은 무조건 클라이언트(페이지)로 이전
- 디버깅: 도구 콘솔 (`F12`)에 하트비트 로그 자동 출력
- 진단 시점이 필요하면 `extension/background.js`의 `setStage()` 콜이 stage marker

---

## 4. 환경변수 (변경 없음)

```
GROQ_API_KEY=gsk_...        # AI fallback 1군데(/api/extract-web)에만 사용
FIGMA_ACCESS_TOKEN=figd_... # Figma REST API
```

`.env.local`은 `.gitignore`에 포함. Vercel 대시보드에 production 환경변수 등록되어 있음.

---

## 5. 파일 변경 요약

### 신규 파일
| 파일 | 역할 |
|---|---|
| `extension/manifest.json` | MV3 manifest, externally_connectable 매칭 |
| `extension/background.js` | 1041줄. Port 핸들러, 캡처, 토큰 추출, 세션 주입 모두 |
| `extension/content.js` | 도구 페이지에 확장 ID/version 알림 |
| `extension/popup.html` + `popup.js` | 확장 아이콘 클릭 시 표시 (사용자가 수동으로 캡처할 일은 없음) |
| `extension/icons/` | 16/48/128 PNG 아이콘 |
| `extension/README.md` | 설치/사용 가이드 |
| `src/app/api/capture-staging/route.ts` | Playwright fallback (현재 미사용 / 보존) |
| `src/components/AnalysisCriteria.tsx` | 비교 결과 화면에 "AI가 어떤 기준으로 분석했나요?" 펼치기 (현재는 코드 기반 매칭이라 이름이 다소 misleading) |
| `src/lib/cache.ts` | 단순 메모리 캐시 (Vercel 함수 콜드 스타트 사이엔 무효) |
| `src/lib/client-stitch.ts` | HTMLCanvas로 슬라이스 합성 |
| `src/lib/staging-capture.ts` | Playwright 헤드리스 캡처 (서버, fallback, 미사용) |
| `src/lib/staging-client.ts` | 확장 통신 hook + Port 기반 capture 함수 + ping/version 검증 |

### 대규모 변경
| 파일 | 핵심 변화 |
|---|---|
| `src/lib/figma.ts` | 40K줄. AI 호출 제거, 결정적 토큰 추출, SECTION/viewport range 인식 |
| `src/lib/compare.ts` | AI 호출 제거, 그리디 매칭 |
| `src/lib/types.ts` | `FrameSet`, `ViewportCategory`, `StagingCaptureItem` 추가 |
| `src/lib/claude.ts` | max_tokens 1024 → 8192, 마크다운 fence stripping 보강 (응답 잘림 대응) |
| `src/components/FigmaInput.tsx` | 페이지 URL 지원, SECTION chip 그룹, 로그인 토글, frameLoginRank |
| `src/components/ImplInput.tsx` | iOS/Android 탭 제거, 확장 우선 사용, targetWidths prop |
| `src/components/VisualCompare.tsx` | 좌우 동일 너비, 그룹별 카테고리 chip, SECTION/시안명 헤더 |
| `src/app/page.tsx` | targetWidths/figmaUniqueWidths 전달, deriveCaptureWidths, findMatchingCapture |

### 삭제
- `src/app/api/extract-code/route.ts`
- `src/lib/code-extractor.ts`

---

## 6. 시행착오와 배운 것들

### 1) MV3 Service Worker는 진짜 까다롭다
- "Port가 열려 있으면 SW 안 죽음"이라는 Chrome 공식 문서 보장이 실전에선 100% 아님
- 무거운 동기 작업(PNG 인코딩 등)이 있으면 SW가 죽을 수 있음
- **해결 패턴**: 무거운 작업은 무조건 페이지(client) 컨텍스트로 이전. 확장 SW는 chrome API 호출 위주로 가볍게 유지.

### 2) 진단 정보를 응답에 실어보내기
- 사용자가 SW 콘솔 직접 보기 어려움 → 캡처 도중 하트비트 메시지로 단계+경과 시간 전송 → disconnect 시 마지막 정보를 에러 메시지에 포함
- 이 진단 메커니즘 덕에 "stitching 단계 38초에 죽음" 정확히 알아냈고, 그게 PNG 인코딩이 원인이라는 결론으로 이어짐

### 3) 캡처 응답 크기 = SW 부담
- 12개 슬라이스 × 1MB(PNG) = 12MB+ 응답. Port 직렬화 부담 + SW 메모리 부담
- JPEG quality 92로 5~10배 축소 → 부담 즉시 감소
- 디자인 QA에 화질 차이 무시할 만함

### 4) localStorage vs cookies vs sessionStorage
- popup window는 같은 프로필이라 cookies는 자동 공유
- localStorage는 origin 단위로 공유 (popup도 같은 origin이면 접근 가능)
- 그러나 popup이 처음 열릴 때 localStorage가 비어 있을 수 있음 (특히 SPA가 페이지 로드 후 토큰 set 전 단계)
- 안전책: 메인 탭에서 읽어와서 popup에 명시적 주입 + 새로고침
- sessionStorage는 per-tab이라 popup으로 옮겨갈 방법 없음 (현재 도구는 이 케이스 미지원)

### 5) Figma 시안 그룹 인식
- SECTION 안에 다른 SECTION이 있을 수 있음 (중첩) → drillDown이 가장 깊은 SECTION 이름 사용
- 시안 너비가 5000px+면 wrapper 가능성 → children 더 탐색
- "1280 미만" 같은 한국어 viewport 라벨 정규식 매칭 필요

### 6) 사용자 인내심 한계가 곧 디버깅 시한
- 사용자가 비개발자 디자이너이므로 "또 안 되네" 메시지가 오면 5분 안에 진전 보여줘야 함
- 추측으로 한 줄 패치하지 말고 진단 정보부터 확보 → 확실한 원인 잡기

---

## 7. 다음 세션에서 이어갈 수 있는 일감

### 시급도 높음
1. **F-2 단계 4: 디자이너 배포용 zip + 설치 가이드** (Task #30, pending)
   - `extension/` 폴더를 zip으로 묶어 다른 왓챠 디자이너에게 전달
   - "압축 풀고 chrome://extensions에서 '압축해제된 확장 프로그램 로드'" 가이드
   - 자동 업데이트 안 되므로 버전 업 시 zip 재배포 필요

2. **확장 자동 업데이트 메커니즘**
   - 현재는 unpacked extension. 새 버전 나오면 디자이너가 직접 zip 다시 받아 교체해야 함
   - 옵션 A: Chrome Web Store 게시 (심사 필요)
   - 옵션 B: `update_url` + 자체 호스팅 (기업용)
   - 옵션 C: 도구 페이지에서 "확장 업데이트 필요" 알림 → 사용자가 새 zip 받기

### 기능 확장
3. **Watcha sessionStorage 인증 케이스 대응**
   - 현재는 localStorage만 카피. sessionStorage 쓰는 경우 비로그인 잡힘
   - 옵션: chrome.scripting.executeScript로 sessionStorage도 함께 읽어 주입 (효과 검증 필요)

4. **비교 결과 공유**
   - 현재 페이지 상태 only. 새로고침 시 소실
   - URL 해시에 결과 직렬화 / Vercel KV 저장 / Notion 자동 push 등

5. **개발자 전달용 이슈 자동 생성**
   - 비교 결과 → "이 버튼 background-color #FF0558로 바꿔주세요" 같은 한국어 코멘트 자동 생성
   - GitHub Issue / Linear / Slack 메시지 형식 export

6. **Figma 플러그인화**
   - 디자이너가 Figma 안에서 현재 선택한 프레임 우클릭 → "DDhelper로 비교" 메뉴
   - URL 복사 단계 생략

### 기술 부채
7. **`src/lib/claude.ts` 파일명**
   - 여전히 Groq를 쓰는데 이름이 claude. `ai.ts` 또는 `llm.ts`로 리네임 권장. 단, 핵심 경로에서 AI 호출 거의 사라져서 우선순위 낮음.

8. **`src/components/AnalysisCriteria.tsx` 표현**
   - "AI가 어떤 기준으로 분석했나요?" 라고 표시되는데 실제로는 결정적 매칭. 텍스트 수정 필요.

9. **테스트 0**
   - 여전히 테스트 없음. 확장 동작은 더더욱 자동 테스트 어려움.

### 다른 디자이너 배포 시 고려사항
10. **사용자 가이드**
    - "메인 브라우저에 staging.watcha.com 로그인된 탭 1개 열어둘 것"
    - "Figma URL은 페이지 URL OR 프레임 URL 모두 가능"
    - "케이스/사이즈 자동 매칭이 잘못되면 chip 클릭으로 직접 선택"

---

## 8. 세션 상호작용 패턴 (이어 작업 시 참고)

- **언어**: 한국어. 비개발자 디자이너 눈높이.
- **태도**: 사용자가 "또 안 되네"/"못하면 못한다고 해" 라고 표현하면 추측 패치 멈추고 진단 정보부터 확보
- **배포**: `vercel --prod --yes` 후 사용자가 `Cmd+Shift+R`로 강제 새로고침해야 신코드 봄. 매번 안내.
- **확장 변경 시**: 사용자에게 `chrome://extensions` 토글 OFF/ON 안내 (단순 새로고침 ↻로 안 잡히는 경우 있음)
- **이미지 첨부**: 사용자가 스크린샷 자주 줌. 이미지에서 SECTION 이름 / 프레임 이름 / 에러 메시지 정확히 읽을 것.
- **버전 표시**: Step 2 헤더에 "확장 v0.5.x" 표시. 사용자가 업데이트 안 됐으면 그 자리가 옛 버전. 사용자에게 항상 그 태그 확인 요청.

---

## 9. 환경/실행 참조 정보

### 로컬 개발
```bash
npm run dev          # http://localhost:3000
npm run build        # 빌드 검증
npx tsc --noEmit     # 타입 체크 (배포 전 항상)
```

### 배포
```bash
vercel --prod --yes        # 프로덕션 배포 (수동)
# GitHub push는 자동 배포 안 됨 (Phase J 미완)
git push origin main       # GitHub 푸시는 별개
```

### 확장 관리
- 로컬 경로: `/Users/ken/Projects/DDhelper/extension/`
- 사용자가 chrome://extensions에 unpacked로 등록
- 코드 수정 시 사용자가 카드의 새로고침(↻) 또는 토글 OFF/ON 필요
- 버전은 `manifest.json` + `background.js`의 `VERSION` 상수 동시 업데이트

### 테스트 URL
- Figma 페이지: `https://www.figma.com/design/T6txdtsZ5utexHAR2DyPRw/-Core--SVOD-...?node-id=55-189660`
- 스테이징: `https://staging.watcha.com/browse/all`
- 사용자는 메인 브라우저에 staging.watcha.com 탭 로그인된 채로 열어두기

### 주요 파일 빠른 참조
- `src/lib/figma.ts` — Figma 노드 트리 → SECTION/프레임 추출 + 토큰 (AI 없음)
- `src/lib/compare.ts` — 그리디 매칭 + severity 판정 (AI 없음)
- `src/lib/staging-client.ts` — 확장 통신 (Port 기반, 하트비트, 진단)
- `src/lib/client-stitch.ts` — 페이지 측 슬라이스 합성
- `src/components/FigmaInput.tsx` — 페이지 URL 입력, SECTION chip, 로그인 토글, frameLoginRank
- `src/components/VisualCompare.tsx` — 좌우 비교 뷰, 마커
- `src/app/page.tsx` — Step 1/2/3 오케스트레이션, deriveCaptureWidths, findMatchingCapture
- `extension/background.js` — Port 핸들러, captureSingle, extractTokensFromTab, readSessionFromExistingTab

### Git / 배포 인프라
- **원격**: `https://github.com/ken-watcha/ddhelper` (main 브랜치)
- **Vercel**: `ken-5665s-projects/ddhelper`. alias `ddhelper-two.vercel.app`
- **로컬**: `/Users/ken/Projects/DDhelper`

### 메모리
`~/.claude/projects/-Users-ken-Projects-DDhelper/memory/`:
- `user_role.md` — 왓챠 프로덕트 디자이너 (비개발자)
- `user_preferences.md` — 한국어, 비개발자 눈높이
- `project_ddhelper.md` — 프로젝트 개요

`MEMORY.md`가 자동 로드되므로 위 파일들은 항상 컨텍스트에 있음.

---

## 10. 한 페이지 개요 (다음 세션 첫 1분에 보면 좋을 것)

```
DDhelper = Watcha 디자인 QA 도구
        Web 전용 (iOS/Android 미지원)
        ddhelper-two.vercel.app

Figma URL → 도구가 토큰 추출 (AI 없음, 코드 직접)
스테이징 URL → 확장이 본인 세션으로 캡처 + 토큰 추출 (AI 없음)
            ↓ Port 통신 + 하트비트
            ↓ raw 슬라이스 (JPEG)
도구 페이지가 HTMLCanvas로 합성 → 단일 PNG
비교 → 코드 매칭 (Jaccard + 값 일치)

사용 시 주의:
1. 메인 브라우저에 watcha 탭 로그인된 채 1개 열어둘 것
2. Figma 변경 후 도구 페이지에 결과 반영 안 되면 Cmd+Shift+R
3. 확장 코드 변경 후엔 chrome://extensions에서 토글 OFF/ON
4. Vercel 자동배포 안 됨 → vercel --prod --yes 수동

알려진 한계:
- 캡처 시간 사이즈 N개 × 25~30초
- 디자이너 배포용 zip 미생성 (Task #30 pending)
- AI fallback (extract-web)은 미테스트
```

---

**End of log.**

> **다음 작업자에게**: 가장 먼저 할 일은 `git log --oneline -50` 으로 새 커밋이 있는지 확인. 그 다음 `extension/manifest.json`의 version 확인하고, 도구 화면에서 "확장 v0.X.X" 표시와 일치하는지 사용자에게 확인 요청. 그 후 사용자가 보고하는 이슈 처리.
