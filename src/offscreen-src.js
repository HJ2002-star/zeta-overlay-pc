// 이 스크립트는 chrome extension의 "offscreen document" 안에서 실행됩니다.
// MV3 서비스 워커(background.js)는 언제든 종료될 수 있어서 Firestore의
// 실시간 리스너(onSnapshot)를 안정적으로 유지하기 어렵기 때문에,
// 오래 살아있는 offscreen 문서 쪽에서 리스너를 유지합니다.

import { initializeApp } from "firebase/app";
// firebase/auth: 크롬 익스텐션 환경(서비스 워커, 팝업, offscreen 문서)에서
// signInAnonymously 등을 안전하게 쓰기 위한 Firebase 공식 진입점입니다.
// (signInWithPopup처럼 별도 웹사이트+iframe이 필요한 방식이 아니라면 이걸로 충분합니다)
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
        mappings[doc.id] = data.imageUrl;
      });

      log(`매핑 ${Object.keys(mappings).length}건 수신`, mappings);

      chrome.storage.local.set({
        zetaMappings: mappings,
        zetaMappingsSyncedAt: Date.now(),
        zetaSyncStatus: "connected",
      });
    },
    (error) => {
      log("Firestore 구독 에러:", error);
      chrome.storage.local.set({
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
          chrome.storage.local.set({
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
        chrome.storage.local.set({ zetaSyncStatus: "disconnected" });
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
// 마지막으로 저장해둔 ownerUid를 읽어와서 자동으로 구독을 재개합니다.
chrome.storage.local.get(["zetaOwnerUid"], (result) => {
  if (result.zetaOwnerUid) {
    ensureSignedIn().then(() => startListening(result.zetaOwnerUid));
  }
});

log("offscreen document 준비 완료");
