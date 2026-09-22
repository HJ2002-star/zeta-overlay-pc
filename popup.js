const uidInput = document.getElementById("ownerUid");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

function renderStatus({ zetaSyncStatus, zetaSyncError, zetaMappings, zetaMappingsSyncedAt }) {
  statusEl.classList.remove("connected", "error");

  if (!zetaSyncStatus || zetaSyncStatus === "disconnected") {
    statusEl.textContent = "연결되지 않음 — Owner UID를 입력하세요.";
    return;
  }
  if (zetaSyncStatus === "error") {
    statusEl.classList.add("error");
    statusEl.textContent = `동기화 오류: ${zetaSyncError || "알 수 없는 오류"}`;
    return;
  }
  if (zetaSyncStatus === "connected") {
    statusEl.classList.add("connected");
    const count = zetaMappings ? Object.keys(zetaMappings).length : 0;
    const time = zetaMappingsSyncedAt
      ? new Date(zetaMappingsSyncedAt).toLocaleTimeString()
      : "-";
    statusEl.textContent = `연결됨 · 매핑 ${count}건 · 마지막 동기화 ${time}`;
  }
}

function loadCurrentState() {
  chrome.storage.local.get(
    ["zetaOwnerUid", "zetaSyncStatus", "zetaSyncError", "zetaMappings", "zetaMappingsSyncedAt"],
    (result) => {
      uidInput.value = result.zetaOwnerUid || "";
      renderStatus(result);
    }
  );
}

saveBtn.addEventListener("click", () => {
  const ownerUid = uidInput.value.trim();
  if (!ownerUid) {
    statusEl.textContent = "UID를 입력해주세요.";
    return;
  }
  chrome.storage.local.set({ zetaOwnerUid: ownerUid }, () => {
    chrome.runtime.sendMessage(
      { target: "background", type: "APPLY_OWNER_UID", ownerUid },
      () => loadCurrentState()
    );
  });
});

clearBtn.addEventListener("click", () => {
  uidInput.value = "";
  chrome.storage.local.remove(["zetaOwnerUid", "zetaMappings"], () => {
    chrome.runtime.sendMessage(
      { target: "background", type: "APPLY_OWNER_UID", ownerUid: null },
      () => loadCurrentState()
    );
  });
});

// storage 변경(offscreen 문서가 동기화 상태를 갱신할 때)을 실시간 반영
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  loadCurrentState();
});

loadCurrentState();
