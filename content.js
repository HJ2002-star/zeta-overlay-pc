// ⚠️ zeta-ai.io의 실제 DOM 구조(클래스명 등)는 확인 전이라, 이 파일의 셀렉터는
// "이름 텍스트를 찾고 그 근처에 배지를 얹는다"는 범용 휴리스틱으로 작성했습니다.
// 실제 사이트에서 개발자 도구로 구조를 확인한 뒤, findNameCandidates()의
// 셀렉터 부분만 사이트에 맞게 다듬으면 됩니다. (안드로이드 앱의 "이름 기반 매칭"과
// 같은 컨셉을 웹 DOM 버전으로 옮긴 것)

(() => {
  const OVERLAY_CLASS = "zeta-overlay-pc-badge";
  const MAX_NAME_TEXT_LENGTH = 20; // 이 길이보다 긴 텍스트는 캐릭터 이름이 아니라고 간주

  /** @type {Record<string, string>} 캐릭터명 -> 이미지 URL */
  let mappings = {};

  // node -> 오버레이 엘리먼트. 이름 노드가 DOM에서 사라지면 같이 정리하기 위해 사용.
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

  // ---- 캐릭터 이름 후보 찾기 ---------------------------------------------------

  /**
   * 페이지에서 "캐릭터 이름 텍스트"로 보이는 후보 엘리먼트를 찾습니다.
   * TODO(실사이트 확인 후 다듬기): 지금은 아주 일반적인 방식으로,
   *   - 매핑에 등록된 이름 문자열과 정확히 일치하는 텍스트만 가진 leaf 엘리먼트를 찾습니다.
   *   - 채팅 목록/랭킹 카드 등에서 이름이 표시되는 실제 태그(span, div 등)를 devtools로
   *     확인해서 querySelector 범위를 좁히면 오탐이 줄고 성능도 좋아집니다.
   */
  function findNameCandidates() {
    const names = Object.keys(mappings);
    if (names.length === 0) return [];

    const nameSet = new Set(names);
    const candidates = [];

    // 너무 넓은 범위를 매 스캔마다 훑는 건 비용이 크니, 텍스트 길이로 1차 필터링
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(el) {
          if (el.classList.contains(OVERLAY_CLASS)) return NodeFilter.FILTER_REJECT;
          const text = el.textContent?.trim();
          if (!text || text.length > MAX_NAME_TEXT_LENGTH) return NodeFilter.FILTER_SKIP;
          // leaf 엘리먼트(자식 엘리먼트가 없는)만: 상위 컨테이너가 같은 텍스트를
          // 중복으로 갖고 있는 경우를 걸러내기 위함
          if (el.children.length > 0) return NodeFilter.FILTER_SKIP;
          return nameSet.has(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      candidates.push(node);
    }
    return candidates;
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

  function positionBadge(badge, nameEl) {
    const rect = nameEl.getBoundingClientRect();
    // 이름 라벨의 왼쪽 위 근처에 살짝 겹치도록 배치 (안드로이드 버전의
    // "자기 높이만큼 위로 보정"과 비슷한 취지 — 실제 사이트에서 위치가
    // 어색하면 여기 오프셋만 조정하면 됩니다)
    const size = 40;
    badge.style.left = `${rect.left - size / 2}px`;
    badge.style.top = `${rect.top - size}px`;
    badge.style.width = `${size}px`;
    badge.style.height = `${size}px`;
  }

  function scan() {
    if (Object.keys(mappings).length === 0) {
      clearAllOverlays();
      return;
    }

    const candidates = findNameCandidates();
    const seenNodes = new Set();

    for (const nameEl of candidates) {
      const characterName = nameEl.textContent.trim();
      const imageUrl = mappings[characterName];
      if (!imageUrl) continue;

      seenNodes.add(nameEl);

      let badge = activeOverlays.get(nameEl);
      if (!badge || badge.dataset.imageUrl !== imageUrl) {
        badge?.remove();
        badge = createBadge(imageUrl, characterName);
        badge.dataset.imageUrl = imageUrl;
        activeOverlays.set(nameEl, badge);
      }
      positionBadge(badge, nameEl);
    }

    // 더 이상 화면에 없는 이름 노드의 배지는 정리
    for (const [nameEl, badge] of activeOverlays) {
      if (!seenNodes.has(nameEl) || !document.contains(nameEl)) {
        badge.remove();
        activeOverlays.delete(nameEl);
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
    document.addEventListener(
      "keydown",
      function onEsc(e) {
        if (e.key === "Escape") {
          overlay.remove();
          document.removeEventListener("keydown", onEsc);
        }
      }
    );
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
    characterData: true,
  });

  window.addEventListener("scroll", scheduleScan, { passive: true });
  window.addEventListener("resize", scheduleScan, { passive: true });

  loadMappings();
})();
