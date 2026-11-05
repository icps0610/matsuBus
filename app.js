// 馬祖南竿・北竿公車動態路線規劃網頁

function getCurrentTime24h() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getDefaultTimeScope() {
  const hour = new Date().getHours();
  return hour >= 19 ? "allday" : "upcoming";
}

function getDefaultDayType() {
  const day = new Date().getDay();
  return day === 0 || day === 6 ? "holiday" : "weekday";
}

function getInitialConfig() {
  const params = new URLSearchParams(window.location.search);
  const qIsland = params.get("island");
  const island = qIsland && ISLANDS_DATA[qIsland] ? qIsland : "nangan";
  const qDayType = params.get("daytype");
  const dayType = qDayType === "holiday" || qDayType === "weekday" ? qDayType : getDefaultDayType();

  setActiveIslandSchedule(island, dayType);

  const qFrom = params.get("from");
  const qTo = params.get("to");
  return {
    island,
    dayType,
    fromStop: qFrom && STOPS_INFO[qFrom] ? qFrom : ACTIVE_ISLAND.defaultFrom,
    toStop: qTo && STOPS_INFO[qTo] ? qTo : ACTIVE_ISLAND.defaultTo
  };
}

const initialConfig = getInitialConfig();

const state = {
  island: initialConfig.island,
  dayType: initialConfig.dayType,
  fromStop: initialConfig.fromStop,
  toStop: initialConfig.toStop,
  timeScope: getDefaultTimeScope(), // 19:00 後預設 "allday" (整天)，其餘時段預設 "upcoming" (尚未發車)
  onlyAccessible: false,
  allowTransfer: true,
  activeClickMode: "to",
  highlightedPlan: null,
  highlightedRun: null,
  simActive: false,
  simPlaying: false,
  simSpeed: 100,
  simTimeMin: 0,
  timetableFilterLine: "all",
  timetableFilterBranch: "all",
  timetableFilterAccessible: false
};

document.addEventListener("DOMContentLoaded", () => {
  initIslandAndDayTypeControls();
  initStopSelects();
  initTimeControls();
  initFilterControls();
  initMapInteraction();
  initBusSimulation();
  initTabsAndModals();
  syncIslandUI();
  renderLegend();
  renderTimetable();
  renderRules();

  updatePlannerAndUI();
});

function populateStopSelects() {
  const fromSelect = document.getElementById("from-stop");
  const toSelect = document.getElementById("to-stop");
  if (!fromSelect || !toSelect) return;

  const groups = {};
  for (const [stopName, info] of Object.entries(STOPS_INFO)) {
    if (!groups[info.group]) groups[info.group] = [];
    groups[info.group].push({ name: stopName, ...info });
  }

  const shortHint = ACTIVE_ISLAND.shortHint || {};

  function populateSelect(selectEl, defaultVal) {
    selectEl.innerHTML = "";
    for (const [groupName, stops] of Object.entries(groups)) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = groupName;
      for (const s of stops) {
        const opt = document.createElement("option");
        opt.value = s.name;
        const hint = shortHint[s.name] ? ` (${shortHint[s.name]})` : "";
        opt.textContent = `${s.name}${hint}`;
        if (s.name === defaultVal) opt.selected = true;
        optgroup.appendChild(opt);
      }
      selectEl.appendChild(optgroup);
    }
  }

  populateSelect(fromSelect, state.fromStop);
  populateSelect(toSelect, state.toStop);
}

function populateBranchFilterSelect() {
  const branchSelect = document.getElementById("tt-filter-branch");
  if (!branchSelect) return;

  const dotEmojiMap = {
    red: "🔴",
    white: "⚪",
    green: "🟢",
    orange: "🟠",
    blue: "🔵",
    grey: "🔘",
    yellow: "🟡",
    black: "⚫",
    houao: "🟠",
    wusha: "🔵",
    clinic: "🔴"
  };

  let html = `<option value="all">全部支線</option>`;
  for (const [bKey, br] of Object.entries(BRANCHES)) {
    const icon = dotEmojiMap[bKey] || "🔹";
    html += `<option value="${bKey}">${icon} ${br.name.replace("支線", "")}</option>`;
  }
  branchSelect.innerHTML = html;
  branchSelect.value = state.timetableFilterBranch;
}

function syncIslandUI() {
  const mainTitleEl = document.getElementById("app-main-title");
  const ttLinkEl = document.getElementById("header-timetable-link");
  const nanganBtn = document.getElementById("island-nangan-btn");
  const beiganBtn = document.getElementById("island-beigan-btn");
  const dayTypeBar = document.getElementById("day-type-bar");
  const weekdayBtn = document.getElementById("daytype-weekday-btn");
  const holidayBtn = document.getElementById("daytype-holiday-btn");
  const leftTitleEl = document.getElementById("tt-left-col-title");
  const rightTitleEl = document.getElementById("tt-right-col-title");

  if (mainTitleEl) mainTitleEl.textContent = ACTIVE_ISLAND.title;
  document.title = ACTIVE_ISLAND.title.replace("🚌 ", "");
  if (ttLinkEl) {
    ttLinkEl.href = ACTIVE_ISLAND.timetableImg;
    ttLinkEl.textContent = ACTIVE_ISLAND.timetableBtnText;
  }

  nanganBtn?.classList.toggle("active", state.island === "nangan");
  beiganBtn?.classList.toggle("active", state.island === "beigan");

  if (dayTypeBar) {
    if (ACTIVE_ISLAND.hasDayTypeSwitch) {
      dayTypeBar.removeAttribute("hidden");
    } else {
      dayTypeBar.setAttribute("hidden", "");
    }
  }

  weekdayBtn?.classList.toggle("active", state.dayType === "weekday");
  holidayBtn?.classList.toggle("active", state.dayType === "holiday");

  if (leftTitleEl) leftTitleEl.textContent = ACTIVE_ISLAND.leftTitle;
  if (rightTitleEl) rightTitleEl.textContent = ACTIVE_ISLAND.rightTitle;

  populateBranchFilterSelect();
}

function initIslandAndDayTypeControls() {
  const nanganBtn = document.getElementById("island-nangan-btn");
  const beiganBtn = document.getElementById("island-beigan-btn");
  const weekdayBtn = document.getElementById("daytype-weekday-btn");
  const holidayBtn = document.getElementById("daytype-holiday-btn");

  function switchIsland(nextIsland) {
    if (state.island === nextIsland) return;
    state.island = nextIsland;
    setActiveIslandSchedule(state.island, state.dayType);
    state.fromStop = ACTIVE_ISLAND.defaultFrom;
    state.toStop = ACTIVE_ISLAND.defaultTo;
    state.highlightedPlan = null;
    state.highlightedRun = null;
    state.timetableFilterBranch = "all";

    syncIslandUI();
    populateStopSelects();
    refreshSimBounds();
    renderLegend();
    renderTimetable();
    renderRules();
    updatePlannerAndUI();
  }

  function switchDayType(nextDayType) {
    if (state.dayType === nextDayType) return;
    state.dayType = nextDayType;
    setActiveIslandSchedule(state.island, state.dayType);
    state.highlightedPlan = null;
    state.highlightedRun = null;

    syncIslandUI();
    refreshSimBounds();
    renderTimetable();
    updatePlannerAndUI();
  }

  nanganBtn?.addEventListener("click", () => switchIsland("nangan"));
  beiganBtn?.addEventListener("click", () => switchIsland("beigan"));
  weekdayBtn?.addEventListener("click", () => switchDayType("weekday"));
  holidayBtn?.addEventListener("click", () => switchDayType("holiday"));
}

// 1. 初始化起訖站下拉選單
function initStopSelects() {
  const fromSelect = document.getElementById("from-stop");
  const toSelect = document.getElementById("to-stop");

  populateStopSelects();

  fromSelect.addEventListener("change", (e) => {
    state.fromStop = e.target.value;
    updatePlannerAndUI();
  });

  toSelect.addEventListener("change", (e) => {
    state.toStop = e.target.value;
    updatePlannerAndUI();
  });

  document.getElementById("swap-stops-btn").addEventListener("click", () => {
    const temp = state.fromStop;
    state.fromStop = state.toStop;
    state.toStop = temp;
    fromSelect.value = state.fromStop;
    toSelect.value = state.toStop;
    updatePlannerAndUI();
  });
}

// 2. 班次顯示切換（尚未發車 ／ 整天）
function initTimeControls() {
  const upcomingBtn = document.getElementById("scope-upcoming-btn");
  const alldayBtn = document.getElementById("scope-allday-btn");

  function syncScopeButtons() {
    upcomingBtn.classList.toggle("active", state.timeScope === "upcoming");
    alldayBtn.classList.toggle("active", state.timeScope === "allday");
  }

  upcomingBtn.addEventListener("click", () => {
    state.timeScope = "upcoming";
    syncScopeButtons();
    updatePlannerAndUI();
  });

  alldayBtn.addEventListener("click", () => {
    state.timeScope = "allday";
    syncScopeButtons();
    updatePlannerAndUI();
  });

  syncScopeButtons();
}

// 4. 篩選控制（含轉乘方案 ／ 無障礙）
function initFilterControls() {
  const accCheck = document.getElementById("filter-accessible");
  const transCheck = document.getElementById("filter-transfer");

  if (accCheck) accCheck.checked = state.onlyAccessible;
  if (transCheck) transCheck.checked = state.allowTransfer;

  accCheck?.addEventListener("change", (e) => {
    state.onlyAccessible = e.target.checked;
    updatePlannerAndUI();
  });

  transCheck?.addEventListener("change", (e) => {
    state.allowTransfer = e.target.checked;
    updatePlannerAndUI();
  });
}

