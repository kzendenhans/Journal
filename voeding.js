// Voeding — plan staat klaar, jij vinkt af. Opslag: Supabase (food_days, food_settings),
// met een lokale kopie zodat het scherm meteen laadt en ook zonder verbinding werkt.
'use strict';

const Voeding = (() => {
  const { SLOTS, TRAINING_DEFAULT, TRAINING_TYPES, CAT, PRICES, BASE_VARIANTS, EXTRAS, LOGBOEK, AH, CONV, CONV_SPECIFIC } = VOEDING_DATA;
  const MIRROR = 'voeding_mirror_v1';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r0 = n => Math.round(n);
  const r1 = n => Math.round(n * 10) / 10;
  const euro = n => '€' + n.toFixed(2).replace('.', ',');
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ── datums ── */
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => offsetDate(s, n);
  const today = () => todayStr();
  const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const longDate = s => { const d = parse(s); return `${DAGEN[d.getDay()]} ${d.getDate()} ${MAANDEN[d.getMonth()]}`; };
  const shortDate = s => { const d = parse(s); return `${DAGEN[d.getDay()].slice(0, 2)} ${d.getDate()}/${d.getMonth() + 1}`; };
  const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  /* ── toestand ── */
  function defaultSettings() {
    return {
      eiwit: 150, vz: 20, kcal: 2600,
      times: Object.fromEntries(SLOTS.map(s => [s.key, s.time])),
      train: clone(TRAINING_DEFAULT),
      custom: [], disabled: {}, shop: {},
    };
  }
  function mergeSettings(saved) {
    const d = defaultSettings(), s = saved || {};
    const m = Object.assign(d, s);
    m.times = Object.assign(defaultSettings().times, s.times || {});
    if (m.times.avondmaal === '19:00') m.times.avondmaal = '18:00';   // avondmaal valt tussen 18 en 19u
    m.train = Object.assign(clone(TRAINING_DEFAULT), s.train || {});
    m.train.days = Object.assign({}, TRAINING_DEFAULT.days, (s.train || {}).days || {});
    if (!(s.train && s.train.cardio)) m.train.cardio = clone(TRAINING_DEFAULT.cardio);
    m.custom = s.custom || []; m.disabled = s.disabled || {}; m.shop = s.shop || {};
    return m;
  }
  const V = {
    settings: defaultSettings(), days: {}, dirty: { days: {}, settings: false },
    tab: 'dag', cur: null, db: 'onbekend', weights: [],
  };
  (function loadMirror() {
    try {
      const m = JSON.parse(localStorage.getItem(MIRROR) || 'null');
      if (m) { V.settings = mergeSettings(m.settings); V.days = m.days || {}; V.dirty = m.dirty || V.dirty; }
    } catch { /* lege start */ }
  })();
  function saveMirror() {
    try { localStorage.setItem(MIRROR, JSON.stringify({ settings: V.settings, days: V.days, dirty: V.dirty })); } catch { /* opslag vol */ }
  }
  const emptyDay = () => ({ entries: {}, extras: [], plan: {}, flags: {} });
  const day = date => V.days[date] || emptyDay();
  const ensureDay = date => (V.days[date] = V.days[date] || emptyDay());
  function touchDay(date) { V.dirty.days[date] = true; saveMirror(); sync(); }
  function touchSettings() { V.dirty.settings = true; saveMirror(); sync(); }

  /* ── Supabase ── */
  const hasDb = () => !!(cfg.sbUrl && cfg.sbKey);
  function dbError(err) {
    const msg = String(err && err.message || err);
    V.db = /food_|42P01|PGRST20[0-9]|does not exist|schema cache/i.test(msg) ? 'ontbreekt' : 'offline';
  }
  let syncing = false;
  async function sync() {
    if (!hasDb()) { V.db = 'lokaal'; renderBanner(); return; }
    if (syncing) return; syncing = true;
    try {
      for (const date of Object.keys(V.dirty.days)) {
        const d = day(date);
        await sbFetch('/food_days?on_conflict=date', {
          method: 'POST', prefer: 'return=representation,resolution=merge-duplicates',
          body: JSON.stringify({ date, entries: d.entries, extras: d.extras, plan: d.plan, flags: d.flags, updated_at: new Date().toISOString() }),
        });
        delete V.dirty.days[date];
      }
      if (V.dirty.settings) {
        await sbFetch('/food_settings?on_conflict=id', {
          method: 'POST', prefer: 'return=representation,resolution=merge-duplicates',
          body: JSON.stringify({ id: 1, data: V.settings, updated_at: new Date().toISOString() }),
        });
        V.dirty.settings = false;
      }
      V.db = 'ok';
    } catch (e) { dbError(e); }
    syncing = false; saveMirror(); renderBanner();
  }
  async function refresh() {
    if (!hasDb()) { V.db = 'lokaal'; render(); return; }
    const from = addDays(today(), -14), to = addDays(today(), 7);
    try {
      const [rows, srows, wrows] = await Promise.all([
        sbFetch(`/food_days?date=gte.${from}&date=lte.${to}`),
        sbFetch('/food_settings?id=eq.1&limit=1'),
        sbFetch(`/habit_entries?date=gte.${addDays(today(), -13)}&date=lte.${today()}&gewicht=not.is.null&select=date,gewicht`).catch(() => []),
      ]);
      (rows || []).forEach(r => { if (!V.dirty.days[r.date]) V.days[r.date] = { entries: r.entries || {}, extras: r.extras || [], plan: r.plan || {}, flags: r.flags || {} }; });
      if (srows && srows[0] && !V.dirty.settings) V.settings = mergeSettings(srows[0].data);
      V.weights = (wrows || []).map(r => ({ date: r.date, kg: +r.gewicht })).filter(r => !isNaN(r.kg));
      V.db = 'ok'; saveMirror();
      await sync();
    } catch (e) { dbError(e); }
    render();
  }
  async function fetchDay(date) {
    if (!hasDb() || V.days[date] || V.dirty.days[date]) return;
    try {
      const rows = await sbFetch(`/food_days?date=eq.${date}&limit=1`);
      if (rows && rows[0]) { V.days[date] = { entries: rows[0].entries || {}, extras: rows[0].extras || [], plan: rows[0].plan || {}, flags: rows[0].flags || {} }; saveMirror(); renderDag(); }
    } catch { /* toon wat er lokaal is */ }
  }

  /* ── training ── */
  const flagsOf = date => day(date).flags || {};
  const scheduled = date => V.settings.train.days[parse(date).getDay()] || '';
  const training = date => { const f = flagsOf(date); return f.skip ? '' : (f.alt || scheduled(date)); };
  const isTrain = date => !!training(date) && training(date) !== 'Cardio';
  const slotLabel = (s, date) => (s.trainLabel && isTrain(date) ? s.trainLabel : s.label);
  // cardio: vast schema per weekdag, per dag aan of uit te zetten (flags.cardio = true/false)
  const cardioPlan = date => (V.settings.train.cardio || {})[parse(date).getDay()] || null;
  const hasCardio = date => { const f = flagsOf(date).cardio; return f === undefined ? !!cardioPlan(date) : !!f; };
  const kcalTarget = date => V.settings.kcal + (hasCardio(date) ? 100 : 0);
  // maaltijdtijd per dag: avondmaal minstens 1u vóór avondcardio
  function slotTime(s, date) {
    const t = V.settings.times[s.key], c = hasCardio(date) && cardioPlan(date);
    if (s.key === 'avondmaal' && c && toMin(t) > toMin(c.start) - 60 && toMin(t) < toMin(c.end)) {
      const m = toMin(c.start) - 60; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    }
    if (s.key === 'avond' && c && toMin(c.end) > toMin(t) - 30) {
      const m = toMin(c.end) + 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    }
    return t;
  }

  /* ── varianten ── */
  const allVariants = () => [...BASE_VARIANTS, ...V.settings.custom];
  const byId = id => allVariants().find(v => v.id === id);
  function variantsFor(slot, date) {
    const type = isTrain(date) ? 'train' : 'rest';
    const all = allVariants().filter(v => v.slot === slot && (!v.when || v.when === type));
    const on = all.filter(v => !V.settings.disabled[v.id]);
    return on.length ? on : all;
  }
  function planned(date, slot) {
    const list = variantsFor(slot, date), id = day(date).plan[slot];
    const pick = list.find(v => v.id === id);
    if (pick) return pick;
    const def = SLOTS.find(s => s.key === slot);
    // standaard = aanbeveling voor het soort dag; het avondmaal rouleert per weekdag (variatie), behalve vóór avondcardio
    if (!(def && def.rot) || dayKind(slot, date) === 'cardio') {
      const r = recommended(slot, date), v = r && list.find(x => x.id === r.id);
      if (v) return v;
    }
    if (def && def.rot) return rotPick(slot, date);   // ma = 1e variant … zo = 7e
    return list[0];
  }
  const entry = (date, slot) => day(date).entries[slot];
  const kcal = m => r0(4 * (m.kh + m.eiwit) + 9 * m.vet);
  const lateRise = v => v.vet >= 20 || (v.vet + v.eiwit) >= 60;
  // hoeveelheid uit het menu omrekenen naar de eenheid van de AH-verpakking
  function toAh(name, q, u) {
    const ah = AH[name]; if (!ah) return null;
    if (u === ah.u) return q;
    const spec = CONV_SPECIFIC[name] && CONV_SPECIFIC[name][u];
    if (spec) return q * spec;
    const c = CONV[u] && CONV[u][ah.u];
    return c ? q * c : null;
  }
  function price(v) {
    let sum = 0, unknown = 0;
    (v.ing || []).forEach(([q, u, n]) => {
      const aq = toAh(n, q, u);
      if (aq != null) { sum += aq / AH[n].q * AH[n].price; return; }
      const p = PRICES[n] && PRICES[n][u];
      if (p == null) unknown++; else sum += p * q;
    });
    return { sum, unknown };
  }
  const priceText = v => { const p = price(v); return p.unknown && !p.sum ? '' : `± ${euro(p.sum)}${p.unknown ? '+' : ''}`; };
  // korte labels; de uitleg staat in de title (tooltip)
  function flags(s, v, date) {
    const f = [];
    if (s.key === 'ontbijt' && isTrain(date)) f.push(['Bolus ↓ · suiker mee', `Training om ${V.settings.train.start}: overweeg je ontbijtbolus te verlagen (zoals afgesproken met je diabetesteam) en neem snelle suikers mee.`]);
    if (s.key === 'tussen1' && isTrain(date)) f.push(['Check glucose', 'Na krachttraining stijgt je glucose vaak, ook zonder veel koolhydraten.']);
    if (v.spike) f.push(['Piek', 'Veel snelle koolhydraten net na de training.']);
    if (lateRise(v)) f.push(['Late stijging', 'Vet- en eiwitrijk: je glucose kan pas na 2 à 4 uur stijgen.']);
    const c = hasCardio(date) && cardioPlan(date);
    if (s.key === 'avondmaal' && c) f.push([`${c.name} om ${c.start}: bolus ↓`, `${c.name} van ${c.start} tot ${c.end}: overweeg je bolus voor deze maaltijd te verlagen (zoals afgesproken met je diabetesteam) en neem snelle suikers mee.`]);
    else if (s.key === 'avondmaal' && hasCardio(date)) f.push(['Late hypo?', 'Cardio vandaag: check je glucose voor het slapen.']);
    if (s.key === 'avond' && hasCardio(date)) f.push(['Na cardio: KH + eiwit', 'Deze snack is je buffer tegen een nachtelijke hypo, zeker na een trainingsdag. Check je glucose voor het slapen.']);
    return f;
  }

  /* ── aanbeveling per soort dag ── */
  // Kiest per maaltijd de variant die het best past bij training, avondcardio of rust. Prijs breekt gelijke scores.
  function dayKind(slot, date) {
    const evening = ['tussen2', 'avondmaal', 'avond'].includes(slot);
    if (evening && hasCardio(date)) return 'cardio';
    return isTrain(date) ? 'train' : 'rest';
  }
  const RULES = {
    ontbijt:   { train: [v => v.kh + v.eiwit * 0.5, 'Trainingsdag: meer koolhydraten als brandstof voor de training'],
                 cardio: [v => v.kh + v.eiwit * 0.5, 'Trainingsdag: meer koolhydraten als brandstof'],
                 rest:  [v => v.eiwit - v.kh * 0.6, 'Rustdag: minder koolhydraten, eiwit blijft hoog'] },
    tussen1:   { train: [v => v.eiwit - v.kh, 'Na de training: veel eiwit, weinig koolhydraten (je glucose stijgt al)'],
                 cardio: [v => v.eiwit - v.kh, 'Na de training: veel eiwit, weinig koolhydraten'],
                 rest:  [v => v.eiwit - v.kh * 0.5, 'Rustdag: eiwitrijk tussendoortje'] },
    lunch:     { train: [v => v.eiwit + v.kh * 0.3 - v.vz * 2, 'Trainingsdag: eiwit voor herstel, met genoeg koolhydraten'],
                 cardio: [v => v.eiwit + v.kh * 0.3 - v.vz * 2, 'Eiwit voor herstel, met genoeg koolhydraten'],
                 rest:  [v => v.eiwit - v.kh * 0.5 - v.vz * 2, 'Rustdag: eiwitrijk, minder koolhydraten'] },
    tussen2:   { train: [v => v.eiwit + v.kh * 0.2, 'Trainingsdag: eiwit en wat koolhydraten'],
                 cardio: [v => v.kh * 0.6 + v.eiwit * 0.5 - v.vet, 'Avondcardio: koolhydraten als brandstof, weinig vet'],
                 rest:  [v => v.eiwit - v.kh * 0.5, 'Rustdag: eiwitrijk, minder koolhydraten'] },
    avondmaal: { train: [v => v.eiwit + v.kh * 0.3 - v.vz * 2, 'Trainingsdag: eiwit voor herstel'],
                 cardio: [v => v.kh - v.vet * 1.5 + v.eiwit * 0.3, 'Voor het zwemmen: koolhydraten als brandstof, weinig vet zodat het snel verteert'],
                 rest:  [v => v.eiwit - v.kh * 0.5 - v.vz * 2, 'Rustdag: eiwitrijk, minder koolhydraten'] },
    avond:     { train: [v => v.eiwit - v.kh * 0.3, 'Voor de nacht: eiwitrijk voor herstel'],
                 cardio: [v => v.kh + v.eiwit * 0.5, 'Na het zwemmen: koolhydraten en eiwit tegen een nachtelijke hypo'],
                 rest:  [v => v.eiwit - v.kh * 0.5, 'Rustdag: eiwitrijk, weinig koolhydraten'] },
  };
  // Per dag: eerst per maaltijd de best passende optie, daarna aanvullen tot het energiedoel
  // (rustdag = minder koolhydraten, niet minder eten). Rouleerde avondmalen blijven buiten de aanvulling.
  const recCache = new Map();
  function dayRecs(date) {
    const key = date + '|' + dayKind('avondmaal', date) + '|' + isTrain(date) + '|' + V.settings.kcal + '|' + Object.keys(V.settings.disabled).join();
    if (recCache.has(key)) return recCache.get(key);
    const pick = {}, opts = {};
    SLOTS.forEach(s => {
      const r = RULES[s.key][dayKind(s.key, date)];
      const scored = variantsFor(s.key, date).map(v => ({ v, sc: r[0](v) - price(v).sum * 2 })).sort((a, b) => b.sc - a.sc);
      opts[s.key] = scored; pick[s.key] = { v: scored[0].v, sc: scored[0].sc, why: r[1] };
    });
    const fixed = sk => { const d = SLOTS.find(x => x.key === sk); return d.rot && dayKind(sk, date) !== 'cardio'; };
    const total = () => SLOTS.reduce((a, s) => a + kcal(fixed(s.key) ? rotPick(s.key, date) : pick[s.key].v), 0);
    let guard = 12;
    while (total() < kcalTarget(date) - 150 && guard--) {
      let best = null;
      SLOTS.forEach(s => {
        if (fixed(s.key)) return;
        const cur = pick[s.key];
        opts[s.key].forEach(o => {
          const gain = kcal(o.v) - kcal(cur.v); if (gain < 60 || o.v.duur) return;
          const cost = (cur.sc - o.sc) / gain;
          if (!best || cost < best.cost) best = { sk: s.key, o, cost };
        });
      });
      if (!best) break;
      pick[best.sk] = { v: best.o.v, sc: best.o.sc, why: pick[best.sk].why + ' · aangevuld voor je energiedoel' };
    }
    recCache.set(key, pick);
    return pick;
  }
  function rotPick(slot, date) {
    const list = variantsFor(slot, date), rot = list.filter(v => !v.norot), pool = rot.length ? rot : list;
    return pool[((parse(date).getDay() + 6) % 7) % pool.length];
  }
  function recommended(slot, date) {
    const p = dayRecs(date)[slot];
    return p ? { id: p.v.id, why: p.why } : null;
  }

  /* ── totalen ── */
  function dayTotals(date) {
    const t = { kh: 0, eiwit: 0, vet: 0, vz: 0, eaten: 0, skipped: 0, expected: SLOTS.length, hypo: 0 };
    const add = m => { t.kh += m.kh; t.eiwit += m.eiwit; t.vet += m.vet; t.vz += m.vz; };
    SLOTS.forEach(s => {
      const e = entry(date, s.key); if (!e) return;
      if (e.status === 'gegeten') { add(byId(e.v) || planned(date, s.key)); t.eaten++; }
      else t.skipped++;
    });
    (day(date).extras || []).forEach(x => { add(x); if (x.hypo) t.hypo++; });
    return t;
  }
  function projected(date) {
    const t = dayTotals(date);
    SLOTS.forEach(s => { if (!entry(date, s.key)) { const v = planned(date, s.key); t.kh += v.kh; t.eiwit += v.eiwit; t.vet += v.vet; t.vz += v.vz; } });
    return t;
  }
  function dayCost(date) {
    let sum = 0;
    SLOTS.forEach(s => { const e = entry(date, s.key); if (e && e.status === 'overgeslagen') return; sum += price((e && byId(e.v)) || planned(date, s.key)).sum; });
    return sum;
  }

  /* ── weergave ── */
  const el = id => document.getElementById(id);
  function render() {
    if (!V.cur) V.cur = today();
    document.querySelectorAll('#screen-voeding .vd-tabs button').forEach(b => b.classList.toggle('active', b.dataset.vtab === V.tab));
    const pane = { dag: 'vd-dag', week: 'vd-week', menu: 'vd-menu-pane', shop: 'vd-shop-pane' }[V.tab];
    document.querySelectorAll('#screen-voeding .vd-pane').forEach(p => p.hidden = p.id !== pane);
    renderBanner();
    if (V.tab === 'dag') renderDag();
    if (V.tab === 'week') renderWeek();
    if (V.tab === 'menu') { renderMenu(); renderInst(); }
    if (V.tab === 'shop') renderShop();
  }
  function renderBanner() {
    const b = el('vd-banner'); if (!b) return;
    const txt = { ontbreekt: 'Supabase-tabellen ontbreken · alleen lokaal bewaard', offline: 'Offline · synchroniseert later', lokaal: 'Supabase niet ingesteld · alleen lokaal bewaard' }[V.db];
    b.innerHTML = txt ? `<div class="vd-banner">${esc(txt)}</div>` : '';
  }

  function isLate(s) {
    if (V.cur !== today() || entry(V.cur, s.key)) return false;
    return nowMin() > toMin(slotTime(s, V.cur)) + 60;
  }
  function fmtIng(i) {
    const [q, u, n] = i;
    const qs = q === 0.25 ? '¼' : q === 0.33 ? '⅓' : q === 0.5 ? '½' : String(q).replace('.', ',');
    return esc(`${qs} ${u} ${n.toLowerCase()}`);
  }

  const ICON = {
    swap: '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
    skip: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',
  };
  function renderDag() {
    const cur = V.cur, isToday = cur === today();
    el('vd-titel').textContent = isToday ? 'Vandaag' : cur === addDays(today(), -1) ? 'Gisteren' : cur === addDays(today(), 1) ? 'Morgen' : DAGEN[parse(cur).getDay()].replace(/^./, c => c.toUpperCase());
    el('vd-datum').textContent = longDate(cur);
    el('vd-btn-vandaag').hidden = isToday;

    const tr = training(cur), sch = scheduled(cur), fl = flagsOf(cur), T = V.settings.train;
    const changed = fl.skip || (fl.alt && fl.alt !== sch);
    el('vd-training').innerHTML = `
      <div class="vd-train">
        <label class="vd-tname"><span class="sr">Training vandaag</span>
          <select class="vd-tsel" data-vtrain aria-label="Training van deze dag">
            ${TRAINING_TYPES.map(x => `<option value="${esc(x)}" ${x === tr ? 'selected' : ''}>${x ? esc(x) : 'Rustdag'}</option>`).join('')}
          </select>
          <span>${tr ? `${esc(T.start)}–${esc(T.end)}` : ''}${changed ? ` · ${sch ? 'gepland: ' + esc(sch) : 'gepland: rust'}` : ''}</span>
        </label>
        <button class="vd-pill ${hasCardio(cur) ? 'on' : ''}" data-vact="cardio" title="${cardioPlan(cur) ? esc(cardioPlan(cur).name + ' ' + cardioPlan(cur).start + '–' + cardioPlan(cur).end) : 'Cardio'}">${cardioPlan(cur) ? esc(cardioPlan(cur).name) : 'Cardio'}${hasCardio(cur) ? ' ✓' : ''}</button>
      </div>`;

    const t = dayTotals(cur), st = V.settings, kt = kcalTarget(cur);
    const pct = (a, b) => Math.min(100, b ? a / b * 100 : 0);
    const meter = (label, val, of, warn) => `<div class="vd-m"><span class="l">${label}</span><span class="v">${val}<small>/${of}</small></span><div class="vd-bar ${warn ? 'warn' : ''}"><i style="width:${pct(parseFloat(val), of)}%"></i></div></div>`;
    el('vd-sum').innerHTML = `
      <div class="vd-meters">
        ${meter('kcal', kcal(t), kt)}
        ${meter('eiwit g', r0(t.eiwit), st.eiwit)}
        ${meter('verz. vet g', r1(t.vz), st.vz, t.vz > st.vz)}
      </div>`;
    el('vd-nudge').innerHTML = '';

    el('vd-meals').innerHTML = SLOTS.map(s => {
      const e = entry(cur, s.key);
      const v = (e && e.status === 'gegeten' && byId(e.v)) || planned(cur, s.key);
      if (e) {
        const done = e.status === 'gegeten';
        return `<div class="vd-row ${done ? 'done' : 'skip'}">
          <span class="vd-tick">${done ? '✓' : '–'}</span>
          <span class="vd-rowtxt"><span class="vd-slot">${esc(slotLabel(s, cur))}</span>${esc(done ? v.name : 'Overgeslagen')}</span>
          ${done ? `<span class="vd-rowkh">${r0(v.kh)} g</span>` : ''}
          <button class="vd-ico" data-vact="undo" data-slot="${s.key}" aria-label="Ongedaan maken" title="Ongedaan maken">${ICON.undo}</button>
        </div>`;
      }
      const n = variantsFor(s.key, cur).length, late = isLate(s);
      const fs = flags(s, v, cur), rec = recommended(s.key, cur);
      return `<article class="vd-meal ${late ? 'late' : ''}">
        <div class="vd-slot">${esc(slotLabel(s, cur))} · ${esc(slotTime(s, cur))}${late ? ' · <b>nog niet</b>' : ''}</div>
        <details class="vd-det"><summary><span class="vd-name">${esc(v.name)}</span>${rec && rec.id === v.id ? ` <span class="vd-tag" title="${esc(rec.why)}">aanbevolen</span>` : ''}${v.duur ? ' <span class="vd-tag warn">€€</span>' : ''}</summary>
          <div class="vd-ing">${(v.ing || []).map(fmtIng).join(' · ')}${priceText(v) ? ` <span class="vd-price">${priceText(v)}</span>` : ''}</div>
        </details>
        <div class="vd-line">
          <span class="vd-kh">${r0(v.kh)}<small> g KH</small></span><span class="vd-p">${r0(v.eiwit)} g eiwit</span>
          ${fs.map(f => `<span class="vd-flag" title="${esc(f[1])}">${esc(f[0])}</span>`).join('')}
        </div>
        <div class="vd-acts">
          <button class="yes" data-vact="eat" data-slot="${s.key}">Gegeten</button>
          ${n > 1 ? `<button class="vd-ico" data-vact="swap" data-slot="${s.key}" aria-label="Kies een andere optie" title="Opties (${n})">${ICON.swap}</button>` : ''}
          <button class="vd-ico" data-vact="skip" data-slot="${s.key}" aria-label="Overslaan" title="Overslaan">${ICON.skip}</button>
        </div>
      </article>`;
    }).join('');

    const xs = day(cur).extras || [];
    el('vd-extras').innerHTML = xs.map((x, i) => `<div class="vd-row extra"><span class="vd-tick">+</span><span class="vd-rowtxt">${esc(x.name)}</span><span class="vd-rowkh">${r0(x.kh)} g</span><button class="vd-ico" data-vact="xdel" data-i="${i}" aria-label="Verwijder ${esc(x.name)}">${ICON.skip}</button></div>`).join('');
  }

  function renderWeek() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today(), -6 + i));
    const T = days.map(d => ({ d, t: dayTotals(d) }));
    const logged = T.filter(x => x.t.eaten || x.t.skipped || (day(x.d).extras || []).length);
    const avg = f => logged.length ? logged.reduce((a, x) => a + f(x), 0) / logged.length : 0;
    const skipped = T.reduce((a, x) => a + x.t.skipped, 0);
    const missing = T.filter(x => x.d !== today()).reduce((a, x) => a + Math.max(0, x.t.expected - x.t.eaten - x.t.skipped), 0);
    const hypo = T.reduce((a, x) => a + x.t.hypo, 0);

    // gewicht uit de check-in
    const w1 = V.weights.filter(w => w.date > addDays(today(), -7)), w0 = V.weights.filter(w => w.date <= addDays(today(), -7));
    const mean = a => a.reduce((s, w) => s + w.kg, 0) / a.length;
    let wHtml = '';
    if (w1.length >= 3 && w0.length >= 3) {
      const a1 = mean(w1), a0 = mean(w0), dlt = a1 - a0;
      const advies = dlt > 0.35 ? 'Te snel · −150 kcal' : dlt < 0.05 ? 'Stilstand · +150 kcal' : 'Op schema';
      wHtml = `<div class="vd-card vd-tile vd-wide"><div class="v">${a1.toFixed(1).replace('.', ',')} kg <small>${dlt >= 0 ? '+' : ''}${dlt.toFixed(2).replace('.', ',')}</small></div><div class="l">gewicht, weekgemiddelde · ${advies}</div></div>`;
    }
    el('vd-week').innerHTML = `
      <div class="vd-tiles">
        ${wHtml}
        <div class="vd-card vd-tile"><div class="v">${r0(avg(x => kcal(x.t)))}</div><div class="l">kcal / dag</div></div>
        <div class="vd-card vd-tile"><div class="v">${r0(avg(x => x.t.eiwit))} g</div><div class="l">eiwit / dag</div></div>
        <div class="vd-card vd-tile"><div class="v">${r1(avg(x => x.t.vz))} g</div><div class="l">verz. vet / dag</div></div>
        <div class="vd-card vd-tile"><div class="v">${skipped + missing}</div><div class="l">gemist${hypo ? ` · ${hypo} hypo` : ''}</div></div>
      </div>
      ${T.slice().reverse().map(({ d, t }) => `
        <div class="vd-wrow">
          <span class="d">${d === today() ? 'vandaag' : shortDate(d)}</span>
          <div class="vd-bar"><i style="width:${Math.min(100, kcal(t) / kcalTarget(d) * 100)}%"></i></div>
          <span class="r">${kcal(t)} <small>kcal</small></span>
        </div>`).join('')}`;
  }

  // Labels in Menu's: voor welk soort dag past een optie het best (top 2 per soort dag, of vast via 'when')
  const KIND_LABEL = { train: 'training', rest: 'rust', cardio: 'avondcardio' };
  function fitTags(slot) {
    const all = allVariants().filter(v => v.slot === slot && !V.settings.disabled[v.id]);
    const kinds = ['train', 'rest'].concat(['tussen2', 'avondmaal', 'avond'].includes(slot) ? ['cardio'] : []);
    const out = {};
    const add = (id, k) => { const l = out[id] = out[id] || []; if (!l.includes(KIND_LABEL[k])) l.push(KIND_LABEL[k]); };
    const rank = {};   // beste plaats per variant over de soorten dagen
    kinds.forEach(k => {
      const pool = all.filter(v => !v.when || v.when === (k === 'rest' ? 'rest' : 'train'));
      const r = RULES[slot][k];
      const sorted = pool.map(v => ({ v, sc: r[0](v) - price(v).sum * 2 })).sort((a, b) => b.sc - a.sc);
      sorted.forEach((t, i) => {
        if (i < (pool.length > 3 ? 2 : 1)) add(t.v.id, k);
        const rel = i / Math.max(1, sorted.length - 1);
        if (!rank[t.v.id] || rel < rank[t.v.id].rel) rank[t.v.id] = { rel, k };
      });
    });
    all.forEach(v => {
      if (v.when) add(v.id, v.when === 'rest' ? 'rest' : 'train');      // vaste dagtypes
      else if (!out[v.id] && rank[v.id]) add(v.id, rank[v.id].k);        // elke optie minstens één label
    });
    return out;
  }
  let fit = {};
  function renderMenu() {
    el('vd-menu').innerHTML = SLOTS.map(s => `
      <div class="vd-mgroup"><h3>${esc(s.trainLabel ? s.trainLabel + ' / ' + s.label.toLowerCase() : s.label)}</h3>
      ${(fit = fitTags(s.key), '')}${allVariants().filter(v => v.slot === s.key).map(v => `
        <div class="vd-card vd-mitem ${V.settings.disabled[v.id] ? 'off' : ''}">
          <details class="vd-det vd-mdet"><summary><span class="vd-name n">${esc(v.name)}</span>${(fit[v.id] || []).map(t => ` <span class="vd-tag">${t}</span>`).join('')}</summary>
            <ul class="vd-inglist">${(v.ing || []).map(i => `<li><span>${fmtIng(i)}</span>${AH[i[2]] ? `<small>${esc(AH[i[2]].p)}</small>` : ''}</li>`).join('') || '<li>Geen ingrediënten ingevuld</li>'}</ul>
          </details>
          <div class="vd-toggle">
            <button class="vd-switch ${V.settings.disabled[v.id] ? '' : 'on'}" data-vact="toggle" data-id="${v.id}" role="switch" aria-checked="${!V.settings.disabled[v.id]}" aria-label="${esc(v.name)} gebruiken"><i></i></button>
            ${v.id.startsWith('c_') ? `<button class="vd-ico" data-vact="cdel" data-id="${v.id}" aria-label="Verwijderen">${ICON.skip}</button>` : ''}
          </div>
          <span class="m">${r0(v.kh)} KH · ${r0(v.eiwit)} eiwit · ${r1(v.vz)} verz. · ${kcal(v)} kcal${priceText(v) ? ' · ' + priceText(v) : ''}</span>
        </div>`).join('')}
      </div>`).join('');
  }
  function renderInst() {
    const S = V.settings, T = S.train;
    el('vd-i-eiwit').value = S.eiwit; el('vd-i-vz').value = S.vz; el('vd-i-kcal').value = S.kcal;
    el('vd-i-tstart').value = T.start; el('vd-i-tend').value = T.end;
    const cd = Object.keys(T.cardio || {})[0], cc = cd != null ? T.cardio[cd] : null;
    el('vd-c-dag').innerHTML = `<option value="">Geen</option>` + [1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${String(d) === cd ? 'selected' : ''}>${DAGEN[d]}</option>`).join('');
    el('vd-c-naam').value = cc ? cc.name : ''; el('vd-c-start').value = cc ? cc.start : ''; el('vd-c-end').value = cc ? cc.end : '';
    el('vd-i-schema').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<label>${DAGEN[d]}<select id="vd-d-${d}">${TRAINING_TYPES.map(t => `<option value="${esc(t)}" ${T.days[d] === t ? 'selected' : ''}>${t ? esc(t) : 'Rust'}</option>`).join('')}</select></label>`).join('');
    el('vd-i-tijden').innerHTML = SLOTS.map(s => `<label>${esc(s.trainLabel ? s.label + ' / ' + s.trainLabel.toLowerCase() : s.label)}<input type="time" id="vd-t-${s.key}" value="${S.times[s.key]}"></label>`).join('');
    el('vd-e-slot').innerHTML = SLOTS.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
  }

  // Boodschappendag: zelf te kiezen (standaard vandaag), voor een aantal dagen vooruit.
  const shopFrom = () => { const f = V.settings.shopFrom; return f && f >= today() ? f : today(); };
  const shopDays = () => V.settings.shopDays || 7;
  const shopKey = () => shopFrom();
  function renderShop() {
    const from = shopFrom(), n = shopDays(), to = addDays(from, n - 1), key = shopKey();
    el('vd-shop-from').value = from; el('vd-shop-from').min = today();
    el('vd-shop-days').value = String(n);
    const sum = {};
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i);
      SLOTS.forEach(s => {
        const e = entry(d, s.key); if (e && e.status === 'overgeslagen') return;
        const v = (e && byId(e.v)) || planned(d, s.key);
        (v.ing || []).forEach(([q, u, nm, c]) => {
          const aq = toAh(nm, q, u);
          const k = aq != null ? nm.toLowerCase() : `${nm.toLowerCase()}|${u}`;
          sum[k] = sum[k] || { n: nm, u: aq != null ? AH[nm].u : u, q: 0, c: c || 'O', ah: aq != null ? AH[nm] : null };
          sum[k].q += aq != null ? aq : q;
        });
      });
    }
    let total = 0, left = 0, use = 0;
    const checked = V.settings.shop[key] || {}, groups = {};
    for (let i = 0; i < n; i++) use += dayCost(addDays(from, i));
    Object.entries(sum).forEach(([k, it]) => {
      if (it.ah) { it.packs = Math.max(1, Math.ceil(it.q / it.ah.q - 0.05)); it.cost = it.packs * it.ah.price; }
      else { const p = PRICES[it.n] && PRICES[it.n][it.u]; it.cost = p != null ? p * it.q : 0; }
      total += it.cost; if (!checked[k]) left += it.cost;
    });
    el('vd-shop-sub').innerHTML = `${shortDate(from)} – ${shortDate(to)}<br>Nog te kopen <b class="vd-left">± ${euro(left)}</b>${left < total - 0.005 ? ` <small>van ${euro(total)}</small>` : ''} · verbruik ± ${euro(use)}<br><small>Vink af wat je gekocht hebt of nog in huis hebt. ≈ = prijs onzeker.</small>`;
    Object.entries(sum).forEach(([k, it]) => (groups[it.c] = groups[it.c] || []).push([k, it]));
    const fmtQ = it => {
      let q = it.q;
      if (it.u === 'g' || it.u === 'ml') q = q >= 100 ? Math.ceil(q / 50) * 50 : Math.ceil(q / 10) * 10;
      else q = Math.ceil(q * 2) / 2;
      return `${String(q).replace('.', ',')} ${it.u}`;
    };
    el('vd-shop').innerHTML = Object.keys(CAT).filter(c => groups[c]).map(c => `
      <div class="vd-scat"><h3>${CAT[c]}</h3>
        ${groups[c].sort((a, b) => a[1].n.localeCompare(b[1].n, 'nl')).map(([k, it]) => `
          <label class="vd-sitem ${checked[k] ? 'got' : ''}"><input type="checkbox" data-shop="${esc(k)}" ${checked[k] ? 'checked' : ''}>
            <span class="vd-sname">${esc(it.n)} <small>${fmtQ(it)}</small>${it.ah ? `<small class="ah">${esc(it.ah.p)} · ${esc(it.ah.size)}</small>` : ''}</span>
            <span class="q">${it.ah ? `${it.packs}× · ${it.ah.c === 'onzeker' ? '≈' : ''}${euro(it.packs * it.ah.price)}` : ''}</span></label>`).join('')}
      </div>`).join('') || '<p class="vd-empty">Geen ingrediënten gevonden voor deze periode.</p>';
  }

  /* ── acties ── */
  function setEntry(slot, val) {
    const d = ensureDay(V.cur);
    if (val) d.entries[slot] = val; else delete d.entries[slot];
    touchDay(V.cur); renderDag();
  }
  function onClick(ev) {
    const tab = ev.target.closest('[data-vtab]');
    if (tab) { V.tab = tab.dataset.vtab; render(); document.getElementById('main').scrollTop = 0; return; }
    const b = ev.target.closest('[data-vact]'); if (!b) return;
    const slot = b.dataset.slot, act = b.dataset.vact, cur = V.cur;
    if (act === 'eat') { setEntry(slot, { status: 'gegeten', v: planned(cur, slot).id, at: Date.now() }); haptic(); }
    if (act === 'skip') setEntry(slot, { status: 'overgeslagen', v: planned(cur, slot).id, at: Date.now() });
    if (act === 'undo') setEntry(slot, null);
    if (act === 'swap') openPicker(slot);
    if (act === 'tskip' || act === 'cardio') {
      const f = ensureDay(cur).flags;
      if (act === 'tskip') { if (f.skip) delete f.skip; else f.skip = true; }
      else { const want = !hasCardio(cur); if (want === !!cardioPlan(cur)) delete f.cardio; else f.cardio = want; ensureDay(cur).plan = {}; }
      touchDay(cur); renderDag();
    }
    if (act === 'xdel') {
      const i = +b.dataset.i, item = ensureDay(cur).extras.splice(i, 1)[0];
      touchDay(cur); renderDag(); showToast(`${item.name} verwijderd`);
    }
    if (act === 'extra') openExtra();
    if (act === 'prev' || act === 'next' || act === 'vandaag') {
      V.cur = act === 'vandaag' ? today() : addDays(V.cur, act === 'prev' ? -1 : 1);
      renderDag(); fetchDay(V.cur);
    }
    if (act === 'toggle') {
      const id = b.dataset.id, D = V.settings.disabled;
      if (D[id]) delete D[id]; else D[id] = true;
      touchSettings(); renderMenu();
    }
    if (act === 'cdel') {
      V.settings.custom = V.settings.custom.filter(c => c.id !== b.dataset.id);
      touchSettings(); renderMenu(); showToast('Variant verwijderd');
    }
    if (act === 'shopreset') { delete V.settings.shop[shopKey()]; touchSettings(); renderShop(); showToast('Vinkjes gewist'); }
  }
  function onChange(ev) {
    if (ev.target.id === 'vd-shop-from' || ev.target.id === 'vd-shop-days') {
      if (ev.target.id === 'vd-shop-from') V.settings.shopFrom = ev.target.value || today();
      else V.settings.shopDays = +ev.target.value || 7;
      touchSettings(); renderShop();
      return;
    }
    if ('vtrain' in ev.target.dataset) {
      const val = ev.target.value, f = ensureDay(V.cur).flags, sch = scheduled(V.cur);
      delete f.skip; delete f.alt;
      if (!val && sch) f.skip = true;
      else if (val && val !== sch) f.alt = val;
      ensureDay(V.cur).plan = {};   // menu volgt het nieuwe soort dag
      // wissels die niet meer bij het dagtype passen vallen vanzelf terug op de standaard
      touchDay(V.cur); renderDag();
      showToast(val ? `Training: ${val}` : 'Rustdag');
      return;
    }
    const k = ev.target.dataset.shop; if (!k) return;
    const key = shopKey();
    // oude weken opruimen
    Object.keys(V.settings.shop).forEach(w => { if (w < addDays(today(), -14)) delete V.settings.shop[w]; });
    const m = V.settings.shop[key] = V.settings.shop[key] || {};
    if (ev.target.checked) m[k] = true; else delete m[k];
    touchSettings(); renderShop();
  }
  const num = id => parseFloat((el(id).value || '0').replace(',', '.')) || 0;
  function onSubmit(ev) {
    if (ev.target.id === 'vd-form-inst') {
      ev.preventDefault();
      const S = V.settings, T = S.train;
      S.eiwit = +el('vd-i-eiwit').value || 150; S.vz = +el('vd-i-vz').value || 20; S.kcal = +el('vd-i-kcal').value || 2600;
      if (el('vd-i-tstart').value) T.start = el('vd-i-tstart').value;
      if (el('vd-i-tend').value) T.end = el('vd-i-tend').value;
      const cdag = el('vd-c-dag').value;
      T.cardio = cdag === '' ? {} : { [cdag]: { name: el('vd-c-naam').value.trim() || 'Cardio', start: el('vd-c-start').value || '19:00', end: el('vd-c-end').value || '20:00' } };
      [0, 1, 2, 3, 4, 5, 6].forEach(d => { T.days[d] = el('vd-d-' + d).value; });
      SLOTS.forEach(s => { const v = el('vd-t-' + s.key).value; if (v) S.times[s.key] = v; });
      touchSettings(); showToast('Instellingen opgeslagen');
    }
    if (ev.target.id === 'vd-form-eigen') {
      ev.preventDefault();
      const ing = el('vd-e-ing').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|ml|st|el|tl|sn|blik)?\.?\s+(.+)$/i);
        return m ? [parseFloat(m[1].replace(',', '.')), (m[2] || 'st').toLowerCase().replace('gr', 'g'), m[3], 'O'] : [1, 'st', l, 'O'];
      });
      V.settings.custom.push({ id: 'c_' + Date.now().toString(36), slot: el('vd-e-slot').value, name: el('vd-e-naam').value.trim(),
        kh: num('vd-e-kh'), eiwit: num('vd-e-eiwit'), vet: num('vd-e-vet'), vz: num('vd-e-vz'), ing });
      touchSettings(); ev.target.reset(); renderMenu(); renderInst(); showToast('Variant opgeslagen');
    }
  }

  /* ── extra's ── */
  // Zoekbare lijst: snelle keuzes + je oude voedingslog + eigen extra's die je ooit invulde
  const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let xQty = 1;
  function foodList() {
    const seen = new Set(), out = [];
    const push = x => { const k = norm(x.name); if (!seen.has(k)) { seen.add(k); out.push(x); } };
    EXTRAS.forEach(push); LOGBOEK.forEach(push); (V.settings.ownFoods || []).forEach(push);
    return out;
  }
  function renderFoods() {
    const q = norm(el('vd-x-zoek').value.trim());
    const all = foodList();
    let list;
    if (q) {
      const words = q.split(/\s+/);
      list = all.filter(x => { const n = norm(x.name); return words.every(w => n.includes(w)); })
        .sort((a, b) => norm(a.name).indexOf(words[0]) - norm(b.name).indexOf(words[0]) || a.name.localeCompare(b.name, 'nl'));
    } else {
      const recent = (V.settings.recent || []).map(n => all.find(x => x.name === n)).filter(Boolean);
      const hypo = all.filter(x => x.hypo && !recent.includes(x));
      list = [...hypo, ...recent, ...all.filter(x => !x.hypo && !recent.includes(x)).sort((a, b) => a.name.localeCompare(b.name, 'nl'))];
    }
    V._foods = list;
    el('vd-x-lijst').innerHTML = list.length
      ? list.map((x, i) => `<button type="button" class="vd-food ${x.hypo ? 'hypo' : ''}" data-x="${i}">
          <span class="n">${esc(x.name)}</span>
          <span class="m">${r0(x.kh * xQty)} KH · ${r0(x.eiwit * xQty)} eiwit · ${r0(kcal(x) * xQty)} kcal</span></button>`).join('')
      : `<p class="vd-empty">Niets gevonden voor "${esc(el('vd-x-zoek').value.trim())}". Vul het hieronder zelf in.</p>`;
    if (!list.length) { el('vd-x-eigen').open = true; el('vd-x-naam').value = el('vd-x-zoek').value.trim(); }
  }
  function openExtra() {
    xQty = 1;
    el('vd-x-zoek').value = '';
    el('vd-x-qty').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.q === 1));
    el('vd-x-eigen').open = false;
    renderFoods();
    el('vd-dlg').showModal();
    setTimeout(() => el('vd-x-zoek').focus(), 50);
  }
  function addExtra(x, own) {
    const item = { name: xQty === 1 ? x.name : `${String(xQty).replace('.', ',')} × ${x.name}`,
      kh: x.kh * xQty, eiwit: x.eiwit * xQty, vet: x.vet * xQty, vz: x.vz * xQty, at: Date.now() };
    if (x.hypo) item.hypo = true;
    ensureDay(V.cur).extras.push(item); touchDay(V.cur);
    const S = V.settings;
    S.recent = [x.name, ...(S.recent || []).filter(n => n !== x.name)].slice(0, 8);
    if (own) S.ownFoods = [{ name: x.name, kh: x.kh, eiwit: x.eiwit, vet: x.vet, vz: x.vz, hypo: x.hypo || undefined },
      ...(S.ownFoods || []).filter(f => norm(f.name) !== norm(x.name))].slice(0, 100);
    touchSettings();
    renderDag(); el('vd-dlg').close();
    showToast(`${item.name} toegevoegd`);
  }
  function initDialog() {
    const dlg = el('vd-dlg');
    dlg.addEventListener('click', ev => {
      if (ev.target === dlg || ev.target.closest('[data-close]')) { dlg.close(); return; }
      const qb = ev.target.closest('[data-q]');
      if (qb) { xQty = +qb.dataset.q; el('vd-x-qty').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === qb)); renderFoods(); return; }
      const b = ev.target.closest('[data-x]'); if (b) addExtra(V._foods[+b.dataset.x]);
    });
    el('vd-x-zoek').addEventListener('input', renderFoods);
    el('vd-x-zoek').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (V._foods && V._foods[0]) addExtra(V._foods[0]); } });
    el('vd-x-add').addEventListener('click', () => {
      const name = el('vd-x-naam').value.trim();
      if (!name) { el('vd-x-naam').focus(); showToast('Vul in wat je at'); return; }
      addExtra({ name, kh: num('vd-x-kh'), eiwit: num('vd-x-eiwit'), vet: num('vd-x-vet'), vz: num('vd-x-vz'), hypo: el('vd-x-hypo').checked }, true);
      ['vd-x-naam', 'vd-x-kh', 'vd-x-eiwit', 'vd-x-vet', 'vd-x-vz'].forEach(id => el(id).value = ''); el('vd-x-hypo').checked = false;
    });
  }

  /* ── keuzelijst per maaltijd ── */
  let pickSlot = null;
  function openPicker(slot) {
    pickSlot = slot;
    const s = SLOTS.find(x => x.key === slot), now = planned(V.cur, slot), rec = recommended(slot, V.cur);
    el('vd-pick-title').textContent = `${slotLabel(s, V.cur)} · ${DAGEN[parse(V.cur).getDay()]}`;
    el('vd-pick-why').textContent = rec ? rec.why : '';
    el('vd-pick-list').innerHTML = variantsFor(slot, V.cur).map(v => `
      <button type="button" class="vd-opt ${v.id === now.id ? 'on' : ''}" data-pick="${v.id}" aria-pressed="${v.id === now.id}">
        <span class="n">${esc(v.name)}${rec && rec.id === v.id ? ' <span class="vd-tag">aanbevolen</span>' : ''}${v.duur ? ' <span class="vd-tag warn">€€</span>' : ''}</span>
        <span class="m">${r0(v.kh)} KH · ${r0(v.eiwit)} eiwit · ${r1(v.vz)} verz. · ${kcal(v)} kcal${priceText(v) ? ' · ' + priceText(v) : ''}</span>
      </button>`).join('');
    el('vd-pick').showModal();
  }
  function initPicker() {
    const dlg = el('vd-pick');
    dlg.addEventListener('click', ev => {
      if (ev.target === dlg || ev.target.closest('[data-close]')) { dlg.close(); return; }
      const b = ev.target.closest('[data-pick]'); if (!b || !pickSlot) return;
      ensureDay(V.cur).plan[pickSlot] = b.dataset.pick; touchDay(V.cur); renderDag(); dlg.close();
    });
  }

  /* ── start ── */
  let inited = false;
  function init() {
    if (inited) return; inited = true;
    const scr = el('screen-voeding');
    scr.addEventListener('click', onClick);
    scr.addEventListener('change', onChange);
    scr.addEventListener('submit', onSubmit);
    initDialog();
    initPicker();
    setInterval(() => { if (!document.hidden && scr.classList.contains('active') && V.tab === 'dag') renderDag(); }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !scr.classList.contains('active')) return;
      if (el('vd-btn-vandaag').hidden) V.cur = today();
      refresh();
    });
  }
  function open() {
    init();
    if (!V.cur) V.cur = today();
    render();
    refresh();
  }

  return { open, _V: V, _dayTotals: dayTotals, _planned: planned, _dayCost: dayCost, _kcal: kcal };
})();
