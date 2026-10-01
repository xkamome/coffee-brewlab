/* 咖啡萃取模擬引擎
 * 三池動力學：A＝酸質與芳香（快）、S＝糖類與梅納產物（中）、B＝苦味與重分子（慢、對溫度最敏感）。
 * 粉層切成數層串聯（tanks-in-series）近似滲流的「活塞流」：上層是新鮮水、下層濃度高。
 * 每一步：注水 → 熱混合／散熱 → 各層依溫度（Arrhenius）、研磨、攪拌、濃度差萃取 → 依重力、泵壓或閥門往下流。
 * EY 只計入流進杯子的部分（和折射儀量測方式一致），留在粉層的液體不算。
 */
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const RG = 8.314, TREF = 366.15;
  const POOLS = ['A', 'S', 'B'];
  const EA = { A: 15000, S: 28000, B: 45000 };           // 活化能 J/mol
  const K0 = { A: 0.050, S: 0.0150, B: 0.0052 };          // 93°C、650µm、中焙、攪拌 1.0 的基準速率 1/s
  const FINES_BOOST = { A: 0.8, S: 1.2, B: 3.0 };          // 細粉對各池速率的放大
  const CSAT = 0.32;                                       // 粉層液體濃度上限（溶質／水）

  const arr = (p, T) => Math.exp(-EA[p] / RG * (1 / (T + 273.15) - 1 / TREF));
  // 低溫時部分成分溶不出來（冷萃的甜、低苦來源）
  function cap(p, T) {
    const s = clamp((T - 15) / 75, 0, 1);
    return p === 'A' ? 0.8 + 0.2 * s : p === 'S' ? 0.72 + 0.28 * s : 0.42 + 0.58 * s;
  }

  const ROASTS = {
    xlight: { emax: 26.0, share: [0.36, 0.45, 0.19], k: 0.80, co2: 0.40 },
    light:  { emax: 27.5, share: [0.33, 0.46, 0.21], k: 0.88, co2: 0.45 },
    mlight: { emax: 28.5, share: [0.30, 0.47, 0.23], k: 0.95, co2: 0.50 },
    medium: { emax: 29.5, share: [0.26, 0.48, 0.26], k: 1.00, co2: 0.55 },
    mdark:  { emax: 30.5, share: [0.22, 0.46, 0.32], k: 1.08, co2: 0.62 },
    dark:   { emax: 31.5, share: [0.18, 0.42, 0.40], k: 1.18, co2: 0.70 },
    xdark:  { emax: 32.0, share: [0.15, 0.37, 0.48], k: 1.25, co2: 0.72 }
  };
  const GRINDERS = {
    premium: { fines: 0.06, spread: 0.07 },
    flat:    { fines: 0.09, spread: 0.10 },
    conical: { fines: 0.13, spread: 0.16 },
    blade:   { fines: 0.26, spread: 0.45 }
  };
  const WATERS = {
    ro:   { k: 0.86, acid: 1.10, flat: 0.35 },
    soft: { k: 0.97, acid: 1.05, flat: 0.05 },
    sca:  { k: 1.00, acid: 1.00, flat: 0 },
    mg:   { k: 1.05, acid: 1.03, flat: 0 },
    hard: { k: 1.02, acid: 0.72, flat: 0.10 }
  };
  const POUR_AGIT = { center: 0.22, spiral: 0.45, pulse: 0.55, stir: 0.85, melodrip: 0.05 };

  // 方法家族預設物理參數
  const FAMILY = {
    perc:      { dt: 0.25, absorb: 2.0, baseAgit: 0.60, kMul: 1.28, n: 0.8, heatTau: 900,  tEnv: 25, layers: [0.5, 0.25, 0.25] },
    valve:     { dt: 0.25, absorb: 2.0, baseAgit: 0.60, kMul: 1.18, n: 0.8, heatTau: 1100, tEnv: 25, layers: [0.7, 0.3] },
    immersion: { dt: 0.5,  absorb: 2.0, baseAgit: 0.72, kMul: 0.95, n: 1.1, heatTau: 3000, tEnv: 25, layers: [1] },
    espresso:  { dt: 0.05, absorb: 1.2, baseAgit: 1.00, kMul: 1.75, n: 1.4, heatTau: 1e9,  tEnv: 25, layers: [0.25, 0.25, 0.25, 0.25] },
    moka:      { dt: 0.25, absorb: 1.4, baseAgit: 1.00, kMul: 0.60, n: 1.4, heatTau: 1e9,  tEnv: 25, layers: [0.34, 0.33, 0.33] },
    turkish:   { dt: 0.5,  absorb: 1.6, baseAgit: 0.90, kMul: 0.55, n: 1.1, heatTau: 1e9,  tEnv: 25, layers: [1] }
  };

  function effectiveGrind(cfg) {
    const parts = cfg.grindSplit && cfg.grindSplit.length ? cfg.grindSplit : [{ g: cfg.dose, d: cfg.grind }];
    const tot = parts.reduce((s, p) => s + p.g, 0);
    let d2 = 0, dm = 0;
    parts.forEach(p => { d2 += (p.g / tot) * p.d * p.d; dm += (p.g / tot) * p.d; });
    return { parts, tot, dTau: Math.sqrt(d2), dMean: dm };
  }

  /* cfg: { method:{family,phys,kAdj}, dose, water, temp, grind, grindSplit?, grinder, waterProfile, roast, restDays,
   *        beanSol, schedule:[{t,g,temp?,dur?,style?,valve?}], events:[{t,type:'stir'|'swirl'|'valve',open?,boost?}],
   *        release?, yield?, pressure?, preinf?, prep?, heat?, hotStart?, boils?, fixedT?, estT?, maxT? } */
  function simulate(cfg) {
    const m = cfg.method;
    const fam = Object.assign({}, FAMILY[m.family], m.phys || {}, cfg.phys || {});
    const F = m.family;
    const dose = cfg.dose;
    const roast = ROASTS[cfg.roast] || ROASTS.medium;
    const grinder = GRINDERS[cfg.grinder] || GRINDERS.conical;
    const water = WATERS[cfg.waterProfile] || WATERS.sca;
    const eg = effectiveGrind(cfg);
    const dT = eg.dTau;
    const phi = clamp(grinder.fines * (1 + 0.6 * clamp((700 - eg.dMean) / 600, -0.4, 1)), 0.02, 0.5);
    const rest = cfg.restDays == null ? 10 : cfg.restDays;
    const co2 = roast.co2 * Math.exp(-rest / 6);

    const gF = {};
    POOLS.forEach(p => {
      let s = 0;
      eg.parts.forEach(pt => { s += (pt.g / eg.tot) * Math.pow(650 / pt.d, fam.n); });
      gF[p] = s * (1 + FINES_BOOST[p] * phi) / (1 + FINES_BOOST[p] * 0.13);
    });

    const emax = roast.emax / 100 * (cfg.beanSol || 1);
    const P0tot = {};
    POOLS.forEach((p, i) => { P0tot[p] = dose * emax * roast.share[i]; });
    const L = fam.layers.map(f => {
      const o = { d: dose * f, W: 0, M: 0, P: {}, P0: {}, X: {} };
      POOLS.forEach(p => { o.P0[p] = P0tot[p] * f; o.P[p] = o.P0[p]; o.X[p] = 0; });
      o.cap = fam.absorb * o.d;
      return o;
    });
    const top = L[0], bot = L[L.length - 1];
    const head = F === 'espresso' ? 6 : 0;        // 沖煮頭與粉餅間的水
    top.cap += head;

    let t = 0, cupW = 0, cupS = 0, poured = 0, T = fam.tEnv, tWet = -1, drawEnd = null, flowStart = null, passed = 0;
    let valveOpen = F === 'perc' || F === 'espresso' || F === 'moka';
    const events = (cfg.events || []).slice().sort((a, b) => a.t - b.t);
    const sched = (cfg.schedule || []).map(s => Object.assign({ style: 'spiral' }, s, { dur: s.dur || Math.max(3, s.g / (cfg.pourRate || 6)) }));
    const lastInEnd = sched.reduce((mx, s) => Math.max(mx, s.t + s.dur), 0);
    let evIdx = 0; const boosts = [];
    const dt = fam.dt;
    const samples = [];
    const est = cfg.estT || (F === 'espresso' ? 40 : F === 'turkish' ? 300 : F === 'moka' ? 260 : Math.max(lastInEnd, cfg.release || 0) + 90);
    const sampleEvery = Math.max(1, Math.round(est / dt / 420));
    let stepN = 0, agitSum = 0, agitN = 0, tempExSum = 0, exSum = 0;
    let ch = 0, R0 = 0, sputter = false, tk = null, maxPour = 0;
    const maxT = cfg.maxT || (F === 'espresso' ? 90 : Math.max(lastInEnd, cfg.release || 0) + 1800);

    if (F === 'espresso') {
      const prepBase = { none: 0.36, tamp: 0.20, wdt: 0.09, screen: 0.06 }[cfg.prep || 'wdt'];
      ch = prepBase + Math.max(0, (230 - dT) / 120) + Math.max(0, ((cfg.pressure || 9) - 9) * 0.03)
        + (rest < 5 ? 0.05 : 0) - ((cfg.preinf || 0) >= 4 ? 0.05 : 0) - Math.max(0, (dT - 300) / 400)
        + (cfg.grinder === 'blade' ? 0.2 : 0);
      ch = clamp(ch, 0.02, 0.85);
      R0 = 6.4 * Math.pow(dT / 250, -2) * (dose / 18) * (1 + 3 * (phi - 0.1)) * (1 - 0.55 * ch);
    }
    if (F === 'turkish') { tk = { boils: 0, heating: true, cool: 0, done: false }; top.W = cfg.water; poured = cfg.water; T = 22; tWet = 0; }
    if (F === 'moka') {
      const H = { low: [0.9, 300, 120, 90], med: [1.5, 200, 80, 93], high: [2.6, 140, 55, 96] }[cfg.heat || 'med'];
      fam.mq = H[0]; fam.mStart = cfg.hotStart ? H[2] : H[1]; fam.mT = H[3];
    }

    // 把 wIn/sIn 從第 j 層往下傳，飽和的層立即把多出的量推給下一層；最底層流進杯子（閥門關閉時停住）
    function cascade(j, wIn, sIn) {
      for (let k = j; k < L.length; k++) {
        const ly = L[k];
        ly.W += wIn; ly.M += sIn;
        const excess = Math.max(0, ly.W - ly.cap);
        if (excess <= 0) return;
        if (k === L.length - 1 && !valveOpen) return;
        const r = ly.M / ly.W;
        wIn = excess; sIn = excess * r;
        if (F === 'espresso') sIn *= (1 - 0.6 * ch * (k === L.length - 1 ? 1 : 0));
        ly.W -= wIn; ly.M -= excess * r;
        if (k === L.length - 1) { cupW += wIn; cupS += sIn; }
      }
    }

    function inflowAt(tt) {
      let rate = 0, temp = cfg.temp, style = 'spiral';
      for (const s of sched) if (tt >= s.t && tt < s.t + s.dur) { rate += s.g / s.dur; if (s.temp != null) temp = s.temp; style = s.style; }
      return { rate, temp, style };
    }

    while (t < maxT) {
      while (evIdx < events.length && events[evIdx].t <= t + 1e-9) {
        const e = events[evIdx++];
        if (e.type === 'stir' || e.type === 'swirl') boosts.push({ t: e.t, b: e.boost || (e.type === 'stir' ? 0.9 : 0.5) });
        if (e.type === 'valve') valveOpen = !!e.open;
      }
      for (const s of sched) if (s.valve && t >= s.t && t < s.t + dt) valveOpen = s.valve === 'open';
      if (F === 'immersion' && cfg.release != null && t >= cfg.release) valveOpen = true;

      let inRate = 0, agit = fam.baseAgit;
      const totalW = () => L.reduce((s, l) => s + l.W, 0);

      if (F === 'espresso') {
        const sat = L.every(l => l.W >= l.cap - 1e-6);
        const pre = cfg.preinf || 0;
        if (!sat) inRate = 4.0 * (t < pre ? 0.45 : 1);
        else {
          if (flowStart == null) flowStart = t;
          const P = cfg.pressure || 9;
          const Pb = t < pre ? 2.5 : Math.min(P, 2.5 + (P - 2.5) * clamp((t - Math.max(pre, flowStart)) / 2.5, 0, 1));
          inRate = Pb / (R0 * (1 - 0.35 * clamp((t - flowStart) / 30, 0, 1)));
        }
        if (tWet < 0) tWet = t;
        T = cfg.temp - 1.5;
        agit = 1.0 + 0.02 * ((cfg.pressure || 9) - 9);
        poured += inRate * dt;
        cascade(0, inRate * dt, 0);
      } else if (F === 'moka') {
        if (t < fam.mStart) { T = 60 + 30 * (t / fam.mStart); }
        else {
          if (flowStart == null) flowStart = t;
          const tot = cfg.water * 0.85;
          sputter = passed > tot * 0.86;
          inRate = fam.mq * (sputter ? 1.8 : 1);
          T = sputter ? 100 : fam.mT; agit = sputter ? 1.6 : 1.0;
          if (tWet < 0) tWet = t;
          passed += inRate * dt; poured = passed;
          cascade(0, inRate * dt, 0);
          if (passed >= tot) drawEnd = t;
        }
      } else if (F === 'turkish') {
        const heatRate = { low: 0.35, med: 0.6, high: 1.0 }[cfg.heat || 'med'];
        if (!tk.done) {
          if (tk.heating) { T += heatRate * (100 - T) / 60 * dt * 1.6; if (T >= 97) { tk.boils++; tk.heating = false; tk.cool = 0; boosts.push({ t, b: 0.8 }); } }
          else { tk.cool += dt; T -= 0.6 * dt; if (tk.cool >= 8) { if (tk.boils < (cfg.boils || 1)) tk.heating = true; else { tk.done = true; drawEnd = t + (cfg.settle || 60); } } }
        } else T -= (T - 25) / 900 * dt;
      } else {
        const inf = inflowAt(t);
        inRate = inf.rate;
        if (inRate > 0) {
          let add = inRate * dt, byp = 0;
          if ((F === 'perc' || (F === 'valve' && valveOpen)) && top.W > top.cap) byp = add * (fam.bypass || 0);
          cupW += byp; add -= byp; poured += inRate * dt;
          const C = totalW() + 0.43 * dose;
          const Tstart = tWet < 0 ? fam.tEnv : T;
          T = (Tstart * C + inf.temp * add) / (C + add);
          top.W += add;
          if (tWet < 0) tWet = t;
          agit += (POUR_AGIT[inf.style] || 0.4) * clamp(inRate / 5, 0, 1.4);
          maxPour = Math.max(maxPour, inRate);
        }
        if (fam.hold != null) T = cfg.temp;
        else T -= (T - fam.tEnv) / fam.heatTau * dt;
        if (cfg.fixedT != null) T = cfg.fixedT;
      }

      for (const b of boosts) agit += b.b * Math.exp(-(t - b.t) / 18);
      if (F === 'immersion' && !valveOpen) {
        const lastStir = boosts.length ? boosts[boosts.length - 1].t : 0;
        agit *= 0.75 + 0.25 * Math.exp(-(t - lastStir) / 90);
      }

      // 萃取（各層）
      if (tWet >= 0) {
        const co2f = 1 - co2 * Math.exp(-(t - tWet) / 25);
        let exStep = 0;
        L.forEach((ly, j) => {
          if (ly.W <= 0) return;
          const wet = clamp(ly.W / (fam.absorb * ly.d), 0, 1);
          const drive = Math.max(0, 1 - (ly.M / ly.W) / CSAT);
          const a = j === 0 ? agit : Math.min(agit, fam.baseAgit + 0.15);
          POOLS.forEach(p => {
            const acc = Math.max(0, ly.P[p] - ly.P0[p] * (1 - cap(p, T)));
            const k = K0[p] * fam.kMul * gF[p] * arr(p, T) * a * roast.k * water.k * (m.kAdj || 1);
            const dx = Math.min(acc, k * wet * co2f * drive * acc * dt);
            ly.P[p] -= dx; ly.X[p] += dx; ly.M += dx; exStep += dx;
          });
        });
        tempExSum += T * exStep; exSum += exStep; agitSum += agit; agitN++;
      }

      // 重力滲流／浸泡釋放
      let drainable = Math.max(0, top.W - top.cap);
      if (F === 'perc' || F === 'valve' || F === 'immersion') {
        if (drainable > 0 && (valveOpen || L.length > 1)) {
          const releasing = F === 'immersion';
          const tau0 = releasing ? (fam.releaseTau || 10) : fam.tau0;
          const tau = releasing ? tau0 * Math.pow(650 / dT, 0.6) * (1 + 3 * (phi - 0.12))
            : tau0 * (0.35 + 0.65 * Math.pow(650 / dT, 2)) * Math.sqrt(dose / 15) * (1 + 3 * (phi - 0.12));  // 0.35：濾紙本身的阻力
          let q = drainable / Math.max(tau, 0.5) * dt;
          if (!valveOpen) { // 閥門關閉：只能往下填滿下層的空間
            const room = L.slice(1).reduce((s, l) => s + Math.max(0, l.cap - l.W), 0);
            q = Math.min(q, room);
          }
          if (L.length === 1 && !valveOpen) q = 0;
          if (q > 0) {
            const r = top.M / top.W;
            top.W -= q; top.M -= q * r;
            if (L.length === 1) { cupW += q; cupS += q * r; }
            else cascade(1, q, q * r);
          }
        }
        drainable = Math.max(0, top.W - top.cap);
        const allIn = t > lastInEnd && (F !== 'immersion' || t >= (cfg.release || 0));
        if (allIn && valveOpen && drainable < Math.max(0.8, 0.012 * poured)) drawEnd = t;
      }
      t += dt; stepN++;
      if (F === 'turkish' && tk.done && t >= drawEnd) {
        const q = Math.max(0, top.W - top.cap), r = top.M / top.W;
        cupW += q; cupS += q * r; top.W -= q; top.M -= q * r;
      }
      const cupMass = cupW + cupS;
      if (stepN % sampleEvery === 0) {
        const X = sumX();
        samples.push({
          t, poured, cup: cupMass, T, drainable: Math.max(0, top.W - top.cap), bedW: totalW(),
          ey: cupS / dose * 100, eyTot: (X.A + X.S + X.B) / dose * 100,
          tds: cupMass > 0 ? cupS / cupMass * 100 : 0,
          xa: X.A / P0tot.A, xs: X.S / P0tot.S, xb: X.B / P0tot.B, inRate, valveOpen, sputter
        });
      }
      if (F === 'espresso' && cupMass >= (cfg.yield || 36)) { drawEnd = t; break; }
      if (drawEnd != null && (F !== 'turkish' || t >= drawEnd)) break;
    }

    function sumX() { const X = { A: 0, S: 0, B: 0 }; L.forEach(l => POOLS.forEach(p => { X[p] += l.X[p]; })); return X; }
    const X = sumX();
    const bev = cupW + cupS;
    const res = {
      time: drawEnd != null ? drawEnd : t, timedOut: drawEnd == null,
      beverage: bev, tds: bev > 0 ? cupS / bev * 100 : 0, ey: cupS / dose * 100,
      eyTotal: (X.A + X.S + X.B) / dose * 100,
      fa: X.A / P0tot.A, fs: X.S / P0tot.S, fb: X.B / P0tot.B,
      fines: phi, spread: grinder.spread, channel: ch, co2, restDays: rest,
      avgT: exSum > 0 ? tempExSum / exSum : cfg.temp, agit: agitN ? agitSum / agitN : 1,
      flowStart, poured, emax: emax * 100, maxPour, sputter
    };
    samples.push({ t: res.time, poured, cup: bev, T, drainable: 0, bedW: 0, ey: res.ey, eyTot: res.eyTotal, tds: res.tds, xa: res.fa, xs: res.fs, xb: res.fb, inRate: 0, valveOpen, end: true });
    return { samples, result: res };
  }

  const api = { simulate, ROASTS, GRINDERS, WATERS, POUR_AGIT, FAMILY, clamp, arr, cap, EA, K0 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoffeeEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