// 5. 路線圖互動模式與全螢幕切換
function initMapInteraction() {
  const modeFromBtn = document.getElementById("map-mode-from");
  const modeToBtn = document.getElementById("map-mode-to");
  const fullscreenBtn = document.getElementById("map-fullscreen-btn");
  const mapCard = document.getElementById("network-map-card");

  function updateModeButtons() {
    modeFromBtn.classList.toggle("active", state.activeClickMode === "from");
    modeToBtn.classList.toggle("active", state.activeClickMode === "to");
  }

  modeFromBtn.addEventListener("click", () => {
    state.activeClickMode = "from";
    updateModeButtons();
  });

  modeToBtn.addEventListener("click", () => {
    state.activeClickMode = "to";
    updateModeButtons();
  });

  function syncFullscreenButton() {
    if (!fullscreenBtn || !mapCard) return;
    const isFs = mapCard.classList.contains("map-card-fullscreen");
    fullscreenBtn.textContent = isFs ? "✕ 退出全螢幕" : "⛶ 全螢幕";
    fullscreenBtn.classList.toggle("active", isFs);
    document.body.classList.toggle("map-fs-active", isFs);
  }

  fullscreenBtn?.addEventListener("click", () => {
    if (!mapCard) return;
    mapCard.classList.toggle("map-card-fullscreen");
    syncFullscreenButton();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mapCard?.classList.contains("map-card-fullscreen")) {
      mapCard.classList.remove("map-card-fullscreen");
      syncFullscreenButton();
    }
  });

  updateModeButtons();
}

// 5b. 公車動態模擬引擎（預設為現在系統時間並暫停，時間軸自動對齊最早班次發車至最晚班次後 1 小時）
let simAnimFrameId = null;
let lastFrameTime = 0;
const simMarkerElements = new Map();
const simDom = {
  clockEl: null,
  countEl: null,
  sliderEl: null,
  playBtn: null,
  liveDot: null
};

function getScheduleTimeBounds() {
  let minDep = Infinity;
  let maxDep = -Infinity;
  for (const run of ALL_SCHEDULES) {
    const stList = run.stopTimes;
    if (!stList || stList.length === 0) continue;
    if (stList[0].timeMin < minDep) minDep = stList[0].timeMin;
    if (stList[0].timeMin > maxDep) maxDep = stList[0].timeMin;
  }
  return {
    min: Number.isFinite(minDep) ? minDep : 380,
    // 最晚發車班次往後加 1 小時 (60 分鐘)，確保末班車有充裕時間完整走完
    max: Number.isFinite(maxDep) ? maxDep + 60 : 1145
  };
}

let SIM_BOUNDS = getScheduleTimeBounds();

function refreshSimBounds() {
  SIM_BOUNDS = getScheduleTimeBounds();
  const sliderEl = simDom.sliderEl || document.getElementById("sim-time-slider");
  const edgeMinEl = document.getElementById("sim-edge-min");
  const edgeMaxEl = document.getElementById("sim-edge-max");
  if (sliderEl) {
    sliderEl.min = String(SIM_BOUNDS.min);
    sliderEl.max = String(SIM_BOUNDS.max);
  }
  if (edgeMinEl) edgeMinEl.textContent = minToTime(SIM_BOUNDS.min);
  if (edgeMaxEl) edgeMaxEl.textContent = minToTime(SIM_BOUNDS.max);
  simMarkerElements.clear();
  if (state.simActive) {
    renderSimBusesLayer();
  }
}

function getNowSystemMinutes() {
  const now = new Date();
  return (
    now.getHours() * 60 +
    now.getMinutes() +
    now.getSeconds() / 60 +
    now.getMilliseconds() / 60000
  );
}

function formatSimClock(minsFloat) {
  const normalized = ((minsFloat % 1440) + 1440) % 1440;
  const totalSec = Math.floor(normalized * 60);
  const hh = Math.floor(totalSec / 3600) % 24;
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function getActiveSimulatedBuses(simMin) {
  const active = [];
  for (const run of ALL_SCHEDULES) {
    const stList = run.stopTimes;
    if (!stList || stList.length < 2) continue;
    const startMin = stList[0].timeMin;
    const endMin = stList[stList.length - 1].timeMin;
    if (simMin < startMin || simMin > endMin) continue;

    // 找出目前所在的站間段落 [k, k+1]
    let segIdx = 0;
    for (let k = 0; k < stList.length - 1; k++) {
      if (simMin >= stList[k].timeMin && simMin <= stList[k + 1].timeMin) {
        segIdx = k;
        break;
      }
    }

    const stA = stList[segIdx];
    const stB = stList[segIdx + 1];
    const infoA = STOPS_INFO[stA.stop];
    const infoB = STOPS_INFO[stB.stop];
    if (!infoA || !infoB) continue;

    const span = Math.max(0.1, stB.timeMin - stA.timeMin);
    const ratio = Math.min(1, Math.max(0, (simMin - stA.timeMin) / span));
    const x = infoA.x + (infoB.x - infoA.x) * ratio;
    const y = infoA.y + (infoB.y - infoA.y) * ratio;

    active.push({
      run,
      x,
      y,
      fromStop: stA.stop,
      nextStop: stB.stop,
      terminalStop: stList[stList.length - 1].stop,
      progressRatio: ratio
    });
  }
  return active;
}

function syncSimPlayUI() {
  const playBtn = simDom.playBtn || document.getElementById("sim-play-btn");
  const liveDot = simDom.liveDot || document.getElementById("sim-live-dot");
  if (playBtn) {
    playBtn.textContent = state.simPlaying ? "⏸ 暫停" : "▶ 播放";
    playBtn.classList.toggle("active", state.simPlaying);
  }
  if (liveDot) {
    liveDot.classList.toggle("paused", !state.simPlaying);
  }
}

function createBusMarkerElement(b) {
  const isMtn = b.run.line === "山";
  const badgeFill = isMtn ? "#15803d" : "#0284c7";
  const badgeStroke = "#ffffff";
  // 固定依行駛方向決定標籤在上方或下方，避免新公車加入或移除時其他公車標籤上下跳動
  const labelOffsetY = b.run.dir === ACTIVE_ISLAND.leftDir ? -24 : 28;
  const tagText = `${b.run.line} ${b.run.time} ➔ ${b.terminalStop}`;
  const tagWidth = Math.max(96, tagText.length * 10.5);

  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", "sim-bus-marker");
  g.setAttribute("data-run-id", b.run.id);
  g.setAttribute("transform", `translate(${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
  g.style.cursor = "pointer";

  g.innerHTML = `
    <circle cx="0" cy="0" r="16" fill="${badgeFill}" opacity="0.25" class="sim-pulse-ring" />
    <circle cx="0" cy="0" r="11" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="2.5" />
    <text x="0" y="4" text-anchor="middle" font-size="11">🚌</text>
    <g transform="translate(0, ${labelOffsetY})">
      <rect x="${-tagWidth / 2}" y="-11" width="${tagWidth}" height="20" rx="6"
            fill="${badgeFill}" stroke="#ffffff" stroke-width="1.5" opacity="0.95" />
      <text x="0" y="3" text-anchor="middle" fill="#ffffff" font-size="10.5" font-weight="800">
        ${tagText}
      </text>
    </g>
  `;

  g.addEventListener("click", (e) => {
    e.stopPropagation();
    const runId = b.run.id;
    const foundRun = ALL_SCHEDULES.find((r) => r.id === runId) || null;
    state.highlightedRun =
      state.highlightedRun && state.highlightedRun.id === runId ? null : foundRun;
    syncActiveRunButtons();
    renderNetworkMap();
  });

  return g;
}

function renderSimBusesLayer() {
  const layer = document.getElementById("sim-buses-layer");
  const clockEl = simDom.clockEl || document.getElementById("sim-clock-text");
  const countEl = simDom.countEl || document.getElementById("sim-active-count");
  const sliderEl = simDom.sliderEl || document.getElementById("sim-time-slider");

  const nextClockText = formatSimClock(state.simTimeMin);
  if (clockEl && clockEl.textContent !== nextClockText) {
    clockEl.textContent = nextClockText;
  }
  if (sliderEl && document.activeElement !== sliderEl) {
    const clampedSliderVal = Math.min(SIM_BOUNDS.max, Math.max(SIM_BOUNDS.min, state.simTimeMin));
    sliderEl.value = String(clampedSliderVal.toFixed(2));
  }

  const activeBuses = getActiveSimulatedBuses(state.simTimeMin);
  const nextCountText = `行駛中 ${activeBuses.length} 輛`;
  if (countEl && countEl.textContent !== nextCountText) {
    countEl.textContent = nextCountText;
  }

  if (!layer) return;
  if (!state.simActive) {
    if (layer.firstChild) layer.innerHTML = "";
    simMarkerElements.clear();
    return;
  }

  // 以記憶體 Map 複用既有 SVG 節點，僅更新座標 transform，60fps 零 DOM 查詢且新車加入/移除時不卡頓
  const activeIds = new Set();
  for (const b of activeBuses) {
    const id = b.run.id;
    activeIds.add(id);
    let markerEl = simMarkerElements.get(id);
    if (!markerEl || markerEl.parentNode !== layer) {
      markerEl = createBusMarkerElement(b);
      simMarkerElements.set(id, markerEl);
      layer.appendChild(markerEl);
    } else {
      markerEl.setAttribute("transform", `translate(${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
    }
  }

  for (const [id, el] of simMarkerElements.entries()) {
    if (!activeIds.has(id)) {
      el.remove();
      simMarkerElements.delete(id);
    }
  }
}

function stepSimulation(timestamp) {
  if (!state.simActive) return;
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dtSec = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  if (state.simPlaying) {
    // 直接從目前所選的時間連續推進，若超過最晚班次收班時間或不在範圍內則從最早班次時間開始
    state.simTimeMin += (dtSec * state.simSpeed) / 60;

    if (state.simTimeMin < SIM_BOUNDS.min || state.simTimeMin >= SIM_BOUNDS.max) {
      state.simTimeMin = SIM_BOUNDS.min;
    }
    renderSimBusesLayer();
  }

  simAnimFrameId = requestAnimationFrame(stepSimulation);
}

function initBusSimulation() {
  const mapSimBtn = document.getElementById("map-sim-btn");
  const controlBar = document.getElementById("sim-control-bar");
  const playBtn = document.getElementById("sim-play-btn");
  const nowBtn = document.getElementById("sim-now-btn");
  const sliderEl = document.getElementById("sim-time-slider");
  const edgeMinEl = document.getElementById("sim-edge-min");
  const edgeMaxEl = document.getElementById("sim-edge-max");
  const speedBtns = document.querySelectorAll("[data-speed]");

  simDom.clockEl = document.getElementById("sim-clock-text");
  simDom.countEl = document.getElementById("sim-active-count");
  simDom.sliderEl = sliderEl;
  simDom.playBtn = playBtn;
  simDom.liveDot = document.getElementById("sim-live-dot");

  if (sliderEl) {
    sliderEl.min = String(SIM_BOUNDS.min);
    sliderEl.max = String(SIM_BOUNDS.max);
  }
  if (edgeMinEl) edgeMinEl.textContent = minToTime(SIM_BOUNDS.min);
  if (edgeMaxEl) edgeMaxEl.textContent = minToTime(SIM_BOUNDS.max);

  function toggleSimulation() {
    state.simActive = !state.simActive;
    if (mapSimBtn) {
      mapSimBtn.classList.toggle("active-sim", state.simActive);
      mapSimBtn.textContent = "▶ 公車動畫";
    }

    if (state.simActive) {
      controlBar?.removeAttribute("hidden");
      // 預設為現在系統時間，並保持暫停狀態
      state.simTimeMin = getNowSystemMinutes();
      state.simPlaying = false;
      syncSimPlayUI();
      renderSimBusesLayer();

      lastFrameTime = 0;
      if (simAnimFrameId) cancelAnimationFrame(simAnimFrameId);
      simAnimFrameId = requestAnimationFrame(stepSimulation);
    } else {
      controlBar?.setAttribute("hidden", "");
      state.simPlaying = false;
      syncSimPlayUI();
      if (simAnimFrameId) {
        cancelAnimationFrame(simAnimFrameId);
        simAnimFrameId = null;
      }
      renderSimBusesLayer();
    }
  }

  mapSimBtn?.addEventListener("click", toggleSimulation);

  playBtn?.addEventListener("click", () => {
    state.simPlaying = !state.simPlaying;
    // 若按下播放時，時間不在最早班次～最晚班次範圍內，自動從最早班次時間開始播放
    if (state.simPlaying && (state.simTimeMin < SIM_BOUNDS.min || state.simTimeMin >= SIM_BOUNDS.max)) {
      state.simTimeMin = SIM_BOUNDS.min;
    }
    lastFrameTime = 0;
    syncSimPlayUI();
    renderSimBusesLayer();
  });

  nowBtn?.addEventListener("click", () => {
    state.simTimeMin = getNowSystemMinutes();
    state.simPlaying = false;
    syncSimPlayUI();
    renderSimBusesLayer();
  });

  sliderEl?.addEventListener("input", (e) => {
    state.simTimeMin = parseFloat(e.target.value);
    renderSimBusesLayer();
  });

  // 支援手機直立時全螢幕透過 CSS 90 度橫向旋轉下的時間軸觸控拖曳 (如 iOS Safari)
  function handleRotatedSliderTouch(e) {
    const mapCard = document.getElementById("network-map-card");
    const isFs =
      document.fullscreenElement === mapCard || mapCard?.classList.contains("map-card-fullscreen");
    if (
      !isFs ||
      !window.matchMedia("(max-width: 900px) and (orientation: portrait) and (hover: none) and (pointer: coarse)").matches
    ) {
      return;
    }
    const touch = e.touches[0];
    if (!touch || !sliderEl) return;
    const rect = sliderEl.getBoundingClientRect();
    if (rect.height <= 0) return;
    e.preventDefault();
    const ratio = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));
    const minVal = parseFloat(sliderEl.min) || SIM_BOUNDS.min;
    const maxVal = parseFloat(sliderEl.max) || SIM_BOUNDS.max;
    state.simTimeMin = minVal + ratio * (maxVal - minVal);
    sliderEl.value = String(state.simTimeMin);
    renderSimBusesLayer();
  }

  sliderEl?.addEventListener("touchstart", handleRotatedSliderTouch, { passive: false });
  sliderEl?.addEventListener("touchmove", handleRotatedSliderTouch, { passive: false });

  speedBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.simSpeed = Number(btn.getAttribute("data-speed")) || 100;
      speedBtns.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
}

