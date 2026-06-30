'use strict';

// ── Config (stored in localStorage) ──────────────────────────────────────────
const cfg = {
  get sbUrl()  { return localStorage.getItem('sb_url') || ''; },
  get sbKey()  { return localStorage.getItem('sb_key') || ''; },
  get geminiKey() { return localStorage.getItem('gemini_key') || ''; },
  set sbUrl(v)  { localStorage.setItem('sb_url', v); },
  set sbKey(v)  { localStorage.setItem('sb_key', v); },
  set geminiKey(v) { localStorage.setItem('gemini_key', v); },
};

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  date: todayStr(),          // YYYY-MM-DD
  entry: {},                 // current habit entry values
  sleep: 8.0,
  sleepAvg14: null,
  weight: null,
  weightAvg14: null,
  mood: null,
  emotions: {},
  notes: '',
  dirtyCheckin: false,
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateNL(str) {
  const [y,m,d] = str.split('-');
  const days = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
  const months = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  const dt = new Date(+y, +m-1, +d);
  return `${days[dt.getDay()]} ${+d} ${months[dt.getMonth()]} ${y}`;
}

function offsetDate(str, days) {
  const d = new Date(str);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function showToast(msg, duration=2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function haptic(ms = 8) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

const MOOD_SVG = {
  '😞': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="8.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="M7.5,17 Q12,12 16.5,17"/></svg>`,
  '😕': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="8.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="M7.5,16.5 Q12,14 16.5,16.5"/></svg>`,
  '😐': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="8.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><line x1="7.5" y1="15.5" x2="16.5" y2="15.5"/></svg>`,
  '🙂': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="8.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="M7.5,15 Q12,18.5 16.5,15"/></svg>`,
  '😄': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5,10.5 Q8.5,9 9.5,10.5"/><path d="M14.5,10.5 Q15.5,9 16.5,10.5"/><path d="M7,15 Q12,20.5 17,15"/></svg>`,
};

let _autoSaveTimer = null;

function scheduleAutoSave() {
  if (!cfg.sbUrl || !cfg.sbKey) return;
  state.dirtyCheckin = true;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    _autoSaveTimer = null;
    saveCheckin(true);
  }, 1500);
}

