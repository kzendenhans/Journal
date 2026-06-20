'use strict';

// ── Config (stored in localStorage) ──────────────────────────────────────────
const cfg = {
  get sbUrl()  { return localStorage.getItem('sb_url') || ''; },
  get sbKey()  { return localStorage.getItem('sb_key') || ''; },
  get asanaPat(){ return localStorage.getItem('asana_pat') || ''; },
  set sbUrl(v)  { localStorage.setItem('sb_url', v); },
  set sbKey(v)  { localStorage.setItem('sb_key', v); },
  set asanaPat(v){ localStorage.setItem('asana_pat', v); },
};

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  date: todayStr(),          // YYYY-MM-DD
  entry: {},                 // current habit entry values
  sleep: 8.0,
  weight: null,
  mood: null,
  emotions: {},
  notes: '',
  dirtyCheckin: false,
  tasks: [],
  projects: [],
  asanaWorkspace: null,
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

async function loadEntry(dateStr) {
  const rows = await sbFetch(`/habit_entries?date=eq.${dateStr}&limit=1`);
  return rows && rows.length ? rows[0] : null;
}

async function upsertEntry(data) {
  return sbFetch('/habit_entries?on_conflict=date', {
    method: 'POST',
    prefer: 'return=representation,resolution=merge-duplicates',
    body: JSON.stringify(data),
  });
}

// ── Asana helpers ─────────────────────────────────────────────────────────────
async function asanaFetch(path, opts={}) {
  if (!cfg.asanaPat) throw new Error('Asana PAT niet geconfigureerd');
  const base = 'https://app.asana.com/api/1.0';
  const headers = {
    'Authorization': `Bearer ${cfg.asanaPat}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asana ${res.status}: ${err}`);
  }
  const json = await res.json();
  return json.data;
}

async function getAsanaWorkspace() {
  if (state.asanaWorkspace) return state.asanaWorkspace;
  const workspaces = await asanaFetch('/workspaces');
  state.asanaWorkspace = workspaces[0].gid;
  return state.asanaWorkspace;
}

async function loadAsanaTasks() {
  const ws = await getAsanaWorkspace();
  // Get user's GID first
  const me = await asanaFetch('/users/me');
  const tasks = await asanaFetch(
    `/tasks?workspace=${ws}&assignee=${me.gid}&completed_since=now&opt_fields=gid,name,due_on,notes,projects,projects.name,projects.color&limit=100`
  );
  // Also fetch projects for the add-task modal
  const projects = await asanaFetch(
    `/projects?workspace=${ws}&archived=false&opt_fields=gid,name,color&limit=50`
  );
  return { tasks, projects };
}

async function completeAsanaTask(gid) {
  return asanaFetch(`/tasks/${gid}`, {
    method: 'PUT',
    body: JSON.stringify({ data: { completed: true } }),
  });
}

async function updateAsanaTask(gid, data) {
  return asanaFetch(`/tasks/${gid}`, {
    method: 'PUT',
    body: JSON.stringify({ data }),
  });
}

async function createAsanaTask(name, projectGid, dueOn) {
  const ws = await getAsanaWorkspace();
  const data = { name, workspace: ws };
  if (projectGid) data.projects = [projectGid];
  if (dueOn) data.due_on = dueOn;
  return asanaFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`screen-${screenId}`).classList.add('active');
  document.querySelector(`.nav-item[data-screen="${screenId}"]`).classList.add('active');

  if (screenId === 'tasks') loadTasks();
  if (screenId === 'insights') loadInsights();
  if (screenId === 'settings') populateSettingsFields();

  // Scroll to top
  document.getElementById('main').scrollTop = 0;
}