// 路網圖靜態拓撲與底圖快取（僅在載入時建立一次，避免每次點擊卡片或站點時重複組合數千點 SVG 路徑與物件）
const NANGAN_NETWORK_EDGES = [
  { a: "介壽站", b: "縣政府", type: "common" },
  { a: "縣政府", b: "酒廠", type: "common" },
  { a: "酒廠", b: "縣立醫院", type: "common" },
  { a: "縣立醫院", b: "福澳嶺", type: "common" },
  { a: "酒廠", b: "復興村", type: "branch", branch: "white" },
  { a: "酒廠", b: "八八坑道", type: "branch", branch: "red" },
  { a: "八八坑道", b: "機場", type: "branch", branch: "red" },
  { a: "福澳嶺", b: "聚英路口", type: "mtn" },
  { a: "聚英路口", b: "青檀澳", type: "mtn" },
  { a: "青檀澳", b: "加油站", type: "mtn" },
  { a: "加油站", b: "神農山莊", type: "mtn" },
  { a: "神農山莊", b: "梅石", type: "mtn" },
  { a: "梅石", b: "上腰山", type: "mtn" },
  { a: "上腰山", b: "中興嶺", type: "mtn" },
  { a: "中興嶺", b: "陽明橋", type: "mtn" },
  { a: "陽明橋", b: "八角亭", type: "mtn" },
  { a: "八角亭", b: "中山門", type: "mtn" },
  { a: "中山門", b: "儲水澳", type: "mtn" },
  { a: "儲水澳", b: "文化中心", type: "mtn" },
  { a: "中興嶺", b: "軍醫院", type: "branch", branch: "green" },
  { a: "軍醫院", b: "仁愛", type: "branch", branch: "green" },
  { a: "仁愛", b: "遊客中心", type: "branch", branch: "orange" },
  { a: "軍醫院", b: "陽明橋", type: "branch", branch: "green" },
  { a: "陽明橋", b: "監理站", type: "branch", branch: "blue" },
  { a: "監理站", b: "津沙公園", type: "branch", branch: "blue" },
  { a: "津沙公園", b: "津沙", type: "branch", branch: "blue" },
  { a: "福澳嶺", b: "福澳", type: "sea" },
  { a: "福澳", b: "福澳碼頭", type: "sea" },
  { a: "福澳", b: "三槍堡", type: "sea" },
  { a: "三槍堡", b: "清水", type: "sea" },
  { a: "清水", b: "勝利堡", type: "sea" },
  { a: "勝利堡", b: "珠螺", type: "sea" },
  { a: "珠螺", b: "文化中心", type: "sea" },
  { a: "文化中心", b: "馬港站", type: "common" },
  { a: "文化中心", b: "科蹄澳", type: "branch", branch: "yellow" },
  { a: "科蹄澳", b: "芙蓉澳", type: "branch", branch: "yellow" },
  { a: "芙蓉澳", b: "四維", type: "branch", branch: "yellow" },
  { a: "清水", b: "民俗文物館", type: "branch", branch: "grey" },
  { a: "民俗文物館", b: "下腰山", type: "branch", branch: "grey" },
  { a: "下腰山", b: "志清發電廠", type: "branch", branch: "grey" },
  { a: "志清發電廠", b: "中山門", type: "branch", branch: "grey" },
  { a: "梅石", b: "清水", type: "transfer" }
];

const BEIGAN_NETWORK_EDGES = [
  // 后澳支線與衛生所支線
  { a: "塘岐", b: "后澳", type: "branch", branch: "houao" },
  { a: "塘岐", b: "衛生所", type: "branch", branch: "clinic" },
  { a: "衛生所", b: "警察所", type: "branch", branch: "clinic" },
  { a: "衛生所", b: "莒光堡", type: "branch", branch: "clinic" },

  // 山線主線與午沙支線
  { a: "塘岐", b: "警察所", type: "mtn" },
  { a: "警察所", b: "軍醫院", type: "mtn" },
  { a: "軍醫院", b: "碧園", type: "mtn" },
  { a: "碧園", b: "午沙", type: "branch", branch: "wusha" },
  { a: "碧園", b: "加油站", type: "mtn" },
  { a: "加油站", b: "上村", type: "mtn" },
  { a: "上村", b: "坂里水庫", type: "mtn" },

  // 海線主線
  { a: "塘岐", b: "莒光堡", type: "sea" },
  { a: "莒光堡", b: "橋仔", type: "sea" },
  { a: "橋仔", b: "開心農場", type: "sea" },
  { a: "開心農場", b: "芹壁", type: "sea" },
  { a: "芹壁", b: "中山國中", type: "sea" },
  { a: "中山國中", b: "坂里水庫", type: "sea" },

  // 西側共線段（坂里水庫～白沙）
  { a: "坂里水庫", b: "坂里村", type: "common" },
  { a: "坂里村", b: "中沃口", type: "common" },
  { a: "中沃口", b: "白沙", type: "common" }
];

