// 南竿公車動態路線規劃引擎 (依據連江縣公車動態資訊系統 matsuebus.tw 官方排點與路線)

function timeToMin(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minToTime(mins) {
  const rounded = Math.round(mins);
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 根據「連江縣公車動態資訊系統 (matsuebus.tw)」官方 rid 建構各班次完整停靠站與真實預估到站時間
function buildRunSchedule(run) {
  const depMin = timeToMin(run.time);
  const official = OFFICIAL_ROUTES[String(run.rid)];
  const stops = official ? [...official.stops] : [];
  const offsets = official ? [...official.offsets] : stops.map((_, i) => i);

  const warnings = [];
  if (official && official.name.includes("不經福澳碼頭")) {
    warnings.push("本班次不經福澳碼頭");
  }
  if (run.branches.includes("grey")) {
    warnings.push("經志清發電廠，不經珠螺～勝利堡");
  }
  if (run.note.includes("梅石發車")) {
    warnings.push("由梅石站發車");
  }

  const stopTimes = stops.map((stopName, idx) => {
    const estMin = depMin + (offsets[idx] ?? idx);
    return {
      stop: stopName,
      index: idx,
      offsetMin: offsets[idx] ?? idx,
      timeMin: estMin,
      timeStr: minToTime(estMin)
    };
  });

  return {
    ...run,
    officialName: official ? official.name : "",
    depMin,
    stops,
    stopSet: new Set(stops),
    stopTimes,
    warnings
  };
}

// 預先建構並快取南竿與北竿（平日／放假日）所有班次的完整排點資料
let ACTIVE_ISLAND = ISLANDS_DATA.nangan;
const SCHEDULE_CACHE = new Map();

function getOrBuildSchedules(islandId, dayType = "weekday") {
  const island = ISLANDS_DATA[islandId] || ISLANDS_DATA.nangan;
  const effectiveDayType = island.hasDayTypeSwitch ? dayType : "weekday";
  const cacheKey = `${island.id}:${effectiveDayType}`;
  if (SCHEDULE_CACHE.has(cacheKey)) {
    return SCHEDULE_CACHE.get(cacheKey);
  }
  const rawList = island.timetables[effectiveDayType] || island.timetables.weekday;
  const prevOfficial = OFFICIAL_ROUTES;
  OFFICIAL_ROUTES = island.officialRoutes;
  const built = rawList.map(buildRunSchedule);
  OFFICIAL_ROUTES = prevOfficial;
  SCHEDULE_CACHE.set(cacheKey, built);
  return built;
}

let ALL_SCHEDULES = getOrBuildSchedules("nangan", "weekday");

function setActiveIslandSchedule(islandId, dayType = "weekday") {
  const island = ISLANDS_DATA[islandId] || ISLANDS_DATA.nangan;
  const effectiveDayType = island.hasDayTypeSwitch ? dayType : "weekday";
  ACTIVE_ISLAND = island;
  BUS_CONFIG = island.busConfig;
  BRANCHES = island.branches;
  STOPS_INFO = island.stopsInfo;
  OFFICIAL_ROUTES = island.officialRoutes;
  RAW_TIMETABLE = island.timetables[effectiveDayType] || island.timetables.weekday;
  ALL_SCHEDULES = getOrBuildSchedules(island.id, effectiveDayType);
}

// 尋找某班次中從 fromStop 到 toStop 的最佳乘車區間（自動避開多餘的支線折返繞行）
function findSegmentInRun(run, fromStop, toStop) {
  if (!fromStop || !toStop || fromStop === toStop) return null;
  if (!run.stopSet.has(fromStop) || !run.stopSet.has(toStop)) return null;

  let bestFromIdx = -1;
  let bestToIdx = -1;
  let bestSpan = Infinity;

  for (let i = 0; i < run.stops.length; i++) {
    if (run.stops[i] !== fromStop) continue;
    for (let j = i + 1; j < run.stops.length; j++) {
      if (run.stops[j] !== toStop) continue;
      const span = j - i;
      if (span < bestSpan) {
        bestSpan = span;
        bestFromIdx = i;
        bestToIdx = j;
      }
      break;
    }
  }

  if (bestFromIdx === -1 || bestToIdx === -1) return null;

  const passedStops = run.stopTimes.slice(bestFromIdx, bestToIdx + 1);
  const depTimeMin = passedStops[0].timeMin;
  const arrTimeMin = passedStops[passedStops.length - 1].timeMin;

  return {
    run,
    fromStop,
    toStop,
    fromIdx: bestFromIdx,
    toIdx: bestToIdx,
    depTimeMin,
    depTimeStr: minToTime(depTimeMin),
    arrTimeMin,
    arrTimeStr: minToTime(arrTimeMin),
    durationMin: Math.max(1, Math.round(arrTimeMin - depTimeMin)),
    stopCount: bestToIdx - bestFromIdx,
    passedStops
  };
}

// 查詢抵達終點後的「返程最快一班」（從 toStop 返回 fromStop）
function findFastestReturnPlan({ fromStop, toStop, afterTimeMin, excludeRunId = null, onlyAccessible = false, allowTransfer = true }) {
  // 設定查詢時間為抵達後至少 +3 分鐘（加計內部 -2 分緩衝後，確保返程發車時間 >= 抵達時間 + 1 分）
  const returnQueryTime = minToTime(afterTimeMin + 3);
  const retResult = planRoutes({
    fromStop: toStop,
    toStop: fromStop,
    queryTimeStr: returnQueryTime,
    onlyAccessible,
    allowTransfer,
    isReturnLookup: true
  });

  const candidates = [...retResult.direct, ...retResult.transfers].filter(
    (p) => p.depTimeMin >= afterTimeMin + 1 && p.legs[0].run.id !== excludeRunId
  );

  // 依「最早抵達起點站」優先排序（若同時間抵達則取較早發車或耗時較短者）
  candidates.sort((a, b) => a.arrTimeMin - b.arrTimeMin || a.depTimeMin - b.depTimeMin);
  return candidates[0] || null;
}

// 動態規劃 (Dynamic Programming) 路線搜尋：包含直達與最佳轉乘
function planRoutes({ fromStop, toStop, queryTimeStr, onlyAccessible = false, allowTransfer = true, isReturnLookup = false }) {
  if (!fromStop || !toStop || fromStop === toStop) {
    return { direct: [], transfers: [], earlierDirect: [] };
  }

  const queryMin = timeToMin(queryTimeStr);
  const candidateRuns = ALL_SCHEDULES.filter((r) => !onlyAccessible || r.accessible);

  // 1. 搜尋所有直達班次
  const allDirect = [];
  for (const run of candidateRuns) {
    const seg = findSegmentInRun(run, fromStop, toStop);
    if (seg) {
      allDirect.push({
        type: "direct",
        depTimeMin: seg.depTimeMin,
        depTimeStr: seg.depTimeStr,
        arrTimeMin: seg.arrTimeMin,
        arrTimeStr: seg.arrTimeStr,
        totalDurationMin: seg.durationMin,
        waitBeforeBoardMin: Math.round(seg.depTimeMin - queryMin),
        fare: BUS_CONFIG.fare.full,
        halfFare: BUS_CONFIG.fare.half,
        legs: [seg],
        warnings: [...run.warnings]
      });
    }
  }

  allDirect.sort((a, b) => a.depTimeMin - b.depTimeMin || a.arrTimeMin - b.arrTimeMin);

  const upcomingDirect = allDirect.filter((d) => d.depTimeMin >= queryMin - 2);
  const earlierDirect = allDirect.filter((d) => d.depTimeMin < queryMin - 2);
  const minDirectStops =
    allDirect.length > 0
      ? Math.min(...allDirect.map((d) => d.legs[0].stopCount))
      : Infinity;

  // 2. 動態規劃搜尋 1 次轉乘方案
  const transferResults = [];
  if (allowTransfer) {
    // 涵蓋山海線分岔點與各支線交會點，避免乘客坐過頭到終點再折返
    const transferHubs = ACTIVE_ISLAND.transferHubs || [
      "清水", "梅石", "福澳嶺", "福澳", "縣立醫院", "酒廠", "縣政府", "介壽站",
      "陽明橋", "中興嶺", "軍醫院", "監理站", "上腰山", "文化中心", "馬港站",
      "中山門", "儲水澳", "八角亭", "仁愛"
    ];

    for (const run1 of candidateRuns) {
      if (!run1.stopSet.has(fromStop)) continue;
      if (findSegmentInRun(run1, fromStop, toStop)) continue;

      for (const hub1 of transferHubs) {
        if (hub1 === fromStop || hub1 === toStop) continue;
        const seg1 = findSegmentInRun(run1, fromStop, hub1);
        if (!seg1 || seg1.depTimeMin < queryMin - 2) continue;

        const nextHubCandidates = [hub1];
        if (hub1 === "梅石" && !run1.stopSet.has("清水")) nextHubCandidates.push("清水");
        if (hub1 === "清水" && !run1.stopSet.has("梅石")) nextHubCandidates.push("梅石");

        for (const hub2 of nextHubCandidates) {
          if (hub2 === fromStop || hub2 === toStop) continue;
          const isCrossWalk = hub1 !== hub2;
          const minTransferBuffer = isCrossWalk ? 3 : 1;

          for (const run2 of candidateRuns) {
            if (run2.id === run1.id) continue;
            if (findSegmentInRun(run2, fromStop, toStop)) continue;
            if (isCrossWalk && findSegmentInRun(run2, hub1, toStop)) continue;

            const seg2 = findSegmentInRun(run2, hub2, toStop);
            if (!seg2) continue;

            const waitTransferMin = seg2.depTimeMin - seg1.arrTimeMin;
            if (waitTransferMin < minTransferBuffer || waitTransferMin > 90) continue;

            // 若起訖站本就是極短程直達（4站以內），過濾掉繞遠路再折返的轉乘
            const totalStops = seg1.stopCount + seg2.stopCount;
            if (minDirectStops <= 4 && totalStops > minDirectStops + 4) continue;

            // 檢查第一段與第二段是否有折返重疊站點（避免坐過頭再往回坐）
            const seg1Internal = new Set(seg1.passedStops.slice(0, -1).map((s) => s.stop));
            const seg2Internal = seg2.passedStops.slice(1).map((s) => s.stop);
            const hasBacktrack = seg2Internal.some((st) => seg1Internal.has(st));
            if (hasBacktrack) continue;

            const isMeishiSpecial =
              hub1 === "梅石" ||
              hub1 === "清水" ||
              hub2 === "梅石" ||
              hub2 === "清水";

            const combinedWarnings = Array.from(new Set([...run1.warnings, ...run2.warnings]));

            transferResults.push({
              type: "transfer",
              transferStop1: hub1,
              transferStop2: hub2,
              isMeishiSpecial,
              isCrossWalk,
              depTimeMin: seg1.depTimeMin,
              depTimeStr: seg1.depTimeStr,
              arrTimeMin: seg2.arrTimeMin,
              arrTimeStr: seg2.arrTimeStr,
              waitTransferMin: Math.round(waitTransferMin),
              totalDurationMin: Math.max(2, Math.round(seg2.arrTimeMin - seg1.depTimeMin)),
              waitBeforeBoardMin: Math.round(seg1.depTimeMin - queryMin),
              fare: BUS_CONFIG.fare.full * 2,
              halfFare: BUS_CONFIG.fare.half * 2,
              legs: [seg1, seg2],
              warnings: combinedWarnings
            });
          }
        }
      }
    }
  }

  // 對轉乘結果進行最佳化與去重（優先選擇同站轉乘、總乘車站數最少、耗時最短的方案）
  const bestByRunPair = new Map();
  for (const tr of transferResults) {
    const pairKey = `${tr.legs[0].run.id}->${tr.legs[1].run.id}`;
    const existing = bestByRunPair.get(pairKey);
    const totalStopsNew = tr.legs[0].stopCount + tr.legs[1].stopCount;
    const scoreNew =
      tr.arrTimeMin * 100 +
      tr.totalDurationMin * 10 +
      totalStopsNew +
      (tr.isCrossWalk ? 50 : 0);

    if (!existing) {
      bestByRunPair.set(pairKey, { tr, score: scoreNew });
    } else if (scoreNew < existing.score) {
      bestByRunPair.set(pairKey, { tr, score: scoreNew });
    }
  }

  const dedupTransfers = Array.from(bestByRunPair.values())
    .map((x) => x.tr)
    .sort((a, b) => a.arrTimeMin - b.arrTimeMin || a.totalDurationMin - b.totalDurationMin);

  const filteredTransfers = [];
  const usedRun1Count = new Map();
  for (const tr of dedupTransfers) {
    const r1Id = tr.legs[0].run.id;
    const count = usedRun1Count.get(r1Id) || 0;
    if (count >= 1) continue;

    const dominatedByDirect = upcomingDirect.some(
      (d) => d.depTimeMin >= tr.depTimeMin - 2 && d.arrTimeMin <= tr.arrTimeMin + 2
    );
    const dominatedByOtherTransfer = dedupTransfers.some(
      (other) =>
        other !== tr &&
        other.depTimeMin >= tr.depTimeMin - 2 &&
        other.arrTimeMin <= tr.arrTimeMin &&
        (other.arrTimeMin < tr.arrTimeMin || other.totalDurationMin < tr.totalDurationMin)
    );
    if ((!dominatedByDirect || upcomingDirect.length === 0) && !dominatedByOtherTransfer) {
      filteredTransfers.push(tr);
      usedRun1Count.set(r1Id, count + 1);
    }
  }

  filteredTransfers.sort((a, b) => a.depTimeMin - b.depTimeMin || a.arrTimeMin - b.arrTimeMin);

  // 為每個轉乘方案附上「最近兩班」可銜接的第二段公車選項，供詳細模式切換選擇
  for (const tr of filteredTransfers) {
    const seg1 = tr.legs[0];
    const hub2 = tr.transferStop2;
    const minTransferBuffer = tr.isCrossWalk ? 3 : 1;
    const seg1Internal = new Set(seg1.passedStops.slice(0, -1).map((s) => s.stop));

    const options = [];
    for (const run2 of candidateRuns) {
      if (run2.id === seg1.run.id) continue;
      const seg2 = findSegmentInRun(run2, hub2, toStop);
      if (!seg2) continue;

      const waitMin = seg2.depTimeMin - seg1.arrTimeMin;
      if (waitMin < minTransferBuffer || waitMin > 180) continue;

      const seg2Internal = seg2.passedStops.slice(1).map((s) => s.stop);
      if (seg2Internal.some((st) => seg1Internal.has(st))) continue;

      options.push({
        seg2,
        waitTransferMin: Math.round(waitMin),
        totalDurationMin: Math.max(2, Math.round(seg2.arrTimeMin - seg1.depTimeMin)),
        warnings: Array.from(new Set([...seg1.run.warnings, ...run2.warnings]))
      });
    }

    options.sort((a, b) => a.seg2.depTimeMin - b.seg2.depTimeMin || a.seg2.arrTimeMin - b.seg2.arrTimeMin);
    tr.nextLegOptions = options.slice(0, 2);
    tr.selectedNextIdx = 0;
  }

  // 主查詢時，為每個去程方案（及轉乘的第 2 班選項）附上抵達後的「返程最快一班」
  if (!isReturnLookup) {
    for (const d of upcomingDirect) {
      d.fastestReturn = findFastestReturnPlan({
        fromStop,
        toStop,
        afterTimeMin: d.arrTimeMin,
        excludeRunId: d.legs[0].run.id,
        onlyAccessible,
        allowTransfer
      });
    }
    for (const tr of filteredTransfers) {
      for (const opt of tr.nextLegOptions || []) {
        opt.fastestReturn = findFastestReturnPlan({
          fromStop,
          toStop,
          afterTimeMin: opt.seg2.arrTimeMin,
          excludeRunId: opt.seg2.run.id,
          onlyAccessible,
          allowTransfer
        });
      }
      tr.fastestReturn =
        tr.nextLegOptions?.[0]?.fastestReturn ??
        findFastestReturnPlan({
          fromStop,
          toStop,
          afterTimeMin: tr.arrTimeMin,
          excludeRunId: tr.legs[1].run.id,
          onlyAccessible,
          allowTransfer
        });
    }
  }

  return {
    direct: upcomingDirect,
    transfers: filteredTransfers,
    earlierDirect
  };
}
