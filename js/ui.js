/* 咖啡沖煮模擬館：介面 */
(function () {
  'use strict';
  const D = window.COFFEE, B = window.Brew, C = window.Charts, E = window.CoffeeEngine, DR = window.Draw;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const byId = B.byId;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS = 'brewlab.state.v1', LS_THEME = 'brewlab.theme', LS_3D = 'brewlab.3d';
  const GEAR_IMG = ['cone', 'chemex', 'siphon'];  // 已有 Blender 算圖（img/gear/<draw>.webp）的器具
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式等情況 */ } }
  };

  const CAT = { pour: '手沖', hybrid: '混合式', immersion: '浸泡式', pressure: '加壓式', traditional: '傳統與冷萃' };
  const COMP = { WBrC: '世界沖煮大賽', WBC: '世界咖啡師大賽', WAC: '世界愛樂壓大賽', '基準': '業界基準' };
  const PREP = { none: '直接填壓（不布粉）', tamp: '輕敲＋填壓', wdt: 'WDT 布粉＋填壓', screen: 'WDT＋分水網' };

  let state = restore() || B.fromRecipe(byId(D.RECIPES, 'tetsu46'));
  let current = null, snap = null, anim = null, liveX = null, maxDrain = 1;
  let speed = 1, lastT = 0;
  let use3d = store.get(LS_3D) !== false;
  const brews = [];
  let histN = 0;

  function restore() {
    const s = store.get(LS);
    if (!s || !s.method || !byId(D.METHODS, s.method) || !byId(D.BEANS, s.bean)) return null;
    return s;
  }

  /* ================= 分頁 ================= */
  const VIEWS = ['sim', 'theory', 'gear', 'beans', 'champions'];
  function showView(v, scroll) {
    if (!VIEWS.includes(v)) v = 'sim';
    VIEWS.forEach(x => { const el = $('#view-' + x); if (el) el.hidden = x !== v; });
    $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.view === v ? 'page' : 'false'));
    try { history_replace('#' + v); } catch (e) { }
    if (scroll) { const m = $('#main'); window.scrollTo({ top: m.getBoundingClientRect().top + window.scrollY - 64, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  }
  function history_replace(h) { if (window.history && window.history.replaceState) window.history.replaceState(null, '', h); }

  /* ================= 吧台：控制面板 ================= */
  function field(key, label, min, max, step, unit, val, hint) {
    return `<div class="field"><div class="field-top"><label for="f-${key}">${label}</label><span class="field-val"><input class="num" type="number" id="n-${key}" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}">${unit ? `<span class="unit">${unit}</span>` : ''}</span></div>
      <input type="range" id="f-${key}" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}">${hint ? `<div class="field-hint">${hint}</div>` : ''}</div>`;
  }
  function seg(key, label, options, val) {
    return `<div class="field"><div class="field-top"><span class="lbl">${label}</span></div><div class="seg" role="radiogroup" aria-label="${label}">${options.map(([v, t]) =>
      `<button type="button" class="seg-btn" data-seg="${key}" data-v="${v}" role="radio" aria-checked="${String(val) === String(v)}">${t}</button>`).join('')}</div></div>`;
  }
  function check(key, label, val) {
    return `<label class="check"><input type="checkbox" id="c-${key}" data-c="${key}" ${val ? 'checked' : ''}><span>${label}</span></label>`;
  }
  function select(key, label, options, val) {
    return `<div class="field"><div class="field-top"><label for="s-${key}">${label}</label></div><select id="s-${key}" data-s="${key}">${options.map(([v, t]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  }

  function renderPanel() {
    const m = B.method(state);
    const bean = byId(D.BEANS, state.bean);
    const roast = byId(D.ROAST_INFO, state.roast);
    const rec = state.recipe ? byId(D.RECIPES, state.recipe) : null;
    let h = '';
    // 配方
    const groups = [['WBrC', '世界沖煮大賽冠軍'], ['WBC', '世界咖啡師冠軍'], ['WAC', '世界愛樂壓冠軍'], ['基準', '業界基準']];
    h += `<section class="psec"><div class="psec-head"><h3>快速載入配方</h3></div>
      <select id="recipe" aria-label="載入配方"><option value="">自由沖煮</option>${groups.map(([k, n]) => `<optgroup label="${n}">${D.RECIPES.filter(r => r.comp === k).map(r => `<option value="${r.id}" ${state.recipe === r.id ? 'selected' : ''}>${r.year ? r.year + ' ' : ''}${esc(r.who)}：${esc(r.title)}</option>`).join('')}</optgroup>`).join('')}</select>
      ${rec ? `<p class="hint">${state.modified ? '已依照你的調整修改，' : ''}<a href="#champions" data-goto="champions" data-focus="${rec.id}">看配方說明</a></p>` : '<p class="hint">從零開始：依序選豆子、處理法、烘焙度與沖煮法。</p>'}</section>`;
    // 1 豆子
    h += `<section class="psec"><div class="psec-head"><span class="step">1</span><h3>豆子</h3></div>
      <select id="bean" aria-label="選擇豆子">${D.BEANS.map(b => `<option value="${b.id}" ${b.id === state.bean ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
      <div class="bean-meta"><span>${esc(bean.region)}</span><span>${esc(bean.alt)}</span><span>${esc(bean.variety)}</span></div>
      <div class="chips small">${bean.notes.map(n => `<span class="chip">${esc(n[0])}</span>`).join('')}</div></section>`;
    // 2 處理法
    h += `<section class="psec"><div class="psec-head"><span class="step">2</span><h3>處理法</h3><span class="aside">● 這個產區常見</span></div>
      <div class="chips pick">${D.PROCESSES.map(p => `<button type="button" class="chip-btn ${bean.common.includes(p.id) ? 'common' : ''}" data-process="${p.id}" aria-pressed="${p.id === state.process}">${p.name}</button>`).join('')}</div>
      <p class="hint">${esc(byId(D.PROCESSES, state.process).summary)}</p></section>`;
    // 3 烘焙
    h += `<section class="psec"><div class="psec-head"><span class="step">3</span><h3>烘焙度</h3><span class="aside">SCA 色卡 #${roast.tile}</span></div>
      <div class="roast-row" role="radiogroup" aria-label="烘焙度">${D.ROAST_INFO.map(r => `<button type="button" class="roast-sw" data-roast="${r.id}" role="radio" aria-checked="${r.id === state.roast}" style="--sw:${r.color}" title="${r.name}"><span>${r.name}</span></button>`).join('')}</div>
      <p class="hint">${esc(roast.desc)} 建議水溫 ${roast.temp[0]}–${roast.temp[1]}°C。</p>
      ${field('restDays', '烘焙後天數', 1, 60, 1, '天', state.restDays, state.restDays < 4 ? '還在大量排氣' : state.restDays > 30 ? '香氣開始流失' : '賞味期內')}</section>`;
    // 4 沖煮法
    h += `<section class="psec"><div class="psec-head"><span class="step">4</span><h3>沖煮法</h3></div>
      ${Object.keys(CAT).map(c => `<div class="mgroup"><div class="mgroup-name">${CAT[c]}</div><div class="mgrid">${D.METHODS.filter(x => x.cat === c).map(x => `<button type="button" class="mbtn" data-method="${x.id}" aria-pressed="${x.id === state.method}">${DR.svg(x.draw, DR.staticState(x.draw), 'mini', 'm-' + x.id)}<span>${esc(x.name)}</span></button>`).join('')}</div></div>`).join('')}</section>`;
    // 5 參數
    h += `<section class="psec"><div class="psec-head"><span class="step">5</span><h3>參數</h3><span class="aside" id="ratio-note"></span></div>`;
    h += field('dose', '粉量', m.id === 'coldbrew' ? 30 : m.id === 'colddrip' ? 20 : 5, m.id === 'coldbrew' ? 200 : m.id === 'colddrip' ? 100 : 40, 0.5, 'g', state.dose);
    if (m.family === 'espresso') h += field('yield', '出杯量', 15, 90, 1, 'g', state.yield);
    else h += field('water', m.id === 'phin' ? '總水量' : '水量', m.id === 'turkish' ? 40 : m.id === 'coldbrew' ? 300 : 60, m.id === 'coldbrew' ? 2000 : m.id === 'colddrip' ? 1000 : m.id === 'turkish' ? 150 : 700, 1, 'g', state.water);
    if (m.target !== 'cold' || m.id === 'coldbrew') h += field('temp', m.id === 'coldbrew' ? '環境溫度' : m.id === 'turkish' ? '目標溫度（起泡）' : '水溫', m.id === 'coldbrew' ? 2 : 70, m.id === 'coldbrew' ? 30 : 100, 1, '°C', state.temp);
    else h += field('temp', '冰水溫度', 1, 20, 1, '°C', state.temp);
    const gr = m.grindRange;
    h += field('grind', '研磨（顆粒中位數）', m.id === 'turkish' ? 60 : 150, 1600, 10, 'µm', state.grind,
      `這個方法常見 ${gr[0]}–${gr[1]} µm${state.grindSplit ? '・目前是雙研磨配方（整體平移）' : ''}`);
    h += select('grinder', '磨豆機', D.GRINDER_INFO.map(g => [g.id, g.name]), state.grinder) + `<div class="field-hint sel-hint">${esc(byId(D.GRINDER_INFO, state.grinder).desc)}</div>`;
    h += select('waterProfile', '水質', D.WATER_INFO.map(w => [w.id, w.name]), state.waterProfile) + `<div class="field-hint sel-hint">${esc(byId(D.WATER_INFO, state.waterProfile).spec)}・${esc(byId(D.WATER_INFO, state.waterProfile).desc)}</div>`;
    h += '</section>';
    // 6 方法專屬
    h += `<section class="psec"><div class="psec-head"><span class="step">6</span><h3>${methodSectionTitle(m)}</h3></div>${methodControls(m)}</section>`;
    $('#panel').innerHTML = h;
    updateRatioNote();
  }

  function methodSectionTitle(m) {
    if (m.family === 'perc' && m.id !== 'colddrip' || m.id === 'switch') return '注水節奏';
    if (m.family === 'espresso') return '萃取設定';
    if (m.id === 'colddrip') return '滴速';
    return '浸泡與操作';
  }

  function methodControls(m) {
    let h = '';
    switch (m.id) {
      case 'clever':
        h += field('steep', '浸泡時間', 60, 420, 5, '秒', state.steep, '到時間就把濾杯放上分享壺，閥門打開');
        h += check('stir30', '注水後 30 秒攪拌一次', (state.stirs || []).includes(30));
        break;
      case 'frenchpress':
        h += seg('mode', '下壓方式', [['plunge', '時間到直接下壓'], ['hoffmann', 'Hoffmann 靜置法']], state.mode);
        h += field('steep', state.mode === 'hoffmann' ? '破渣前浸泡' : '浸泡時間', 60, 600, 10, '秒', state.steep);
        if (state.mode === 'hoffmann') h += field('wait', '破渣後靜置', 60, 600, 10, '秒', state.wait || 300, '細粉沉澱，濾網只壓到液面');
        else h += check('stir30', '30 秒時攪拌一次', (state.stirs || []).includes(30));
        break;
      case 'aeropress':
        h += field('steep', '浸泡時間', 30, 300, 5, '秒', state.steep);
        h += seg('stirN', '攪拌次數', [[0, '不攪拌'], [1, '1 次'], [2, '2 次']], (state.stirs || []).length);
        h += field('press', '下壓時間', 10, 60, 5, '秒', state.press || 30, '慢壓細粉比較不會穿過濾紙');
        h += field('dilute', '壓完加水稀釋', 0, 200, 5, 'g', state.dilute || 0);
        h += check('invert', '倒置法（浸泡時不滴漏）', !!state.invert);
        break;
      case 'siphon':
        h += field('steep', '上壺浸泡時間', 30, 150, 5, '秒', state.steep);
        h += seg('stirN', '攪拌', [[1, '開始時 1 次'], [2, '開始＋關火前']], Math.max(1, (state.stirs || []).length));
        break;
      case 'coldbrew':
        h += field('hours', '浸泡時間', 4, 24, 1, '小時', state.hours);
        h += check('fridge', '放冰箱冷藏（5°C）', !!state.fridge);
        break;
      case 'espresso':
        h += `<div class="presets">${[['ristretto', 'Ristretto 1:1.5'], ['normale', 'Normale 1:2'], ['lungo', 'Lungo 1:3'], ['turbo', 'Turbo shot']].map(([k, t]) => `<button type="button" class="chip-btn" data-preset="${k}">${t}</button>`).join('')}</div>`;
        h += field('pressure', '泵壓', 3, 12, 0.5, 'bar', state.pressure);
        h += field('preinf', '低壓預浸', 0, 15, 1, '秒', state.preinf || 0);
        h += select('prep', '布粉與填壓', Object.entries(PREP), state.prep);
        break;
      case 'moka':
        h += seg('heat', '火力', [['low', '小火'], ['med', '中火'], ['high', '大火']], state.heat);
        h += check('hotStart', '下壺直接倒熱水', !!state.hotStart);
        break;
      case 'turkish':
        h += seg('boils', '起泡次數', [[1, '1 次'], [2, '2 次'], [3, '3 次']], state.boils);
        h += seg('heat', '火力', [['low', '小火'], ['med', '中火'], ['high', '大火']], state.heat);
        h += seg('sugar', '糖', [['none', '無糖 sade'], ['mid', '適中 orta'], ['sweet', '甜 şekerli']], state.sugar);
        break;
      case 'phin':
        h += seg('tamp', '壓板', [['light', '輕放'], ['firm', '壓緊']], state.tamp);
        h += check('milk', '杯底加煉乳（cà phê sữa）', !!state.milk);
        h += scheduleEditor(m);
        break;
      case 'colddrip':
        h += field('dripRate', '滴速', 0.3, 3, 0.1, '滴／秒', state.dripRate, '每滴約 0.05 g');
        break;
      default:
        h += scheduleEditor(m);
    }
    return h;
  }

  const TEMPLATES = {
    three: { name: '三段式', fn: w => [[0, 0.16], [45, 0.42], [90, 0.42]] },
    four6: { name: '4:6 法', fn: w => [[0, 0.1667], [45, 0.2333], [90, 0.2], [130, 0.2], [165, 0.2]] },
    five: { name: '五段等量', fn: w => [[0, 0.2], [40, 0.2], [80, 0.2], [120, 0.2], [160, 0.2]] },
    one: { name: '悶蒸＋一刀流', fn: w => [[0, 0.14], [40, 0.86]] }
  };
  function scheduleEditor(m) {
    const valve = m.id === 'switch';
    const sum = state.schedule.reduce((s, p) => s + p.g, 0);
    let h = `<div class="sched-tools">${Object.entries(TEMPLATES).map(([k, t]) => `<button type="button" class="chip-btn" data-template="${k}">${t.name}</button>`).join('')}</div>`;
    h += `<div class="sched-wrap"><table class="sched"><thead><tr><th>#</th><th>開始</th><th>水量</th><th>水溫</th><th>手法</th>${valve ? '<th>閥門</th>' : ''}<th><span class="sr">刪除</span></th></tr></thead><tbody>`;
    state.schedule.forEach((p, i) => {
      h += `<tr><td class="idx">${i + 1}</td>
        <td><input type="number" aria-label="第 ${i + 1} 段開始秒數" data-row="${i}" data-col="t" value="${p.t}" min="0" step="1"><span class="u">s</span></td>
        <td><input type="number" aria-label="第 ${i + 1} 段水量" data-row="${i}" data-col="g" value="${p.g}" min="1" step="1"><span class="u">g</span></td>
        <td><input type="number" aria-label="第 ${i + 1} 段水溫" data-row="${i}" data-col="temp" value="${p.temp != null ? p.temp : ''}" placeholder="${state.temp}" min="60" max="100" step="1"><span class="u">°</span></td>
        <td><select aria-label="第 ${i + 1} 段手法" data-row="${i}" data-col="style">${Object.entries(D.STYLE_NAMES).map(([k, n]) => `<option value="${k}" ${(p.style || 'spiral') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        ${valve ? `<td><select aria-label="第 ${i + 1} 段閥門" data-row="${i}" data-col="valve"><option value="" ${!p.valve ? 'selected' : ''}>維持</option><option value="close" ${p.valve === 'close' ? 'selected' : ''}>關</option><option value="open" ${p.valve === 'open' ? 'selected' : ''}>開</option></select></td>` : ''}
        <td><button type="button" class="icon-btn" data-delrow="${i}" aria-label="刪除第 ${i + 1} 段" ${state.schedule.length < 2 ? 'disabled' : ''}>×</button></td></tr>`;
    });
    h += `</tbody></table></div><div class="sched-foot"><button type="button" class="link-btn" data-addrow="1">＋ 加一段注水</button><span>合計 ${sum} g</span></div>`;
    if (valve) h += `<p class="hint">閥門「關」＝浸泡，「開」＝滴濾。最後一段之後的開閥時間：<input class="inline-num" type="number" data-k="valveOpenAt" value="${valveOpenAt()}" min="0" step="5" aria-label="最後開閥秒數"> 秒</p>`;
    return h;
  }
  function valveOpenAt() { const e = (state.events || []).find(x => x.type === 'valve' && x.open); return e ? e.t : ''; }

  function updateRatioNote() {
    const el = $('#ratio-note'); if (!el) return;
    const m = B.method(state);
    const r = m.family === 'espresso' ? state.yield / state.dose : state.water / state.dose;
    el.textContent = '粉水比 1:' + r.toFixed(r < 4 ? 2 : 1);
  }

  /* ---------- 面板事件 ---------- */
  function onPanelInput(e) {
    const t = e.target;
    if (t.dataset.k) {
      const k = t.dataset.k; let v = parseFloat(t.value);
      if (isNaN(v)) return;
      setParam(k, v);
      const pair = t.type === 'range' ? $('#n-' + k) : $('#f-' + k);
      if (pair && pair !== t) pair.value = v;
      if (k === 'restDays') { const hint = t.closest('.field').querySelector('.field-hint'); if (hint) hint.textContent = v < 4 ? '還在大量排氣' : v > 30 ? '香氣開始流失' : '賞味期內'; }
      updateRatioNote();
      scheduleRecompute(e.type === 'change');
    }
    if (t.dataset.row != null && e.type === 'change') {
      const i = +t.dataset.row, col = t.dataset.col;
      const p = state.schedule[i];
      if (col === 'style' || col === 'valve') { if (t.value) p[col] = t.value; else delete p[col]; }
      else if (col === 'temp') { if (t.value === '') delete p.temp; else p.temp = clamp(+t.value, 60, 100); }
      else p[col] = Math.max(col === 'g' ? 1 : 0, +t.value || 0);
      state.schedule.sort((a, b) => a.t - b.t);
      state.water = state.schedule.reduce((s, q) => s + q.g, 0);
      touched(); renderPanel(); recompute();
    }
  }
  function setParam(k, v) {
    const m = B.method(state);
    if (k === 'water' && state.schedule && (m.family === 'perc' || m.id === 'switch') && m.id !== 'colddrip') {
      B.scaleWater(state, v / state.water); state.water = v;
      const sum = state.schedule.reduce((s, p) => s + p.g, 0); state.water = sum;
    } else if (k === 'grind') {
      B.shiftGrind(state, v - state.grind);
    } else if (k === 'valveOpenAt') {
      state.events = (state.events || []).filter(x => !(x.type === 'valve' && x.open)).concat([{ t: v, type: 'valve', open: true }]);
    } else state[k] = v;
    touched();
  }
  function touched() { if (state.recipe) state.modified = true; }

  function onPanelClick(e) {
    const b = e.target.closest('button, a[data-goto]');
    if (!b) return;
    if (b.dataset.goto) { e.preventDefault(); showView(b.dataset.goto, true); if (b.dataset.focus) focusRecipe(b.dataset.focus); return; }
    if (b.dataset.process) { state.process = b.dataset.process; touched(); renderPanel(); recompute(); }
    else if (b.dataset.roast) {
      state.roast = b.dataset.roast; touched();
      renderPanel(); recompute();
    } else if (b.dataset.method) {
      if (b.dataset.method === state.method) return;
      state = B.defaults(b.dataset.method, state); renderPanel(); recompute(true);
    } else if (b.dataset.seg) {
      const k = b.dataset.seg; let v = b.dataset.v;
      if (k === 'stirN') {
        const n = +v, m = B.method(state);
        state.stirs = m.id === 'siphon' ? (n >= 2 ? [5, Math.max(10, state.steep - 5)] : [5]) : n === 0 ? [] : n === 1 ? [15] : [15, 45];
      } else if (k === 'boils') state.boils = +v;
      else state[k] = v;
      touched(); renderPanel(); recompute();
    } else if (b.dataset.preset) {
      const P = { ristretto: { yield: Math.round(state.dose * 1.5), grind: 230, pressure: 9, preinf: 0 }, normale: { yield: state.dose * 2, grind: 240, pressure: 9, preinf: 0 },
        lungo: { yield: state.dose * 3, grind: 260, pressure: 9, preinf: 0 }, turbo: { yield: state.dose * 3, grind: 340, pressure: 6, preinf: 0 } }[b.dataset.preset];
      Object.assign(state, P); touched(); renderPanel(); recompute();
    } else if (b.dataset.template) {
      const t = TEMPLATES[b.dataset.template], w = state.water;
      const firstTemp = state.schedule[0] && state.schedule[0].temp;
      state.schedule = t.fn(w).map(([tt, fr], i) => {
        const o = { t: tt, g: Math.round(w * fr), style: 'spiral' };
        if (state.method === 'switch') o.valve = i === 0 ? 'close' : undefined;
        return o;
      });
      const diff = w - state.schedule.reduce((s, p) => s + p.g, 0); state.schedule[state.schedule.length - 1].g += diff;
      if (firstTemp != null) { /* 模板一律用統一水溫 */ }
      touched(); renderPanel(); recompute();
    } else if (b.dataset.addrow) {
      const last = state.schedule[state.schedule.length - 1];
      state.schedule.push({ t: last.t + 40, g: 50, style: last.style || 'spiral' });
      state.water = state.schedule.reduce((s, p) => s + p.g, 0);
      touched(); renderPanel(); recompute();
    } else if (b.dataset.delrow) {
      state.schedule.splice(+b.dataset.delrow, 1);
      state.water = state.schedule.reduce((s, p) => s + p.g, 0);
      touched(); renderPanel(); recompute();
    }
  }
  function onPanelChange(e) {
    const t = e.target;
    if (t.id === 'recipe') {
      state = t.value ? B.fromRecipe(byId(D.RECIPES, t.value)) : Object.assign(B.defaults(state.method, state), {});
      renderPanel(); recompute(true); return;
    }
    if (t.id === 'bean') {
      state.bean = t.value;
      const bean = byId(D.BEANS, t.value);
      if (!bean.common.includes(state.process)) state.process = bean.common[0];
      touched(); renderPanel(); recompute(); return;
    }
    if (t.dataset.s) { state[t.dataset.s] = t.value; touched(); renderPanel(); recompute(); return; }
    if (t.dataset.c) {
      const k = t.dataset.c;
      if (k === 'stir30') state.stirs = t.checked ? [30] : [];
      else state[k] = t.checked;
      touched(); recompute(); return;
    }
    onPanelInput(e);
  }

  let rcTimer = 0;
  function scheduleRecompute(now) { clearTimeout(rcTimer); rcTimer = setTimeout(recompute, now ? 0 : 140); }

  /* ================= 模擬與結果 ================= */
  function recompute(resetStage) {
    stopAnim();
    snap = B.clone(state);
    current = B.run(snap);
    const sm = current.sim.samples;
    maxDrain = Math.max(8, ...sm.map(p => p.drainable || 0));
    store.set(LS, state);
    renderStageStatic();
    renderResults();
  }

  function methodLabel(st) {
    const m = byId(D.METHODS, st.method), bean = byId(D.BEANS, st.bean), p = byId(D.PROCESSES, st.process), r = byId(D.ROAST_INFO, st.roast);
    return { m, bean, p, r };
  }

  function renderStageStatic() {
    const { m, bean, p, r } = methodLabel(snap);
    const rec = snap.recipe ? byId(D.RECIPES, snap.recipe) : null;
    $('#stage-title').textContent = m.name;
    $('#stage-sub').textContent = `${bean.name} · ${p.name} · ${r.name}${rec ? '　｜　' + (rec.year ? rec.year + ' ' : '') + rec.who + '：' + rec.title + (snap.modified ? '（已調整）' : '') : ''}`;
    const res = current.sim.result;
    const ro = E.ROASTS[snap.roast];
    const marks = (snap.schedule && ['perc', 'valve'].includes(m.family) && m.id !== 'colddrip') ? snap.schedule.map(s => s.t) : [];
    const lc = C.liveChart({ samples: current.sim.samples, tEnd: res.time, shares: ro.share, emax: res.emax, target: current.analysis.tgt, marks, release: current.cfg.release != null && m.id !== 'coldbrew' ? current.cfg.release : null });
    $('#live').innerHTML = lc.svg; liveX = lc.x;
    // 時間軸
    const tl = $('#tl-marks');
    tl.innerHTML = marks.map(t => `<span class="tl-mark" style="left:${(t / res.time * 100).toFixed(2)}%"></span>`).join('')
      + (current.cfg.release != null && m.id !== 'coldbrew' ? `<span class="tl-mark rel" style="left:${(current.cfg.release / res.time * 100).toFixed(2)}%"></span>` : '');
    $('#tl-end').textContent = B.fmtTime(res.time);
    drawFrame(res.time);
  }

  function sampleAt(t) {
    const sm = current.sim.samples;
    let lo = 0, hi = sm.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sm[mid].t < t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function styleAt(t) {
    let st = 'spiral';
    (snap.schedule || []).forEach(p => { if (t >= p.t) st = p.style || 'spiral'; });
    return st;
  }

  function drawFrame(t) {
    const m = byId(D.METHODS, snap.method), res = current.sim.result, sm = current.sim.samples;
    const i = sampleAt(t), s = sm[i], pv = sm[Math.max(0, i - 3)];
    const dt = Math.max(1e-6, s.t - pv.t);
    const flowRate = Math.max(0, (s.cup - pv.cup) / dt);
    const fam = m.family;
    const end = t >= res.time - 1e-6;
    const rel = current.cfg.release;
    const released = rel != null && t >= rel;
    const slurry = s.poured > 1 ? (s.eyTot / 100 * snap.dose) / s.poured * 100 : 0;
    const ds = {
      t: t / (res.time > 3600 ? 3600 : res.time > 400 ? 20 : 1) + (anim ? performance.now() / 1000 : 0.35),
      pour: !end && s.inRate > 0.05 && ['perc', 'valve', 'immersion'].includes(fam) && m.id !== 'colddrip',
      rate: s.inRate, style: styleAt(t),
      level: clamp((s.drainable || 0) / maxDrain, 0, 1) * 0.92,
      bedWet: clamp(s.poured / (2 * snap.dose), 0, 1),
      cupFrac: res.beverage > 0 ? s.cup / (m.family === 'espresso' ? snap.yield : res.beverage) : 0,
      tds: s.tds || slurry, slurryTds: slurry,
      flow: !end && flowRate > 0.02, flowRate, valveOpen: s.valveOpen,
      prog: t / res.time, bloom: !end && s.poured > 0 && s.poured < 2.6 * snap.dose && t < 50
    };
    if (fam === 'immersion') {
      ds.fillFrac = clamp(s.poured / snap.water, 0, 1);
      ds.released = released; ds.releaseProg = released ? clamp((t - rel) / Math.max(1, res.time - rel), 0, 1) : 0;
      ds.settle = clamp(t / (rel || 240), 0, 1);
      if (m.id === 'siphon') { ds.upFrac = released ? 1 - ds.releaseProg : clamp(s.poured / snap.water, 0, 1); ds.downFrac = ds.releaseProg; }
      if (m.id === 'coldbrew') { ds.prog = t / res.time; ds.hoursLabel = (t / 3600).toFixed(1) + ' / ' + (res.time / 3600).toFixed(1) + ' 小時'; ds.fridge = snap.fridge; }
      if (!released) ds.cupFrac = 0;
    }
    if (fam === 'espresso') {
      const pre = snap.preinf || 0;
      ds.pressure = end ? 0 : t < pre ? 2.5 : Math.min(snap.pressure, 2.5 + (t - pre) * 3);
      ds.instTds = s.cup - pv.cup > 0.01 ? clamp(((s.ey - pv.ey) * snap.dose / 100) / (s.cup - pv.cup) * 100, 1, 25) : 9;
    }
    if (m.id === 'moka') { ds.boilerFrac = 1 - s.poured / snap.water; ds.heat = snap.heat; ds.sputter = s.sputter; ds.done = end; }
    if (m.id === 'turkish') { ds.T = s.T; ds.heating = !end && s.T > pv.T + 0.005; ds.done = end; ds.cupFrac = end ? 1 : 0; ds.tds = res.tds; }
    if (m.id === 'phin') ds.milk = snap.milk;
    if (m.id === 'colddrip') { ds.boilerFrac = 1 - s.poured / snap.water; ds.pour = !end && s.inRate > 0; }
    lastT = t;
    renderArt(m.draw, ds);
    // 讀數
    const fmtT = B.fmtTime(t);
    $('#ro-time').textContent = fmtT;
    $('#ro-pour').textContent = (m.family === 'espresso' ? s.poured : s.poured).toFixed(0);
    $('#ro-cup').textContent = s.cup.toFixed(s.cup < 100 ? 1 : 0);
    $('#ro-temp').textContent = s.T.toFixed(1);
    $('#ro-tds').textContent = s.tds.toFixed(s.tds >= 3 ? 1 : 2);
    $('#ro-ey').textContent = s.ey.toFixed(1);
    const pl = $('#live-play'); if (pl && liveX) { const x = liveX(Math.min(t, res.time)); pl.setAttribute('x1', x); pl.setAttribute('x2', x); }
    $('#tl-fill').style.width = (clamp(t / res.time, 0, 1) * 100).toFixed(2) + '%';
    $('#tl-now').textContent = fmtT;
  }

  // 器具插圖：有 3D 模型且瀏覽器跑得動就用 3D（js/stage3d.js），否則用 draw.js 的 SVG
  function renderArt(type, ds) {
    const S3 = window.Stage3D;
    const has3d = !!(S3 && S3.ready && !S3.failed && S3.types.includes(type));
    const on = use3d && has3d;
    $('#stage-3d').hidden = !on; $('#stage-svg').hidden = on;
    if (on) S3.update(type, ds);
    else $('#stage-svg').innerHTML = DR.svg(type, ds, 'brewer', 'stage');
    const b = $('#btn-3d'); b.hidden = !has3d; b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '3D' : '2D';
  }

  function playDuration(tEnd, m) {
    if (m.id === 'coldbrew') return 9000;
    if (m.family === 'espresso') return Math.max(7000, tEnd * 280);
    return clamp(tEnd * 55, 8000, 16000);
  }
  function play() {
    stopAnim();
    const m = byId(D.METHODS, snap.method), tEnd = current.sim.result.time;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { drawFrame(tEnd); finishBrew(); return; }
    const dur = playDuration(tEnd, m) / speed;
    const t0 = performance.now();
    $('#stage').classList.add('playing');
    $('#results').classList.add('pending');
    $('#btn-play').textContent = '沖煮中…';
    const stepFn = now => {
      const k = Math.min(1, (now - t0) / dur);
      drawFrame(k * tEnd);
      if (k < 1) anim = requestAnimationFrame(stepFn);
      else { anim = null; finishBrew(); }
    };
    anim = requestAnimationFrame(stepFn);
  }
  function stopAnim() {
    if (anim) cancelAnimationFrame(anim); anim = null;
    const st = $('#stage'); if (st) st.classList.remove('playing');
    const rs = $('#results'); if (rs) rs.classList.remove('pending');
    const bp = $('#btn-play'); if (bp) bp.textContent = '▶ 開始沖煮';
  }
  function finishBrew() {
    stopAnim();
    const r = current.sim.result, a = current.analysis;
    const { m, bean } = methodLabel(snap);
    histN++;
    brews.unshift({ n: histN, label: `${m.name}・${bean.name}`, method: m.name, bean: bean.name, ey: r.ey, tds: r.tds, time: r.time, score: a.score, target: m.target, state: B.clone(snap) });
    if (brews.length > 8) brews.pop();
    renderResults();
    const rs = $('#results'); rs.classList.remove('flash'); void rs.offsetWidth; rs.classList.add('flash');
  }

  function renderResults() {
    const r = current.sim.result, a = current.analysis, m = byId(D.METHODS, snap.method);
    const bean = byId(D.BEANS, snap.bean), proc = byId(D.PROCESSES, snap.process), roast = byId(D.ROAST_INFO, snap.roast);
    const pot = {};
    ['acid', 'sweet', 'body', 'bitter', 'aroma', 'clarity'].forEach(k => { pot[k] = bean.p[k] + (proc.d[k] || 0) + (roast.d[k] || 0); });
    pot.finish = 0.35 * pot.sweet + 0.25 * pot.clarity + 0.2 * pot.body + (bean.quality - 84) * 0.25;
    const ratio = m.family === 'espresso' ? '1:' + (snap.yield / snap.dose).toFixed(2) : '1:' + (snap.water / snap.dose).toFixed(1);
    const sevCls = { good: 'ok', warn: 'warn', bad: 'bad' };
    const zoneCls = a.extraction === 'ok' && a.strength === 'ok' ? 'ok' : (a.under > 2 || a.over > 2) ? 'bad' : 'warn';
    const hist = brews.filter(h => h.target === m.target).slice(0, 6).map(h => ({ n: h.n, ey: h.ey, tds: h.tds, label: h.label }));
    let h = `<div class="res-top">
      <div class="score"><div class="score-num">${a.score.toFixed(a.score % 1 ? 2 : 0).replace(/\.?0+$/, '')}</div><div class="score-meta"><span class="grade">${a.grade}</span><span class="zone ${zoneCls}">${a.zone}</span></div><div class="score-cap">杯測式風味分數（豆子潛力 ${bean.quality}）</div></div>
      <dl class="stats">
        <div><dt>萃取率 EY</dt><dd>${r.ey.toFixed(1)}<small>%</small></dd><span class="target">目標 ${a.tgt.ey[0]}–${a.tgt.ey[1]}</span></div>
        <div><dt>濃度 TDS</dt><dd>${r.tds.toFixed(r.tds >= 3 ? 1 : 2)}<small>%</small></dd><span class="target">目標 ${a.tgt.tds[0]}–${a.tgt.tds[1]}</span></div>
        <div><dt>總時間</dt><dd>${B.fmtTime(r.time)}</dd><span class="target">${m.info.time}</span></div>
        <div><dt>飲品量</dt><dd>${r.beverage.toFixed(0)}<small>g</small></dd><span class="target">粉水比 ${ratio}</span></div>
        <div><dt>粉層平均溫度</dt><dd>${r.avgT.toFixed(1)}<small>°C</small></dd><span class="target">${m.target === 'cold' ? '低溫萃取' : '壺溫 ' + snap.temp + '°C'}</span></div>
        <div><dt>總溶出量</dt><dd>${r.eyTotal.toFixed(1)}<small>%</small></dd><span class="target">含留在粉層的 ${(r.eyTotal - r.ey).toFixed(1)}%</span></div>
      </dl></div>`;
    h += `<div class="res-grid">
      <figure class="fig"><figcaption><span>沖煮控制圖</span><span class="cap-note">${esc(a.tgt.label)}・斜線為粉水比</span></figcaption>${C.controlChart({ target: a.tgt, current: { ey: r.ey, tds: r.tds }, history: hist, ratios: C.ratioLines(m.target, (m.phys && m.phys.absorb) || (m.family === 'espresso' ? 0 : 2)) })}</figure>
      <figure class="fig"><figcaption><span>風味結構</span><span class="cap-note">虛線：這支豆在理想萃取下的潛力</span></figcaption>${C.radar(a.s, pot)}</figure></div>`;
    h += `<div class="tasting"><h4>品飲描述</h4><p>${esc(a.notes.text)}</p><div class="chips">${a.notes.top.map(n => `<span class="chip">${esc(n)}</span>`).join('')}</div></div>`;
    h += `<div class="advice"><h4>調整建議</h4><ul>${a.advice.map((x, i) => `<li class="adv ${sevCls[x.sev]}"><div class="adv-body"><strong>${esc(x.title)}</strong><p>${esc(x.text)}</p></div>${x.fix ? `<button type="button" class="btn small" data-fix="${i}">${esc(x.fix.label)}</button>` : ''}</li>`).join('')}</ul></div>`;
    h += `<div class="hist"><h4>沖煮紀錄</h4>${brews.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>沖煮法・豆子</th><th>EY</th><th>TDS</th><th>時間</th><th>分數</th><th></th></tr></thead><tbody>${brews.map((x, i) => `<tr><td>${x.n}</td><td>${esc(x.label)}</td><td>${x.ey.toFixed(1)}</td><td>${x.tds.toFixed(2)}</td><td>${B.fmtTime(x.time)}</td><td>${x.score}</td><td><button type="button" class="link-btn" data-restore="${i}">還原</button></td></tr>`).join('')}</tbody></table></div><p class="hint">同一種目標區間的紀錄會以編號畫在控制圖上，方便比較。</p>` : '<p class="hint">按「開始沖煮」看完一次萃取後，結果會記錄在這裡，並以編號畫在控制圖上。</p>'}</div>`;
    $('#results').innerHTML = h;
  }

  function onResultsClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fix != null) {
      const x = current.analysis.advice[+b.dataset.fix];
      if (x && x.fix) { x.fix.apply(state); touched(); renderPanel(); recompute(); play(); }
    } else if (b.dataset.restore != null) {
      state = B.clone(brews[+b.dataset.restore].state); renderPanel(); recompute();
    }
  }

  /* ================= 圖鑑、豆子、冠軍 ================= */
  function renderGear() {
    const cats = [['all', '全部']].concat(Object.entries(CAT));
    $('#gear-filter').innerHTML = cats.map(([k, n]) => `<button type="button" class="chip-btn" data-cat="${k}" aria-pressed="${k === 'all'}">${n}</button>`).join('');
    $('#gear-grid').innerHTML = D.METHODS.map(m => {
      const i = m.info, tg = D.TARGETS[m.target];
      return `<article class="gear" data-cat="${m.cat}" id="gear-${m.id}">
        <div class="gear-art">${GEAR_IMG.includes(m.draw) ? `<img src="img/gear/${m.draw}.webp" alt="${esc(m.name)} 的 3D 模型" loading="lazy" width="640" height="640">` : DR.svg(m.draw, DR.staticState(m.draw), 'brewer', 'g-' + m.id)}</div>
        <div class="gear-body"><div class="eyebrow-sm">${CAT[m.cat]}</div><h3>${esc(m.name)}</h3><p class="gear-origin">${esc(i.origin)}</p>
        <p>${esc(i.principle)}</p>
        <dl class="kv"><div><dt>粉水比</dt><dd>${esc(i.ratio)}</dd></div><div><dt>研磨</dt><dd>${m.grindRange[0]}–${m.grindRange[1]} µm</dd></div><div><dt>時間</dt><dd>${esc(i.time)}</dd></div><div><dt>目標 TDS</dt><dd>${tg.tds[0]}–${tg.tds[1]}%</dd></div></dl>
        <p class="gear-flavor"><strong>風味</strong>${esc(i.flavor)}</p>
        <details><summary>技巧與常見錯誤</summary><h4>技巧</h4><ul>${i.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul><h4>常見錯誤</h4><ul>${i.mistakes.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
        <button type="button" class="btn ghost" data-brew-method="${m.id}">在吧台沖這個</button></div></article>`;
    }).join('');
  }

  function bars(p) {
    const L = [['acid', '酸'], ['sweet', '甜'], ['body', '醇厚'], ['bitter', '苦'], ['aroma', '香氣'], ['clarity', '乾淨']];
    return `<div class="bars">${L.map(([k, n]) => `<div class="bar-row"><span>${n}</span><span class="bar"><i style="width:${(p[k] * 10).toFixed(0)}%"></i></span><span class="bar-v">${p[k].toFixed(1)}</span></div>`).join('')}</div>`;
  }
  function renderBeans() {
    $('#bean-grid').innerHTML = D.BEANS.map(b => `<article class="bean-card">
      <div class="bean-head"><h3>${esc(b.name)}</h3><span class="en">${esc(b.en)}</span></div>
      <dl class="kv"><div><dt>產區</dt><dd>${esc(b.region)}</dd></div><div><dt>海拔</dt><dd>${esc(b.alt)}</dd></div><div><dt>品種</dt><dd>${esc(b.variety)}</dd></div><div><dt>常見處理</dt><dd>${b.common.map(c => byId(D.PROCESSES, c).name).join('、')}</dd></div></dl>
      ${bars(b.p)}<div class="chips small">${b.notes.map(n => `<span class="chip">${esc(n[0])}</span>`).join('')}</div>
      <p>${esc(b.story)}</p><button type="button" class="btn ghost" data-brew-bean="${b.id}">用這支豆沖</button></article>`).join('');
    const dl = (v) => `<span class="delta ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v.toFixed(1)}</span>`;
    $('#process-grid').innerHTML = D.PROCESSES.map(p => `<article class="proc-card">
      <div class="proc-head"><h3>${p.name}</h3><span class="en">${esc(p.en)}</span></div>
      <p>${esc(p.summary)}</p>
      <ol class="steps">${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="deltas"><span>酸 ${dl(p.d.acid)}</span><span>甜 ${dl(p.d.sweet)}</span><span>醇厚 ${dl(p.d.body)}</span><span>乾淨 ${dl(p.d.clarity)}</span><span>發酵感 ${dl(p.d.ferment)}</span></div>
      <dl class="kv"><div><dt>時間</dt><dd>${esc(p.time)}</dd></div><div><dt>風險</dt><dd>${esc(p.risk)}</dd></div></dl></article>`).join('');
    $('#roast-strip').innerHTML = D.ROAST_INFO.map(r => `<article class="roast-card" style="--sw:${r.color}"><div class="roast-chip"><span>#${r.tile}</span></div>
      <h3>${r.name}</h3><div class="en">${esc(r.en)}</div><p class="drop">${esc(r.drop)}</p><p>${esc(r.desc)}</p><p class="temp">建議水溫 ${r.temp[0]}–${r.temp[1]}°C</p></article>`).join('');
  }

  function recipeParams(r) {
    const m = byId(D.METHODS, r.method), c = r.cfg;
    const items = [['器具', m.name], ['粉量', c.dose + ' g']];
    if (m.family === 'espresso') items.push(['出杯', c.yield + ' g']); else items.push(['水量', c.water + ' g']);
    const temps = (c.schedule || []).map(p => p.temp).filter(x => x != null);
    items.push(['水溫', temps.length ? Array.from(new Set(temps.concat([c.temp]))).sort((a, b) => b - a).join(' / ') + '°C' : c.temp + '°C']);
    items.push(['研磨', c.grindSplit ? c.grindSplit.map(p => p.d).join(' + ') + ' µm' : (r.grindKnown ? '' : '約 ') + c.grind + ' µm' + (r.grindKnown ? '' : '（推估）')]);
    return `<dl class="kv tight">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }
  function renderChampions() {
    $('#recipe-grid').innerHTML = D.RECIPES.map(r => {
      const bean = byId(D.BEANS, r.bean), p = byId(D.PROCESSES, r.process), ro = byId(D.ROAST_INFO, r.roast);
      return `<article class="recipe" id="recipe-${r.id}">
        <div class="recipe-top"><span class="year">${r.year || '—'}</span><span class="comp">${esc(COMP[r.comp] || r.comp)}</span></div>
        <h3>${esc(r.who)}<span class="en">${r.en !== r.who ? esc(r.en) + '・' : ''}${esc(r.country)}</span></h3>
        <div class="recipe-title">${esc(r.title)}</div>
        ${recipeParams(r)}
        <ol class="steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        <p>${esc(r.idea)}</p>
        <p class="meta">模擬搭配：${esc(bean.name)}・${p.name}・${ro.name}<br>資料來源：${esc(r.src)}</p>
        <button type="button" class="btn" data-load-recipe="${r.id}">載入吧台模擬</button></article>`;
    }).join('');
    $('#wbrc-list').innerHTML = D.HISTORY.wbrc.map(([y, n, c]) => `<li><span class="y">${y}</span><span class="n">${esc(n)}</span><span class="c">${esc(c)}</span></li>`).join('');
    $('#wbc-list').innerHTML = D.HISTORY.wbc.map(([y, n, c, note]) => `<li><span class="y">${y}</span><span class="n">${esc(n)}</span><span class="c">${esc(c)}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}</li>`).join('');
  }
  function focusRecipe(id) {
    const el = $('#recipe-' + id); if (!el) return;
    setTimeout(() => { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }, 80);
  }

  /* ================= 理論圖 ================= */
  function renderTheory() {
    // 萃取順序
    const st = B.defaults('v60', { bean: 'huila', roast: 'medium' });
    const run = B.run(st);
    const sm = run.sim.samples;
    const ser = (k, cls, label, dy) => ({ cls, label, dy, pts: sm.map(p => [p.t, p[k] * 100]) });
    $('#fig-order').innerHTML = C.lineChart({ x: [0, run.sim.result.time], y: [0, 100], aria: '三類成分的萃取進度', xFmt: v => C.fmtT(v), xLabel: '時間（V60，15 g：250 g，93°C，中焙）', yLabel: '已溶出比例（%）',
      series: [ser('xa', 'l-acid-line', '酸與芳香', 0), ser('xs', 'l-sweet-line', '糖與梅納產物', 0), ser('xb', 'l-bitter-line', '苦味重分子', 0)] });
    // 溫度
    const temps = []; for (let T = 60; T <= 100; T += 1) temps.push(T);
    $('#fig-temp').innerHTML = C.lineChart({ x: [60, 100], y: [0, 1.3], aria: '溫度對萃取速度的影響', xLabel: '水溫（°C）', yLabel: '相對萃取速度（93°C = 1）', yFmt: v => v.toFixed(1),
      vlines: [{ x: 93 }], series: [['A', 'l-acid-line', '酸與芳香'], ['S', 'l-sweet-line', '糖與梅納'], ['B', 'l-bitter-line', '苦味重分子']].map(([p, cls, label], i) => ({ cls, label, dy: [-8, 4, 14][i], pts: temps.map(T => [T, E.arr(p, T)]) })) });
    // 研磨
    $('#fig-grind').innerHTML = C.grindLadder(D.METHODS);
    $('#fig-dist').innerHTML = C.distribution();
    // 烘焙曲線
    const bt = []; for (let s = 0; s <= 660; s += 10) {
      let T; if (s <= 60) T = 200 - 110 * (s / 60) + 0; else T = 90 + 117 * (1 - Math.exp(-(s - 60) / 330)) / (1 - Math.exp(-600 / 330));
      bt.push([s / 60, T]);
    }
    $('#fig-roast').innerHTML = C.lineChart({ x: [0, 11], y: [80, 240], aria: '典型淺中焙的豆溫曲線', xLabel: '烘焙時間（分鐘）', yLabel: '豆溫（°C）', xTicks: [0, 2, 4, 6, 8, 10],
      bands: [{ x0: 1, x1: 4.6, cls: 'b-dry', label: '脫水' }, { x0: 4.6, x1: 8.7, cls: 'b-maillard', label: '梅納反應' }, { x0: 8.7, x1: 11, cls: 'b-dev', label: '發展' }],
      hlines: [{ y: 150, label: '轉黃 ~150°C' }, { y: 196, label: '一爆 ~196°C' }, { y: 224, label: '二爆 ~224°C' }],
      series: [{ cls: 'l-roast', pts: bt }], points: [{ x: 1, y: 90, label: '回溫點', dy: 16 }, { x: 11, y: bt[bt.length - 1][1], label: '出爐', dx: -6, anchor: 'end', dy: -10 }] });
    renderCtlDemo();
  }
  function renderCtlDemo() {
    const r = +$('#demo-ratio').value, ey = +$('#demo-ey').value;
    const tds = ey / (r - 2 + ey / 100);
    $('#demo-ratio-v').textContent = '1:' + r.toFixed(1);
    $('#demo-ey-v').textContent = ey.toFixed(1) + '%';
    const tgt = D.TARGETS.filter;
    const zone = (ey < tgt.ey[0] ? '萃取不足' : ey > tgt.ey[1] ? '過度萃取' : '萃取適中') + '・' + (tds < tgt.tds[0] ? '偏淡' : tds > tgt.tds[1] ? '偏濃' : '濃度適中');
    $('#demo-out').innerHTML = `TDS <b>${tds.toFixed(2)}%</b>　${zone}`;
    $('#fig-ctl').innerHTML = C.controlChart({ target: tgt, current: { ey, tds }, ratios: C.ratioLines('filter', 2).concat([{ label: '1:' + r.toFixed(1), fn: e => e / (r - 2 + e / 100) }]) });
  }

  /* ================= 啟動 ================= */
  function setTheme(v) {
    const root = document.documentElement;
    if (v === 'light' || v === 'dark') root.setAttribute('data-theme', v); else root.removeAttribute('data-theme');
    const b = $('#theme-btn'); if (b) { b.dataset.mode = v || 'system'; b.setAttribute('aria-label', '切換配色：目前' + ({ light: '淺色', dark: '深色', system: '跟隨系統' }[v || 'system'])); b.querySelector('span').textContent = { light: '淺色', dark: '深色', system: '自動' }[v || 'system']; }
    store.set(LS_THEME, v || 'system');
  }

  function init() {
    setTheme(store.get(LS_THEME));
    $('#theme-btn').addEventListener('click', () => { const cur = $('#theme-btn').dataset.mode; setTheme(cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system'); });
    $$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view, true)));
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]');
      if (g && !g.closest('#panel')) { e.preventDefault(); showView(g.dataset.goto, true); if (g.dataset.focus) focusRecipe(g.dataset.focus); return; }
      const bm = e.target.closest('[data-brew-method]');
      if (bm) { state = B.defaults(bm.dataset.brewMethod, state); renderPanel(); recompute(); showView('sim', true); return; }
      const bb = e.target.closest('[data-brew-bean]');
      if (bb) { state.bean = bb.dataset.brewBean; const bean = byId(D.BEANS, state.bean); if (!bean.common.includes(state.process)) state.process = bean.common[0]; touched(); renderPanel(); recompute(); showView('sim', true); return; }
      const lr = e.target.closest('[data-load-recipe]');
      if (lr) { state = B.fromRecipe(byId(D.RECIPES, lr.dataset.loadRecipe)); renderPanel(); recompute(); showView('sim', true); setTimeout(play, 500); return; }
      const cat = e.target.closest('[data-cat]');
      if (cat) { $$('#gear-filter .chip-btn').forEach(x => x.setAttribute('aria-pressed', x === cat)); $$('.gear').forEach(g2 => { g2.hidden = !(cat.dataset.cat === 'all' || g2.dataset.cat === cat.dataset.cat); }); }
    });
    const panel = $('#panel');
    panel.addEventListener('input', onPanelInput);
    panel.addEventListener('change', onPanelChange);
    panel.addEventListener('click', onPanelClick);
    $('#results').addEventListener('click', onResultsClick);
    $('#btn-play').addEventListener('click', () => { if (anim) { stopAnim(); drawFrame(current.sim.result.time); } else play(); });
    $('#btn-skip').addEventListener('click', () => { drawFrame(current.sim.result.time); finishBrew(); });
    $('#speed').addEventListener('change', e => { speed = +e.target.value; });
    $('#btn-3d').addEventListener('click', () => { use3d = !use3d; store.set(LS_3D, use3d); if (current) drawFrame(lastT); });
    window.addEventListener('stage3d', () => { if (current) drawFrame(lastT); });
    $('#tl-track').addEventListener('click', e => {
      const rc = e.currentTarget.getBoundingClientRect();
      stopAnim(); drawFrame(clamp((e.clientX - rc.left) / rc.width, 0, 1) * current.sim.result.time);
    });
    $('#demo-ratio').addEventListener('input', renderCtlDemo);
    $('#demo-ey').addEventListener('input', renderCtlDemo);
    $('#stat-methods').textContent = D.METHODS.length;
    $('#stat-beans').textContent = D.BEANS.length;
    $('#stat-proc').textContent = D.PROCESSES.length;
    $('#stat-recipes').textContent = D.RECIPES.length;
    renderPanel(); recompute();
    renderGear(); renderBeans(); renderChampions(); renderTheory();
    const h = (location.hash || '').replace('#', '');
    showView(VIEWS.includes(h) ? h : 'sim', false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