const NANGAN_LABEL_OFFSETS = {
  "復興村": [0, -12],
  "酒廠": [-22, -8],
  "八八坑道": [30, -8],
  "機場": [26, 5],
  "縣政府": [28, 4],
  "介壽站": [28, 12],
  "縣立醫院": [0, -12],
  "福澳嶺": [-22, -9],
  "聚英路口": [-6, 20],
  "福澳碼頭": [0, -12],
  "福澳": [-22, 4],
  "三槍堡": [26, -6],
  "清水": [-22, -8],
  "勝利堡": [0, -12],
  "珠螺": [0, -12],
  "青檀澳": [28, 5],
  "加油站": [28, 8],
  "神農山莊": [0, 20],
  "梅石": [20, -9],
  "民俗文物館": [0, -13],
  "上腰山": [0, 20],
  "下腰山": [6, -13],
  "志清發電廠": [12, -14],
  "中興嶺": [26, 4],
  "軍醫院": [28, 4],
  "仁愛": [-22, 4],
  "遊客中心": [0, 20],
  "陽明橋": [26, 4],
  "監理站": [0, 20],
  "津沙公園": [0, -12],
  "津沙": [0, 20],
  "八角亭": [-26, 4],
  "中山門": [-6, -15],
  "儲水澳": [-26, 4],
  "文化中心": [22, -10],
  "馬港站": [-26, 10],
  "科蹄澳": [-26, 4],
  "芙蓉澳": [26, 4],
  "四維": [0, -12]
};

const BEIGAN_LABEL_OFFSETS = {
  "塘岐": [24, -10],
  "后澳": [0, 22],
  "衛生所": [18, 18],
  "警察所": [-16, -12],
  "軍醫院": [0, 20],
  "碧園": [0, -13],
  "午沙": [0, 20],
  "加油站": [0, 20],
  "上村": [-10, 20],
  "莒光堡": [28, 4],
  "橋仔": [0, -13],
  "開心農場": [-34, -6],
  "芹壁": [8, -13],
  "中山國中": [-16, -13],
  "坂里水庫": [-34, -4],
  "坂里村": [28, 5],
  "中沃口": [-28, -4],
  "白沙": [24, 6]
};

function buildIslandBaseSvg(realMap, isBeigan = false) {
  const realWaterSvg = (realMap ? realMap.waterPaths : [])
    .map((d) => `<path d="${d}" fill="#7dd3fc" stroke="#38bdf8" stroke-width="0.9" opacity="0.88" />`)
    .join("");

  const realRoadsSvg = (realMap ? realMap.roadPaths : [])
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#cbd5e1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.65" />`
    )
    .join("");

  const realRunwaySvg = (realMap ? realMap.runwayPaths : [])
    .map(
      (d) => `
        <path d="${d}" fill="none" stroke="#94a3b8" stroke-width="11" stroke-linecap="butt" opacity="0.85" />
        <path d="${d}" fill="none" stroke="#f8fafc" stroke-width="1.4" stroke-dasharray="6,5" opacity="0.95" />
      `
    )
    .join("");

  const coastlineD = realMap && realMap.coastlinePath ? realMap.coastlinePath : "";

  const terrainAndLandmarksSvg = isBeigan
    ? `
      <!-- 北竿山脈地形暈染（壁山 298m 馬祖第一高峰、芹山 229m、大澳山 145m、尼姑山 122m） -->
      <ellipse cx="511" cy="173" rx="70" ry="42" fill="url(#peak-yuntai)" />
      <ellipse cx="511" cy="173" rx="40" ry="22" fill="none" stroke="#86efac" stroke-width="1.1" stroke-dasharray="5,4" opacity="0.7" />
      <ellipse cx="324" cy="215" rx="46" ry="30" fill="url(#peak-yuntai)" />
      <ellipse cx="822" cy="173" rx="52" ry="34" fill="url(#peak-yuntai)" />
      <ellipse cx="164" cy="445" rx="34" ry="26" fill="url(#peak-yuntai)" />

      <!-- 北竿島真實水庫（坂里水庫、橋仔水庫）與真實道路底圖 -->
      <g style="pointer-events:none;">${realWaterSvg}</g>
      <g style="pointer-events:none;">${realRoadsSvg}</g>

      <!-- 北竿航空站真實跑道 (03/21) -->
      <g style="pointer-events:none;">${realRunwaySvg}</g>

      <!-- 北竿地理分區與山岳澳口地標浮水印 -->
      <g fill="#15803d" opacity="0.62" font-size="10.5" font-weight="700" style="pointer-events:none;">
        <text x="502" y="168" text-anchor="middle">⛰️ 壁山 (298m)</text>
        <text x="822" y="166" text-anchor="middle">⛰️ 大澳山 (145m)</text>
        <text x="415" y="66" text-anchor="middle" fill="#0369a1" font-size="13" letter-spacing="3" opacity="0.72">馬祖北竿</text>
        <text x="108" y="382" text-anchor="middle" fill="#0284c7" font-size="10">白沙港</text>
        <text x="512" y="55" text-anchor="middle" fill="#0284c7" font-size="10">橋仔港</text>
        <text x="315" y="292" text-anchor="middle" fill="#0284c7" font-size="10">坂里沙灘</text>
        <text x="712" y="228" text-anchor="middle" fill="#0284c7" font-size="10">塘后沙灘</text>
        <text x="724" y="156" text-anchor="middle" fill="#475569" font-size="10">✈️ 北竿機場</text>
      </g>
    `
    : `
      <!-- 南竿山脈地形暈染（雲台山 248m、牛背嶺、牛角嶺） -->
      <ellipse cx="305" cy="348" rx="75" ry="44" fill="url(#peak-yuntai)" />
      <ellipse cx="305" cy="348" rx="44" ry="24" fill="none" stroke="#86efac" stroke-width="1.1" stroke-dasharray="5,4" opacity="0.7" />
      <ellipse cx="535" cy="345" rx="58" ry="34" fill="url(#peak-yuntai)" />
      <ellipse cx="688" cy="222" rx="48" ry="32" fill="url(#peak-yuntai)" />

      <!-- 南竿島真實水庫（儲水澳水庫、勝利水庫、津沙水庫、秋桂山水庫）與真實道路底圖 -->
      <g style="pointer-events:none;">${realWaterSvg}</g>
      <g style="pointer-events:none;">${realRoadsSvg}</g>

      <!-- 南竿航空站真實跑道 (03/21) -->
      <g style="pointer-events:none;">${realRunwaySvg}</g>

      <!-- 地理分區與山岳澳口地標浮水印 -->
      <g fill="#15803d" opacity="0.6" font-size="10.5" font-weight="700" style="pointer-events:none;">
        <text x="305" y="346" text-anchor="middle">⛰️ 雲台山 (248m)</text>
        <text x="515" y="95" text-anchor="middle" fill="#0369a1" font-size="13" letter-spacing="3" opacity="0.7">馬祖南竿</text>
        <text x="542" y="198" text-anchor="middle" fill="#0284c7" font-size="10">福澳港</text>
        <text x="168" y="254" text-anchor="middle" fill="#0284c7" font-size="10">馬祖港</text>
        <text x="118" y="446" text-anchor="middle" fill="#0284c7" font-size="10">津沙澳</text>
        <text x="308" y="485" text-anchor="middle" fill="#0284c7" font-size="10">鐵板澳</text>
        <text x="795" y="228" text-anchor="middle" fill="#475569" font-size="10">✈️ 南竿機場</text>
      </g>
    `;

  return `
    <defs>
      <linearGradient id="sea-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#dbeafe" />
        <stop offset="50%" stop-color="#e0f2fe" />
        <stop offset="100%" stop-color="#bae6fd" />
      </linearGradient>
      <linearGradient id="land-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#f0fdf4" />
        <stop offset="55%" stop-color="#dcfce7" />
        <stop offset="100%" stop-color="#ecfccb" />
      </linearGradient>
      <radialGradient id="peak-yuntai" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#86efac" stop-opacity="0.55" />
        <stop offset="65%" stop-color="#bbf7d0" stop-opacity="0.25" />
        <stop offset="100%" stop-color="#dcfce7" stop-opacity="0" />
      </radialGradient>
      <filter id="island-shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#0284c7" flood-opacity="0.24" />
      </filter>
      <marker id="arrow-active" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#f97316" />
      </marker>
    </defs>

    <!-- 馬祖海域背景與真實經緯度網格 -->
    <rect x="0" y="0" width="1000" height="540" fill="url(#sea-grad)" rx="10" />
    <g stroke="#93c5fd" stroke-width="0.6" stroke-dasharray="4,6" opacity="0.45">
      <line x1="0" y1="135" x2="1000" y2="135" />
      <line x1="0" y1="270" x2="1000" y2="270" />
      <line x1="0" y1="405" x2="1000" y2="405" />
      <line x1="250" y1="0" x2="250" y2="540" />
      <line x1="500" y1="0" x2="500" y2="540" />
      <line x1="750" y1="0" x2="750" y2="540" />
    </g>

    <!-- 真實海岸線輪廓（取自 OpenStreetMap 連江縣南竿島／北竿島真實海岸線多邊形） -->
    <path d="${coastlineD}"
          fill="none" stroke="#bae6fd" stroke-width="8" stroke-linejoin="round" opacity="0.7" />
    <path d="${coastlineD}"
          fill="url(#land-grad)" stroke="#22c55e" stroke-width="1.8" stroke-linejoin="round" filter="url(#island-shadow)" />

    ${terrainAndLandmarksSvg}

    <!-- 指北針 -->
    <g transform="translate(952, 82)" opacity="0.75" style="pointer-events:none;">
      <circle cx="0" cy="0" r="16" fill="#ffffff" fill-opacity="0.8" stroke="#94a3b8" stroke-width="1.2" />
      <polygon points="0,-12 4,4 0,1 -4,4" fill="#dc2626" />
      <text x="0" y="13" text-anchor="middle" fill="#334155" font-size="8" font-weight="800">N</text>
    </g>
  `;
}

