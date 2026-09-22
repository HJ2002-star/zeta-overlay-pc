# Zeta Overlay (PC)

zeta-ai.io 웹버전 위에 캐릭터 이미지를 오버레이하는 Chrome 확장 프로그램입니다.
안드로이드 `zeta-overlay` 앱과 같은 Firebase 프로젝트의 Firestore를 통해
매핑 데이터를 실시간으로 동기화합니다.

## 구조

```
manifest.json         확장 설정 (Manifest V3)
background.js         서비스 워커 — offscreen 문서 생성/관리, popup↔offscreen 메시지 중계
offscreen.html/.js    오래 살아있는 문서 — Firestore 실시간 구독 담당 (dist/offscreen.bundle.js를 로드)
content.js / .css     zeta-ai.io 페이지에 주입되어 캐릭터 이름을 찾아 이미지를 오버레이
popup.html/.js/.css   확장 아이콘 클릭 시 뜨는 설정 창 — 폰 Owner UID 입력, 동기화 상태 표시
src/                  esbuild로 번들링되기 전의 원본 소스
  firebase-config.js  Firebase 프로젝트 설정값 (직접 채워야 함)
  offscreen-src.js    Firestore 구독 로직 원본
dist/offscreen.bundle.js  esbuild로 Firebase SDK까지 번들링된 결과물 (이미 빌드되어 있음)
```

## 1. Firebase 프로젝트 설정

모바일 앱과 **반드시 같은 Firebase 프로젝트**를 써야 매핑 데이터를 공유할 수 있습니다.

1. [Firebase 콘솔](https://console.firebase.google.com)에서 모바일 앱과 같은 프로젝트를 엽니다.
2. 프로젝트 설정 > 일반 > "내 앱"에서 웹 앱을 하나 추가합니다 (아이콘: `</>`).
3. 발급된 `firebaseConfig` 값을 `src/firebase-config.js`에 그대로 붙여넣습니다.
4. Authentication에서 "익명" 로그인 방법을 활성화합니다 (모바일 쪽에서 이미 켰다면 생략).

### Firestore 보안 규칙

개인 프로젝트라 계정 개념이 없기 때문에, "폰에서 발급된 UID를 아는 사람만 접근 가능"한
정도로 규칙을 잡았습니다. Firestore 콘솔의 규칙 탭에 아래 내용을 반영하세요.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/mappings/{characterName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

- PC 쪽은 자신의 UID로 쓰기 권한이 없고, 읽기만 합니다 (`read: if request.auth != null`).
- 모바일 쪽 UID로만 해당 경로에 쓸 수 있습니다.
- 이 방식은 "UID 문자열 자체를 아는 사람만 접근 가능"이라는 가정에 의존하는,
  개인용 프로젝트에 맞춘 단순화된 보안 모델입니다. 여러 사람이 쓰는 서비스로
  확장할 계획이라면 이 부분은 다시 설계해야 합니다.

Storage 규칙도 동일한 패턴(`images/{uid}/...`)으로 맞춰두면 됩니다.

## 2. 빌드

`firebase-config.js`를 수정했다면 다시 번들링해야 합니다.

```bash
npm install
npm run build
```

(설정을 안 건드렸다면 이미 빌드된 `dist/offscreen.bundle.js`를 그대로 써도 됩니다.)

## 3. Chrome에 로드하기

1. `chrome://extensions` 접속
2. 우측 상단 "개발자 모드" 켜기
3. "압축해제된 확장 프로그램을 로드합니다" 클릭 → 이 폴더(`zeta-overlay-pc`) 선택

## 4. 폰과 연결하기

1. 모바일 앱(수정 완료 후)에서 앱 실행 시 발급되는 "Owner UID"를 확인/복사합니다.
2. 확장 아이콘 클릭 → 팝업에서 UID 붙여넣기 → "연결/저장" 클릭
3. 상태가 "연결됨 · 매핑 N건"으로 바뀌면 정상 동작 중입니다.

## 5. zeta-ai.io에서 확인

zeta-ai.io를 열고 매핑에 등록된 캐릭터 이름이 화면에 보이면 그 옆에 이미지 배지가 붙습니다.
클릭하면 전체화면으로 크게 볼 수 있습니다 (안드로이드 앱의 "크게 보기"와 동일한 컨셉).

## ⚠️ 알려진 제한사항 / 확인 필요 사항

- **`content.js`의 셀렉터는 아직 실제 사이트 구조로 검증되지 않았습니다.** 지금은
  "매핑에 등록된 이름과 텍스트가 정확히 일치하는 최하위(leaf) 엘리먼트를 찾는다"는
  범용 방식으로 짜여 있습니다. zeta-ai.io를 개발자 도구로 열어서 캐릭터 이름이
  실제로 어떤 태그/클래스에 렌더링되는지 확인한 뒤 `findNameCandidates()`를
  좁혀주면 오탐이 줄고 성능도 좋아집니다.
- 오버레이 위치(`positionBadge`)의 오프셋도 실제 화면을 보면서 조정이 필요할 수 있습니다
  (안드로이드 버전에서도 실측 후 보정치를 넣었던 것과 같은 과정입니다).
- Firestore 보안 규칙은 위에서 설명한 대로 "UID를 아는 사람만 접근 가능"한 단순화된
  모델입니다 — 개인용도에 한해 쓰는 걸 전제로 합니다.
- 모바일 앱 쪽 Firestore 업로드 로직이 아직 작업 중이라고 하셨으니, 그쪽 작업이
  끝나야 실제 데이터로 종단 테스트가 가능합니다. 그 전까지는 Firestore 콘솔에서
  `users/{uid}/mappings/{characterName}` 문서를 손으로 하나 만들어서
  (`{ imageUrl: "https://...", updatedAt: <타임스탬프> }`) 오버레이 로직만 먼저
  테스트해볼 수 있습니다.