// ── Check-in Screen ───────────────────────────────────────────────────────────
function renderCheckin() {
  const isToday = state.date === todayStr();
  const isYesterday = state.date === offsetDate(todayStr(), -1);
  const dayNames = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];
  const titleDate = new Date(state.date + 'T12:00:00');
  document.getElementById('checkin-title').textContent = isToday ? 'Vandaag' : isYesterday ? 'Gisteren' : dayNames[titleDate.getDay()];
  document.getElementById('checkin-date').textContent = formatDateNL(state.date);

  // Date nav: disable next if today
  document.getElementById('date-next').disabled = isToday;

  // Habit buttons
  document.querySelectorAll('.habit-btn').forEach(btn => {
    const key = btn.dataset.key;
    const on = !!state.entry[key];
    btn.classList.toggle('active', on);
  });

  // Sleep
  document.getElementById('sleep-value').textContent = state.sleep.toFixed(1);

  // Weight
  const wi = document.getElementById('weight-input');
  wi.value = state.weight !== null ? state.weight : '';

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
  state.date = dateStr;
  state.entry = {};
  state.sleep = 8.0;
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
    const row = await loadEntry(dateStr);
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
}

async function saveCheckin() {
  if (!cfg.sbUrl || !cfg.sbKey) {
    showToast('Configureer eerst Supabase');
    navigate('settings');
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Opslaan…';

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
    showToast('✓ Opgeslagen');
  } catch (e) {
    showToast('⚠ Opslaan mislukt');
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = 'Opslaan';
}

// ── Tasks Screen ──────────────────────────────────────────────────────────────
const PROJECT_COLORS = {
  dark_pink: '#e8698a', light_pink: '#f8a5c2', red: '#e8394d',
  bright_red: '#fc4d4d', dark_orange: '#e07a5f', dark_brown: '#b45309',
  light_orange: '#fbbf24', dark_yellow: '#d97706', light_yellow: '#f9e154',
  dark_green: '#10b981', light_green: '#6ee7b7', teal: '#14b8a6',
  dark_teal: '#0f766e', light_blue: '#60a5fa', dark_blue: '#3b82f6',
  light_purple: '#a78bfa', dark_purple: '#7c3aed',
};

function taskProjectColor(task) {
  if (!task.projects || !task.projects.length) return '#64748b';
  const color = task.projects[0].color;
  return PROJECT_COLORS[color] || '#64748b';
}

function dueLabelHtml(dueOn) {
  if (!dueOn) return '';
  const today = todayStr();
  if (dueOn < today) return `<span class="task-meta task-due-overdue">Verlopen: ${dueOn}</span>`;
  if (dueOn === today) return `<span class="task-meta task-due-today">Vandaag</span>`;
  return `<span class="task-meta">${dueOn}</span>`;
}

async function loadTasks() {
  const container = document.getElementById('tasks-content');
  if (!cfg.asanaPat) {
    container.innerHTML = `<div class="empty">Configureer je Asana PAT in <a href="#" onclick="navigate('settings')" style="color:var(--primary)">Instellingen</a>.</div>`;
    return;
  }

  container.innerHTML = `<div class="loading"><div class="spinner"></div>Laden…</div>`;

  try {
    const { tasks, projects } = await loadAsanaTasks();
    state.tasks = tasks;
    state.projects = projects;
    renderTasks();
    populateProjectSelect();
  } catch (e) {
    container.innerHTML = `<div class="empty">⚠ Kan taken niet laden.<br><small>${e.message}</small></div>`;
  }
}

function renderTasks() {
  const container = document.getElementById('tasks-content');
  if (!state.tasks.length) {
    container.innerHTML = `<div class="empty">Geen openstaande taken</div>`;
    return;
  }

  // Sort by deadline: overdue/today first, then upcoming, no date last
  const sorted = [...state.tasks].sort((a, b) => {
    if (!a.due_on && !b.due_on) return 0;
    if (!a.due_on) return 1;
    if (!b.due_on) return -1;
    return a.due_on < b.due_on ? -1 : 1;
  });

  let html = '';
  sorted.forEach(task => {
    const projectName = task.projects && task.projects.length ? task.projects[0].name : '';
    const projectColor = taskProjectColor(task);
    const projectHtml = projectName
      ? `<span style="display:inline-flex;align-items:center;gap:4px;color:var(--text-muted)"><span style="width:5px;height:5px;border-radius:50%;background:${projectColor};display:inline-block;flex-shrink:0"></span>${projectName}</span>`
      : '';
    const due = dueLabelHtml(task.due_on);
    const meta = [projectHtml, due].filter(Boolean).join('<span style="color:var(--border)"> · </span>');

    html += `
      <div class="task-item" data-gid="${task.gid}">
        <div class="task-check" onclick="completeTask('${task.gid}', this.closest('.task-item'))"></div>
        <div class="task-body" onclick="openTaskDetail('${task.gid}')">
          <div class="task-name">${task.name}</div>
          ${meta ? `<div class="task-meta" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:3px">${meta}</div>` : ''}
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

let _pending = null;

async function _commitTask(gid, el, checkEl) {
  try {
    await completeAsanaTask(gid);
    el.remove();
    state.tasks = state.tasks.filter(t => t.gid !== gid);
    if (!document.querySelectorAll('.task-item').length) {
      document.getElementById('tasks-content').innerHTML = `<div class="empty">Geen openstaande taken</div>`;
    }
  } catch(e) {
    el.classList.remove('completing');
    checkEl.textContent = '';
    checkEl.style.cssText = '';
    showToast('⚠ Kan taak niet afvinken');
  }
}

function _clearPending(commit) {
  if (!_pending) return;
  clearTimeout(_pending.timerId);
  clearInterval(_pending.countdownId);
  document.getElementById('undo-bar').classList.remove('show');
  const { gid, el, checkEl } = _pending;
  _pending = null;
  if (commit) {
    _commitTask(gid, el, checkEl);
  } else {
    el.classList.remove('completing');
    checkEl.textContent = '';
    checkEl.style.cssText = '';
  }
}

function completeTask(gid, el) {
  if (el.classList.contains('completing')) return;
  if (_pending) _clearPending(true);

  el.classList.add('completing');
  const checkEl = el.querySelector('.task-check');
  checkEl.textContent = '✓';
  checkEl.style.cssText = 'border-color:var(--success);background:rgba(74,124,89,0.12);color:var(--success)';

  let secs = 5;
  const labelEl = document.getElementById('undo-label');
  labelEl.textContent = `Afgevinkt (${secs}s)`;
  document.getElementById('undo-bar').classList.add('show');

  const countdownId = setInterval(() => {
    secs--;
    if (secs > 0) labelEl.textContent = `Afgevinkt (${secs}s)`;
  }, 1000);

  const timerId = setTimeout(() => _clearPending(true), 5000);
  _pending = { gid, el, checkEl, timerId, countdownId };
}

function undoCompleteTask() {
  _clearPending(false);
}

function populateProjectSelect() {
  const sel = document.getElementById('new-task-project');
  sel.innerHTML = `<option value="">Project (optioneel)</option>`;
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.gid;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

function openModal() {
  document.getElementById('new-task-name').value = '';
  document.getElementById('new-task-due').value = '';
  document.getElementById('task-modal').classList.add('open');
  setTimeout(() => document.getElementById('new-task-name').focus(), 300);
}

function closeModal() {
  document.getElementById('task-modal').classList.remove('open');
}

async function createTask() {
  const name = document.getElementById('new-task-name').value.trim();
  if (!name) { showToast('Voer een taaknaam in'); return; }
  const projectGid = document.getElementById('new-task-project').value;
  const dueOn = document.getElementById('new-task-due').value;

  closeModal();
  try {
    const task = await createAsanaTask(name, projectGid, dueOn);
    showToast('✓ Taak aangemaakt');
    // Reload tasks to show new task
    await loadTasks();
  } catch (e) {
    showToast('⚠ Aanmaken mislukt');
    console.error(e);
  }
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

function lineChartHtml(vals, dates, color, target = null) {
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

  // Target zone: light red rect below target line + dashed line
  let targetHtml = '';
  if (target !== null) {
    const ty = +toY(target).toFixed(1);
    const zoneH = (T + cH) - ty;
    targetHtml =
      `<rect x="${L}" y="${ty}" width="${cW}" height="${zoneH}" fill="var(--danger)" fill-opacity="0.10"/>`
    + `<line x1="${L}" y1="${ty}" x2="${W - R}" y2="${ty}" stroke="var(--danger)" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="4,3"/>`;
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

  const essentials = ['gym','gewerkt','geklust','geschreven'];
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

  const WEEKLY_RATES = { gym: 3/7, gewerkt: 5/7, geklust: 1, geschreven: 1 };
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

  const bonusBars = bonuses.map(k => barHtml(k, '')).join('');
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
  const moodEmojis = ['😄','🙂','😐','🙁','😩'];
  const moodCounts = {};
  moodEmojis.forEach(e => { moodCounts[e] = 0; });
  dataRows.forEach(r => { if (r.mood_emoji && moodCounts[r.mood_emoji] !== undefined) moodCounts[r.mood_emoji]++; });
  const maxMood = Math.max(...Object.values(moodCounts), 1);
  const moodHtml = moodEmojis.map(e => `
    <div class="mood-dist-col">
      <div class="mood-dist-bar-wrap">
        <div class="mood-dist-bar" style="height:${Math.round(moodCounts[e] / maxMood * 48)}px"></div>
      </div>
      <div class="mood-dist-emoji">${e}</div>
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
      ${lineChartHtml(weightVals, weightDates, 'var(--success)')}
    </div>
  `;
}

// ── Task Detail ───────────────────────────────────────────────────────────────
async function openTaskDetail(gid) {
  const task = state.tasks.find(t => t.gid === gid);
  if (!task) return;

  const projectName = task.projects && task.projects.length ? task.projects[0].name : '—';
  const projectColor = taskProjectColor(task);

  document.getElementById('detail-name').value = task.name;
  document.getElementById('detail-due').value = task.due_on || '';
  document.getElementById('detail-notes').value = task.notes || '';
  document.getElementById('detail-project').innerHTML =
    `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:50%;background:${projectColor};display:inline-block"></span>${projectName}</span>`;

  // Reset delete button state
  const delBtn = document.querySelector('#task-detail-modal .btn-danger');
  if (delBtn) { delBtn.textContent = 'Verwijder'; delete delBtn.dataset.confirm; }

  const modal = document.getElementById('task-detail-modal');
  modal.dataset.gid = gid;
  modal.classList.add('open');

  // Load subtasks
  const subtasksEl = document.getElementById('detail-subtasks');
  subtasksEl.innerHTML = `<div class="subtask-item" style="color:var(--text-muted)">Laden…</div>`;
  try {
    const subs = await asanaFetch(`/tasks/${gid}/subtasks?opt_fields=gid,name,completed&limit=50`);
    if (!subs || !subs.length) {
      subtasksEl.innerHTML = `<div class="subtask-item" style="color:var(--text-muted)">Geen subtaken</div>`;
    } else {
      subtasksEl.innerHTML = subs.map(s => `
        <div class="subtask-item">
          <div class="subtask-dot ${s.completed ? 'done' : ''}"></div>
          <span style="${s.completed ? 'text-decoration:line-through;opacity:0.45' : ''}">${s.name}</span>
        </div>`).join('');
    }
  } catch(e) {
    subtasksEl.innerHTML = `<div class="subtask-item" style="color:var(--text-muted)">Kan subtaken niet laden</div>`;
  }
}

function deleteTask() {
  const delBtn = document.querySelector('#task-detail-modal .btn-danger');
  if (delBtn.dataset.confirm !== 'true') {
    delBtn.textContent = 'Zeker?';
    delBtn.dataset.confirm = 'true';
    setTimeout(() => {
      if (delBtn.dataset.confirm === 'true') {
        delBtn.textContent = 'Verwijder';
        delete delBtn.dataset.confirm;
      }
    }, 3000);
    return;
  }
  const gid = document.getElementById('task-detail-modal').dataset.gid;
  asanaFetch(`/tasks/${gid}`, { method: 'DELETE' })
    .then(() => {
      state.tasks = state.tasks.filter(t => t.gid !== gid);
      renderTasks();
      closeTaskDetail();
      showToast('Taak verwijderd');
    })
    .catch(() => showToast('⚠ Verwijderen mislukt'));
}

function closeTaskDetail() {
  document.getElementById('task-detail-modal').classList.remove('open');
}

async function saveTaskDetail() {
  const modal = document.getElementById('task-detail-modal');
  const gid = modal.dataset.gid;
  const name  = document.getElementById('detail-name').value.trim();
  const due   = document.getElementById('detail-due').value || null;
  const notes = document.getElementById('detail-notes').value;

  if (!name) { showToast('Naam is verplicht'); return; }

  try {
    await updateAsanaTask(gid, { name, due_on: due, notes });
    const task = state.tasks.find(t => t.gid === gid);
    if (task) { task.name = name; task.due_on = due; task.notes = notes; }
    renderTasks();
    closeTaskDetail();
    showToast('✓ Taak bijgewerkt');
  } catch(e) {
    showToast('⚠ Opslaan mislukt');
  }
}

// ── Settings Screen ───────────────────────────────────────────────────────────
function populateSettingsFields() {
  document.getElementById('sb-url').value = cfg.sbUrl;
  document.getElementById('sb-key').value = cfg.sbKey;
  document.getElementById('asana-pat').value = cfg.asanaPat;
}

function saveSupabase() {
  cfg.sbUrl = document.getElementById('sb-url').value.trim().replace(/\/$/, '');
  cfg.sbKey = document.getElementById('sb-key').value.trim();
  showToast('✓ Supabase opgeslagen');
  loadCheckinForDate(state.date);
}

function saveAsana() {
  cfg.asanaPat = document.getElementById('asana-pat').value.trim();
  showToast('✓ Asana PAT opgeslagen');
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

async function testAsana() {
  const statusEl = document.getElementById('asana-status');
  statusEl.innerHTML = `<span class="status-dot idle"></span> Testen…`;
  try {
    cfg.asanaPat = document.getElementById('asana-pat').value.trim();
    const me = await asanaFetch('/users/me');
    statusEl.innerHTML = `<span class="status-dot ok"></span> Ingelogd als ${me.name}`;
  } catch(e) {
    statusEl.innerHTML = `<span class="status-dot err"></span> Fout: ${e.message}`;
  }
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
      btn.classList.toggle('active', !!state.entry[key]);
    });
  });

  // Mood buttons
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mood = state.mood === btn.dataset.mood ? null : btn.dataset.mood;
      document.querySelectorAll('.mood-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mood === state.mood)
      );
    });
  });

  // Emotion buttons
  document.querySelectorAll('.emotion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      state.emotions[key] = !state.emotions[key];
      btn.classList.toggle('active', !!state.emotions[key]);
    });
  });

  // Sleep
  document.getElementById('sleep-minus').addEventListener('click', () => {
    state.sleep = Math.max(0, +(state.sleep - 0.5).toFixed(1));
    document.getElementById('sleep-value').textContent = state.sleep.toFixed(1);
  });

  document.getElementById('sleep-plus').addEventListener('click', () => {
    state.sleep = Math.min(24, +(state.sleep + 0.5).toFixed(1));
    document.getElementById('sleep-value').textContent = state.sleep.toFixed(1);
  });

  // Weight
  document.getElementById('weight-input').addEventListener('input', e => {
    state.weight = e.target.value ? +e.target.value : null;
  });

  // Notes
  document.getElementById('notes-input').addEventListener('input', e => {
    state.notes = e.target.value;
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

  // Add task button
  document.getElementById('add-task-btn').addEventListener('click', openModal);

  // Close modals on overlay click
  document.getElementById('task-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('task-modal')) closeModal();
  });
  document.getElementById('task-detail-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('task-detail-modal')) closeTaskDetail();
  });
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

// ── Init ──────────────────────────────────────────────────────────────────────
initTheme();
initListeners();
registerSW();
loadCheckinForDate(todayStr());