const STATIC_MAP_BASE_SVG_BY_ISLAND = {
  nangan: buildIslandBaseSvg(typeof NANGAN_REAL_MAP !== "undefined" ? NANGAN_REAL_MAP : null, false),
  beigan: buildIslandBaseSvg(typeof BEIGAN_REAL_MAP !== "undefined" ? BEIGAN_REAL_MAP : null, true)
};

// 繪製路網圖
function renderNetworkMap() {
  const svg = document.getElementById("network-map-svg");
  if (!svg) return;

  const activeStops = new Set();
  const activeDirectedEdges = [];
  const transferHubs = new Set();

  // 判斷目前地圖應高亮去程還是返程（若選取的卡片切到「返程」子卡，地圖同步顯示返程路線）
  const isShowingReturn =
    !state.highlightedRun &&
    state.highlightedPlan &&
    state.highlightedPlan.activeSubcard === "return" &&
    state.highlightedPlan.fastestReturn;

  const mapPlan = isShowingReturn ? state.highlightedPlan.fastestReturn : state.highlightedPlan;

  if (state.highlightedRun) {
    // 顯示單一班次的完整行駛路線
    const sList = state.highlightedRun.stopTimes;
    for (let i = 0; i < sList.length; i++) {
      activeStops.add(sList[i].stop);
      if (i < sList.length - 1) {
        activeDirectedEdges.push({ from: sList[i].stop, to: sList[i + 1].stop });
      }
    }
  } else if (mapPlan) {
    for (const leg of mapPlan.legs) {
      const sList = leg.passedStops.map((p) => p.stop);
      for (let i = 0; i < sList.length; i++) {
        activeStops.add(sList[i]);
        if (i < sList.length - 1) {
          activeDirectedEdges.push({ from: sList[i], to: sList[i + 1] });
        }
      }
    }
    if (mapPlan.type === "transfer") {
      transferHubs.add(mapPlan.transferStop1);
      transferHubs.add(mapPlan.transferStop2);
    }
  }

  const hasHighlight = Boolean(state.highlightedRun || state.highlightedPlan);
  const currentBaseSvg = STATIC_MAP_BASE_SVG_BY_ISLAND[state.island] || STATIC_MAP_BASE_SVG_BY_ISLAND.nangan;
  const currentEdges = state.island === "beigan" ? BEIGAN_NETWORK_EDGES : NANGAN_NETWORK_EDGES;
  const currentLabelOffsets = state.island === "beigan" ? BEIGAN_LABEL_OFFSETS : NANGAN_LABEL_OFFSETS;

  let html =
    currentBaseSvg +
    `
    <rect x="18" y="18" width="430" height="26" rx="6" fill="#ffffff" fill-opacity="0.82" />
    <text x="28" y="35" fill="#334155" font-size="12" font-weight="700">${
      state.highlightedRun
        ? `🚌 橘線：${state.highlightedRun.line}線 ${state.highlightedRun.time} 班次完整行駛路線（含支線折返）`
        : "綠線：山線 ｜ 藍線：海線 ｜ 橘線：當前選取路線"
    }</text>
    ${
      hasHighlight
        ? `
      <g id="clear-map-highlight-btn" style="cursor:pointer;">
        <rect x="456" y="18" width="112" height="26" rx="6" fill="#ea580c" stroke="#ffffff" stroke-width="1.2" />
        <text x="512" y="35" text-anchor="middle" fill="#ffffff" font-size="11.5" font-weight="700">✕ 取消路線顯示</text>
      </g>
    `
        : ""
    }
  `;

  for (const edge of currentEdges) {
    const sA = STOPS_INFO[edge.a];
    const sB = STOPS_INFO[edge.b];
    if (!sA || !sB) continue;

    let stroke = "#94a3b8";
    let width = 3.5;
    let dash = "";

    if (edge.type === "common") {
      stroke = "#334155";
      width = 5;
    } else if (edge.type === "mtn") {
      stroke = "#16a34a";
      width = 4.5;
    } else if (edge.type === "sea") {
      stroke = "#0284c7";
      width = 4.5;
    } else if (edge.type === "transfer") {
      stroke = "#111827";
      width = 3;
      dash = "6,5";
    } else if (edge.type === "branch") {
      const br = BRANCHES[edge.branch];
      stroke = br.id === "white" ? "#64748b" : br.dotColor || br.color;
      width = 3;
      dash = "4,4";
    }

    html += `<line x1="${sA.x}" y1="${sA.y}" x2="${sB.x}" y2="${sB.y}"
                   stroke="${stroke}" stroke-width="${width}" stroke-dasharray="${dash}"
                   stroke-linecap="round" opacity="${hasHighlight ? 0.25 : 0.75}" />`;
  }

  for (const dEdge of activeDirectedEdges) {
    const sA = STOPS_INFO[dEdge.from];
    const sB = STOPS_INFO[dEdge.to];
    if (!sA || !sB) continue;
    html += `<line x1="${sA.x}" y1="${sA.y}" x2="${sB.x}" y2="${sB.y}"
                   stroke="#f97316" stroke-width="6" stroke-linecap="round"
                   marker-end="url(#arrow-active)" class="active-route-line" />`;
  }

  if (
    !state.highlightedRun &&
    mapPlan &&
    mapPlan.type === "transfer" &&
    mapPlan.transferStop1 !== mapPlan.transferStop2
  ) {
    const s1 = STOPS_INFO[mapPlan.transferStop1];
    const s2 = STOPS_INFO[mapPlan.transferStop2];
    if (s1 && s2) {
      html += `<line x1="${s1.x}" y1="${s1.y}" x2="${s2.x}" y2="${s2.y}"
                     stroke="#7c3aed" stroke-width="5" stroke-dasharray="6,4" />`;
    }
  }

  const runOriginStop = state.highlightedRun ? state.highlightedRun.stops[0] : null;
  const runTermStop = state.highlightedRun
    ? state.highlightedRun.stops[state.highlightedRun.stops.length - 1]
    : null;
  const effectiveFromStop = isShowingReturn ? state.toStop : state.fromStop;
  const effectiveToStop = isShowingReturn ? state.fromStop : state.toStop;

  for (const [stopName, info] of Object.entries(STOPS_INFO)) {
    const isFrom = state.highlightedRun ? stopName === runOriginStop : stopName === effectiveFromStop;
    const isTo = state.highlightedRun ? stopName === runTermStop : stopName === effectiveToStop;
    const isTransfer = !state.highlightedRun && transferHubs.has(stopName);
    const isActive = activeStops.has(stopName);

    let r = info.hub ? 7.5 : 5.5;
    let fill = "#ffffff";
    let stroke = "#334155";
    let strokeWidth = 2.5;

    if (info.branch) {
      const br = BRANCHES[info.branch];
      fill = br.color;
      stroke = br.border;
    } else if (info.line === "山") {
      stroke = "#15803d";
    } else if (info.line === "海") {
      stroke = "#0369a1";
    }

    if (isActive) {
      r = 7.5;
      stroke = "#ea580c";
      strokeWidth = 3;
    }
    if (isTransfer) {
      r = 9.5;
      fill = "#f3e8ff";
      stroke = "#7c3aed";
      strokeWidth = 3.5;
    }
    if (isFrom) {
      r = 10.5;
      fill = "#16a34a";
      stroke = "#ffffff";
      strokeWidth = 3;
    } else if (isTo) {
      r = 10.5;
      fill = "#dc2626";
      stroke = "#ffffff";
      strokeWidth = 3;
    }

    const opacity = hasHighlight && !isActive && !isFrom && !isTo ? "0.35" : "1";
    const [textXOffset, textYOffset] = currentLabelOffsets[stopName] || [0, -12];

    const labelWeight = isFrom || isTo || isTransfer || info.hub ? "700" : "600";
    const labelColor = isFrom
      ? "#15803d"
      : isTo
      ? "#b91c1c"
      : isTransfer
      ? "#6d28d9"
      : "#0f172a";

    html += `
      <g class="map-stop-node" data-stop="${stopName}" style="cursor:pointer; opacity:${opacity}">
        <circle cx="${info.x}" cy="${info.y}" r="${r + 5}" fill="transparent" />
        <circle cx="${info.x}" cy="${info.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
        ${
          isFrom
            ? `<text x="${info.x}" y="${info.y + 4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">起</text>`
            : isTo
            ? `<text x="${info.x}" y="${info.y + 4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">終</text>`
            : isTransfer
            ? `<text x="${info.x}" y="${info.y + 4}" text-anchor="middle" fill="#6d28d9" font-size="9" font-weight="bold">轉</text>`
            : ""
        }
        <text x="${info.x + textXOffset}" y="${info.y + textYOffset}"
              text-anchor="middle" fill="${labelColor}" font-size="12" font-weight="${labelWeight}"
              paint-order="stroke" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round">
          ${stopName}
        </text>
      </g>
    `;
  }

  html += `<g id="sim-buses-layer"></g>`;
  svg.innerHTML = html;

  if (state.simActive) {
    renderSimBusesLayer();
  }

  svg.querySelector("#clear-map-highlight-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.highlightedPlan = null;
    state.highlightedRun = null;
    document.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("selected-card"));
    syncActiveRunButtons();
    renderNetworkMap();
  });

  svg.querySelectorAll(".map-stop-node").forEach((node) => {
    node.addEventListener("click", () => {
      const clickedStop = node.getAttribute("data-stop");
      if (state.activeClickMode === "from") {
        state.fromStop = clickedStop;
        document.getElementById("from-stop").value = clickedStop;
        state.activeClickMode = "to";
      } else {
        state.toStop = clickedStop;
        document.getElementById("to-stop").value = clickedStop;
        state.activeClickMode = "from";
      }
      document.getElementById("map-mode-from").classList.toggle("active", state.activeClickMode === "from");
      document.getElementById("map-mode-to").classList.toggle("active", state.activeClickMode === "to");
      updatePlannerAndUI();
    });
  });
}

