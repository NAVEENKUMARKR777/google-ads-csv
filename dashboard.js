// ── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://jkcvwihwitgpxzljlmoh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprY3Z3aWh3aXRncHh6bGpsbW9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2ODkzODcsImV4cCI6MjA4ODI2NTM4N30.l2TYr2m_KgQ3kN2s2fCp6lxRiE7Z6c00rIqr-MWjQgw";

async function supabaseFetch(table) {
  const rows = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < limit) break;
    offset += limit;
  }
  return rows;
}

// ── PARSE CSV ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const raw = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(raw).map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if ((c === "," || c === "\t") && !inQ) { vals.push(cur); cur = ""; continue; }
      cur += c;
    }
    vals.push(cur);
    const obj = {};
    headers.forEach((h, i) => {
      const v = (vals[i] || "").trim();
      obj[h] = v === "" ? "" : isNaN(v) ? v : Number(v);
    });
    return obj;
  });
}

// ── AGGREGATE ROWS ───────────────────────────────────────────────────────────
function aggregate(rows, dateStart, dateEnd) {
  const days = new Set(rows.filter(r => r.date >= dateStart && r.date <= dateEnd).map(r => r.date)).size || 1;
  const sum = k => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const imp   = sum("impressions");
  const clk   = sum("clicks");
  const cost  = sum("cost");
  const conv  = sum("conversions");
  const cv    = sum("conversion_value");
  return {
    impressions:     imp,
    imp_per_day:     imp / days,
    clicks:          clk,
    clk_per_day:     clk / days,
    cost,
    conversions:     conv,
    conv_value:      cv,
    cv_per_day:      cv / days,
    ctr:             imp ? (clk / imp) * 100 : 0,
    cpc:             clk ? cost / clk : 0,
    cpa:             conv ? cost / conv : 0,
    cvr:             clk ? (conv / clk) * 100 : 0,
  };
}

