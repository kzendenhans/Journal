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
  sleep: 7.5,
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
    `/tasks?workspace=${ws}&assignee=${me.gid}&completed_since=now&opt_fields=gid,name,due_on,projects,projects.name,projects.color&limit=100`
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
  state.sleep = 7.5;
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
      state.sleep = row.slaap !== null ? +row.slaap : 7.5;
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
    container.innerHTML = `<div class="empty">Geen openstaande taken 🎉</div>`;
    return;
  }

  // Group by project
  const groups = new Map();
  groups.set('__none__', { name: 'Geen project', color: '#64748b', tasks: [] });

  state.tasks.forEach(task => {
    if (task.projects && task.projects.length) {
      const p = task.projects[0];
      if (!groups.has(p.gid)) {
        groups.set(p.gid, { name: p.name, color: PROJECT_COLORS[p.color] || '#64748b', tasks: [] });
      }
      groups.get(p.gid).tasks.push(task);
    } else {
      groups.get('__none__').tasks.push(task);
    }
  });

  let html = '';
  groups.forEach((group, gid) => {
    if (!group.tasks.length) return;
    html += `
      <div class="project-group">
        <div class="project-header">
          <div class="project-dot" style="background:${group.color}"></div>
          <div class="project-name">${group.name}</div>
        </div>
    `;
    group.tasks.forEach(task => {
      const projectStr = task.projects && task.projects.length ? task.projects[0].name : '';
      html += `
        <div class="task-item" data-gid="${task.gid}" onclick="completeTask('${task.gid}', this)">
          <div class="task-check"></div>
          <div class="task-body">
            <div class="task-name">${task.name}</div>
            ${dueLabelHtml(task.due_on)}
          </div>
        </div>
      `;
    });
    html += `</div>`;
  });

  container.innerHTML = html;
}