// 支線色點徽章
function renderBranchDots(branches, showNames = true) {
  if (!branches || branches.length === 0) return "";
  return branches
    .map((bKey) => {
      const br = BRANCHES[bKey];
      if (!br) return "";
      return `
        <span class="branch-badge" style="background:${br.bgLight}; border-color:${br.border};" title="${br.fullName}">
          <span class="branch-dot" style="background:${br.color}; border-color:${br.border};"></span>
          ${showNames ? `<span class="branch-name">${br.name.replace("支線", "")}</span>` : ""}
        </span>
      `;
    })
    .join("");
}

// 同步「完整班次路線」按鈕選取狀態
function syncActiveRunButtons() {
  const activeRunId = state.highlightedRun ? state.highlightedRun.id : null;
  document.querySelectorAll(".run-route-btn").forEach((btn) => {
    btn.classList.toggle("active-run-btn", btn.getAttribute("data-run-id") === activeRunId);
  });
}

// 更新路線規劃與結果畫面（可傳入 preferredPlan 指定預設選取並加上橘色邊框的班次）
function updatePlannerAndUI(preferredPlan = null) {
  const resultsContainer = document.getElementById("route-results");
  const summaryBanner = document.getElementById("route-summary-banner");

  if (state.fromStop === state.toStop) {
    state.highlightedPlan = null;
    state.highlightedRun = null;
    summaryBanner.innerHTML = `<div class="empty-notice">請選擇不同的起點與終點站。</div>`;
    resultsContainer.innerHTML = "";
    renderNetworkMap();
    return;
  }

  const effectiveQueryTime = state.timeScope === "allday" ? "00:00" : getCurrentTime24h();

  const planResult = planRoutes({
    fromStop: state.fromStop,
    toStop: state.toStop,
    queryTimeStr: effectiveQueryTime,
    onlyAccessible: state.onlyAccessible,
    allowTransfer: state.allowTransfer
  });

  const allUpcoming = [...planResult.direct, ...planResult.transfers].sort(
    (a, b) => a.depTimeMin - b.depTimeMin || a.arrTimeMin - b.arrTimeMin
  );

  let selectedIdx = -1;
  if (preferredPlan && allUpcoming.length > 0) {
    const exactIdx = allUpcoming.findIndex(
      (p) =>
        p.depTimeMin === preferredPlan.depTimeMin &&
        p.legs[0]?.run?.id === preferredPlan.legs[0]?.run?.id
    );
    if (exactIdx !== -1) {
      selectedIdx = exactIdx;
    } else {
      const timeIdx = allUpcoming.findIndex((p) => p.depTimeMin >= preferredPlan.depTimeMin);
      if (timeIdx !== -1) selectedIdx = timeIdx;
    }
  }

  state.highlightedPlan = selectedIdx >= 0 ? allUpcoming[selectedIdx] || null : null;
  state.highlightedRun = null;

  const scopeLabel =
    state.timeScope === "allday"
      ? `整天共 <strong>${allUpcoming.length}</strong> 個方案`
      : `現在 (${effectiveQueryTime}) 後尚有 <strong>${allUpcoming.length}</strong> 個未發車方案`;

  summaryBanner.innerHTML = `
    <div class="summary-bar">
      <div class="summary-route-title">
        <span class="stop-pill from-pill">${state.fromStop}</span>
        <span class="route-arrow">➔</span>
        <span class="stop-pill to-pill">${state.toStop}</span>
      </div>
      <span class="summary-count-text">${scopeLabel}</span>
    </div>
  `;

  let cardsHtml = "";

  if (allUpcoming.length === 0) {
    cardsHtml += `
      <div class="no-route-box">
        <strong>目前 (${effectiveQueryTime}) 今日已無尚未發車之班次</strong>（末班車約 ${ACTIVE_ISLAND.lastBusTime || "18:05"} 發車）。可點選上方「<strong>整天</strong>」查看全日班次。
      </div>
    `;
  } else {
    allUpcoming.forEach((plan, idx) => {
      cardsHtml += renderPlanCard(plan, idx, idx === selectedIdx, false);
    });
  }

  resultsContainer.innerHTML = cardsHtml;

  if (preferredPlan && selectedIdx > 0) {
    const targetCardEl = resultsContainer.querySelector(`.plan-card[data-plan-idx="${selectedIdx}"]`);
    targetCardEl?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // 綁定單張路線卡片的所有互動事件
  function bindCardEvents(card) {
    const planIdx = Number(card.getAttribute("data-plan-idx"));
    const targetPlan = allUpcoming[planIdx];

    card.addEventListener("click", () => {
      const isAlreadySelected =
        card.classList.contains("selected-card") &&
        state.highlightedPlan === targetPlan &&
        !state.highlightedRun;

      if (isAlreadySelected) {
        // 再次點擊已選取的橘框卡片 -> 取消選取與地圖路線顯示
        state.highlightedPlan = null;
        state.highlightedRun = null;
        card.classList.remove("selected-card");
      } else {
        state.highlightedPlan = targetPlan;
        state.highlightedRun = null;
        resultsContainer.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("selected-card"));
        card.classList.add("selected-card");
      }
      syncActiveRunButtons();
      renderNetworkMap();
    });

    // 點擊詳細區塊內的「去程卡片」或「返程卡片」切換選取狀態（若再次點擊已選取的子卡則取消顯示）
    card.querySelectorAll(".trip-subcard").forEach((subcard) => {
      subcard.addEventListener("click", (e) => {
        e.stopPropagation();
        const dir = subcard.getAttribute("data-trip-dir");
        if (dir === "return" && !targetPlan.fastestReturn) return;

        const currentDir = targetPlan.activeSubcard || "outbound";
        const isAlreadySelectedSubcard =
          card.classList.contains("selected-card") &&
          state.highlightedPlan === targetPlan &&
          currentDir === dir &&
          !state.highlightedRun;

        if (isAlreadySelectedSubcard) {
          state.highlightedPlan = null;
          state.highlightedRun = null;
          card.classList.remove("selected-card");
          syncActiveRunButtons();
          renderNetworkMap();
          return;
        }

        targetPlan.activeSubcard = dir;
        state.highlightedPlan = targetPlan;
        state.highlightedRun = null;

        card.querySelectorAll(".trip-subcard").forEach((sc) => {
          const isThis = sc.getAttribute("data-trip-dir") === dir;
          sc.classList.toggle("active-subcard", isThis);
          sc.classList.toggle("inactive-subcard", !isThis);
        });

        resultsContainer.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("selected-card"));
        card.classList.add("selected-card");
        syncActiveRunButtons();
        renderNetworkMap();
      });
    });

    // 點擊返程卡片上的「終點 ➔ 起點」按鈕，直接將主查詢切換為該起訖方向，並將橘色框定位到對應的返程班次
    card.querySelectorAll(".switch-route-dir-btn").forEach((swBtn) => {
      swBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const chosenReturnPlan = targetPlan.fastestReturn || null;
        const temp = state.fromStop;
        state.fromStop = state.toStop;
        state.toStop = temp;
        const fromSelect = document.getElementById("from-stop");
        const toSelect = document.getElementById("to-stop");
        if (fromSelect) fromSelect.value = state.fromStop;
        if (toSelect) toSelect.value = state.toStop;
        updatePlannerAndUI(chosenReturnPlan);
      });
    });

    card.querySelectorAll(".run-route-btn").forEach((runBtn) => {
      runBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const parentSubcard = runBtn.closest(".trip-subcard");
        if (parentSubcard) {
          const dir = parentSubcard.getAttribute("data-trip-dir");
          if (dir) {
            targetPlan.activeSubcard = dir;
            card.querySelectorAll(".trip-subcard").forEach((sc) => {
              const isThis = sc.getAttribute("data-trip-dir") === dir;
              sc.classList.toggle("active-subcard", isThis);
              sc.classList.toggle("inactive-subcard", !isThis);
            });
          }
        }
        const runId = runBtn.getAttribute("data-run-id");
        const foundRun = ALL_SCHEDULES.find((r) => r.id === runId) || null;
        state.highlightedPlan = targetPlan;
        state.highlightedRun =
          state.highlightedRun && state.highlightedRun.id === runId ? null : foundRun;
        resultsContainer.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("selected-card"));
        card.classList.add("selected-card");
        syncActiveRunButtons();
        renderNetworkMap();
      });
    });

    card.querySelectorAll(".transfer-opt-btn").forEach((optBtn) => {
      optBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const optIdx = Number(optBtn.getAttribute("data-opt-idx"));
        const chosenOpt = targetPlan.nextLegOptions?.[optIdx];
        if (!chosenOpt) return;

        targetPlan.selectedNextIdx = optIdx;
        targetPlan.legs[1] = chosenOpt.seg2;
        targetPlan.arrTimeMin = chosenOpt.seg2.arrTimeMin;
        targetPlan.arrTimeStr = chosenOpt.seg2.arrTimeStr;
        targetPlan.waitTransferMin = chosenOpt.waitTransferMin;
        targetPlan.totalDurationMin = chosenOpt.totalDurationMin;
        targetPlan.warnings = chosenOpt.warnings;
        targetPlan.fastestReturn = chosenOpt.fastestReturn || null;

        state.highlightedPlan = targetPlan;
        state.highlightedRun = null;

        const wasExpanded = !card.querySelector(".card-detail-section")?.hasAttribute("hidden");
        const tempWrapper = document.createElement("div");
        tempWrapper.innerHTML = renderPlanCard(targetPlan, planIdx, true, false).trim();
        const newCard = tempWrapper.firstElementChild;
        if (wasExpanded) {
          newCard.querySelector(".card-detail-section")?.removeAttribute("hidden");
          const toggleBtn = newCard.querySelector(".toggle-detail-btn");
          if (toggleBtn) toggleBtn.textContent = "收合 ▴";
        }
        resultsContainer.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("selected-card"));
        newCard.classList.add("selected-card");
        card.replaceWith(newCard);
        bindCardEvents(newCard);
        syncActiveRunButtons();
        renderNetworkMap();
      });
    });

    card.querySelector(".toggle-detail-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const detailBlock = card.querySelector(".card-detail-section");
      const isHidden = detailBlock.hasAttribute("hidden");
      if (isHidden) {
        detailBlock.removeAttribute("hidden");
        e.currentTarget.textContent = "收合 ▴";
      } else {
        detailBlock.setAttribute("hidden", "");
        e.currentTarget.textContent = "詳細 ▾";
      }
    });
  }

  resultsContainer.querySelectorAll(".plan-card").forEach(bindCardEvents);

  renderNetworkMap();
}

