# DDhelper Capture (크롬 확장)

DDhelper 디자인 QA 도구를 위한 viewport별 자동 캡처 헬퍼입니다.

본인 크롬 세션을 그대로 사용하므로 watcha.com에 평소처럼 로그인된 상태에서 그대로 동작합니다 — 도구가 별도 로그인 절차를 만들지 않고, 모든 처리가 디자이너 본인 PC 안에서 이루어집니다.

## 설치 방법

1. 크롬에서 **`chrome://extensions`** 주소로 이동
2. 우측 상단 **개발자 모드** 토글 켜기
3. 좌측 상단 **압축해제된 확장 프로그램을 로드합니다** 클릭
4. 이 `extension` 폴더를 선택
5. 확장 목록에 "DDhelper Capture"가 추가되면 완료
6. 우측 퍼즐 모양 아이콘 클릭 → "DDhelper Capture" 옆 핀 아이콘을 눌러 툴바에 고정

## 사용 방법

1. **본인 크롬에서 watcha.com에 평소처럼 로그인** 해두기
2. DDhelper 도구 페이지(<https://ddhelper-two.vercel.app>) 접속
3. Step 1: Figma 페이지 URL 입력 → 불러오기
4. Step 2: 스테이징 URL 입력 → "분석하기"
5. 도구가 자동으로 이 확장을 호출 → 백그라운드 창 4개를 띄워 viewport별 캡처
6. 캡처 결과가 우측 비교 패널에 표시됨

## 보안 측면

- **외부 서버로 세션 정보를 절대 전송하지 않습니다.** 모든 처리는 본인 크롬 안에서 진행됩니다
- 캡처는 본인이 watcha.com에 평소 로그인한 세션을 그대로 사용합니다 (별도 자격 증명 저장 없음)
- 도구 서버는 캡처 **결과 이미지만** 받습니다 (쿠키, 토큰 등은 받지 않음)

## 권한 설명

- `tabs`, `windows`, `scripting`: viewport별 별도 창을 띄워 캡처하기 위함
- `storage`: 도구 URL 같은 사용자 설정 저장
- `<all_urls>`: 디자이너가 입력하는 임의의 스테이징 URL을 처리하기 위함

## 개발자 메모

- Manifest V3
- Service worker 기반 background
- 외부 메시지 통신: `chrome.runtime.sendMessage(extensionId, {...})` from
  `localhost:3000` / `ddhelper-two.vercel.app`
- 메시지 프로토콜은 `background.js` 상단 주석 참고