function showSettings() {
  navigate('settings');
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function sbFetch(path, opts={}) {
  if (!cfg.sbUrl || !cfg.sbKey) throw new Error('Supabase niet geconfigureerd');
  const url = `${cfg.sbUrl}/rest/v1${path}`;
  const headers = {
    'apikey': cfg.sbKey,
    'Authorization': `Bearer ${cfg.sbKey}`,
    'Content-Type': 'application/json',
    'Prefer': opts.prefer || 'return=representation',
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const _entryCache = new Map();

async function loadEntry(dateStr) {
  if (_entryCache.has(dateStr)) return _entryCache.get(dateStr);
  const p = sbFetch(`/habit_entries?date=eq.${dateStr}&limit=1`)
    .then(rows => rows && rows.length ? rows[0] : null);
  _entryCache.set(dateStr, p);
  return p;
}

function invalidateEntry(dateStr) {
  _entryCache.delete(dateStr);
}

async function loadSleepAvg14(excludeDate) {
  if (!cfg.sbUrl || !cfg.sbKey) return null;
  const from = offsetDate(excludeDate, -14);
  const to   = offsetDate(excludeDate, -1);
  try {
    const rows = await sbFetch(`/habit_entries?date=gte.${from}&date=lte.${to}&slaap=not.is.null&select=slaap`);
    if (!rows || !rows.length) return null;
    const vals = rows.map(r => +r.slaap).filter(v => !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  } catch { return null; }
}

async function loadWeightAvg14(excludeDate) {
  if (!cfg.sbUrl || !cfg.sbKey) return null;
  const from = offsetDate(excludeDate, -14);
  const to   = offsetDate(excludeDate, -1);
  try {
    const rows = await sbFetch(`/habit_entries?date=gte.${from}&date=lte.${to}&gewicht=not.is.null&select=gewicht`);
    if (!rows || !rows.length) return null;
    const vals = rows.map(r => +r.gewicht).filter(v => !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  } catch { return null; }
}

async function upsertEntry(data) {
  return sbFetch('/habit_entries?on_conflict=date', {
    method: 'POST',
    prefer: 'return=representation,resolution=merge-duplicates',
    body: JSON.stringify(data),
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`screen-${screenId}`).classList.add('active');
  document.querySelector(`.nav-item[data-screen="${screenId}"]`).classList.add('active');

  if (screenId === 'insights') loadInsights();
  if (screenId === 'reflections') renderReflectionsScreen();
  if (screenId === 'settings') populateSettingsFields();

  // Scroll to top
  document.getElementById('main').scrollTop = 0;
}

// ── Check-in Screen ───────────────────────────────────────────────────────────
function updateWeightWarning() {
  const el = document.getElementById('weight-warning');
  if (!el) return;
  const avg = state.weightAvg14;
  if (avg !== null && state.weight !== null) {
    const diff = state.weight - avg;
    if (diff > 1.5) {
      el.textContent = `Iets hoger dan je gemiddelde van de afgelopen 2 weken (${avg.toFixed(1)}kg).`;
      el.style.display = '';
    } else if (diff < -1.5) {
      el.textContent = `Iets lager dan je gemiddelde van de afgelopen 2 weken (${avg.toFixed(1)}kg).`;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  } else {
    el.style.display = 'none';
  }
}

function updateSleepWarning() {
  const el = document.getElementById('sleep-warning');
  if (!el) return;
  const avg = state.sleepAvg14;
  if (avg !== null && state.sleep < avg - 0.4) {
    el.textContent = `Minder slaap dan je gemiddelde van de afgelopen 2 weken (${avg.toFixed(1)}u).`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function renderCheckin() {
  const isToday = state.date === todayStr();
  const isYesterday = state.date === offsetDate(todayStr(), -1);
  const dayNames = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];
  const titleDate = new Date(state.date + 'T12:00:00');
  document.getElementById('checkin-title').textContent = isToday ? 'Vandaag' : isYesterday ? 'Gisteren' : dayNames[titleDate.getDay()];
  document.getElementById('checkin-date').textContent = formatDateNL(state.date);

  // Date nav: disable next if today; show Vandaag when past
  document.getElementById('date-next').disabled = isToday;
  const todayBtn = document.getElementById('today-btn');
  if (todayBtn) todayBtn.style.display = isToday ? 'none' : '';

  // Habit buttons
  document.querySelectorAll('.habit-btn').forEach(btn => {
    const key = btn.dataset.key;
    const on = !!state.entry[key];
    btn.classList.toggle('active', on);
  });

  // Sleep
  document.getElementById('sleep-value').textContent = state.sleep.toFixed(1);
  updateSleepWarning();

  // Weight
  const wi = document.getElementById('weight-input');
  wi.value = state.weight !== null ? state.weight : '';
  updateWeightWarning();

  // Mood
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mood === state.mood);
  });

  // Emotions
  document.querySelectorAll('.emotion-btn').forEach(btn => {
    btn.classList.toggle('active', !!state.emotions[btn.dataset.key]);
  });

  // Notes
  document.getElementById('notes-input').value = state.notes;
}

async function loadCheckinForDate(dateStr) {
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
    if (state.dirtyCheckin) await saveCheckin(true);
  }
  state.date = dateStr;
  state.dirtyCheckin = false;
  state.entry = {};
  state.sleep = 8.0;
  state.sleepAvg14 = null;
  state.weightAvg14 = null;
  state.weight = null;
  state.mood = null;
  state.emotions = {};
  state.notes = '';

  if (!cfg.sbUrl || !cfg.sbKey) {
    document.getElementById('setup-banner').style.display = '';
    renderCheckin();
    return;
  }

  document.getElementById('setup-banner').style.display = 'none';

  try {
    const [row] = await Promise.all([
      loadEntry(dateStr),
      loadSleepAvg14(dateStr).then(avg => { state.sleepAvg14 = avg; }),
      loadWeightAvg14(dateStr).then(avg => { state.weightAvg14 = avg; }),
    ]);
    if (row) {
      const boolKeys = ['gym','gewerkt','geklust','geschreven','geleest','gemediteerd',
        'tijd_met_anderen','gespeeld','te_veel_weinig_eten','gedoomscrolled',
        'gemasturbeerd','porno_gekeken'];
      boolKeys.forEach(k => { if (row[k]) state.entry[k] = true; });
      state.sleep = row.slaap !== null ? +row.slaap : 8.0;
      state.weight = row.gewicht !== null ? +row.gewicht : null;
      state.mood = row.mood_emoji || null;
      ['blij','bang','boos','verdrietig'].forEach(k => {
        if (row[k]) state.emotions[k] = true;
      });
      state.notes = row.notities || '';
    }
  } catch (e) {
    showToast('⚠ Kan data niet laden');
  }

  renderCheckin();
  if (dateStr === todayStr()) loadWeekSummary();
  else { const ws = document.getElementById('week-summary'); if (ws) ws.innerHTML = ''; }

  // Pre-fetch adjacent days so swipe under-card has real data ready
  if (cfg.sbUrl && cfg.sbKey) {
    loadEntry(offsetDate(dateStr, -1)).catch(() => {});
    if (dateStr < todayStr()) loadEntry(offsetDate(dateStr, 1)).catch(() => {});
  }
}

function goToToday() {
  loadCheckinForDate(todayStr());
}

async function loadWeekSummary() {
  const el = document.getElementById('week-summary');
  if (!el) return;
  if (new Date().getDay() !== 1 || !cfg.sbUrl || !cfg.sbKey) { el.innerHTML = ''; return; }

  const getMonday = d => {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(d);
    m.setDate(d.getDate() + diff);
    return `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}-${String(m.getDate()).padStart(2,'0')}`;
  };

  const lastMon = new Date();
  lastMon.setDate(lastMon.getDate() - 7);
  const from = getMonday(lastMon);
  const fromDate = new Date(from + 'T12:00:00');
  const toDate = new Date(fromDate);
  toDate.setDate(fromDate.getDate() + 6);
  const to = `${toDate.getFullYear()}-${String(toDate.getMonth()+1).padStart(2,'0')}-${String(toDate.getDate()).padStart(2,'0')}`;

  try {
    const raw = await sbFetch(`/habit_entries?date=gte.${from}&date=lte.${to}&order=date.asc`);
    const rows = (raw || []).filter(r => r.date >= from && r.date <= to);
    if (!rows.length) { el.innerHTML = ''; return; }

    const goals = [
      { key: 'gym',        label: 'Gym',      goal: 5 },
      { key: 'gewerkt',    label: 'Gewerkt',  goal: 5 },
      { key: 'geklust',    label: 'Geklust',  goal: 7 },
      { key: 'geschreven', label: 'Schrijven',goal: 7 },
    ];

    const goalsHtml = goals.map(g => {
      const count = rows.filter(r => r[g.key]).length;
      const met = count >= g.goal;
      return `<div class="week-summary-goal">
        <span style="font-size:0.78rem;color:${met ? 'var(--success)' : 'var(--text-muted)'}">${met ? '✓' : '○'}</span>
        <span>${g.label} <span style="color:var(--text-muted);font-size:0.78rem">${count}/7</span></span>
      </div>`;
    }).join('');

    el.innerHTML = `<div class="week-summary-card">
      <h3>Vorige week</h3>
      <div class="week-summary-goals">${goalsHtml}</div>
    </div>`;
  } catch(e) {
    el.innerHTML = '';
  }
}

async function saveCheckin(silent = false) {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = null;
  if (!cfg.sbUrl || !cfg.sbKey) {
    if (!silent) { showToast('Configureer eerst Supabase'); navigate('settings'); }
    return;
  }

  const btn = document.getElementById('save-btn');
  if (!silent) { btn.disabled = true; btn.textContent = 'Opslaan…'; }

  const data = {
    date: state.date,
    gym: !!state.entry.gym,
    gewerkt: !!state.entry.gewerkt,
    geklust: !!state.entry.geklust,
    geschreven: !!state.entry.geschreven,
    geleest: !!state.entry.geleest,
    gemediteerd: !!state.entry.gemediteerd,
    tijd_met_anderen: !!state.entry.tijd_met_anderen,
    gespeeld: !!state.entry.gespeeld,
    te_veel_weinig_eten: !!state.entry.te_veel_weinig_eten,
    gedoomscrolled: !!state.entry.gedoomscrolled,
    gemasturbeerd: !!state.entry.gemasturbeerd,
    porno_gekeken: !!state.entry.porno_gekeken,
    slaap: state.sleep,
    gewicht: state.weight,
    mood_emoji: state.mood,
    blij: !!state.emotions.blij,
    bang: !!state.emotions.bang,
    boos: !!state.emotions.boos,
    verdrietig: !!state.emotions.verdrietig,
    notities: state.notes,
    updated_at: new Date().toISOString(),
  };

  try {
    await upsertEntry(data);
    invalidateEntry(state.date);
    state.dirtyCheckin = false;
    if (!silent) showToast('✓ Opgeslagen');
  } catch (e) {
    if (!silent) showToast('⚠ Opslaan mislukt');
    console.error(e);
  }

  if (!silent) { btn.disabled = false; btn.textContent = 'Opslaan'; }
}

// ── Insights Screen ───────────────────────────────────────────────────────────
async function loadInsights() {
  const container = document.getElementById('insights-content');
  if (!cfg.sbUrl || !cfg.sbKey) {
    container.innerHTML = `<div class="empty">Configureer Supabase in Instellingen.</div>`;
    return;
  }

  container.innerHTML = `<div class="loading"><div class="spinner"></div>Laden…</div>`;

  // Determine date range from active period button
  const activePeriod = document.querySelector('.period-btn.active');
  const period = activePeriod ? activePeriod.dataset.period : 'week';
  let from, to;
  to = todayStr();

  const getMonday = (d) => {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(d);
    m.setDate(d.getDate() + diff);
    return `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}-${String(m.getDate()).padStart(2,'0')}`;
  };

  if (period === 'week') {
    from = getMonday(new Date());
    to   = todayStr();
  } else if (period === 'lastweek') {
    const lastMon = new Date();
    lastMon.setDate(lastMon.getDate() - 7);
    from = getMonday(lastMon);
    const lastSun = new Date(from);
    lastSun.setDate(lastSun.getDate() + 6);
    to = `${lastSun.getFullYear()}-${String(lastSun.getMonth()+1).padStart(2,'0')}-${String(lastSun.getDate()).padStart(2,'0')}`;
  } else if (period === 'month') {
    const now = new Date();
    from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    to   = todayStr();
  } else if (period === '3months') {
    from = offsetDate(todayStr(), -89);
  } else if (period === '6months') {
    from = offsetDate(todayStr(), -179);
  } else if (period === 'custom') {
    from = document.getElementById('range-from').value || offsetDate(todayStr(), -6);
    to   = document.getElementById('range-to').value   || todayStr();
  }

  // Fallback voor onbekende of gecachede periode-waarden
  if (!from) from = getMonday(new Date());

  try {
    const [periodRows, allRows] = await Promise.all([
      sbFetch(`/habit_entries?date=gte.${from}&date=lte.${to}&order=date.desc&limit=500`),
      sbFetch(`/habit_entries?order=date.desc&limit=500`),
    ]);
    renderInsights(periodRows || [], allRows || [], from, to, period);
  } catch(e) {
    container.innerHTML = `<div class="empty">⚠ Kan data niet laden.<br><small style="color:var(--text-muted)">${e.message}</small></div>`;
  }
}

function lineChartHtml(vals, dates, color, target = null, showZone = true) {
  if (vals.length < 2) return `<p style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:8px 0">Te weinig data</p>`;

  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (target !== null) { min = Math.min(min, target); max = Math.max(max, target); }
  const spread = max - min || 0.1;

  const W = 300, H = 110;
  const L = 40, R = 6, T = 8, B = 20;
  const cW = W - L - R, cH = H - T - B;

  const toX = i => L + (vals.length > 1 ? (i / (vals.length - 1)) * cW : cW / 2);
  const toY = v => T + (1 - (v - min) / spread) * cH;

  const pts = vals.map((v, i) => [+toX(i).toFixed(1), +toY(v).toFixed(1)]);
  const linePoints = pts.map(p => p.join(',')).join(' ');
  const areaPath = `M${pts[0][0]},${T + cH} ` + pts.map(p => `L${p[0]},${p[1]}`).join(' ') + ` L${pts[pts.length-1][0]},${T + cH} Z`;

  let targetHtml = '';
  if (target !== null) {
    const ty = +toY(target).toFixed(1);
    targetHtml = showZone
      ? `<rect x="${L}" y="${ty}" width="${cW}" height="${(T + cH) - ty}" fill="var(--danger)" fill-opacity="0.10"/>`
      + `<line x1="${L}" y1="${ty}" x2="${W - R}" y2="${ty}" stroke="var(--danger)" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="4,3"/>`
      : `<line x1="${L}" y1="${ty}" x2="${W - R}" y2="${ty}" stroke="var(--text-muted)" stroke-opacity="0.6" stroke-width="1" stroke-dasharray="4,3"/>`;
  }

  // Y-axis: 3 ticks (max, mid, min)
  const yTicks = [max, (min + max) / 2, min];
  const yHtml = yTicks.map(v => {
    const y = toY(v).toFixed(1);
    return `<text x="${L - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="8.5" fill="var(--text-muted)">${v.toFixed(1)}</text>`
         + `<line x1="${L - 2}" y1="${y}" x2="${L}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
  }).join('');

  // X-axis: up to ~6 evenly spaced labels
  const maxLabels = 6;
  const step = Math.max(1, Math.ceil(vals.length / maxLabels));
  const xIndices = [];
  for (let i = 0; i < vals.length; i += step) xIndices.push(i);
  if (xIndices[xIndices.length - 1] !== vals.length - 1) xIndices.push(vals.length - 1);

  const multiMonth = vals.length > 35;
  const monthNames = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  const xHtml = xIndices.map(i => {
    const [, m, d] = dates[i].split('-');
    const label = multiMonth ? `${monthNames[+m - 1]} ${+d}` : `${+d}`;
    return `<text x="${toX(i).toFixed(1)}" y="${T + cH + 13}" text-anchor="middle" font-size="8.5" fill="var(--text-muted)">${label}</text>`;
  }).join('');

  const axes = `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + cH}" stroke="var(--border)" stroke-width="0.5"/>`
             + `<line x1="${L}" y1="${T + cH}" x2="${W - R}" y2="${T + cH}" stroke="var(--border)" stroke-width="0.5"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
    ${axes}
    ${targetHtml}
    <path d="${areaPath}" fill="${color}" opacity="0.15"/>
    <polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${yHtml}${xHtml}
  </svg>`;
}


function renderInsights(rows, allRows, from, to, period) {
  if (!rows.length) {
    document.getElementById('insights-content').innerHTML = `<div class="empty">Nog geen data voor deze periode.</div>`;
    return;
  }

  const essentials = ['gym','gewerkt','geklust','geschreven','stretch_routine'];
  const bonuses    = ['geleest','gemediteerd','tijd_met_anderen','gespeeld'];
  const bad        = ['te_veel_weinig_eten','gedoomscrolled','gemasturbeerd','porno_gekeken'];
  const labels = {
    gym:'Gym', gewerkt:'Gewerkt', geklust:'Geklust', geschreven:'Geschreven',
    geleest:'Gelezen', gemediteerd:'Gemediteerd', tijd_met_anderen:'Sociaal', gespeeld:'Gespeeld',
    te_veel_weinig_eten:'Te veel/weinig', gedoomscrolled:'Doomscroll', gemasturbeerd:'Masturb.', porno_gekeken:'Porno'
  };

  // Skip today if empty (for both sets)
  const boolKeys = [...essentials, ...bonuses, ...bad];
  const todayEmpty = r => boolKeys.every(k => !r[k]) && !r.slaap && !r.gewicht && !r.mood_emoji;
  const dataRows    = rows[0]    && rows[0].date    === todayStr() && todayEmpty(rows[0])    ? rows.slice(1)    : rows;
  const streakRows  = allRows[0] && allRows[0].date === todayStr() && todayEmpty(allRows[0]) ? allRows.slice(1) : allRows;
  const n = dataRows.length;

  // ── Progressiedoelen (schaalt mee met geselecteerde periode) ──
  const periodDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;

  // Vaste doelbasis per periode — altijd volledige week/maand, niet verstreken dagen
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const now = new Date();
  const goalBaseDays =
    (period === 'week' || period === 'lastweek') ? 7 :
    period === 'month'   ? daysInMonth(now.getFullYear(), now.getMonth() + 1) :
    period === '3months' ? 91 :
    period === '6months' ? 182 :
    periodDays;

  const WEEKLY_RATES = { gym: 5/7, gewerkt: 5/7, geklust: 1, geschreven: 1 };
  const periodGoal = k => Math.round(WEEKLY_RATES[k] * goalBaseDays) || 1;

  const progressTitle =
    period === 'week'     ? 'Deze week' :
    period === 'lastweek' ? 'Vorige week' :
    period === 'month'    ? 'Deze maand' :
    period === '3months'  ? 'Afgelopen 3 maanden' :
    period === '6months'  ? 'Afgelopen 6 maanden' : 'Periode';

  const weekGoalHtml = essentials.map(k => {
    const count = dataRows.filter(r => r[k]).length;
    const goal  = periodGoal(k);
    const pct   = Math.min(100, Math.round(count / goal * 100));
    const done  = count >= goal;
    return `
      <div class="habit-bar-row">
        <div class="habit-bar-label">${labels[k]}</div>
        <div class="habit-bar-track">
          <div class="habit-bar-fill essential" style="width:${pct}%; opacity:${done ? 1 : 0.6}"></div>
        </div>
        <div class="habit-bar-pct" style="color:${done ? 'var(--success)' : 'var(--text-muted)'}">
          ${count}/${goal}
        </div>
      </div>`;
  }).join('');

  // ── Essentials: frequentie per geselecteerde periode ──
  const freqHtml = essentials.map(k => {
    const count = dataRows.filter(r => r[k]).length;
    return `
      <div class="streak-item">
        <div class="streak-name">${labels[k]}</div>
        <div style="display:flex;align-items:baseline;gap:4px">
          <div class="streak-count">${count}</div>
          <div class="streak-label">/ ${goalBaseDays} d</div>
        </div>
      </div>`;
  }).join('');

  const streakHtml = freqHtml;

  // ── Completion rates (count / periode) ──
  function barHtml(k, cls) {
    const count = dataRows.filter(r => r[k]).length;
    const pct = Math.min(100, Math.round(count / goalBaseDays * 100));
    return `
      <div class="habit-bar-row">
        <div class="habit-bar-label">${labels[k]}</div>
        <div class="habit-bar-track"><div class="habit-bar-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="habit-bar-pct">${count}/${goalBaseDays}</div>
      </div>`;
  }

  const bonusBars = bonuses.map(k => barHtml(k, 'bonus')).join('');
  const badBars   = bad.map(k    => barHtml(k, 'bad')).join('');

  // ── Gemiddelden + grafiekdata ──
  const sortedRows   = [...dataRows].sort((a, b) => a.date < b.date ? -1 : 1);
  const sleepData    = sortedRows.filter(r => r.slaap   != null);
  const weightData   = sortedRows.filter(r => r.gewicht != null);
  const sleepVals    = sleepData.map(r => +r.slaap);
  const sleepDates   = sleepData.map(r => r.date);
  const weightVals   = weightData.map(r => +r.gewicht);
  const weightDates  = weightData.map(r => r.date);
  const avg = arr => arr.length ? (arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(1) : '–';
  const avgSleep  = avg(sleepVals);
  const avgWeight = avg(weightVals);
  const minWeight = weightVals.length ? Math.min(...weightVals).toFixed(1) : '–';
  const maxWeight = weightVals.length ? Math.max(...weightVals).toFixed(1) : '–';
  const minSleep  = sleepVals.length  ? Math.min(...sleepVals).toFixed(1)  : '–';
  const maxSleep  = sleepVals.length  ? Math.max(...sleepVals).toFixed(1)  : '–';

  // ── Stemming ──
  const moodEmojis = ['😞','😕','😐','🙂','😄'];
  const moodCounts = {};
  moodEmojis.forEach(e => { moodCounts[e] = 0; });
  dataRows.forEach(r => { if (r.mood_emoji && moodCounts[r.mood_emoji] !== undefined) moodCounts[r.mood_emoji]++; });
  const maxMood = Math.max(...Object.values(moodCounts), 1);
  const moodHtml = moodEmojis.map(e => `
    <div class="mood-dist-col">
      <div class="mood-dist-bar-wrap">
        <div class="mood-dist-bar" style="height:${Math.round(moodCounts[e] / maxMood * 48)}px"></div>
      </div>
      <div class="mood-dist-emoji">${MOOD_SVG[e] || e}</div>
      <div class="mood-dist-count">${moodCounts[e]}</div>
    </div>
  `).join('');

  const periodLabel =
    period === 'week'     ? 'deze week' :
    period === 'lastweek' ? 'vorige week' :
    period === 'month'    ? 'deze maand' :
    period === '3months'  ? 'afgelopen 3 maanden' :
    period === '6months'  ? 'afgelopen 6 maanden' :
    `${from} – ${to}`;

  document.getElementById('insights-content').innerHTML = `
    <div class="insight-card">
      <h3>${progressTitle}</h3>
      ${weekGoalHtml}
    </div>

    <div class="insight-card">
      <h3>Essentials — ${periodLabel}</h3>
      <div class="streak-grid">${streakHtml}</div>
    </div>

    <div class="insight-card">
      <h3>Bonussen — ${periodLabel}</h3>
      ${bonusBars}
    </div>

    <div class="insight-card">
      <h3>Aandachtspunten — ${periodLabel}</h3>
      ${badBars}
    </div>

    <div class="insight-card">
      <h3>Stemming — ${periodLabel}</h3>
      <div class="mood-dist">${moodHtml}</div>
    </div>

    <div class="insight-card">
      <h3>Gemiddelden — ${periodLabel}</h3>
      <div class="stats-row">
        <div class="stat-box">
          <div class="stat-label">Slaap gem.</div>
          <div class="stat-value">${avgSleep}</div>
          <div class="stat-unit">uur/nacht</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Gewicht gem.</div>
          <div class="stat-value">${avgWeight}</div>
          <div class="stat-unit">kg</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Gewicht min–max</div>
          <div class="stat-value" style="font-size:1rem;padding-top:6px">${minWeight}–${maxWeight}</div>
          <div class="stat-unit">kg</div>
        </div>
      </div>
    </div>

    <div class="insight-card">
      <h3>Slaap — ${periodLabel}</h3>
      ${lineChartHtml(sleepVals, sleepDates, 'var(--accent)', 8.0)}
    </div>

    <div class="insight-card">
      <h3>Gewicht — ${periodLabel}</h3>
      ${lineChartHtml(weightVals, weightDates, 'var(--success)', 75.0, false)}
    </div>

  `;
}

// ── Reflecties opslaan / weergeven ───────────────────────────────────────────
function getStoredReflections() {
  try { return JSON.parse(localStorage.getItem('reflections_log') || '[]'); } catch { return []; }
}

function saveReflection(date, text) {
  const list = getStoredReflections().filter(r => r.date !== date);
  list.unshift({ date, text });
  localStorage.setItem('reflections_log', JSON.stringify(list));
}

function formatReflectionText(text) {
  return '<p>' + text.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
}

function renderReflectionsScreen() {
  const today = todayStr();
  const list = getStoredReflections();
  const todayEntry = list.find(r => r.date === today);
  const past = list.filter(r => r.date !== today);

  const btn = document.getElementById('generate-narrative-btn');
  const cardEl = document.getElementById('narrative-card');
  const archiveEl = document.getElementById('narrative-archive');
  if (!btn || !cardEl) return;

  if (todayEntry) {
    btn.disabled = true;
    btn.textContent = 'Reflectie voor vandaag reeds gegenereerd';
    cardEl.style.display = 'block';
    cardEl.innerHTML = `
      <div class="narrative-text">${formatReflectionText(todayEntry.text)}</div>
      <p class="narrative-meta">Gegenereerd op ${formatDateNL(today)}</p>`;
  } else {
    btn.disabled = false;
    btn.textContent = 'Genereer reflectie';
    cardEl.style.display = 'none';
    cardEl.innerHTML = '';
  }

  if (!archiveEl) return;
  if (!past.length) { archiveEl.innerHTML = ''; return; }

  archiveEl.innerHTML = `<h3 class="reflection-archive-title">Eerdere reflecties</h3>` +
    past.map(r => `
      <details class="reflection-item">
        <summary class="reflection-summary">
          <span class="reflection-date">${formatDateNL(r.date)}</span>
          <span class="reflection-chevron">›</span>
        </summary>
        <div class="reflection-body">
          <div class="narrative-text">${formatReflectionText(r.text)}</div>
        </div>
      </details>`).join('');
}

// ── Claude AI narratieve reflectie ────────────────────────────────────────────
async function generateInsightNarrative() {
  if (!cfg.geminiKey) {
    showToast('Configureer eerst de Groq API key in Instellingen');
    navigate('settings');
    return;
  }
  if (!cfg.sbUrl || !cfg.sbKey) {
    showToast('Supabase niet geconfigureerd');
    return;
  }

  const btn = document.getElementById('generate-narrative-btn');
  const cardEl = document.getElementById('narrative-card');
  btn.disabled = true;
  btn.textContent = 'Bezig…';
  cardEl.style.display = 'block';
  cardEl.innerHTML = '<div class="narrative-loading">Reflectie genereren…</div>';

  let _generated = false;
  try {
    const to = todayStr();
    const from = offsetDate(to, -13);
    const rows = await sbFetch(`/habit_entries?date=gte.${from}&date=lte.${to}&order=date.asc`);

    // Kalenderdata via lokale server (draait op Mac)
    let calendarEvents = [];
    try {
      const calRes = await fetch(`http://localhost:7878/calendar?from=${from}&to=${to}`);
      if (calRes.ok) calendarEvents = await calRes.json();
    } catch { /* server niet actief, verder zonder kalender */ }

    const dayNames = ['zo','ma','di','wo','do','vr','za'];
    const bool = v => v ? '✓' : '-';

    // Build habit data lines
    const habitLines = [];
    for (let i = 0; i < 14; i++) {
      const d = offsetDate(from, i);
      const [y,mo,dy] = d.split('-');
      const dt = new Date(+y, +mo-1, +dy);
      const label = `${dy}-${mo} (${dayNames[dt.getDay()]})`;
      const r = (rows || []).find(x => x.date === d) || {};
      habitLines.push(
        `${label}: gym:${bool(r.gym)} gew:${bool(r.gewerkt)} schr:${bool(r.geschreven)} gel:${bool(r.geleest)} med:${bool(r.gemediteerd)} soc:${bool(r.tijd_met_anderen)} kl:${bool(r.geklust)} sp:${bool(r.gespeeld)} eten:${bool(r.te_veel_weinig_eten)} doom:${bool(r.gedoomscrolled)} | slaap:${r.slaap != null ? r.slaap + 'u' : '?'} gewicht:${r.gewicht != null ? r.gewicht + 'kg' : '?'} stemming:${r.mood_emoji || '?'}`
      );
    }

    // Kalenderregels per dag opbouwen
    const calLines = [];
    for (let i = 0; i < 14; i++) {
      const d = offsetDate(from, i);
      const [y,mo,dy] = d.split('-');
      const dt = new Date(+y, +mo-1, +dy);
      const label = `${dy}-${mo} (${dayNames[dt.getDay()]})`;
      const dayEvents = calendarEvents.filter(e => e.datetime.startsWith(d));
      if (dayEvents.length) {
        calLines.push(`${label}: ${dayEvents.map(e => `${e.datetime.slice(11)} ${e.title} (${e.calendar})`).join(', ')}`);
      }
    }

    const prompt = `Je bent een persoonlijke reflectieassistent voor Hans, een Belgische psycholoog. Analyseer zijn gewoonte- en welzijnsdata van de afgelopen 14 dagen. Schrijf een zakelijke reflectie in het Nederlands — geen aanmoedigingen, geen lyrisch taalgebruik. Spreek hem aan met "je".

HABITDATA (${from} t/m ${to}):
Kolommen: gym | gewerkt (gew) | geschreven (schr) | gelezen (gel) | gemediteerd (med) | sociaal (soc) | geklust (kl) | gespeeld (sp) | te veel/weinig gegeten (eten) | doomscrolled (doom) | slaapuren | gewicht | stemming
${habitLines.join('\n')}

${calLines.length ? `AGENDA:\n${calLines.join('\n')}` : 'AGENDA: geen kalendergegevens beschikbaar'}

Schrijf een reflectie van 3 korte alinea's (max. 250 woorden totaal):
1. Opvallende patronen of trends in de data.
2. Verbanden tussen variabelen (bijv. slaap ↔ stemming, gewoonten ↔ regelmaat).
3. Één concrete observatie voor de komende week.`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${cfg.geminiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawText = (data.choices?.[0]?.message?.content || '').trim();
    if (!rawText) throw new Error('Geen antwoord ontvangen');
    saveReflection(to, rawText);
    _generated = true;

  } catch(e) {
    cardEl.innerHTML = `<div class="narrative-error">⚠ ${e.message}</div>`;
  } finally {
    if (_generated) {
      renderReflectionsScreen();
    } else {
      btn.disabled = false;
      btn.textContent = 'Genereer reflectie';
    }
  }
}

// ── Settings Screen ───────────────────────────────────────────────────────────
function populateSettingsFields() {
  document.getElementById('sb-url').value = cfg.sbUrl;
  document.getElementById('sb-key').value = cfg.sbKey;
  document.getElementById('gemini-key').value = cfg.geminiKey;
  updateNotificationStatus();
}

function saveSupabase() {
  cfg.sbUrl = document.getElementById('sb-url').value.trim().replace(/\/$/, '');
  cfg.sbKey = document.getElementById('sb-key').value.trim();
  showToast('✓ Supabase opgeslagen');
  loadCheckinForDate(state.date);
}

function saveGeminiKey() {
  cfg.geminiKey = document.getElementById('gemini-key').value.trim();
  showToast('✓ API key opgeslagen');
}

async function testGroqKey() {
  const statusEl = document.getElementById('groq-status');
  cfg.geminiKey = document.getElementById('gemini-key').value.trim();
  if (!cfg.geminiKey) { showToast('Voer eerst een API key in'); return; }
  statusEl.innerHTML = `<span class="status-dot idle"></span> Testen…`;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${cfg.geminiKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 10, messages: [{ role: 'user', content: 'Zeg: OK' }] }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    statusEl.innerHTML = `<span class="status-dot ok"></span> Verbinding OK`;
  } catch(e) {
    statusEl.innerHTML = `<span class="status-dot err"></span> Fout: ${e.message}`;
  }
}

async function testSupabase() {
  const statusEl = document.getElementById('sb-status');
  statusEl.innerHTML = `<span class="status-dot idle"></span> Testen…`;
  try {
    cfg.sbUrl = document.getElementById('sb-url').value.trim().replace(/\/$/, '');
    cfg.sbKey = document.getElementById('sb-key').value.trim();
    await sbFetch('/habit_entries?limit=1');
    statusEl.innerHTML = `<span class="status-dot ok"></span> Verbinding OK`;
  } catch(e) {
    statusEl.innerHTML = `<span class="status-dot err"></span> Fout: ${e.message}`;
  }
}

// ── Backup / herstel instellingen ─────────────────────────────────────────────
function exportSettings() {
  const data = {
    sb_url: cfg.sbUrl,
    sb_key: cfg.sbKey,
    gemini_key: cfg.geminiKey,
    notifications_enabled: localStorage.getItem('notifications_enabled') || 'false',
  };
  const json = JSON.stringify(data);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const restoreUrl = location.origin + location.pathname + '#R:' + encoded;

  const box = document.getElementById('backup-export-box');
  const out = document.getElementById('backup-output');
  const urlOut = document.getElementById('restore-url-output');
  if (box && out) {
    out.value = restoreUrl;
    box.style.display = '';
  }
  if (urlOut) urlOut.href = restoreUrl;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(restoreUrl).then(() => showToast('✓ Herstel-URL gekopieerd'));
  }
}

function importSettings() {
  let raw = (document.getElementById('backup-input').value || '').trim();
  if (!raw) { showToast('Plak eerst een herstel-URL of backup'); return; }
  try {
    // Accepteer herstel-URL (#R:...) of gewone JSON
    const hashIdx = raw.indexOf('#R:');
    if (hashIdx !== -1) {
      raw = decodeURIComponent(escape(atob(raw.slice(hashIdx + 3))));
    }
    const data = JSON.parse(raw);
    if (data.sb_url !== undefined) cfg.sbUrl = data.sb_url;
    if (data.sb_key !== undefined) cfg.sbKey = data.sb_key;
    if (data.gemini_key !== undefined) cfg.geminiKey = data.gemini_key;
    if (data.notifications_enabled !== undefined) localStorage.setItem('notifications_enabled', data.notifications_enabled);
    document.getElementById('backup-input').value = '';
    populateSettingsFields();
    showToast('✓ Instellingen hersteld');
  } catch(e) {
    showToast('⚠ Ongeldige backup — controleer de tekst');
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────
function scheduleNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('notifications_enabled') !== 'true') return;
  const now = new Date();
  [8, 20].forEach(hour => {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0);
    const ms = target - now;
    if (ms > 0 && ms < 86400000) {
      setTimeout(() => {
        new Notification('Dagboek', {
          body: hour === 8 ? 'Goedemorgen — vergeet je check-in niet.' : 'Goedenavond — vul je dagboek in.',
          icon: '/Journal/icon.png',
        });
      }, ms);
    }
  });
}

async function toggleNotifications() {
  const enabled = localStorage.getItem('notifications_enabled') === 'true';
  if (enabled) {
    localStorage.setItem('notifications_enabled', 'false');
    showToast('Herinneringen uitgeschakeld');
  } else if (!('Notification' in window)) {
    showToast('Notificaties niet ondersteund door browser');
  } else {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      localStorage.setItem('notifications_enabled', 'true');
      scheduleNotifications();
      showToast('✓ Herinneringen ingeschakeld');
    } else {
      showToast('Notificaties geweigerd — check browserinstellingen');
    }
  }
  updateNotificationStatus();
}

function updateNotificationStatus() {
  const el = document.getElementById('notification-status');
  const btn = document.getElementById('notification-toggle-btn');
  if (!el) return;
  if (!('Notification' in window)) {
    el.innerHTML = `<span class="status-dot err"></span> Niet ondersteund`;
    return;
  }
  const enabled = localStorage.getItem('notifications_enabled') === 'true' && Notification.permission === 'granted';
  el.innerHTML = enabled
    ? `<span class="status-dot ok"></span> Ingeschakeld — 8:00 & 20:00`
    : Notification.permission === 'denied'
      ? `<span class="status-dot err"></span> Geblokkeerd — check browserinstellingen`
      : `<span class="status-dot idle"></span> Niet ingeschakeld`;
  if (btn) btn.textContent = enabled ? 'Uitschakelen' : 'Inschakelen';
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function initListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.screen));
  });

  // Habit buttons
  document.querySelectorAll('.habit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      state.entry[key] = !state.entry[key];
      const isGood = !btn.classList.contains('bad');
      btn.classList.toggle('active', !!state.entry[key]);
      if (state.entry[key] && isGood) {
        haptic(18);
        btn.classList.remove('pop');
        void btn.offsetWidth; // force reflow to restart animation
        btn.classList.add('pop');
        btn.addEventListener('animationend', () => btn.classList.remove('pop'), { once: true });
      } else {
        haptic(8);
      }
      scheduleAutoSave();
    });
  });

  // Mood buttons
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mood = state.mood === btn.dataset.mood ? null : btn.dataset.mood;
      document.querySelectorAll('.mood-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mood === state.mood)
      );
      haptic(8);
      scheduleAutoSave();
    });
  });

  // Emotion buttons
  document.querySelectorAll('.emotion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      state.emotions[key] = !state.emotions[key];
      btn.classList.toggle('active', !!state.emotions[key]);
      haptic(8);
      scheduleAutoSave();
    });
  });

  // Sleep
  document.getElementById('sleep-minus').addEventListener('click', () => {
    state.sleep = Math.max(0, +(state.sleep - 0.5).toFixed(1));
    document.getElementById('sleep-value').textContent = state.sleep.toFixed(1);
    updateSleepWarning();
    haptic(5);
    scheduleAutoSave();
  });

  document.getElementById('sleep-plus').addEventListener('click', () => {
    state.sleep = Math.min(24, +(state.sleep + 0.5).toFixed(1));
    document.getElementById('sleep-value').textContent = state.sleep.toFixed(1);
    updateSleepWarning();
    haptic(5);
    scheduleAutoSave();
  });

  // Weight
  document.getElementById('weight-input').addEventListener('input', e => {
    state.weight = e.target.value ? +e.target.value : null;
    updateWeightWarning();
    scheduleAutoSave();
  });

  // Notes
  document.getElementById('notes-input').addEventListener('input', e => {
    state.notes = e.target.value;
    scheduleAutoSave();
  });

  // Save
  document.getElementById('save-btn').addEventListener('click', saveCheckin);

  // Date navigation
  document.getElementById('date-prev').addEventListener('click', () => {
    loadCheckinForDate(offsetDate(state.date, -1));
  });

  document.getElementById('date-next').addEventListener('click', () => {
    if (state.date < todayStr()) {
      loadCheckinForDate(offsetDate(state.date, 1));
    }
  });

  // Period selector
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const customRange = document.getElementById('custom-range');
      if (btn.dataset.period === 'custom') {
        customRange.style.display = 'block';
        if (!document.getElementById('range-from').value) {
          document.getElementById('range-from').value = offsetDate(todayStr(), -6);
          document.getElementById('range-to').value = todayStr();
        }
      } else {
        customRange.style.display = 'none';
        loadInsights();
      }
    });
  });

  // Theme toggle (all screens)
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      localStorage.setItem('theme_override_hour', new Date().getHours());
      applyTheme(!isDark);
    });
  });

  // Keyboard dismiss: tik buiten invoerveld sluit toetsenbord
  document.getElementById('main').addEventListener('touchstart', e => {
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        active.blur();
      }
    }
  }, { passive: true });
}