function getRunOriginLabel(r) {
  if (r.note && r.note.includes("梅石發車")) return "梅石發";
  return r.dir === ACTIVE_ISLAND.leftDir ? ACTIVE_ISLAND.leftOriginLabel : ACTIVE_ISLAND.rightOriginLabel;
}

// 渲染路線卡片（預設收合詳細區塊，點擊卡片「詳細 ▾ / 收合 ▴」切換展開）
function renderPlanCard(plan, idx, isSelected = false) {
  const isTransfer = plan.type === "transfer";

  const trStopLabel = isTransfer
    ? plan.transferStop1 === plan.transferStop2
      ? plan.transferStop1
      : `${plan.transferStop1}→${plan.transferStop2}`
    : "";

  const badgesHtml = isTransfer
    ? `<span class="tag-badge transfer-badge">🔄 轉乘（${trStopLabel}）</span>`
    : `<span class="tag-badge direct-badge">直達</span>`;

  // 一行式極簡班次摘要（點擊班次可於地圖顯示該班次完整路線）
  const simpleBarHtml = plan.legs
    .map((leg) => {
      const r = leg.run;
      const originName = getRunOriginLabel(r);
      const lineClass = r.line === "山" ? "line-mtn" : "line-sea";
      return `
        <button type="button" class="simple-leg-chip run-route-btn" data-run-id="${r.id}" title="點擊在地圖顯示「${r.line}線 ${r.time} ${originName}」完整路線">
          <span class="line-pill ${lineClass}">${r.line}線</span>
          <strong class="run-origin-time">${r.time} ${originName}</strong>
          ${r.accessible ? `<span class="wheelchair-badge" title="無障礙公車">♿</span>` : ""}
        </button>
      `;
    })
    .join(`<span class="simple-transfer-pill">➔ ${trStopLabel}轉乘 ➔</span>`);

  // 【詳細區塊】包含支線色點、分段上下車時間、轉乘等候時間、特殊提醒與沿途各站時間軸
  const detailLegsHtml = plan.legs
    .map((leg, lIdx) => {
      const r = leg.run;
      const originName = getRunOriginLabel(r);
      const lineClass = r.line === "山" ? "line-mtn" : "line-sea";

      const stopsList = leg.passedStops
        .map((st, sIdx) => {
          const isFirst = sIdx === 0;
          const isLast = sIdx === leg.passedStops.length - 1;
          return `
            <div class="timeline-stop ${isFirst ? "tl-start" : isLast ? "tl-end" : ""}">
              <span class="tl-time">${st.timeStr}</span>
              <span class="tl-dot"></span>
              <span class="tl-name">${st.stop}</span>
            </div>
          `;
        })
        .join("");

      let transferSelectorHtml = "";
      if (isTransfer && lIdx === 0) {
        const nextOpts = plan.nextLegOptions || [];
        const activeOptIdx = plan.selectedNextIdx || 0;
        if (nextOpts.length > 0) {
          const optButtons = nextOpts
            .map((opt, oIdx) => {
              const r2 = opt.seg2.run;
              const orig2 = getRunOriginLabel(r2);
              const lClass2 = r2.line === "山" ? "line-mtn" : "line-sea";
              const isSel = oIdx === activeOptIdx;
              return `
                <button type="button" class="transfer-opt-btn ${isSel ? "active" : ""}" data-opt-idx="${oIdx}">
                  <span class="opt-rank-badge">班次 ${oIdx + 1}</span>
                  <span class="line-pill ${lClass2}">${r2.line}線</span>
                  <strong>${r2.time} ${orig2}</strong>
                  <span class="opt-wait-meta">${opt.seg2.depTimeStr} 上車（候車 ${opt.waitTransferMin} 分）</span>
                </button>
              `;
            })
            .join("");

          transferSelectorHtml = `
            <div class="transfer-choice-box">
              <div class="compact-transfer-hint">🔄 於 <strong>${plan.transferStop2}</strong> 轉乘（最近 ${nextOpts.length} 班可選）：</div>
              <div class="transfer-choice-list">${optButtons}</div>
            </div>
          `;
        } else {
          transferSelectorHtml = `<div class="compact-transfer-hint">🔄 於 ${plan.transferStop1} 候車約 ${plan.waitTransferMin} 分鐘轉乘下一班</div>`;
        }
      }

      return `
        <div class="detail-leg-box">
          <div class="detail-leg-head">
            <button type="button" class="detail-run-chip run-route-btn" data-run-id="${r.id}" title="點擊在地圖顯示「${r.line}線 ${r.time} ${originName}」完整路線">
              <span class="line-pill ${lineClass}">${r.line}線</span>
              <strong>${r.time} ${originName}</strong>
            </button>
            <span class="leg-step-text">${leg.fromStop}(${leg.depTimeStr}) → ${leg.toStop}(${leg.arrTimeStr})</span>
            ${r.note ? `<span class="note-badge">${r.note}</span>` : ""}
            ${renderBranchDots(r.branches, true)}
          </div>
          <div class="timeline-list">${stopsList}</div>
        </div>
        ${transferSelectorHtml}
      `;
    })
    .join("");

  const warnText = plan.warnings && plan.warnings.length > 0 ? plan.warnings.join(" ｜ ") : "";
  const activeSubcard = plan.activeSubcard || "outbound";

  // 【詳細區塊 - 上方卡片：去程】
  const outboundSubcardHtml = `
    <div class="trip-subcard ${activeSubcard === "outbound" ? "active-subcard" : "inactive-subcard"}" data-trip-dir="outbound">
      <div class="subcard-header">
        <div class="subcard-title-group">
          <span class="subcard-dir-tag outbound-tag">去程</span>
          <strong>${state.fromStop} ➔ ${state.toStop}</strong>
        </div>
        <div class="subcard-meta-group">
          <span class="subcard-time">${plan.depTimeStr} ➔ ${plan.arrTimeStr}（約 ${plan.totalDurationMin} 分）</span>
          <span class="subcard-status-dot"></span>
        </div>
      </div>
      <div class="subcard-body">
        ${warnText ? `<div class="compact-warn">⚠️ ${warnText}</div>` : ""}
        ${detailLegsHtml}
      </div>
    </div>
  `;

  // 【詳細區塊 - 下方卡片：返程最快一班】
  let returnSubcardHtml = "";
  const retPlan = plan.fastestReturn;
  if (retPlan) {
    const retIsTransfer = retPlan.type === "transfer";
    const retTrStop = retIsTransfer
      ? retPlan.transferStop1 === retPlan.transferStop2
        ? retPlan.transferStop1
        : `${retPlan.transferStop1}→${retPlan.transferStop2}`
      : "";

    const retDetailLegsHtml = retPlan.legs
      .map((rLeg, rIdx) => {
        const rr = rLeg.run;
        const rOrig = getRunOriginLabel(rr);
        const rLineClass = rr.line === "山" ? "line-mtn" : "line-sea";
        const rStopsList = rLeg.passedStops
          .map((st, sIdx) => {
            const isFirst = sIdx === 0;
            const isLast = sIdx === rLeg.passedStops.length - 1;
            return `
              <div class="timeline-stop ${isFirst ? "tl-start" : isLast ? "tl-end" : ""}">
                <span class="tl-time">${st.timeStr}</span>
                <span class="tl-dot"></span>
                <span class="tl-name">${st.stop}</span>
              </div>
            `;
          })
          .join("");

        return `
          <div class="detail-leg-box">
            <div class="detail-leg-head">
              <button type="button" class="detail-run-chip run-route-btn" data-run-id="${rr.id}" title="點擊在地圖顯示返程「${rr.line}線 ${rr.time} ${rOrig}」完整路線">
                <span class="line-pill ${rLineClass}">${rr.line}線</span>
                <strong>${rr.time} ${rOrig}</strong>
              </button>
              <span class="leg-step-text">${rLeg.fromStop}(${rLeg.depTimeStr}) → ${rLeg.toStop}(${rLeg.arrTimeStr})</span>
              ${rr.note ? `<span class="note-badge">${rr.note}</span>` : ""}
              ${renderBranchDots(rr.branches, true)}
            </div>
            <div class="timeline-list">${rStopsList}</div>
          </div>
          ${
            retIsTransfer && rIdx === 0
              ? `<div class="compact-transfer-hint">🔄 於 ${retTrStop} 轉乘（候車約 ${retPlan.waitTransferMin} 分）</div>`
              : ""
          }
        `;
      })
      .join("");

    returnSubcardHtml = `
      <div class="trip-subcard ${activeSubcard === "return" ? "active-subcard" : "inactive-subcard"}" data-trip-dir="return">
        <div class="subcard-header">
          <div class="subcard-title-group">
            <span class="subcard-dir-tag return-tag">返程</span>
            <button type="button" class="switch-route-dir-btn" title="點擊將查詢路線切換為「${state.toStop} ➔ ${state.fromStop}」">
              ${state.toStop} ➔ ${state.fromStop}
            </button>
            <span class="tag-badge ${retIsTransfer ? "transfer-badge" : "direct-badge"}">
              ${retIsTransfer ? `轉乘（${retTrStop}）` : "直達"}
            </span>
          </div>
          <div class="subcard-meta-group">
            <span class="subcard-time">${retPlan.depTimeStr} ➔ ${retPlan.arrTimeStr}（約 ${retPlan.totalDurationMin} 分）</span>
            <span class="subcard-status-dot"></span>
          </div>
        </div>
        <div class="subcard-body">
          ${retDetailLegsHtml}
        </div>
      </div>
    `;
  } else {
    returnSubcardHtml = `
      <div class="trip-subcard inactive-subcard disabled-subcard" data-trip-dir="return">
        <div class="subcard-header">
          <div class="subcard-title-group">
            <span class="subcard-dir-tag return-tag">返程</span>
            <button type="button" class="switch-route-dir-btn" title="點擊將查詢路線切換為「${state.toStop} ➔ ${state.fromStop}」">
              ${state.toStop} ➔ ${state.fromStop}
            </button>
          </div>
          <span class="return-empty-text">當日抵達後已無返程班次</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="plan-card ${isSelected ? "selected-card" : ""}" data-plan-idx="${idx}">
      <!-- 第一列：上下車時間 + 直達/轉乘標籤 -->
      <div class="plan-card-top">
        <div class="plan-time-main">
          <span class="dep-big">${plan.depTimeStr}</span>
          <span class="time-arrow">➔</span>
          <span class="arr-big">${plan.arrTimeStr}</span>
          <span class="duration-pill">約 ${plan.totalDurationMin} 分</span>
        </div>
        <div class="plan-badges">${badgesHtml}</div>
      </div>

      <!-- 第二列：極簡班次列 + 詳細切換按鈕 -->
      <div class="plan-card-body">
        <div class="simple-legs-row">
          ${simpleBarHtml}
        </div>
        <button type="button" class="btn-text toggle-detail-btn">詳細 ▾</button>
      </div>

      <!-- 詳細資訊區：明確分為上方「去程卡片」與下方「返程卡片」，預設選取去程，未選取者呈現灰色 -->
      <div class="card-detail-section" hidden>
        ${outboundSubcardHtml}
        ${returnSubcardHtml}
      </div>
    </div>
  `;
}

// 支線圖例
function renderLegend() {
  const legendGrid = document.getElementById("branch-legend-grid");
  if (!legendGrid) return;

  legendGrid.innerHTML = Object.values(BRANCHES)
    .map(
      (br) => `
      <div class="legend-card" style="border-left: 4px solid ${br.border};">
        <div class="legend-card-head">
          <span class="branch-dot-lg" style="background:${br.color}; border-color:${br.border};"></span>
          <strong>${br.fullName}</strong>
        </div>
        <div class="legend-card-stops">${br.stops.join(" → ")}</div>
      </div>
    `
    )
    .join("");
}

// 完整時刻表
function renderTimetable() {
  const leftBody = document.getElementById("timetable-left-body");
  const rightBody = document.getElementById("timetable-right-body");
  if (!leftBody || !rightBody) return;

  const filterFn = (run) => {
    if (state.timetableFilterLine !== "all" && run.line !== state.timetableFilterLine) return false;
    if (state.timetableFilterBranch !== "all" && !run.branches.includes(state.timetableFilterBranch)) return false;
    if (state.timetableFilterAccessible && !run.accessible) return false;
    return true;
  };

  const leftRuns = ALL_SCHEDULES.filter((r) => r.dir === ACTIVE_ISLAND.leftDir && filterFn(r));
  const rightRuns = ALL_SCHEDULES.filter((r) => r.dir === ACTIVE_ISLAND.rightDir && filterFn(r));

  function buildRows(runs) {
    if (runs.length === 0) {
      return `<tr><td colspan="5" style="text-align:center; padding:12px; color:#64748b;">無符合班次</td></tr>`;
    }
    return runs
      .map(
        (r) => `
        <tr class="tt-row">
          <td><span class="line-pill ${r.line === "山" ? "line-mtn" : "line-sea"}">${r.line}</span></td>
          <td class="tt-time">${r.time}</td>
          <td>${renderBranchDots(r.branches, false)}</td>
          <td>
            ${r.accessible ? `<span class="wheelchair-badge">♿</span>` : ""}
            ${r.note ? `<span class="note-badge">${r.note}</span>` : ""}
          </td>
          <td>
            <button type="button" class="tt-inspect-btn" data-run-id="${r.id}">站點</button>
          </td>
        </tr>
      `
      )
      .join("");
  }

  leftBody.innerHTML = buildRows(leftRuns);
  rightBody.innerHTML = buildRows(rightRuns);

  document.querySelectorAll(".tt-inspect-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const runId = btn.getAttribute("data-run-id");
      const run = ALL_SCHEDULES.find((r) => r.id === runId);
      if (run) showRunDetailModal(run);
    });
  });
}

