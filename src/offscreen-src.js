// 이 스크립트는 chrome extension의 "offscreen document" 안에서 실행됩니다.
// MV3 서비스 워커(background.js)는 언제든 종료될 수 있어서 Firestore의
// 실시간 리스너(onSnapshot)를 안정적으로 유지하기 어렵기 때문에,
// 오래 살아있는 offscreen 문서 쪽에서 리스너를 유지합니다.

import { initializeApp } from "firebase/app";
// offscreen 문서는 (서비스 워커와 달리) 일반 웹페이지처럼 DOM/IndexedDB를 쓸 수 있으므로,
// chrome.storage.local에 의존하는 firebase/auth/web-extension 대신 일반 firebase/auth를 씁니다.
// (web-extension 진입점은 DOM이 없는 서비스 워커/팝업용으로, offscreen에서 쓰면
// 세션 저장 시 chrome.storage.local을 호출하다가 에러가 납니다 — offscreen은 그 API를 못 씀)
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  onSnapshot,
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let unsubscribe = null;
let currentOwnerUid = null;

function log(...args) {
  console.log("[zeta-overlay-pc/offscreen]", ...args);
}

// offscreen 문서는 chrome.storage를 직접 쓸 수 없고 chrome.runtime만 지원되므로
// (Chrome 공식 문서 기준), background 서비스 워커에게 대신 저장해달라고 메시지를 보낸다.
function setStorage(payload) {
  chrome.runtime.sendMessage({ target: "background", type: "STORAGE_SET", payload });
}

function stopListening() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

// ownerUid는 "폰에서 익명 로그인했을 때 발급된 UID"입니다.
// 모바일 쪽 Firestore 구조가 users/{uid}/mappings/{characterName} 라고 가정합니다.
function startListening(ownerUid) {
  stopListening();
  currentOwnerUid = ownerUid;

  const mappingsRef = collection(db, "users", ownerUid, "mappings");

  unsubscribe = onSnapshot(
    mappingsRef,
    (snapshot) => {
      const mappings = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        // 모바일 쪽 문서 형태: { imageUrl: string, updatedAt: Timestamp }
        mappings[doc.id] = "data:image/jpeg;base64," + data.imageBase64;
      });

      log(`매핑 ${Object.keys(mappings).length}건 수신`, mappings);

      setStorage({
        zetaMappings: mappings,
        zetaMappingsSyncedAt: Date.now(),
        zetaSyncStatus: "connected",
      });
    },
    (error) => {
      log("Firestore 구독 에러:", error);
      setStorage({
        zetaSyncStatus: "error",
        zetaSyncError: error.message,
      });
    }
  );
}

async function ensureSignedIn() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        resolve(user);
      } else {
        signInAnonymously(auth).catch((err) => {
          log("익명 로그인 실패:", err);
          setStorage({
            zetaSyncStatus: "error",
            zetaSyncError: "auth failed: " + err.message,
          });
        });
      }
    });
  });
}

// background.js로부터 오는 메시지 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return;

  if (message.type === "SET_OWNER_UID") {
    ensureSignedIn().then(() => {
      if (message.ownerUid) {
        startListening(message.ownerUid);
      } else {
        stopListening();
        setStorage({ zetaSyncStatus: "disconnected" });
      }
    });
    sendResponse({ ok: true });
  }

  if (message.type === "GET_STATUS") {
    sendResponse({ ok: true, currentOwnerUid });
  }

  return true;
});

// 서비스 워커가 재시작돼서 offscreen 문서도 새로 만들어졌을 경우,
// (offscreen 문서는 chrome.storage를 직접 못 읽으므로) background에게
// 마지막으로 저장해둔 ownerUid를 물어봐서 자동으로 구독을 재개합니다.
chrome.runtime.sendMessage(
  { target: "background", type: "REQUEST_OWNER_UID" },
  (response) => {
    if (response?.ownerUid) {
      ensureSignedIn().then(() => startListening(response.ownerUid));
    }
  }
);

log("offscreen document 준비 완료");