// ── FORMAT HELPERS ───────────────────────────────────────────────────────────
const f0  = n => n == null ? "—" : Number(n).toLocaleString("en-AU", {maximumFractionDigits: 0});
const f1  = n => n == null ? "—" : Number(n).toFixed(1);
const f2  = n => n == null ? "—" : Number(n).toFixed(2);
const pct = n => n == null ? "—" : `${Number(n).toFixed(1)}%`;
const cur = n => n == null ? "—" : `$${Number(n).toLocaleString("en-AU", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

function deltaPct(curr, prev) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function deltaBadge(curr, prev, isCost = false) {
  const d = deltaPct(curr, prev);
  if (d == null) return "";
  const up   = d >= 0;
  const sign = up ? "▲" : "▼";
  let cls;
  if (isCost) cls = up ? "delta-cost-up" : "delta-cost-down";
  else        cls = up ? "delta-up"       : "delta-down";
  return `<span class="delta ${cls}">${sign} ${Math.abs(d).toFixed(1)}%</span>`;
}

// ── STATE ────────────────────────────────────────────────────────────────────
let allRows = [];
let adSortKey = "cost";
let adSortDir = -1;

// Primary range
let primaryStart = null;
let primaryEnd = null;
let primaryViewMonth = null;
let primaryTempStart = null;
let primaryActivePreset = null;

// Compare range
let compareStart = null;
let compareEnd = null;
let compareViewMonth = null;
let compareActivePreset = null;

// Selection state: true = waiting for second click (end date)
let primarySelectingEnd = false;
let compareSelectingEnd = false;

let dataMinDate = null;
let dataMaxDate = null;

// ── DATE UTIL ────────────────────────────────────────────────────────────────
function offsetDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db - da) / 86400000);
}

function formatShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ── CHANGES CSV ──────────────────────────────────────────────────────────────
let changesRows = [];

document.getElementById("changesInput").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    changesRows = parseCSV(ev.target.result);
    changesRows.sort((a, b) => (b.datetime || "").localeCompare(a.datetime || ""));
    renderChanges();
  };
  reader.readAsText(f);
});

function renderChanges() {
  if (!changesRows.length) return;
  document.getElementById("changesEmpty").classList.add("hidden");
  document.getElementById("changesTableWrap").classList.remove("hidden");

  const filtered = changesRows.filter(r => {
    const date = (r.datetime || "").slice(0, 10);
    return date >= primaryStart && date <= primaryEnd;
  });

  document.getElementById("changesTbody").innerHTML = filtered.length
    ? filtered.map(r => {
        const dt = (r.datetime || "").replace(" ", "\u00a0\u00a0");
        const ag = r.ad_group_name || "—";
        const rt = r.resource_type || "—";
        const change = r.changed_field || "—";
        const oldVal = r.old_value ?? "—";
        const newVal = r.new_value ?? "—";
        const user = r.user_email || "—";
        const camp = r.campaign_name || "—";
        return `<tr>
          <td style="white-space:nowrap">${dt}</td>
          <td>${camp}</td>
          <td>${ag}</td>
          <td><span class="resource-badge">${rt}</span></td>
          <td>${change}</td>
          <td class="change-val-cell">${oldVal}</td>
          <td class="change-val-cell">${newVal}</td>
          <td>${user}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="8" style="text-align:center;color:var(--text-2);padding:24px">No changes in the selected date range</td></tr>`;
}

// ── FETCH FROM SERVER ────────────────────────────────────────────────────────
document.getElementById("fetchMetricsBtn").addEventListener("click", async () => {
  const btn = document.getElementById("fetchMetricsBtn");
  btn.disabled = true;
  btn.textContent = "Fetching...";
  try {
    const rows = await supabaseFetch("ad_metrics");
    if (!rows.length) throw new Error("empty");
    // Strip supabase meta fields
    allRows = rows.map(r => {
      const { id, inserted_at, ...rest } = r;
      return rest;
    });
    initDashboard();
    btn.textContent = "Fetched!";
    setTimeout(() => { btn.innerHTML = svgRefresh + " Fetch from server"; btn.disabled = false; }, 2000);
  } catch (e) {
    btn.textContent = "Couldn't find CSV on server";
    btn.classList.add("fetch-btn--error");
    setTimeout(() => { btn.innerHTML = svgRefresh + " Fetch from server"; btn.disabled = false; btn.classList.remove("fetch-btn--error"); }, 3000);
  }
});

document.getElementById("fetchChangesBtn").addEventListener("click", async () => {
  const btn = document.getElementById("fetchChangesBtn");
  btn.disabled = true;
  btn.textContent = "Fetching...";
  try {
    const rows = await supabaseFetch("ad_changes");
    if (!rows.length) throw new Error("empty");
    changesRows = rows.map(r => {
      const { id, inserted_at, ...rest } = r;
      return rest;
    });
    changesRows.sort((a, b) => (b.datetime || "").localeCompare(a.datetime || ""));
    renderChanges();
    btn.textContent = "Fetched!";
    setTimeout(() => { btn.innerHTML = svgRefreshSmall + " Fetch from server"; btn.disabled = false; }, 2000);
  } catch (e) {
    btn.textContent = "Couldn't find CSV on server";
    btn.classList.add("fetch-btn--error");
    setTimeout(() => { btn.innerHTML = svgRefreshSmall + " Fetch from server"; btn.disabled = false; btn.classList.remove("fetch-btn--error"); }, 3000);
  }
});

const svgRefresh = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>`;
const svgRefreshSmall = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>`;

// ── INIT ─────────────────────────────────────────────────────────────────────
document.getElementById("csvInput").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    allRows = parseCSV(ev.target.result);
    initDashboard();
  };
  reader.readAsText(f);
});

function initDashboard() {
  if (!allRows.length) return;

  const dates = allRows.map(r => r.date).filter(Boolean).sort();
  dataMinDate = dates[0];
  dataMaxDate = dates[dates.length - 1];

  // Default: last 7 days vs prior 7
  primaryEnd = dataMaxDate;
  primaryStart = offsetDate(primaryEnd, -6);
  primaryActivePreset = "7";

  const span = daysBetween(primaryStart, primaryEnd) + 1;
  compareEnd = offsetDate(primaryStart, -1);
  compareStart = offsetDate(compareEnd, -(span - 1));
  compareActivePreset = "prev";

  // View months
  const endD = new Date(primaryEnd + "T00:00:00");
  primaryViewMonth = new Date(endD.getFullYear(), endD.getMonth() - 1, 1);
  const compEndD = new Date(compareEnd + "T00:00:00");
  compareViewMonth = new Date(compEndD.getFullYear(), compEndD.getMonth() - 1, 1);

  // Campaigns
  const campaigns = ["All campaigns", ...Array.from(new Set(allRows.map(r => r.campaign_name).filter(Boolean))).sort()];
  const campSel = document.getElementById("campaignSelect");
  campSel.innerHTML = campaigns.map(c => `<option value="${c}">${c}</option>`).join("");
  campSel.addEventListener("change", onCampaignChange);

  document.getElementById("adGroupSelect").innerHTML = `<option>All ad groups</option>`;
  document.getElementById("applyBtn").addEventListener("click", render);

  // Ad table sorting
  document.querySelectorAll("#adTable th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (adSortKey === key) adSortDir *= -1;
      else { adSortKey = key; adSortDir = -1; }
      document.querySelectorAll("#adTable th").forEach(t => t.classList.remove("sorted"));
      th.classList.add("sorted");
      render();
    });
  });

  initPrimaryPicker();
  initComparePicker();

  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("mainContent").classList.remove("hidden");
  updatePrimaryTrigger();
  updateCompareTrigger();
  render();
}

// ── PRIMARY PICKER ───────────────────────────────────────────────────────────
function initPrimaryPicker() {
  const wrap = document.getElementById("primaryPickerWrap");
  const trigger = document.getElementById("primaryTrigger");
  const dropdown = document.getElementById("primaryDropdown");

  trigger.addEventListener("click", () => {
    closeAllDropdowns();
    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) {
      renderPrimaryCalendars();
      updatePrimaryFooter();
    }
  });

  document.addEventListener("mousedown", e => {
    if (!wrap.contains(e.target)) dropdown.classList.add("hidden");
  });

  document.getElementById("primaryCalPrev").addEventListener("click", () => {
    primaryViewMonth.setMonth(primaryViewMonth.getMonth() - 1);
    renderPrimaryCalendars();
  });
  document.getElementById("primaryCalNext").addEventListener("click", () => {
    primaryViewMonth.setMonth(primaryViewMonth.getMonth() + 1);
    renderPrimaryCalendars();
  });

  document.querySelectorAll("#primaryPresets button[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      primaryActivePreset = preset;
      if (preset === "all") {
        primaryStart = dataMinDate;
        primaryEnd = dataMaxDate;
      } else {
        const n = parseInt(preset);
        primaryEnd = dataMaxDate;
        primaryStart = offsetDate(primaryEnd, -(n - 1));
      }
      const endD = new Date(primaryEnd + "T00:00:00");
      primaryViewMonth = new Date(endD.getFullYear(), endD.getMonth() - 1, 1);
      primarySelectingEnd = false;
      autoUpdateCompare();
      updatePrimaryPresetButtons();
      renderPrimaryCalendars();
      updatePrimaryFooter();
    });
  });

  document.getElementById("primaryApplyBtn").addEventListener("click", () => {
    dropdown.classList.add("hidden");
    updatePrimaryTrigger();
    updateCompareTrigger();
    render();
  });
}

function updatePrimaryPresetButtons() {
  document.querySelectorAll("#primaryPresets button[data-preset]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.preset === primaryActivePreset);
  });
}

function updatePrimaryTrigger() {
  document.getElementById("primaryTriggerLabel").textContent =
    `${formatShort(primaryStart)} – ${formatShort(primaryEnd)}`;
}

function updatePrimaryFooter() {
  const display = document.getElementById("primaryRangeDisplay");
  const span = daysBetween(primaryStart, primaryEnd) + 1;
  display.innerHTML = `<span class="range-chip primary">${formatShort(primaryStart)} – ${formatShort(primaryEnd)}</span>` +
    `<span style="color:var(--text-2)">${span} day${span !== 1 ? 's' : ''}</span>`;
}

function renderPrimaryCalendars() {
  const left = new Date(primaryViewMonth);
  const right = new Date(primaryViewMonth.getFullYear(), primaryViewMonth.getMonth() + 1, 1);

  document.getElementById("primaryCalLeftLabel").textContent = `${MONTH_NAMES[left.getMonth()]} ${left.getFullYear()}`;
  document.getElementById("primaryCalRightLabel").textContent = `${MONTH_NAMES[right.getMonth()]} ${right.getFullYear()}`;

  renderMonthGrid("primaryCalLeftGrid", left, primaryStart, primaryEnd, "primary", onPrimaryDayClick);
  renderMonthGrid("primaryCalRightGrid", right, primaryStart, primaryEnd, "primary", onPrimaryDayClick);
  updatePrimaryPresetButtons();
}

function onPrimaryDayClick(dateStr) {
  primaryActivePreset = null;
  if (!primarySelectingEnd) {
    // First click: set start
    primaryStart = dateStr;
    primaryEnd = dateStr;
    primarySelectingEnd = true;
  } else {
    // Second click: set end
    if (dateStr < primaryStart) {
      primaryEnd = primaryStart;
      primaryStart = dateStr;
    } else {
      primaryEnd = dateStr;
    }
    primarySelectingEnd = false;
  }
  autoUpdateCompare();
  renderPrimaryCalendars();
  updatePrimaryFooter();
}

// ── COMPARE PICKER ───────────────────────────────────────────────────────────
function initComparePicker() {
  const wrap = document.getElementById("comparePickerWrap");
  const trigger = document.getElementById("compareTrigger");
  const dropdown = document.getElementById("compareDropdown");

  trigger.addEventListener("click", () => {
    closeAllDropdowns();
    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) {
      renderCompareCalendars();
      updateCompareFooter();
    }
  });

  document.addEventListener("mousedown", e => {
    if (!wrap.contains(e.target)) dropdown.classList.add("hidden");
  });

  document.getElementById("compareCalPrev").addEventListener("click", () => {
    compareViewMonth.setMonth(compareViewMonth.getMonth() - 1);
    renderCompareCalendars();
  });
  document.getElementById("compareCalNext").addEventListener("click", () => {
    compareViewMonth.setMonth(compareViewMonth.getMonth() + 1);
    renderCompareCalendars();
  });

  document.querySelectorAll("#comparePresets button[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      compareActivePreset = preset;
      applyComparePreset(preset);
      compareSelectingEnd = false;
      updateComparePresetButtons();
      renderCompareCalendars();
      updateCompareFooter();
    });
  });

  document.getElementById("compareApplyBtn").addEventListener("click", () => {
    dropdown.classList.add("hidden");
    updateCompareTrigger();
    render();
  });
}

function applyComparePreset(preset) {
  const span = daysBetween(primaryStart, primaryEnd) + 1;
  if (preset === "prev") {
    compareEnd = offsetDate(primaryStart, -1);
    compareStart = offsetDate(compareEnd, -(span - 1));
  } else if (preset === "prev-month") {
    const sd = new Date(primaryStart + "T00:00:00");
    const ed = new Date(primaryEnd + "T00:00:00");
    sd.setMonth(sd.getMonth() - 1);
    ed.setMonth(ed.getMonth() - 1);
    compareStart = toDateStr(sd);
    compareEnd = toDateStr(ed);
  } else if (preset === "prev-year") {
    const sd = new Date(primaryStart + "T00:00:00");
    const ed = new Date(primaryEnd + "T00:00:00");
    sd.setFullYear(sd.getFullYear() - 1);
    ed.setFullYear(ed.getFullYear() - 1);
    compareStart = toDateStr(sd);
    compareEnd = toDateStr(ed);
  }
  // "custom" preset just lets user click on the calendar — no auto-set
  const compEndD = new Date(compareEnd + "T00:00:00");
  compareViewMonth = new Date(compEndD.getFullYear(), compEndD.getMonth() - 1, 1);
}

function autoUpdateCompare() {
  // If compare is set to "prev" or hasn't been customized, auto-update
  if (compareActivePreset && compareActivePreset !== "custom") {
    applyComparePreset(compareActivePreset);
  }
}

function updateComparePresetButtons() {
  document.querySelectorAll("#comparePresets button[data-preset]").forEach(btn => {
    btn.classList.remove("active", "active-compare");
    if (btn.dataset.preset === compareActivePreset) btn.classList.add("active-compare");
  });
}

function updateCompareTrigger() {
  document.getElementById("compareTriggerLabel").textContent =
    `${formatShort(compareStart)} – ${formatShort(compareEnd)}`;
}

function updateCompareFooter() {
  const display = document.getElementById("compareRangeDisplay");
  const span = daysBetween(compareStart, compareEnd) + 1;
  display.innerHTML = `<span class="range-chip compare">${formatShort(compareStart)} – ${formatShort(compareEnd)}</span>` +
    `<span style="color:var(--text-2)">${span} day${span !== 1 ? 's' : ''}</span>`;
}

function renderCompareCalendars() {
  const left = new Date(compareViewMonth);
  const right = new Date(compareViewMonth.getFullYear(), compareViewMonth.getMonth() + 1, 1);

  document.getElementById("compareCalLeftLabel").textContent = `${MONTH_NAMES[left.getMonth()]} ${left.getFullYear()}`;
  document.getElementById("compareCalRightLabel").textContent = `${MONTH_NAMES[right.getMonth()]} ${right.getFullYear()}`;

  renderMonthGrid("compareCalLeftGrid", left, compareStart, compareEnd, "compare", onCompareDayClick);
  renderMonthGrid("compareCalRightGrid", right, compareStart, compareEnd, "compare", onCompareDayClick);
  updateComparePresetButtons();
}

function onCompareDayClick(dateStr) {
  compareActivePreset = "custom";
  if (!compareSelectingEnd) {
    // First click: set start
    compareStart = dateStr;
    compareEnd = dateStr;
    compareSelectingEnd = true;
  } else {
    // Second click: set end
    if (dateStr < compareStart) {
      compareEnd = compareStart;
      compareStart = dateStr;
    } else {
      compareEnd = dateStr;
    }
    compareSelectingEnd = false;
  }
  renderCompareCalendars();
  updateCompareFooter();
}

// ── SHARED CALENDAR RENDERER ─────────────────────────────────────────────────
function renderMonthGrid(gridId, monthDate, rangeStart, rangeEnd, variant, onClick) {
  const grid = document.getElementById(gridId);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const today = toDateStr(new Date());
  const isPrimary = variant === "primary";

  const dows = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  let html = dows.map(d => `<span class="cal-dow">${d}</span>`).join("");

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    html += `<span class="cal-day empty"></span>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let cls = "cal-day";

    if (rangeStart && rangeEnd) {
      if (isPrimary) {
        if (ds === rangeStart && ds === rangeEnd) cls += " range-start range-end";
        else if (ds === rangeStart) cls += " range-start";
        else if (ds === rangeEnd) cls += " range-end";
        else if (ds > rangeStart && ds < rangeEnd) cls += " in-range";
      } else {
        if (ds === rangeStart && ds === rangeEnd) cls += " compare-start compare-end";
        else if (ds === rangeStart) cls += " compare-start";
        else if (ds === rangeEnd) cls += " compare-end";
        else if (ds > rangeStart && ds < rangeEnd) cls += " in-compare";
      }
    }

    if (ds === today) cls += " today";

    html += `<span class="${cls}" data-date="${ds}">${d}</span>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll(".cal-day:not(.empty)").forEach(cell => {
    cell.addEventListener("click", () => onClick(cell.dataset.date));
  });
}

// ── UTILITY ──────────────────────────────────────────────────────────────────
function closeAllDropdowns() {
  document.getElementById("primaryDropdown").classList.add("hidden");
  document.getElementById("compareDropdown").classList.add("hidden");
}

function onCampaignChange() {
  const camp = document.getElementById("campaignSelect").value;
  const agSel = document.getElementById("adGroupSelect");
  if (camp === "All campaigns") {
    agSel.innerHTML = `<option>All ad groups</option>`;
    agSel.disabled = true;
    return;
  }
  agSel.disabled = false;
  const groups = ["All ad groups", ...Array.from(new Set(
    allRows.filter(r => r.campaign_name === camp).map(r => r.ad_group_name).filter(Boolean)
  )).sort()];
  agSel.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join("");
}

// ── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  const s1 = primaryStart;
  const e1 = primaryEnd;
  const s2 = compareStart;
  const e2 = compareEnd;
  const camp = document.getElementById("campaignSelect").value;
  const ag   = document.getElementById("adGroupSelect").value;

  let curr = allRows.filter(r => r.date >= s1 && r.date <= e1);
  let comp = allRows.filter(r => r.date >= s2 && r.date <= e2);

  if (camp !== "All campaigns") {
    curr = curr.filter(r => r.campaign_name === camp);
    comp = comp.filter(r => r.campaign_name === camp);
  }
  if (ag && ag !== "All ad groups") {
    curr = curr.filter(r => r.ad_group_name === ag);
    comp = comp.filter(r => r.ad_group_name === ag);
  }

  document.getElementById("summaryLabel").textContent =
    `Showing data from ${s1} → ${e1}  vs  ${s2} → ${e2}   |   ${curr.length} rows in current period, ${comp.length} in comparison`;

  const isAllCampaigns = camp === "All campaigns";
  const groupKey = isAllCampaigns ? "campaign_name" : "ad_group_name";
  document.getElementById("aggTableTitle").textContent = isAllCampaigns ? "Campaign Performance" : "Ad Group Performance";

  renderAggTable(curr, comp, groupKey, s1, e1, s2, e2);
  renderInsights(curr, comp, s1, e1, s2, e2);
  renderChanges();
  renderAdTable(curr, comp);
}

// ── AGG TABLE ────────────────────────────────────────────────────────────────
function renderAggTable(curr, comp, groupKey, s1, e1, s2, e2) {
  const groups = Array.from(new Set(curr.map(r => r[groupKey]).filter(Boolean))).sort();

  const thead = document.getElementById("aggThead");
  const tbody = document.getElementById("aggTbody");

  thead.innerHTML = `<tr>
    <th>Name</th>
    <th>Impressions</th>
    <th>Imp/day</th>
    <th>Clicks</th>
    <th>Clicks/day</th>
    <th>Cost</th>
    <th>Conversions</th>
    <th>Conv Value</th>
    <th>Conv Val/day</th>
    <th>CTR</th>
    <th>CPC</th>
    <th>CPA</th>
    <th>CVR</th>
  </tr>`;

  tbody.innerHTML = groups.map(g => {
    const cRows = curr.filter(r => r[groupKey] === g);
    const pRows = comp.filter(r => r[groupKey] === g);
    const hasPrev = pRows.length > 0;
    const c = aggregate(cRows, s1, e1);
    const p = hasPrev ? aggregate(pRows, s2, e2) : null;

    const db = (cv, pv, cost=false) => p ? deltaBadge(cv, pv, cost) : "";

    return `<tr>
      <td><span class="name-cell">${g}</span></td>
      <td>${f0(c.impressions)}${db(c.impressions, p?.impressions)}</td>
      <td>${f1(c.imp_per_day)}${db(c.imp_per_day, p?.imp_per_day)}</td>
      <td>${f0(c.clicks)}${db(c.clicks, p?.clicks)}</td>
      <td>${f1(c.clk_per_day)}${db(c.clk_per_day, p?.clk_per_day)}</td>
      <td>${cur(c.cost)}${db(c.cost, p?.cost, true)}</td>
      <td>${f1(c.conversions)}${db(c.conversions, p?.conversions)}</td>
      <td>${cur(c.conv_value)}${db(c.conv_value, p?.conv_value)}</td>
      <td>${cur(c.cv_per_day)}${db(c.cv_per_day, p?.cv_per_day)}</td>
      <td>${pct(c.ctr)}${db(c.ctr, p?.ctr)}</td>
      <td>${cur(c.cpc)}${db(c.cpc, p?.cpc, true)}</td>
      <td>${c.conversions > 0 ? cur(c.cpa) : "—"}${c.conversions > 0 && p?.conversions > 0 ? db(c.cpa, p.cpa, true) : ""}</td>
      <td>${pct(c.cvr)}${db(c.cvr, p?.cvr)}</td>
    </tr>`;
  }).join("");

  const totC = aggregate(curr, s1, e1);
  const totP = comp.length ? aggregate(comp, s2, e2) : null;
  const db = (cv, pv, cost=false) => totP ? deltaBadge(cv, pv, cost) : "";

  tbody.innerHTML += `<tr style="font-weight:600; background:#f8f9fa; border-top: 2px solid #e0e0e0;">
    <td>Total</td>
    <td>${f0(totC.impressions)}${db(totC.impressions, totP?.impressions)}</td>
    <td>${f1(totC.imp_per_day)}${db(totC.imp_per_day, totP?.imp_per_day)}</td>
    <td>${f0(totC.clicks)}${db(totC.clicks, totP?.clicks)}</td>
    <td>${f1(totC.clk_per_day)}${db(totC.clk_per_day, totP?.clk_per_day)}</td>
    <td>${cur(totC.cost)}${db(totC.cost, totP?.cost, true)}</td>
    <td>${f1(totC.conversions)}${db(totC.conversions, totP?.conversions)}</td>
    <td>${cur(totC.conv_value)}${db(totC.conv_value, totP?.conv_value)}</td>
    <td>${cur(totC.cv_per_day)}${db(totC.cv_per_day, totP?.cv_per_day)}</td>
    <td>${pct(totC.ctr)}${db(totC.ctr, totP?.ctr)}</td>
    <td>${cur(totC.cpc)}${db(totC.cpc, totP?.cpc, true)}</td>
    <td>${totC.conversions > 0 ? cur(totC.cpa) : "—"}${totC.conversions > 0 && totP?.conversions > 0 ? db(totC.cpa, totP.cpa, true) : ""}</td>
    <td>${pct(totC.cvr)}${db(totC.cvr, totP?.cvr)}</td>
  </tr>`;
}

// ── INSIGHTS ─────────────────────────────────────────────────────────────────
function renderInsights(curr, comp, s1, e1, s2, e2) {
  if (!comp.length) {
    document.getElementById("insightsList").innerHTML = `<li class="ins-neutral"><span class="ins-icon">ℹ️</span>No comparison data available for the selected period.</li>`;
    return;
  }

  const c = aggregate(curr, s1, e1);
  const p = aggregate(comp, s2, e2);

  const metrics = [
    { label: "Total impressions",         cv: c.impressions,  pv: p.impressions,  fmt: f0,  cost: false },
    { label: "Avg impressions/day",        cv: c.imp_per_day,  pv: p.imp_per_day,  fmt: f1,  cost: false },
    { label: "Total clicks",              cv: c.clicks,       pv: p.clicks,       fmt: f0,  cost: false },
    { label: "Avg clicks/day",            cv: c.clk_per_day,  pv: p.clk_per_day,  fmt: f1,  cost: false },
    { label: "Total spend",               cv: c.cost,         pv: p.cost,         fmt: cur, cost: true  },
    { label: "Total conversions",         cv: c.conversions,  pv: p.conversions,  fmt: f1,  cost: false },
    { label: "Total conversion value",    cv: c.conv_value,   pv: p.conv_value,   fmt: cur, cost: false },
    { label: "CTR",                       cv: c.ctr,          pv: p.ctr,          fmt: pct, cost: false },
    { label: "CPC",                       cv: c.cpc,          pv: p.cpc,          fmt: cur, cost: true  },
    { label: "CPA",                       cv: c.cpa,          pv: p.cpa,          fmt: cur, cost: true  },
    { label: "CVR",                       cv: c.cvr,          pv: p.cvr,          fmt: pct, cost: false },
  ];

  const items = metrics.map(m => {
    const d = deltaPct(m.cv, m.pv);
    if (d == null || Math.abs(d) < 0.1) return null;
    const up = d >= 0;
    const positive = m.cost ? !up : up;
    const dir  = up ? "increased" : "decreased";
    const sign = up ? "▲" : "▼";
    const cls  = positive ? "ins-positive" : "ins-negative";
    const icon = positive ? "✅" : "⚠️";
    return `<li class="${cls}"><span class="ins-icon">${icon}</span><span><strong>${m.label}</strong> ${dir} by <strong>${sign} ${Math.abs(d).toFixed(1)}%</strong> (${m.fmt(m.pv)} → ${m.fmt(m.cv)})</span></li>`;
  }).filter(Boolean);

  document.getElementById("insightsList").innerHTML = items.length
    ? items.join("")
    : `<li class="ins-neutral"><span class="ins-icon">ℹ️</span>No significant changes detected between the two periods.</li>`;
}

// ── AD TABLE ─────────────────────────────────────────────────────────────────
function renderAdTable(curr, comp) {
  const adIds = Array.from(new Set(curr.map(r => r.ad_id)));

  const ads = adIds.map(id => {
    const cRows = curr.filter(r => r.ad_id == id);
    const pRows = comp.filter(r => r.ad_id == id);
    const c = aggregate(cRows, "0000-00-00", "9999-99-99");
    const p = pRows.length ? aggregate(pRows, "0000-00-00", "9999-99-99") : null;
    return {
      ad_id:       id,
      headline:    cRows[0]?.ad_headline || "—",
      campaign:    cRows[0]?.campaign_name || "—",
      impressions: c.impressions,
      clicks:      c.clicks,
      ctr:         c.ctr,
      conversions: c.conversions,
      cpa:         c.cpa,
      cost:        c.cost,
      _prev:       p,
    };
  });

  ads.sort((a, b) => {
    const av = a[adSortKey] ?? 0;
    const bv = b[adSortKey] ?? 0;
    return (av - bv) * adSortDir;
  });

  document.getElementById("adTbody").innerHTML = ads.map(ad => {
    const p = ad._prev;
    const db = (cv, pv, cost=false) => p ? deltaBadge(cv, pv, cost) : "";
    return `<tr>
      <td><span class="headline-cell" title="${ad.headline}">${ad.headline}</span></td>
      <td style="text-align:left">${ad.campaign}</td>
      <td>${f0(ad.impressions)}${db(ad.impressions, p?.impressions)}</td>
      <td>${f0(ad.clicks)}${db(ad.clicks, p?.clicks)}</td>
      <td>${pct(ad.ctr)}${db(ad.ctr, p?.ctr)}</td>
      <td>${f1(ad.conversions)}${db(ad.conversions, p?.conversions)}</td>
      <td>${ad.conversions > 0 ? cur(ad.cpa) : "—"}${ad.conversions > 0 && p?.conversions > 0 ? db(ad.cpa, p.cpa, true) : ""}</td>
      <td>${cur(ad.cost)}${db(ad.cost, p?.cost, true)}</td>
    </tr>`;
  }).join("");
}
