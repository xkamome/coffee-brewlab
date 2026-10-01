/* 把吧台設定轉成引擎參數，並把萃取結果轉成風味、分數與調整建議 */
(function (root) {
  'use strict';
  const D = root.COFFEE, E = root.CoffeeEngine;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const byId = (arr, id) => arr.find(x => x.id === id);
  const ROAST_ORDER = ['xlight', 'light', 'mlight', 'medium', 'mdark', 'dark', 'xdark'];

  function method(state) { return byId(D.METHODS, state.method); }
  function target(state) { return D.TARGETS[method(state).target]; }

  function buildCfg(state) {
    const m = method(state);
    const bean = byId(D.BEANS, state.bean);
    const phys = Object.assign({}, m.phys || {}, state.phys || {});
    const cfg = {
      method: { family: m.family, phys, kAdj: m.kAdj || 1 },
      dose: state.dose, water: state.water, temp: state.temp, grind: state.grind,
      grindSplit: state.grindSplit || null, grinder: state.grinder, waterProfile: state.waterProfile,
      roast: state.roast, restDays: state.restDays, beanSol: bean.sol || 1
    };
    const stirs = (state.stirs || []).map(t => ({ t, type: 'stir' }));
    switch (m.id) {
      case 'clever':
        cfg.schedule = [{ t: 0, g: state.water, dur: 15, style: 'spiral', valve: 'close' }];
        cfg.events = stirs.concat([{ t: state.steep, type: 'valve', open: true }]);
        break;
      case 'frenchpress': {
        cfg.schedule = [{ t: 0, g: state.water, dur: 15, style: 'stir' }];
        cfg.events = stirs.slice();
        if (state.mode === 'hoffmann') {
          cfg.events.push({ t: state.steep, type: 'stir', boost: 0.4 });
          cfg.release = state.steep + (state.wait || 300);
        } else cfg.release = state.steep;
        break;
      }
      case 'aeropress':
        cfg.schedule = [{ t: 0, g: state.water, dur: 10, style: 'stir' }];
        cfg.events = stirs.slice();
        if (state.swirlAt) cfg.events.push({ t: state.swirlAt, type: 'swirl' });
        cfg.release = state.steep;
        phys.releaseTau = Math.max(3, (state.press || 30) / 3);
        break;
      case 'siphon':
        cfg.schedule = [{ t: 0, g: state.water, dur: 6, style: 'center' }];
        cfg.events = stirs;
        cfg.release = state.steep;
        break;
      case 'coldbrew': {
        cfg.schedule = [{ t: 0, g: state.water, dur: 60, style: 'stir' }];
        cfg.events = stirs;
        cfg.release = state.hours * 3600;
        cfg.fixedT = state.fridge ? 5 : state.temp;
        cfg.estT = cfg.release + 400; cfg.maxT = cfg.release + 4000;
        break;
      }
      case 'colddrip': {
        const rate = (state.dripRate || 1) * 0.05;           // 每滴約 0.05 g
        const rest = Math.max(0, state.water - 50);
        cfg.schedule = [{ t: 0, g: Math.min(50, state.water), dur: 10, style: 'spiral' }, { t: 60, g: rest, dur: rest / rate, style: 'center' }];
        cfg.fixedT = state.temp;
        cfg.estT = 60 + rest / rate + 300; cfg.maxT = cfg.estT + 3000;
        break;
      }
      case 'phin':
        cfg.schedule = state.schedule;
        phys.tau0 = (m.phys.tau0) * (state.tamp === 'firm' ? 1.8 : 1);
        break;
      case 'espresso':
        Object.assign(cfg, { yield: state.yield, pressure: state.pressure, preinf: state.preinf, prep: state.prep });
        break;
      case 'moka':
        Object.assign(cfg, { heat: state.heat, hotStart: state.hotStart });
        break;
      case 'turkish':
        Object.assign(cfg, { boils: state.boils, heat: state.heat });
        break;
      default:
        cfg.schedule = state.schedule;
        cfg.events = (state.events || []).slice();
    }
    return cfg;
  }

  function run(state) {
    const cfg = buildCfg(state);
    const sim = E.simulate(cfg);
    const r = sim.result;
    if (state.method === 'aeropress' && state.dilute > 0) {
      const solids = r.tds / 100 * r.beverage;
      r.beverage += state.dilute;
      r.tds = solids / r.beverage * 100;
    }
    return { cfg, sim, analysis: analyze(state, r) };
  }

  /* ---------- 風味模型 ---------- */
  const FILTER = {
    paper:      { body: 0,    clarity: 0.5, name: '濾紙' },
    thickpaper: { body: -0.8, clarity: 1.2, name: '厚濾紙' },
    cloth:      { body: 0.3,  clarity: 0,   name: '濾布' },
    metal:      { body: 1.3,  clarity: -1.5, name: '金屬濾網' },
    none:       { body: 2.5,  clarity: -3.5, name: '不過濾' }
  };

  function analyze(state, r) {
    const m = method(state), tgt = target(state);
    const bean = byId(D.BEANS, state.bean), proc = byId(D.PROCESSES, state.process), roast = byId(D.ROAST_INFO, state.roast);
    const water = E.WATERS[state.waterProfile] || E.WATERS.sca;
    const ri = ROAST_ORDER.indexOf(state.roast);
    const light = 1 - ri / 6;
    const base = {};
    ['acid', 'sweet', 'body', 'bitter', 'aroma', 'clarity'].forEach(k => {
      base[k] = bean.p[k] + (proc.d[k] || 0) + (roast.d[k] || 0);
    });
    const ferment = proc.d.ferment || 0;
    const ey = r.ey, tds = r.tds;
    const under = Math.max(0, tgt.ey[0] - ey), over = Math.max(0, ey - tgt.ey[1]);
    const tMid = (tgt.tds[0] + tgt.tds[1]) / 2;
    const weakRel = tds < tgt.tds[0] ? (tgt.tds[0] - tds) / tgt.tds[0] : 0;
    const strongRel = tds > tgt.tds[1] ? (tds - tgt.tds[1]) / tgt.tds[1] : 0;
    const filt = FILTER[m.filter] || FILTER.paper;
    const isEsp = m.family === 'espresso';

    const astr = over * 1.3 + r.fines * 6 + r.channel * 5 + r.spread * 2 + (r.sputter ? 1 : 0);
    const s = {};
    s.acid = base.acid * (0.45 + 0.55 * r.fa) * water.acid * (1 - 0.06 * over) + under * 0.35;
    s.sweet = base.sweet * (0.25 + 0.75 * r.fs) * (1 - 0.1 * under) * (1 - 0.12 * over)
      + (m.id === 'turkish' && state.sugar !== 'none' ? (state.sugar === 'sweet' ? 2.5 : 1.3) : 0)
      + (m.id === 'phin' && state.milk ? 2.2 : 0);
    s.bitter = 1 + Math.max(0, roast.d.bitter) * 0.8 + bean.p.bitter * 0.3 + 8 * Math.max(0, r.fb - 0.38) + over * 1.0
      + (r.sputter ? 1.5 : 0) + (isEsp ? 0.8 : 0) - (state.fridge || m.target === 'cold' ? 1 : 0);
    s.body = base.body + filt.body + clamp(2.2 * Math.log2(Math.max(tds, 0.05) / tMid), -2.5, 2.5)
      + (isEsp ? 1.5 : 0) + (m.filter === 'metal' ? r.fines * 6 : 0) + (m.id === 'phin' && state.milk ? 1.5 : 0);
    s.clarity = base.clarity + filt.clarity - r.fines * 8 - r.channel * 6 - r.spread * 3 - over * 0.5 - under * 0.3 - ferment * 0.2 - water.flat * 3;
    let fresh = 0;
    const rd = r.restDays;
    if (rd < 3) fresh = -0.6; else if (rd <= 6) fresh = 0; else if (rd <= 21) fresh = 0.2; else if (rd <= 35) fresh = -0.6; else fresh = -1.8 - (rd - 35) * 0.03;
    s.aroma = base.aroma + fresh - (r.avgT < 80 && light > 0.5 && m.target !== 'cold' ? 0.5 : 0) - water.flat * 2;
    s.finish = 0.35 * s.sweet + 0.25 * s.clarity + 0.2 * s.body + (bean.quality - 84) * 0.25 - astr * 0.4;
    Object.keys(s).forEach(k => { s[k] = clamp(s[k], 0, 10); });

    let score = bean.quality + ({ carbonic: 1, thermal: 1, anaerobic: 0.6, natural: 0.4, yeast: 0.4, wethulled: -0.5 }[state.process] || 0)
      - 2.0 * under - 1.8 * over - 14 * (weakRel + strongRel) - astr * 1.0 - water.flat * 6 - r.channel * 6
      - (rd > 30 ? (rd - 30) * 0.08 : 0) - (rd < 3 ? 0.8 : 0) - Math.max(0, (s.bitter - 6.5) * 0.8);
    if (!bean.common.includes(state.process)) score -= 0.3;
    score = clamp(Math.round(score * 4) / 4, 55, 95);

    const strength = weakRel > 0.02 ? 'weak' : strongRel > 0.02 ? 'strong' : 'ok';
    const extraction = under > 0.3 ? 'under' : over > 0.3 ? 'over' : 'ok';
    const ZONE = {
      'strong-under': '濃而酸澀', 'strong-ok': '濃郁', 'strong-over': '濃而苦',
      'ok-under': '偏酸、甜感不足', 'ok-ok': '理想區間', 'ok-over': '偏苦、乾澀',
      'weak-under': '淡而酸', 'weak-ok': '清淡', 'weak-over': '淡而苦澀'
    };
    const zone = ZONE[strength + '-' + extraction];

    return { s, score, grade: grade(score), strength, extraction, zone, under, over, astr, tgt,
      notes: tasting(state, r, s, { bean, proc, roast, light, ferment, under, over, strength }),
      advice: advise(state, r, { m, tgt, under, over, strength, roast, light }) };
  }

  function grade(score) {
    if (score >= 90) return '驚豔';
    if (score >= 86) return '優秀';
    if (score >= 82) return '好喝';
    if (score >= 78) return '普通';
    return '有明顯缺點';
  }

  function tasting(state, r, s, ctx) {
    const { bean, proc, roast, light, ferment, under, over, strength } = ctx;
    const dark = 1 - light;
    const W = {
      floral: light * (s.aroma / 10) * r.fa * (s.clarity / 10) * 1.3,
      citrus: (s.acid / 10) * r.fa * 1.1,
      berry: (s.sweet / 10) * (0.7 + ferment * 0.15),
      tropical: (s.sweet / 10) * (0.6 + ferment * 0.2),
      stone: (s.sweet / 10) * 0.9,
      sweet: (s.sweet / 10) * r.fs * 1.05,
      choco: (dark * 0.9 + 0.25) * (s.body / 10),
      nut: (dark * 0.6 + 0.2) * (s.body / 10),
      roast: dark * dark * 1.2,
      ferment: ferment / 3,
      tea: (s.clarity / 10) * light,
      spice: 0.55, wood: 0.5, herbal: 0.5, earthy: 0.5, savory: 0.45
    };
    const pool = [];
    const add = (list, bonus) => list.forEach(([n, tag], i) => pool.push({ n, tag, w: (W[tag] || 0.4) * bonus * (1 - i * 0.04) }));
    add(bean.notes, 1);
    add(proc.notes, 1.05);
    add(roast.notes, 0.9);
    const seen = new Set();
    const top = pool.sort((a, b) => b.w - a.w).filter(x => (seen.has(x.n) ? false : (seen.add(x.n), true))).slice(0, 4).map(x => x.n);

    const acidWord = s.acid > 7.5 ? '明亮多汁' : s.acid > 5.5 ? '柔和' : '低調';
    const bodyWord = s.body > 7.8 ? '厚實如糖漿' : s.body > 5.5 ? '圓潤' : '輕盈如茶';
    const parts = [];
    parts.push(`入口是${acidWord}的${top[0] || '果酸'}，接著${top[1] || '焦糖'}${top[2] ? '與' + top[2] : ''}，口感${bodyWord}`);
    parts.push(top[3] ? `，尾韻留下${top[3]}。` : '。');
    const flaws = [];
    if (under > 0.5) flaws.push('前段的酸偏尖，帶點鹹味和青澀，甜感沒有完全出來');
    if (over > 0.5) flaws.push('後段出現乾澀與木質的苦，蓋過了甜感');
    if (r.channel > 0.22) flaws.push('同時又酸又苦，是粉餅通道效應的典型症狀');
    if (strength === 'weak') flaws.push('整體偏淡、水感明顯');
    if (strength === 'strong') flaws.push('濃度偏高，風味擠在一起，可以加一點水');
    if (r.restDays > 35) flaws.push('香氣已經明顯衰退');
    if (r.restDays < 3) flaws.push('豆子太新鮮，CO₂ 讓前段刺激、萃取不均');
    if (r.sputter) flaws.push('最後的蒸氣噴發帶來焦苦味');
    if ((E.WATERS[state.waterProfile] || {}).flat > 0.2) flaws.push('水中缺少礦物質，風味扁平');
    let text = parts.join('');
    if (flaws.length) text += '不過' + flaws.join('；') + '。';
    else text += '甜感與酸質平衡，乾淨度' + (s.clarity > 7.5 ? '很高' : '不錯') + '。';
    return { top, text };
  }

  /* ---------- 調整建議（可一鍵套用） ---------- */
  function advise(state, r, ctx) {
    const { m, tgt, under, over, strength, roast } = ctx;
    const list = [];
    const isEsp = m.family === 'espresso';
    const step = isEsp ? 15 : m.id === 'turkish' ? 15 : 60;
    const mid = (m.grindRange[0] + m.grindRange[1]) / 2;
    const immersive = m.family === 'immersion' || m.id === 'clever';
    const grindFix = (delta) => ({ label: `研磨調${delta < 0 ? '細' : '粗'} ${Math.abs(delta)} µm`, apply: st => shiftGrind(st, delta) });

    if (under > 0.3) {
      let fix;
      if (state.grind > mid - step / 2 || isEsp) fix = grindFix(-step);
      else if (state.temp < roast.temp[1] && m.target !== 'cold') fix = { label: `水溫提高到 ${Math.min(100, state.temp + 2)}°C`, apply: st => { st.temp = Math.min(100, st.temp + 2); } };
      else if (immersive && state.steep != null) fix = { label: '浸泡延長 30 秒', apply: st => { st.steep += 30; } };
      else if (m.id === 'coldbrew') fix = { label: '浸泡延長 2 小時', apply: st => { st.hours += 2; } };
      else fix = grindFix(-Math.round(step * 0.7));
      list.push({ sev: under > 2 ? 'bad' : 'warn', title: '萃取不足', text: `EY ${r.ey.toFixed(1)}%，低於 ${tgt.ey[0]}%。可溶的糖類和梅納產物還沒出來，酸味會先搶戲。`, fix });
    }
    if (over > 0.3) {
      let fix;
      if (state.grind < mid + step / 2 || isEsp) fix = grindFix(step);
      else if (state.temp > roast.temp[0] && m.target !== 'cold') fix = { label: `水溫降到 ${state.temp - 2}°C`, apply: st => { st.temp -= 2; } };
      else if (immersive && state.steep != null) fix = { label: '浸泡縮短 30 秒', apply: st => { st.steep = Math.max(30, st.steep - 30); } };
      else if (m.id === 'coldbrew') fix = { label: '浸泡縮短 2 小時', apply: st => { st.hours = Math.max(4, st.hours - 2); } };
      else fix = grindFix(Math.round(step * 0.7));
      list.push({ sev: over > 2 ? 'bad' : 'warn', title: '過度萃取', text: `EY ${r.ey.toFixed(1)}%，高於 ${tgt.ey[1]}%。慢速溶出的苦味與澀感分子開始累積。`, fix });
    }
    if (strength === 'weak') {
      const fix = isEsp ? { label: `出杯量減少到 ${state.yield - 4} g`, apply: st => { st.yield -= 4; } }
        : m.id === 'aeropress' && state.dilute > 0 ? { label: '少加 30 g 稀釋水', apply: st => { st.dilute = Math.max(0, st.dilute - 30); } }
        : m.id === 'moka' || m.id === 'turkish' ? { label: `粉量增加到 ${+(state.dose + 1).toFixed(1)} g`, apply: st => { st.dose = +(st.dose + 1).toFixed(1); } }
        : { label: `粉量增加 ${state.dose >= 25 ? 2 : 1} g（水量不變）`, apply: st => { st.dose = +(st.dose + (st.dose >= 25 ? 2 : 1)).toFixed(1); } };
      list.push({ sev: 'warn', title: '濃度偏淡', text: `TDS ${r.tds.toFixed(2)}%，低於 ${tgt.tds[0]}%。萃取率決定「萃出什麼」，粉水比才決定「濃淡」。`, fix });
    }
    if (strength === 'strong') {
      const fix = isEsp ? { label: `出杯量增加到 ${state.yield + 4} g`, apply: st => { st.yield += 4; } }
        : m.id === 'aeropress' ? { label: '壓完再加 40 g 熱水', apply: st => { st.dilute = (st.dilute || 0) + 40; } }
        : { label: `水量增加 ${Math.round(state.water * 0.08)} g`, apply: st => scaleWater(st, 1.08) };
      list.push({ sev: 'warn', title: '濃度偏高', text: `TDS ${r.tds.toFixed(2)}%，高於 ${tgt.tds[1]}%。風味會擠在一起、甚至壓住甜感。`, fix });
    }
    if (isEsp) {
      const tt = r.time - (state.preinf || 0);
      if (tt < 20) list.push({ sev: 'warn', title: '流速太快', text: `扣掉預浸，出液只用了 ${tt.toFixed(0)} 秒。水沒有足夠時間接觸粉餅。`, fix: grindFix(-15) });
      if (tt > 38) list.push({ sev: 'warn', title: '流速太慢', text: `出液花了 ${tt.toFixed(0)} 秒，粉餅阻力太高。`, fix: grindFix(15) });
      if (r.channel > 0.2) list.push({ sev: 'bad', title: '通道效應', text: `約 ${(r.channel * 100).toFixed(0)}% 的水從粉餅的裂縫快速穿過：那部分萃取不足，其餘又被過萃，所以同時酸又苦。`,
        fix: state.prep === 'none' || state.prep === 'tamp' ? { label: '改用 WDT 布粉', apply: st => { st.prep = 'wdt'; } } : state.grind < 220 ? grindFix(20) : { label: '加 4 秒預浸', apply: st => { st.preinf = Math.max(4, st.preinf || 0); } } });
    }
    const maxT = { v60: 240, origami: 210, kalita: 270, chemex: 330, orea: 180, phin: 420, switch: 270 }[m.id];
    if (maxT && r.time > maxT) list.push({ sev: 'warn', title: '下水太慢', text: `總時間 ${fmtTime(r.time)}，超過這支濾杯常見的 ${fmtTime(maxT)}。細粉堵住濾紙時萃取會不均。`,
      fix: state.grinder === 'blade' || state.grinder === 'conical' ? { label: '換平刀磨豆機（細粉更少）', apply: st => { st.grinder = 'flat'; } } : grindFix(60) });
    if (state.grinder === 'blade') list.push({ sev: 'bad', title: '顆粒大小不均', text: '刀片式磨豆機會同時產生粉塵和大顆粒：細粉過萃、粗粒萃取不足，杯子裡同時有苦和酸。', fix: { label: '換成錐刀磨豆機', apply: st => { st.grinder = 'conical'; } } });
    if (state.waterProfile === 'ro') list.push({ sev: 'warn', title: '水裡缺礦物質', text: '鈣、鎂離子會和咖啡中的風味分子結合、幫助萃取。純水沖出來會扁平。', fix: { label: '改用 SCA 標準水', apply: st => { st.waterProfile = 'sca'; } } });
    if (state.waterProfile === 'hard') list.push({ sev: 'warn', title: '鹼度太高', text: '碳酸氫根會中和咖啡的酸，讓風味變得悶鈍。', fix: { label: '改用 SCA 標準水', apply: st => { st.waterProfile = 'sca'; } } });
    if (r.restDays < 4) list.push({ sev: 'warn', title: '豆子太新鮮', text: '剛烘好的豆子還在大量釋放 CO₂，氣體會把水推開，造成萃取不均。', fix: { label: '養豆到第 7 天', apply: st => { st.restDays = 7; } } });
    if (r.restDays > 35) list.push({ sev: 'warn', title: '豆子不新鮮', text: '烘焙超過 5 週，揮發性香氣大量流失。這無法靠沖煮補救。', fix: { label: '換新鮮的豆子（第 12 天）', apply: st => { st.restDays = 12; } } });
    if (m.id === 'moka' && state.heat === 'high') list.push({ sev: 'warn', title: '火太大', text: '最後水位低於導管時，蒸氣會把殘水連同過熱的蒸氣一起推上來，帶出焦苦。', fix: { label: '改中火', apply: st => { st.heat = 'med'; } } });
    if (m.target !== 'cold' && m.id !== 'turkish') {
      if (state.temp > roast.temp[1] + 1 && (state.roast === 'dark' || state.roast === 'xdark' || state.roast === 'mdark'))
        list.push({ sev: 'warn', title: '深焙水溫偏高', text: `深焙豆結構脆、可溶物多，建議 ${roast.temp[0]}–${roast.temp[1]}°C。`, fix: { label: `水溫降到 ${roast.temp[1]}°C`, apply: st => { st.temp = roast.temp[1]; } } });
      if (state.temp < roast.temp[0] - 2 && (state.roast === 'light' || state.roast === 'xlight') && !(state.schedule || []).some(p => p.temp != null))
        list.push({ sev: 'warn', title: '淺焙水溫偏低', text: `淺焙豆密度高、不易萃取，建議 ${roast.temp[0]}–${roast.temp[1]}°C。`, fix: { label: `水溫提高到 ${roast.temp[0]}°C`, apply: st => { st.temp = roast.temp[0]; } } });
    }
    const rank = { bad: 0, warn: 1, good: 2 };
    list.sort((a, b) => rank[a.sev] - rank[b.sev]);
    if (!list.length) list.push({ sev: 'good', title: '落在理想區間', text: `EY ${r.ey.toFixed(1)}%、TDS ${r.tds.toFixed(2)}%。接下來可以試著微調水溫或注水節奏，找出這支豆子的個性。` });
    return list.slice(0, 5);
  }

  function shiftGrind(st, delta) {
    const m = byId(D.METHODS, st.method);
    const lo = m.id === 'turkish' ? 60 : 150, hi = 1600;
    st.grind = clamp(st.grind + delta, lo, hi);
    if (st.grindSplit) st.grindSplit = st.grindSplit.map(p => Object.assign({}, p, { d: clamp(p.d + delta, lo, hi) }));
  }
  function scaleWater(st, f) {
    const old = st.water;
    st.water = Math.round(st.water * f);
    if (st.schedule) {
      const k = st.water / old;
      st.schedule = st.schedule.map(p => Object.assign({}, p, { g: Math.round(p.g * k) }));
    }
  }
  function fmtTime(sec) {
    if (sec >= 3600) return (sec / 3600).toFixed(1) + ' 小時';
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  const clone = o => JSON.parse(JSON.stringify(o));
  const KEEP = ['bean', 'process', 'roast', 'restDays', 'grinder', 'waterProfile'];
  function defaults(methodId, keep) {
    const m = byId(D.METHODS, methodId);
    const st = { bean: 'yirga', process: 'washed', roast: 'light', restDays: 10, grinder: 'conical', waterProfile: 'sca' };
    KEEP.forEach(k => { if (keep && keep[k] != null) st[k] = keep[k]; });
    Object.assign(st, clone(m.def), { method: methodId, grindSplit: null, phys: null, recipe: null });
    if (!st.events) st.events = [];
    if (!st.stirs) st.stirs = [];
    return st;
  }
  function fromRecipe(rec, keep) {
    const st = defaults(rec.method, { bean: rec.bean, process: rec.process, roast: rec.roast, restDays: 12, grinder: 'conical', waterProfile: 'sca' });
    Object.assign(st, clone(rec.cfg), { recipe: rec.id });
    if (!rec.cfg.events && !st.events) st.events = [];
    return st;
  }

  root.Brew = { buildCfg, run, analyze, method, target, fmtTime, shiftGrind, scaleWater, byId, ROAST_ORDER, defaults, fromRecipe, clone };
})(typeof window !== 'undefined' ? window : globalThis);