// ── Theme (dag/nacht op basis van uur, overschrijfbaar) ───────────────────────
function isDayTime() {
  const h = new Date().getHours();
  return h >= 7 && h < 21;
}

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelectorAll('.theme-toggle-btn').forEach(b => { b.textContent = dark ? '●' : '○'; });
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.content = dark ? '#111110' : '#f6f3ee';
  localStorage.setItem('theme_override', dark ? 'dark' : 'light');
}

function initTheme() {
  const override = localStorage.getItem('theme_override');
  // Override geldt alleen als het is ingesteld in het huidige uur-blok
  const savedHour = parseInt(localStorage.getItem('theme_override_hour') || '-1');
  const currentHour = new Date().getHours();
  const sameBlock = (savedHour >= 7 && currentHour >= 7 && savedHour < 21 && currentHour < 21)
                 || (savedHour < 7 && currentHour < 7)
                 || (savedHour >= 21 && currentHour >= 21);

  if (override && sameBlock) {
    applyTheme(override === 'dark');
  } else {
    applyTheme(!isDayTime());
    localStorage.removeItem('theme_override');
  }
}

// ── Service Worker ────────────────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/Journal/sw.js').catch(() => {});
  }
}

// ── Swipe navigatie — kaartenstapel ──────────────────────────────────────────
function initSwipe() {
  const el = document.getElementById('screen-checkin');
  let startX = 0, startY = 0, dragging = false;
  let underEl = null;
  let underDate = null;
  const W = () => window.innerWidth;
  const ease = t => 1 - Math.pow(1 - t, 2);

  function buildUnderCard(targetDate) {
    if (underEl || underDate === targetDate) return;
    underDate = targetDate;

    // Clone el off-screen — never touch the live DOM
    const clone = el.cloneNode(true);
    const isToday = targetDate === todayStr();
    const isYesterday = targetDate === offsetDate(todayStr(), -1);
    const dayNames = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];
    const d = new Date(targetDate + 'T12:00:00');
    const titleEl = clone.querySelector('#checkin-title');
    if (titleEl) titleEl.textContent = isToday ? 'Vandaag' : isYesterday ? 'Gisteren' : dayNames[d.getDay()];
    const dateEl = clone.querySelector('#checkin-date');
    if (dateEl) dateEl.textContent = formatDateNL(targetDate);
    clone.querySelectorAll('.habit-btn').forEach(btn => btn.classList.remove('active'));
    clone.querySelectorAll('.mood-btn').forEach(btn => btn.classList.remove('active'));
    clone.querySelectorAll('.emotion-btn').forEach(btn => btn.classList.remove('active'));
    const sv = clone.querySelector('#sleep-value');
    if (sv) sv.textContent = '8.0';
    const wi = clone.querySelector('#weight-input');
    if (wi) wi.value = '';

    underEl = document.createElement('div');
    underEl.id = 'checkin-bg-card';
    underEl.innerHTML = clone.innerHTML;
    document.body.appendChild(underEl);

    const boolKeys = ['gym','gewerkt','geklust','geschreven','geleest','gemediteerd',
      'tijd_met_anderen','gespeeld','te_veel_weinig_eten','gedoomscrolled',
      'gemasturbeerd','porno_gekeken'];

    // Apply real data to under-card as soon as it's available (cache = likely instant)
    loadEntry(targetDate).then(row => {
      if (!underEl || underDate !== targetDate) return;
      underEl.querySelectorAll('.habit-btn').forEach(btn => {
        btn.classList.toggle('active', !!(row && row[btn.dataset.key]));
      });
      const sl = underEl.querySelector('[id="sleep-value"]');
      if (sl) sl.textContent = (row?.slaap != null ? +row.slaap : 8.0).toFixed(1);
      const wi = underEl.querySelector('[id="weight-input"]');
      if (wi) wi.value = row?.gewicht != null ? row.gewicht : '';
      const mood = row?.mood_emoji || null;
      underEl.querySelectorAll('.mood-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mood === mood);
      });
      underEl.querySelectorAll('.emotion-btn').forEach(btn => {
        btn.classList.toggle('active', !!(row && row[btn.dataset.key]));
      });
    }).catch(() => {});
  }

  function removeUnderCard(animate) {
    if (!underEl) return;
    underDate = null;
    if (animate) {
      underEl.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      underEl.style.transform = 'scale(0.92)';
      underEl.style.opacity = '0';
      const card = underEl;
      underEl = null;
      setTimeout(() => card.remove(), 220);
    } else {
      underEl.remove();
      underEl = null;
    }
  }

  el.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = false;
    el.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        dragging = true;
        const targetDate = offsetDate(state.date, dx < 0 ? 1 : -1);
        const canMove = dx > 0 || state.date < todayStr();
        if (canMove) buildUnderCard(targetDate);
      } else return;
    }

    e.preventDefault();
    const atEdge = dx < 0 && state.date >= todayStr();
    const offset = atEdge ? dx * 0.15 : dx;
    const progress = ease(Math.min(Math.abs(offset) / (W() * 0.55), 1));

    el.style.transform = `translateX(${offset}px)`;
    el.style.boxShadow = `${dx > 0 ? 6 : -6}px 0 24px rgba(0,0,0,${0.12 * progress})`;

    if (underEl) {
      underEl.style.transform = `scale(${0.92 + 0.08 * progress})`;
      underEl.style.opacity = String(Math.min(progress * 1.8, 1));
    }
  }, { passive: false });

  el.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    el.style.boxShadow = '';

    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const isH = Math.abs(dx) > Math.abs(dy) * 1.5;
    const goNext = dx < -50 && isH && state.date < todayStr();
    const goPrev = dx > 50 && isH;

    function slideOut(dir, targetDate) {
      el.style.transition = 'transform 0.2s ease';
      el.style.transform = `translateX(${dir * W()}px)`;
      if (underEl) {
        underEl.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        underEl.style.transform = 'scale(1)';
        underEl.style.opacity = '1';
      }
      setTimeout(async () => {
        // Load data while el is off-screen (underEl covers the view)
        el.style.transition = 'none';
        el.style.transform = `translateX(${-dir * W()}px)`;
        await loadCheckinForDate(targetDate);
        // Snap el to center instantly — no second swipe animation
        el.style.transform = 'translateX(0)';
        removeUnderCard(false);
      }, 200);
    }

    if (goNext) slideOut(-1, offsetDate(state.date, 1));
    else if (goPrev) slideOut(1, offsetDate(state.date, -1));
    else {
      el.style.transition = 'transform 0.2s ease';
      el.style.transform = 'translateX(0)';
      removeUnderCard(true);
    }
  }, { passive: true });
}

// ── Herstel vanuit bladwijzer ─────────────────────────────────────────────────
function restoreFromBookmark() {
  const hash = location.hash;
  if (!hash.startsWith('#R:')) return;
  try {
    const json = decodeURIComponent(escape(atob(hash.slice(3))));
    const data = JSON.parse(json);
    if (data.sb_url !== undefined) cfg.sbUrl = data.sb_url;
    if (data.sb_key !== undefined) cfg.sbKey = data.sb_key;
    if (data.gemini_key !== undefined) cfg.geminiKey = data.gemini_key;
    if (data.notifications_enabled !== undefined) localStorage.setItem('notifications_enabled', data.notifications_enabled);
    history.replaceState(null, '', location.pathname);
    showToast('✓ Instellingen hersteld via bladwijzer', 3500);
  } catch(e) { /* ongeldige hash, negeren */ }
}

// ── Init ──────────────────────────────────────────────────────────────────────
restoreFromBookmark();
initTheme();
initListeners();
initSwipe();
registerSW();
scheduleNotifications();
loadCheckinForDate(todayStr());
