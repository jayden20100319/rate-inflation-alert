/* ============================================================
 * 금리·물가 알리미 — 앱 로직
 * 월 인덱스 0 = 2021-07 (BASE_DATA.cpiStart)
 * ============================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const EPOCH = { y: 2021, m: 7 };            // idx 0 = 2021-07
  const TODAY = new Date();
  const CUR_MONTH_IDX = idxOfDate(TODAY);
  const FC_MONTHS = 12;

  function idxOf(ym) {                         // "2026-07" → 60
    const [y, m] = ym.split("-").map(Number);
    return (y - EPOCH.y) * 12 + (m - EPOCH.m);
  }
  function idxOfDate(d) {
    return (d.getFullYear() - EPOCH.y) * 12 + (d.getMonth() + 1 - EPOCH.m);
  }
  function ymOf(idx) {
    const t = EPOCH.m - 1 + idx;
    const y = EPOCH.y + Math.floor(t / 12);
    const m = (t % 12) + 1;
    return { y, m };
  }
  function labelOf(idx, short) {
    const { y, m } = ymOf(idx);
    return short ? `${String(y).slice(2)}.${m}` : `${y}년 ${m}월`;
  }
  function keyOf(idx) {
    const { y, m } = ymOf(idx);
    return `${y}-${String(m).padStart(2, "0")}`;
  }

  /* ---------- 사용자 입력값 병합 ---------- */
  const LS_OVERRIDES = "rpa.overrides.v1";

  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(LS_OVERRIDES)) || {}; }
    catch { return {}; }
  }
  function saveOverrides(o) { localStorage.setItem(LS_OVERRIDES, JSON.stringify(o)); }

  function buildData() {
    const ov = loadOverrides();
    const d = {
      rateKR: BASE_DATA.rateKR.map((x) => [...x]),
      rateUS: BASE_DATA.rateUS.map((x) => [...x]),
      cpiKR: [...BASE_DATA.cpiKR],
      cpiUS: [...BASE_DATA.cpiUS]
    };
    for (const kind of ["rateKR", "rateUS"]) {
      const m = ov[kind] || {};
      for (const [ym, v] of Object.entries(m)) {
        const i = d[kind].findIndex((p) => p[0] === ym);
        if (i >= 0) d[kind][i][1] = v; else d[kind].push([ym, v]);
      }
      d[kind].sort((a, b) => idxOf(a[0]) - idxOf(b[0]));
    }
    for (const kind of ["cpiKR", "cpiUS"]) {
      const m = ov[kind] || {};
      for (const [ym, v] of Object.entries(m)) {
        const i = idxOf(ym);
        if (i < 0) continue;
        while (d[kind].length <= i) d[kind].push(null);
        d[kind][i] = v;
      }
    }
    return d;
  }

  /* ---------- 시리즈 구성 ---------- */
  function stepSeries(changes, lastIdx) {
    const arr = new Array(lastIdx + 1).fill(null);
    let v = null, ci = 0;
    for (let i = 0; i <= lastIdx; i++) {
      while (ci < changes.length && idxOf(changes[ci][0]) <= i) v = changes[ci++][1];
      arr[i] = v;
    }
    return arr;
  }
  function lastNonNull(arr) {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i;
    return -1;
  }

  /* ---------- 예측 모형 ----------
   * 물가: 2% 목표로의 지수 수렴 (월 감쇠 0.93)
   * 금리: 물가 전망에 따른 규칙 기반 시나리오
   *  - 향후 6개월 평균 물가 > 2.8% → 다음다음 회의에서 0.25%p 인상 후 동결
   *  - 향후 6개월 평균 물가 < 1.8% → 0.25%p 인하
   *  - 이후 전망 물가가 2.8% 이하로 내려오는 달(6개월 이후)에 0.25%p 인하(미국만, 고금리일 때)
   */
  function forecastCPI(last) {
    const target = 2.0, decay = 0.93, out = [];
    for (let k = 1; k <= FC_MONTHS; k++) {
      out.push(Math.round((target + (last - target) * Math.pow(decay, k)) * 10) / 10);
    }
    return out;
  }
  function forecastRate(current, cpiF, isUS) {
    const avg6 = cpiF.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
    const out = [];
    let v = current, moved = false;
    for (let k = 1; k <= FC_MONTHS; k++) {
      if (!moved && k === 3 && avg6 > 2.8 && !isUS) { v += 0.25; moved = true; }
      if (!moved && k === 3 && avg6 < 1.8) { v -= 0.25; moved = true; }
      if (isUS && !moved && k > 6 && cpiF[k - 1] <= 2.8 && v >= 3.5) { v -= 0.25; moved = true; }
      out.push(Math.round(v * 100) / 100);
    }
    return out;
  }

  /* ---------- 전체 모델 계산 ---------- */
  let M = null; // model

  function computeModel() {
    const d = buildData();
    const rateLastIdx = Math.max(CUR_MONTH_IDX,
      idxOf(d.rateKR[d.rateKR.length - 1][0]), idxOf(d.rateUS[d.rateUS.length - 1][0]));
    const sKR = stepSeries(d.rateKR, rateLastIdx);
    const sUS = stepSeries(d.rateUS, rateLastIdx);
    const cpiKRLast = lastNonNull(d.cpiKR);
    const cpiUSLast = lastNonNull(d.cpiUS);

    const cpiKRF = forecastCPI(d.cpiKR[cpiKRLast]);
    const cpiUSF = forecastCPI(d.cpiUS[cpiUSLast]);
    const rateKRF = forecastRate(sKR[rateLastIdx], cpiKRF, false);
    const rateUSF = forecastRate(sUS[rateLastIdx], cpiUSF, true);

    M = {
      d, rateLastIdx,
      rate: { kr: sKR, us: sUS, krF: rateKRF, usF: rateUSF },
      cpi: { kr: d.cpiKR, us: d.cpiUS, krLast: cpiKRLast, usLast: cpiUSLast, krF: cpiKRF, usF: cpiUSF },
      maxActual: Math.max(rateLastIdx, cpiKRLast, cpiUSLast)
    };
  }

  /* ---------- 스탯 타일 ---------- */
  function fmtRate(v) { return v == null ? "–" : v.toFixed(2); }
  function fmtCpi(v) { return v == null ? "–" : v.toFixed(1); }

  function makeTile(t) {
    const div = document.createElement("div");
    div.className = "tile";
    const k = document.createElement("div"); k.className = "k";
    const dot = document.createElement("span"); dot.className = "dot";
    dot.style.background = `var(--series-${t.cls})`;
    k.append(dot, document.createTextNode(t.name));
    const v = document.createElement("div"); v.className = "v";
    v.textContent = t.v;
    const u = document.createElement("span"); u.className = "unit"; u.textContent = " %";
    v.appendChild(u);
    const dd = document.createElement("div"); dd.className = "d"; dd.textContent = t.d;
    const w = document.createElement("div"); w.className = "when"; w.textContent = t.when;
    div.append(k, v, dd, w);
    return div;
  }

  function renderTiles() {
    const { d, cpi } = M;
    const lastChange = (list) => {
      const [ym, v] = list[list.length - 1];
      const prev = list.length > 1 ? list[list.length - 2][1] : v;
      return { ym, v, delta: Math.round((v - prev) * 100) / 100 };
    };
    const kr = lastChange(d.rateKR), us = lastChange(d.rateUS);
    const ck = cpi.kr[cpi.krLast], ckPrev = cpi.kr[cpi.krLast - 1];
    const cu = cpi.us[cpi.usLast], cuPrev = cpi.us[cpi.usLast - 1];

    const elKR = $("#tilesKR");
    elKR.textContent = "";
    elKR.append(
      makeTile({
        name: "기준금리", cls: "rate", v: fmtRate(kr.v),
        d: kr.delta === 0 ? "동결" : `${kr.delta > 0 ? "▲ 인상" : "▼ 인하"} ${Math.abs(kr.delta).toFixed(2)}%p`,
        when: `${labelOf(idxOf(kr.ym))} 금통위`
      }),
      makeTile({
        name: "물가상승률", cls: "cpi", v: fmtCpi(ck),
        d: ckPrev == null ? "" : `전월비 ${ck - ckPrev >= 0 ? "▲ +" : "▼ "}${(ck - ckPrev).toFixed(1)}%p`,
        when: `${labelOf(cpi.krLast)} 기준`
      })
    );
    const elUS = $("#tilesUS");
    elUS.textContent = "";
    elUS.append(
      makeTile({
        name: "기준금리", cls: "rate", v: fmtRate(us.v),
        d: us.delta === 0 ? "동결"
          : `${us.delta > 0 ? "▲ 인상" : "▼ 인하"} ${Math.abs(us.delta).toFixed(2)}%p`
            + (idxOf(us.ym) < CUR_MONTH_IDX ? ` (${labelOf(idxOf(us.ym))}, 이후 동결)` : ""),
        when: `목표범위 ${fmtRate(us.v - 0.25)}~${fmtRate(us.v)}%`
      }),
      makeTile({
        name: "물가상승률", cls: "cpi", v: fmtCpi(cu),
        d: cuPrev == null ? "" : `전월비 ${cu - cuPrev >= 0 ? "▲ +" : "▼ "}${(cu - cuPrev).toFixed(1)}%p`,
        when: `${labelOf(cpi.usLast)} 기준`
      })
    );
  }

  /* ---------- 발표 일정 ---------- */
  function todayStr() {
    const p = (n) => String(n).padStart(2, "0");
    return `${TODAY.getFullYear()}-${p(TODAY.getMonth() + 1)}-${p(TODAY.getDate())}`;
  }
  function upcoming(n) {
    const t = todayStr();
    return BASE_DATA.schedule.filter((e) => e.date >= t).slice(0, n);
  }
  function ddayOf(dateStr) {
    const [y, m, dd] = dateStr.split("-").map(Number);
    const a = new Date(y, m - 1, dd);
    const b = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
    return Math.round((a - b) / 86400000);
  }
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const wd = WD[new Date(y, m - 1, d).getDay()];
    return `${m}/${d}(${wd})`;
  }

  function renderSchedule() {
    const list = $("#schedList");
    list.textContent = "";
    for (const e of upcoming(6)) {
      const li = document.createElement("li");
      const dd = ddayOf(e.date);
      const chip = document.createElement("span");
      chip.className = "dday" + (dd <= 7 ? " hot" : "");
      chip.textContent = dd === 0 ? "오늘" : `D-${dd}`;
      const t = document.createElement("div"); t.className = "t";
      t.textContent = e.title + (e.tentative ? " (예정)" : "");
      if (e.note) {
        const n = document.createElement("div"); n.className = "n"; n.textContent = e.note;
        t.appendChild(n);
      }
      const dt = document.createElement("span"); dt.className = "dt";
      dt.textContent = fmtDate(e.date);
      li.append(chip, t, dt);
      list.appendChild(li);
    }
    // 발표 당일 배너
    const todays = BASE_DATA.schedule.filter((e) => e.date === todayStr());
    const tomorrow = BASE_DATA.schedule.filter((e) => ddayOf(e.date) === 1);
    const banner = $("#todayBanner");
    if (todays.length) {
      banner.textContent = "";
      const s = document.createElement("strong");
      s.textContent = "📢 오늘은 발표일입니다 — ";
      banner.append(s, document.createTextNode(todays.map((e) => e.title).join(", ")
        + ". 발표 후 아래 '새 발표값 입력'으로 갱신하세요."));
      banner.classList.add("show");
    } else if (tomorrow.length) {
      banner.textContent = "";
      const s = document.createElement("strong");
      s.textContent = "⏰ 내일 발표 — ";
      banner.append(s, document.createTextNode(tomorrow.map((e) => e.title).join(", ")));
      banner.classList.add("show");
    }
    return todays;
  }

  /* ---------- 알림 ---------- */
  const LS_NOTIF = "rpa.notifOn";
  const LS_NOTIFIED = "rpa.notifiedDates";

  async function notifyToday(todays) {
    if (!todays.length) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (localStorage.getItem(LS_NOTIF) !== "1") return;
    const done = JSON.parse(localStorage.getItem(LS_NOTIFIED) || "[]");
    if (done.includes(todayStr())) return;
    const body = todays.map((e) => e.title).join("\n");
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("📢 오늘은 금리·물가 발표일", {
        body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "announce-" + todayStr()
      });
    } catch {
      try { new Notification("📢 오늘은 금리·물가 발표일", { body }); } catch {}
    }
    done.push(todayStr());
    localStorage.setItem(LS_NOTIFIED, JSON.stringify(done.slice(-30)));
  }

  async function tryPeriodicSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ("periodicSync" in reg) {
        const status = await navigator.permissions.query({ name: "periodic-background-sync" });
        if (status.state === "granted") {
          await reg.periodicSync.register("announce-check", { minInterval: 12 * 60 * 60 * 1000 });
          return true;
        }
      }
    } catch {}
    return false;
  }

  function updateNotifState() {
    const el = $("#notifState");
    const btn = $("#notifBtn");
    const testBtn = $("#testNotifBtn");
    if (!("Notification" in window)) {
      el.textContent = "이 브라우저는 알림을 지원하지 않아요. 발표일에 앱을 열면 상단 배너로 알려드립니다.";
      btn.disabled = true;
      return;
    }
    const p = Notification.permission;
    const on = localStorage.getItem(LS_NOTIF) === "1";
    if (p === "granted" && on) {
      btn.textContent = "🔔 알림 켜짐";
      btn.disabled = true;
      testBtn.hidden = false;
      el.textContent = "발표 당일 앱이 열리면(또는 백그라운드 동기화를 지원하는 기기에서는 자동으로) 알림을 보내드립니다.";
    } else if (p === "denied") {
      el.textContent = "알림 권한이 차단되어 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.";
    } else {
      el.textContent = "알림을 켜면 금통위·FOMC·물가 발표 당일에 알려드려요.";
    }
  }

  /* ============================================================
   * SVG 라인 차트
   * ============================================================ */
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function renderChart(boxSel, cfg) {
    const box = $(boxSel);
    box.textContent = "";
    const W = Math.max(300, box.clientWidth || 320);
    const H = W < 480 ? 240 : 280;
    const PAD = { l: 34, r: cfg.fcOn ? 46 : 74, t: 14, b: 24 };
    const [i0, i1] = cfg.xDomain;

    // y 범위 → 깔끔한 눈금
    let vmin = Infinity, vmax = -Infinity;
    for (const s of cfg.series) {
      for (let i = i0; i <= Math.min(i1, s.data.length - 1); i++) {
        const v = s.data[i];
        if (v != null) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
      }
      if (cfg.fcOn) for (const v of s.fc) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    }
    if (!isFinite(vmin)) { vmin = 0; vmax = 1; }
    const span = vmax - vmin;
    const step = span <= 2 ? 0.5 : span <= 5 ? 1 : 2;
    let y0 = Math.floor((vmin - span * 0.08) / step) * step;
    if (vmin >= 0 && y0 < 0) y0 = 0;
    const y1 = Math.ceil((vmax + span * 0.08) / step) * step;
    const X = (i) => PAD.l + ((i - i0) / Math.max(1, i1 - i0)) * (W - PAD.l - PAD.r);
    const Y = (v) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" });

    // 수평 그리드 + y 눈금
    for (let v = y0; v <= y1 + 1e-9; v += step) {
      svg.appendChild(svgEl("line", {
        x1: PAD.l, x2: W - PAD.r, y1: Y(v), y2: Y(v),
        stroke: "var(--grid)", "stroke-width": 1
      }));
      const t = svgEl("text", {
        x: PAD.l - 6, y: Y(v) + 3.5, "text-anchor": "end",
        "font-size": 10.5, fill: "var(--text-muted)", style: "font-variant-numeric:tabular-nums"
      });
      t.textContent = step < 1 ? v.toFixed(1) : String(v);
      svg.appendChild(t);
    }
    // 기준선(하단 축)
    svg.appendChild(svgEl("line", {
      x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b,
      stroke: "var(--axis)", "stroke-width": 1
    }));

    // x 눈금: 스팬 길면 연 단위(1월), 짧으면 3개월 간격
    const spanM = i1 - i0;
    for (let i = i0; i <= i1; i++) {
      const { m } = ymOf(i);
      const yearly = spanM > 15;
      if (yearly ? m === 1 : (m - 1) % 3 === 0) {
        const t = svgEl("text", {
          x: X(i), y: H - PAD.b + 15, "text-anchor": "middle",
          "font-size": 10.5, fill: "var(--text-muted)"
        });
        t.textContent = yearly ? String(ymOf(i).y) : labelOf(i, true);
        svg.appendChild(t);
      }
    }

    // 예측 구간 배경 표시(옅은 세로 경계선)
    if (cfg.fcOn) {
      const bx = X(cfg.fcStart - 0.5);
      svg.appendChild(svgEl("line", {
        x1: bx, x2: bx, y1: PAD.t, y2: H - PAD.b,
        stroke: "var(--grid)", "stroke-width": 1, "stroke-dasharray": "2 3"
      }));
      const t = svgEl("text", {
        x: bx + 4, y: PAD.t + 9, "font-size": 9.5, fill: "var(--text-muted)"
      });
      t.textContent = "예측 →";
      svg.appendChild(t);
    }

    // 시리즈 경로
    function pathFor(points, stepped) {
      let d = "", pen = false, px = 0, py = 0;
      for (const [x, y, isNull] of points) {
        if (isNull) { pen = false; continue; }
        if (!pen) { d += `M${x.toFixed(1)} ${y.toFixed(1)}`; pen = true; }
        else if (stepped) d += `L${x.toFixed(1)} ${py.toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}`;
        else d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
        px = x; py = y;
      }
      return d;
    }

    const endInfo = [];
    for (const s of cfg.series) {
      const color = `var(${s.cssVar})`;
      const lastA = Math.min(s.lastActual, i1);
      const pts = [];
      for (let i = i0; i <= lastA; i++) {
        pts.push([X(i), s.data[i] == null ? 0 : Y(s.data[i]), s.data[i] == null]);
      }
      svg.appendChild(svgEl("path", {
        d: pathFor(pts, s.stepped), fill: "none", stroke: color,
        "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round"
      }));
      // 예측(점선)
      if (cfg.fcOn && s.fc.length && s.lastActual <= i1) {
        const fpts = [[X(s.lastActual), Y(s.data[s.lastActual]), false]];
        for (let k = 0; k < s.fc.length; k++) {
          const i = s.lastActual + 1 + k;
          if (i > i1) break;
          fpts.push([X(i), Y(s.fc[k]), false]);
        }
        svg.appendChild(svgEl("path", {
          d: pathFor(fpts, s.stepped), fill: "none", stroke: color, opacity: 0.7,
          "stroke-width": 2, "stroke-dasharray": "5 4", "stroke-linejoin": "round", "stroke-linecap": "round"
        }));
        const fcLastV = s.fc[Math.min(s.fc.length, i1 - s.lastActual) - 1];
        endInfo.push({ kind: "fc", x: X(Math.min(s.lastActual + s.fc.length, i1)), y: Y(fcLastV), v: fcLastV, s });
      }
      // 현재값 마커(표면색 링 2px)
      if (s.data[lastA] != null) {
        svg.appendChild(svgEl("circle", {
          cx: X(lastA), cy: Y(s.data[lastA]), r: 4.5,
          fill: color, stroke: "var(--surface-1)", "stroke-width": 2
        }));
        endInfo.push({ kind: "now", x: X(lastA), y: Y(s.data[lastA]), v: s.data[lastA], s });
      }
    }

    // 직접 라벨 (현재값: 이름+값 / 예측 끝: 값만) — 상하 충돌 시 위/아래로 분리
    function placeLabels(items, mk) {
      if (!items.length) return;
      items.sort((a, b) => a.y - b.y);
      const collide = items.length === 2 && Math.abs(items[0].y - items[1].y) < 17;
      items.forEach((it, idx) => {
        const above = collide ? idx === 0 : true;
        mk(it, above);
      });
    }
    placeLabels(endInfo.filter((e) => e.kind === "now"), (it, above) => {
      const t = svgEl("text", {
        x: cfg.fcOn ? it.x : it.x + 8,
        y: cfg.fcOn ? (above ? it.y - 9 : it.y + 17) : (above ? it.y - 9 : it.y + 17),
        "text-anchor": cfg.fcOn ? "middle" : "start",
        "font-size": 11, "font-weight": 600, fill: "var(--text-secondary)"
      });
      t.textContent = `${it.s.short} ${it.s.fmt(it.v)}`;
      svg.appendChild(t);
    });
    placeLabels(endInfo.filter((e) => e.kind === "fc"), (it, above) => {
      const t = svgEl("text", {
        x: it.x + 5, y: above ? it.y - 5 : it.y + 13, "text-anchor": "start",
        "font-size": 10, fill: "var(--text-muted)"
      });
      t.textContent = it.s.fmt(it.v);
      svg.appendChild(t);
    });

    // ---------- 호버: 크로스헤어 + 툴팁 ----------
    const cross = svgEl("line", {
      x1: 0, x2: 0, y1: PAD.t, y2: H - PAD.b,
      stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden"
    });
    svg.appendChild(cross);
    const tip = document.createElement("div");
    tip.className = "tooltip";
    box.append(svg, tip);

    function valueAt(s, i) {
      if (i <= s.lastActual) return { v: s.data[i], fc: false };
      const k = i - s.lastActual - 1;
      if (cfg.fcOn && k < s.fc.length) return { v: s.fc[k], fc: true };
      return { v: null, fc: false };
    }
    function showAt(i) {
      i = Math.max(i0, Math.min(i1, i));
      const x = X(i);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x);
      cross.setAttribute("visibility", "visible");
      tip.textContent = "";
      const dt = document.createElement("div");
      dt.className = "tt-date";
      const anyFc = cfg.series.some((s) => valueAt(s, i).fc);
      dt.textContent = labelOf(i) + (anyFc ? " · 예측" : "");
      tip.appendChild(dt);
      for (const s of cfg.series) {
        const { v } = valueAt(s, i);
        const row = document.createElement("div"); row.className = "row";
        const key = document.createElement("i"); key.style.borderColor = `var(${s.cssVar})`;
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = s.name;
        const vl = document.createElement("span"); vl.className = "vl";
        vl.textContent = v == null ? "미발표" : s.fmt(v);
        row.append(key, nm, vl);
        tip.appendChild(row);
      }
      tip.style.display = "block";
      const bw = box.clientWidth, tw = tip.offsetWidth;
      const px = (x / W) * bw;
      tip.style.left = Math.min(bw - tw - 4, Math.max(4, px + 12)) + "px";
      tip.style.top = "8px";
      if (px + 12 + tw > bw - 4) tip.style.left = Math.max(4, px - tw - 12) + "px";
      return i;
    }
    function hide() { cross.setAttribute("visibility", "hidden"); tip.style.display = "none"; }

    let kbIdx = null;
    svg.addEventListener("pointermove", (ev) => {
      const r = svg.getBoundingClientRect();
      const fx = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.round(i0 + ((fx - PAD.l) / (W - PAD.l - PAD.r)) * (i1 - i0));
      kbIdx = showAt(i);
    });
    svg.addEventListener("pointerleave", hide);
    box.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        ev.preventDefault();
        if (kbIdx == null) kbIdx = i1;
        kbIdx = showAt(kbIdx + (ev.key === "ArrowRight" ? 1 : -1));
      } else if (ev.key === "Escape") { hide(); kbIdx = null; }
    });
    box.addEventListener("blur", hide);
  }

  /* ---------- 차트 두 개 렌더 ---------- */
  const state = { range: 60, fcOn: true };

  const fmtRatePct = (v) => v.toFixed(2) + "%";
  const fmtCpiPct = (v) => v.toFixed(1) + "%";

  function renderCharts() {
    const { rate, cpi, maxActual } = M;
    const i0 = Math.max(0, maxActual - state.range + 1);
    const i1 = maxActual + (state.fcOn ? FC_MONTHS : 0);
    for (const k of document.querySelectorAll(".fcKey")) k.style.display = state.fcOn ? "" : "none";

    renderChart("#krChart", {
      fcOn: state.fcOn, xDomain: [i0, i1],
      fcStart: Math.min(M.rateLastIdx, cpi.krLast) + 1,
      series: [
        { name: "기준금리", short: "금리", stepped: true, fmt: fmtRatePct,
          cssVar: "--series-rate", data: rate.kr, lastActual: M.rateLastIdx, fc: rate.krF },
        { name: "물가상승률", short: "물가", stepped: false, fmt: fmtCpiPct,
          cssVar: "--series-cpi", data: cpi.kr, lastActual: cpi.krLast, fc: cpi.krF }
      ]
    });
    renderChart("#usChart", {
      fcOn: state.fcOn, xDomain: [i0, i1],
      fcStart: Math.min(M.rateLastIdx, cpi.usLast) + 1,
      series: [
        { name: "기준금리", short: "금리", stepped: true, fmt: fmtRatePct,
          cssVar: "--series-rate", data: rate.us, lastActual: M.rateLastIdx, fc: rate.usF },
        { name: "물가상승률", short: "물가", stepped: false, fmt: fmtCpiPct,
          cssVar: "--series-cpi", data: cpi.us, lastActual: cpi.usLast, fc: cpi.usF }
      ]
    });
  }

  /* ---------- 파트별 전망 ---------- */
  function fcCell(name, cls, now, h6, h12, f) {
    const c = document.createElement("div"); c.className = "fc-cell";
    const k = document.createElement("div"); k.className = "k";
    const dot = document.createElement("span"); dot.className = "dot";
    dot.style.background = `var(--series-${cls})`;
    k.append(dot, document.createTextNode(name));
    const p = document.createElement("div"); p.className = "path";
    p.textContent = `${f(now)} → ${f(h6)} → ${f(h12)}%`;
    const cap = document.createElement("div"); cap.className = "cap";
    cap.textContent = "현재 → 6개월 → 12개월";
    c.append(k, p, cap);
    return c;
  }
  function fcNote(el, bullets) {
    el.textContent = "";
    const ul = document.createElement("ul");
    for (const b of bullets) {
      const li = document.createElement("li"); li.textContent = b; ul.appendChild(li);
    }
    el.appendChild(ul);
  }

  function renderForecast() {
    const { rate, cpi } = M;
    const gKR = $("#fcGridKR");
    gKR.textContent = "";
    gKR.append(
      fcCell("기준금리", "rate", rate.kr[M.rateLastIdx], rate.krF[5], rate.krF[11], fmtRate),
      fcCell("물가상승률", "cpi", cpi.kr[cpi.krLast], cpi.krF[5], cpi.krF[11], fmtCpi)
    );
    const krHike = rate.krF[11] > rate.kr[M.rateLastIdx];
    fcNote($("#fcNoteKR"), [
      `물가는 에너지발 상승분이 기저효과로 줄며 ${fmtCpi(cpi.kr[cpi.krLast])}% → 약 ${fmtCpi(cpi.krF[11])}%로 완만한 둔화를 가정.`,
      krHike
        ? `향후 반년 물가 전망 평균이 2.8%를 웃돌아 연내 0.25%p 추가 인상(→${fmtRate(rate.krF[11])}%) 후 동결 시나리오.`
        : `물가 전망이 안정적이어서 현 수준(${fmtRate(rate.krF[11])}%) 동결 시나리오.`
    ]);

    const gUS = $("#fcGridUS");
    gUS.textContent = "";
    gUS.append(
      fcCell("기준금리", "rate", rate.us[M.rateLastIdx], rate.usF[5], rate.usF[11], fmtRate),
      fcCell("물가상승률", "cpi", cpi.us[cpi.usLast], cpi.usF[5], cpi.usF[11], fmtCpi)
    );
    const usCut = rate.usF[11] < rate.us[M.rateLastIdx];
    fcNote($("#fcNoteUS"), [
      `물가는 에너지 급등분이 빠지며 ${fmtCpi(cpi.us[cpi.usLast])}% → 약 ${fmtCpi(cpi.usF[11])}%로 둔화를 가정.`,
      usCut
        ? `당분간 동결 후 물가가 2%대 후반에 안착하는 시점(전망상 약 9~10개월 뒤)에 0.25%p 인하 재개(→${fmtRate(rate.usF[11])}%) 가정.`
        : `물가가 목표를 크게 웃돌아 12개월 내 동결(${fmtRate(rate.usF[11])}%) 유지 가정.`
    ]);
  }

  /* ---------- 데이터 표 ---------- */
  function renderTable() {
    const tb = $("#dataTable tbody");
    tb.textContent = "";
    const { rate, cpi, maxActual } = M;
    for (let i = maxActual; i >= Math.max(0, maxActual - 17); i--) {
      const tr = document.createElement("tr");
      const cells = [
        labelOf(i),
        i <= M.rateLastIdx && rate.kr[i] != null ? rate.kr[i].toFixed(2) : "–",
        i <= cpi.krLast && cpi.kr[i] != null ? cpi.kr[i].toFixed(1) : "–",
        i <= M.rateLastIdx && rate.us[i] != null ? rate.us[i].toFixed(2) : "–",
        i <= cpi.usLast && cpi.us[i] != null ? cpi.us[i].toFixed(1) : "–"
      ];
      cells.forEach((c, j) => {
        const td = document.createElement("td");
        td.textContent = c;
        if (c === "–") td.className = "na";
        if (j === 0) td.style.color = "var(--text-secondary)";
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
  }

  /* ---------- 업데이트 폼 ---------- */
  function renderUserEntries() {
    const ov = loadOverrides();
    const box = $("#userEntries");
    box.textContent = "";
    const entries = [];
    for (const kind of Object.keys(ov)) {
      for (const [ym, v] of Object.entries(ov[kind])) entries.push({ kind, ym, v });
    }
    if (!entries.length) return;
    entries.sort((a, b) => a.ym.localeCompare(b.ym));
    const h = document.createElement("div");
    h.style.fontWeight = "600";
    h.textContent = `내가 입력한 값 (${entries.length}건)`;
    box.appendChild(h);
    for (const e of entries) {
      const row = document.createElement("div"); row.className = "ue";
      const s = document.createElement("span");
      s.textContent = `${e.ym} · ${BASE_DATA.kindLabel[e.kind]} = ${e.v}%`;
      const del = document.createElement("button");
      del.className = "btn"; del.style.padding = "2px 8px"; del.textContent = "✕";
      del.setAttribute("aria-label", "이 입력값 삭제");
      del.addEventListener("click", () => {
        const o = loadOverrides();
        delete o[e.kind][e.ym];
        if (!Object.keys(o[e.kind]).length) delete o[e.kind];
        saveOverrides(o);
        refreshAll();
      });
      row.append(s, del);
      box.appendChild(row);
    }
  }

  function bindForm() {
    $("#uMonth").value = keyOf(CUR_MONTH_IDX);
    $("#updateForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const kind = $("#uKind").value;
      const ym = $("#uMonth").value;
      const v = parseFloat($("#uValue").value);
      if (!ym || isNaN(v)) return;
      const o = loadOverrides();
      (o[kind] = o[kind] || {})[ym] = Math.round(v * 100) / 100;
      saveOverrides(o);
      $("#updateMsg").textContent = `저장했어요: ${ym} ${BASE_DATA.kindLabel[kind]} = ${v}%. 차트와 전망을 갱신했습니다.`;
      $("#uValue").value = "";
      refreshAll();
    });
  }

  /* ---------- 필터 ---------- */
  function bindFilters() {
    $("#rangeSeg").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      for (const x of $("#rangeSeg").querySelectorAll("button")) x.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-pressed", "true");
      state.range = Number(b.dataset.range);
      renderCharts();
    });
    $("#fcToggle").addEventListener("change", (ev) => {
      state.fcOn = ev.target.checked;
      renderCharts();
    });
  }

  /* ---------- 테마 / 설치 / SW ---------- */
  function bindTheme() {
    const saved = localStorage.getItem("rpa.theme");
    if (saved) document.documentElement.dataset.theme = saved;
    $("#themeBtn").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme
        || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("rpa.theme", next);
      renderCharts(); // 차트 색이 CSS 변수라 재렌더만
    });
  }

  let deferredPrompt = null;
  function bindInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      $("#installBtn").hidden = false;
    });
    $("#installBtn").addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $("#installBtn").hidden = true;
    });
  }

  function bindNotif() {
    $("#notifBtn").addEventListener("click", async () => {
      if (!("Notification" in window)) return;
      const p = await Notification.requestPermission();
      if (p === "granted") {
        localStorage.setItem(LS_NOTIF, "1");
        await tryPeriodicSync();
        notifyToday(BASE_DATA.schedule.filter((e) => e.date === todayStr()));
      }
      updateNotifState();
    });
    $("#testNotifBtn").addEventListener("click", async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification("금리·물가 알리미", {
          body: "알림이 정상 동작합니다. 발표 당일 이렇게 알려드려요!",
          icon: "icons/icon-192.png"
        });
      } catch {
        try { new Notification("금리·물가 알리미", { body: "알림이 정상 동작합니다." }); } catch {}
      }
    });
  }

  /* ---------- 전체 갱신 ---------- */
  let resizeTimer = null;

  function refreshAll() {
    computeModel();
    renderTiles();
    renderCharts();
    renderForecast();
    renderTable();
    renderUserEntries();
  }

  function init() {
    $("#dataAsOf").textContent = BASE_DATA.meta.dataAsOf;
    bindTheme(); bindFilters(); bindForm(); bindInstall(); bindNotif();
    refreshAll();
    const todays = renderSchedule();
    updateNotifState();

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").then(() => notifyToday(todays)).catch(() => {});
    }
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderCharts, 150);
    });
  }

  init();
})();