async function completeTask(gid, el) {
  el.classList.add('completing');
  const checkEl = el.querySelector('.task-check');
  checkEl.textContent = '✓';
  checkEl.style.borderColor = 'var(--success)';
  checkEl.style.background = 'var(--success-glow)';
  checkEl.style.color = 'var(--success)';

  try {
    await completeAsanaTask(gid);
    setTimeout(() => {
      el.remove();
      state.tasks = state.tasks.filter(t => t.gid !== gid);
      if (!document.querySelectorAll('.task-item').length) {
        document.getElementById('tasks-content').innerHTML = `<div class="empty">Geen openstaande taken 🎉</div>`;
      }
      // Remove empty project groups
      document.querySelectorAll('.project-group').forEach(g => {
        if (!g.querySelectorAll('.task-item').length) g.remove();
      });
    }, 400);
    showToast('✓ Taak afgevinkt');
  } catch (e) {
    el.classList.remove('completing');
    checkEl.textContent = '';
    checkEl.style = '';
    showToast('⚠ Kan taak niet afvinken');
  }
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
  const period = activePeriod ? activePeriod.dataset.period : '7';
  let from, to;
  to = todayStr();

  if (period === 'custom') {
    from = document.getElementById('range-from').value || offsetDate(todayStr(), -6);
    to   = document.getElementById('range-to').value   || todayStr();
  } else {
    from = offsetDate(todayStr(), -(+period - 1));
  }

  try {
    const [periodRows, allRows] = await Promise.all([
      sbFetch(`/habit_entries?date=gte.${from}&date=lte.${to}&order=date.desc&limit=500`),
      sbFetch(`/habit_entries?order=date.desc&limit=500`),
    ]);
    renderInsights(periodRows || [], allRows || [], from, to, period);
  } catch(e) {
    container.innerHTML = `<div class="empty">⚠ Kan data niet laden.</div>`;
  }
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

  // ── Streaks (berekend vanuit alle data, niet beperkt tot periode) ──
  const streaks = {};
  ['gewerkt','geklust','geschreven'].forEach(k => {
    let s = 0;
    for (const r of streakRows) { if (r[k]) s++; else break; }
    streaks[k] = s;
  });

  // Gym: wekelijkse frequentie in plaats van reeks
  const mondayOfWeek = () => {
    const d = new Date();
    const day = d.getDay(); // 0=zo, 1=ma
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const weekStart = mondayOfWeek();
  const gymThisWeek = streakRows.filter(r => r.date >= weekStart && r.gym).length;

  const totalWeeks = Math.max(1, (allRows.length / 7));
  const gymTotal = allRows.filter(r => r.gym).length;
  const gymAvgPerWeek = (gymTotal / totalWeeks).toFixed(1);

  const gymColor = gymThisWeek >= 5 ? 'var(--success)' : gymThisWeek >= 3 ? 'var(--accent)' : 'var(--danger)';

  const streakHtml = `
    <div class="streak-item" style="grid-column:span 2">
      <div class="streak-name">Gym — deze week</div>
      <div style="display:flex;align-items:baseline;gap:6px">
        <div class="streak-count" style="color:${gymColor}">${gymThisWeek}</div>
        <div class="streak-label">/ 5 dagen &nbsp;·&nbsp; gem. ${gymAvgPerWeek}/week</div>
      </div>
    </div>
  ` + ['gewerkt','geklust','geschreven'].map(k => `
    <div class="streak-item">
      <div class="streak-name">${labels[k]}</div>
      <div class="streak-count">${streaks[k]}</div>
      <div class="streak-label">op rij</div>
    </div>
  `).join('');

  // ── Completion rates ──
  function barHtml(k, cls) {
    const count = dataRows.filter(r => r[k]).length;
    const pct = n ? Math.round(count / n * 100) : 0;
    return `
      <div class="habit-bar-row">
        <div class="habit-bar-label">${labels[k]}</div>
        <div class="habit-bar-track"><div class="habit-bar-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="habit-bar-pct">${pct}%</div>
      </div>`;
  }

  const essentialBars = essentials.map(k => barHtml(k, 'essential')).join('');
  const bonusBars     = bonuses.map(k    => barHtml(k, '')).join('');
  const badBars       = bad.map(k        => barHtml(k, 'bad')).join('');

  // ── Gemiddelden ──
  const sleepVals  = dataRows.filter(r => r.slaap).map(r => +r.slaap);
  const weightVals = dataRows.filter(r => r.gewicht).map(r => +r.gewicht);
  const avg = arr => arr.length ? (arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(1) : '–';
  const avgSleep  = avg(sleepVals);
  const avgWeight = avg(weightVals);
  const minWeight = weightVals.length ? Math.min(...weightVals).toFixed(1) : '–';
  const maxWeight = weightVals.length ? Math.max(...weightVals).toFixed(1) : '–';

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

  const periodLabel = period === 'custom' ? `${from} – ${to}` :
    period === '7' ? 'afgelopen 7 dagen' :
    period === '30' ? 'afgelopen maand' :
    period === '90' ? 'afgelopen 3 maanden' : 'afgelopen 6 maanden';

  document.getElementById('insights-content').innerHTML = `
    <div class="insight-card">
      <h3>Reeks — essentials (huidig)</h3>
      <div class="streak-grid">${streakHtml}</div>
    </div>

    <div class="insight-card">
      <h3>Essentials — ${periodLabel}</h3>
      ${essentialBars}
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
          <div class="stat-label">Slaap</div>
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
  `;
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
          document.getElementById('range-from').value = offsetDate(todayStr(), -29);
          document.getElementById('range-to').value = todayStr();
        }
      } else {
        customRange.style.display = 'none';
        loadInsights();
      }
    });
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    localStorage.setItem('theme_override_hour', new Date().getHours());
    applyTheme(!isDark);
  });

  // Add task button
  document.getElementById('add-task-btn').addEventListener('click', openModal);

  // Close modal on overlay click
  document.getElementById('task-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('task-modal')) closeModal();
  });
}

// ── Theme (dag/nacht op basis van uur, overschrijfbaar) ───────────────────────
function isDayTime() {
  const h = new Date().getHours();
  return h >= 7 && h < 21;
}

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('theme-toggle').textContent = dark ? '☽' : '☀';
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
