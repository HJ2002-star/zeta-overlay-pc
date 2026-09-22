// MV3 서비스 워커. Firebase SDK는 여기서 직접 쓰지 않습니다 —
// 서비스 워커는 언제든 종료될 수 있어서 Firestore 실시간 리스너를 안정적으로
// 유지하기 어렵기 때문에(offscreen.html) 실제 리스너는 offscreen 문서에 둡니다.
// 이 파일은 그 offscreen 문서를 만들고, popup ↔ offscreen 사이 메시지만 중계합니다.

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument; // 동시성 문제 방지용 전역 Promise

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  return contexts.length > 0;
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
  } else {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification:
        "Firestore 실시간 리스너(onSnapshot)를 서비스 워커 종료와 무관하게 유지하기 위함",
    });
    await creatingOffscreenDocument;
    creatingOffscreenDocument = null;
  }
}

// 확장 설치/브라우저 시작 시, 저장된 ownerUid가 있으면 offscreen 문서를 미리 띄워둠
// (그래야 첫 zeta-ai.io 방문 전에도 백그라운드에서 동기화가 시작됨)
async function initIfConfigured() {
  const { zetaOwnerUid } = await chrome.storage.local.get(["zetaOwnerUid"]);
  if (zetaOwnerUid) {
    await setupOffscreenDocument();
  }
}

chrome.runtime.onInstalled.addListener(initIfConfigured);
chrome.runtime.onStartup.addListener(initIfConfigured);

// popup.js가 owner UID를 설정/해제할 때 보내는 메시지를 offscreen 문서로 중계
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "background") return;

  if (message.type === "APPLY_OWNER_UID") {
    (async () => {
      await setupOffscreenDocument();
      chrome.runtime.sendMessage({
        target: "offscreen",
        type: "SET_OWNER_UID",
        ownerUid: message.ownerUid || null,
      });
      sendResponse({ ok: true });
    })();
    return true; // 비동기 응답
  }
});
