// zeta-ai.io 실제 페이지 소스를 확인한 결과, 캐릭터 아바타 <img> 태그가
// alt="캐릭터이름" 속성을 정확히 갖고 있는 걸 확인했습니다 (기본 프로필이든
// 실제 업로드 사진이든 동일). 그래서 텍스트로 이름을 찾는 대신, 이 img를
// 직접 찾아서 그 자리에 우리 이미지를 덮어씌우는 방식으로 짰습니다.

(() => {
  const OVERLAY_CLASS = "zeta-overlay-pc-badge";

  /** @type {Record<string, string>} 캐릭터명 -> 이미지 URL */
  let mappings = {};

  // 원본 <img> 엘리먼트 -> 우리가 덮어씌운 배지 엘리먼트
  const activeOverlays = new Map();

  function log(...args) {
    console.log("[zeta-overlay-pc/content]", ...args);
  }

  // ---- 매핑 로드 & 실시간 반영 -------------------------------------------------

  function loadMappings() {
    chrome.storage.local.get(["zetaMappings"], (result) => {
      mappings = result.zetaMappings || {};
      log(`매핑 ${Object.keys(mappings).length}건 로드`);
      scheduleScan();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.zetaMappings) return;
    mappings = changes.zetaMappings.newValue || {};
    log("매핑 갱신됨, 재스캔");
    scheduleScan();
  });

  // ---- 아바타 <img> 찾기 --------------------------------------------------------

  function findAvatarImages() {
    const names = Object.keys(mappings);
    if (names.length === 0) return [];

    const nameSet = new Set(names);
    const imgs = document.querySelectorAll("img[alt]");
    const matched = [];
    imgs.forEach((img) => {
      if (nameSet.has(img.alt)) matched.push(img);
    });
    return matched;
  }

  // ---- 오버레이 배치 -----------------------------------------------------------

  function createBadge(imageUrl, characterName) {
    const badge = document.createElement("img");
    badge.className = OVERLAY_CLASS;
    badge.src = imageUrl;
    badge.alt = characterName;
    badge.title = characterName;
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      showFullPreview(imageUrl, characterName);
    });
    document.body.appendChild(badge);
    return badge;
  }

  function positionBadge(badge, originalImg) {
    const rect = originalImg.getBoundingClientRect();
    badge.style.left = `${rect.left}px`;
    badge.style.top = `${rect.top}px`;
    badge.style.width = `${rect.width}px`;
    badge.style.height = `${rect.height}px`;
    badge.style.borderRadius =
      getComputedStyle(originalImg).borderRadius || "50%";
  }

  function scan() {
    if (Object.keys(mappings).length === 0) {
      clearAllOverlays();
      return;
    }

    const avatarImgs = findAvatarImages();
    const seen = new Set();

    for (const img of avatarImgs) {
      const characterName = img.alt;
      const imageUrl = mappings[characterName];
      if (!imageUrl) continue;

      seen.add(img);

      let badge = activeOverlays.get(img);
      if (!badge || badge.dataset.imageUrl !== imageUrl) {
        badge?.remove();
        badge = createBadge(imageUrl, characterName);
        badge.dataset.imageUrl = imageUrl;
        activeOverlays.set(img, badge);
      }
      const rect = img.getBoundingClientRect();
      const visible =
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth;
      badge.style.display = visible ? "block" : "none";
      if (visible) positionBadge(badge, img);
    }

    for (const [img, badge] of activeOverlays) {
      if (!seen.has(img) || !document.contains(img)) {
        badge.remove();
        activeOverlays.delete(img);
      }
    }
  }

  function clearAllOverlays() {
    for (const badge of activeOverlays.values()) badge.remove();
    activeOverlays.clear();
  }

  // ---- 크게 보기 (전체화면 미리보기) --------------------------------------------

  function showFullPreview(imageUrl, characterName) {
    const overlay = document.createElement("div");
    overlay.className = "zeta-overlay-pc-fullpreview";
    overlay.innerHTML = `
      <div class="zeta-overlay-pc-fullpreview-inner">
        <img src="${imageUrl}" alt="${characterName}" />
        <div class="zeta-overlay-pc-fullpreview-name">${characterName}</div>
      </div>
    `;
    overlay.addEventListener("click", () => overlay.remove());
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", onEsc);
      }
    });
    document.body.appendChild(overlay);
  }

  // ---- 스캔 스케줄링 (MutationObserver + rAF throttle) ---------------------------

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  const mutationObserver = new MutationObserver(() => scheduleScan());
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["alt", "src"],
  });

  window.addEventListener("scroll", scheduleScan, { passive: true, capture: true });
  window.addEventListener("resize", scheduleScan, { passive: true });

  loadMappings();
})();