function showRunDetailModal(run) {
  const modal = document.getElementById("run-detail-modal");
  const titleEl = document.getElementById("run-modal-title");
  const bodyEl = document.getElementById("run-modal-body");

  const dirText = run.dir === ACTIVE_ISLAND.leftDir ? ACTIVE_ISLAND.leftModalLabel : ACTIVE_ISLAND.rightModalLabel;
  titleEl.innerHTML = `${run.time} ${run.line}線（${dirText}）`;

  bodyEl.innerHTML = `
    <div style="margin-bottom: 10px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
      ${renderBranchDots(run.branches, true)}
      ${run.accessible ? `<span class="wheelchair-badge">♿ 無障礙</span>` : ""}
      ${run.note ? `<span class="note-badge">${run.note}</span>` : ""}
    </div>
    <div class="timeline-list">
      ${run.stopTimes
        .map(
          (st, i) => `
          <div class="timeline-stop ${i === 0 ? "tl-start" : i === run.stopTimes.length - 1 ? "tl-end" : ""}">
            <span class="tl-time">${st.timeStr}</span>
            <span class="tl-dot"></span>
            <span class="tl-name">${st.stop}</span>
          </div>
        `
        )
        .join("")}
    </div>
  `;

  modal.removeAttribute("hidden");
}

function renderRules() {
  const listEl = document.getElementById("official-rules-list");
  if (!listEl) return;
  listEl.innerHTML = BUS_CONFIG.rules.map((r) => `<li>${r}</li>`).join("");
}

function initTabsAndModals() {
  document.getElementById("tt-filter-line")?.addEventListener("change", (e) => {
    state.timetableFilterLine = e.target.value;
    renderTimetable();
  });

  document.getElementById("tt-filter-branch")?.addEventListener("change", (e) => {
    state.timetableFilterBranch = e.target.value;
    renderTimetable();
  });

  document.getElementById("tt-filter-accessible")?.addEventListener("change", (e) => {
    state.timetableFilterAccessible = e.target.checked;
    renderTimetable();
  });

  const runModal = document.getElementById("run-detail-modal");
  document.getElementById("close-run-modal-btn")?.addEventListener("click", () => {
    runModal?.setAttribute("hidden", "");
  });
  runModal?.addEventListener("click", (e) => {
    if (e.target === runModal) runModal.setAttribute("hidden", "");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && runModal && !runModal.hasAttribute("hidden")) {
      runModal.setAttribute("hidden", "");
    }
  });
}
