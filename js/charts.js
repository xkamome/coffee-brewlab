/* 圖表：沖煮控制圖、風味雷達、萃取曲線、理論章節插圖。全部以 SVG 字串輸出，顏色走 CSS token。 */
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const f = n => Math.round(n * 10) / 10;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const scale = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
  const fmtT = s => s >= 3600 ? (s / 3600).toFixed(s >= 36000 ? 0 : 1) + 'h' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');

  function niceTicks(a, b, n) {
    const span = b - a, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
    const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }

  /* ---------- 沖煮控制圖 ---------- */
  function controlChart(o) {
    const W = 540, H = 380, L = 54, R = 20, T = 18, B = 48;
    const tgt = o.target;
    const [y0, y1] = tgt.tdsAxis;
    const x0 = 12, x1 = 28;
    const X = scale(x0, x1, L, W - R), Y = scale(y0, y1, H - B, T);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="沖煮控制圖">`;
    s += `<rect class="c-plot" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
    niceTicks(x0, x1, 8).forEach(v => { s += `<line class="c-grid" x1="${f(X(v))}" x2="${f(X(v))}" y1="${T}" y2="${H - B}"/><text class="c-tick" x="${f(X(v))}" y="${H - B + 16}" text-anchor="middle">${v}</text>`; });
    niceTicks(y0, y1, 6).forEach(v => { s += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="c-tick" x="${L - 8}" y="${f(Y(v)) + 4}" text-anchor="end">${v}</text>`; });
    // 理想區
    s += `<rect class="c-ideal" x="${f(X(tgt.ey[0]))}" y="${f(Y(tgt.tds[1]))}" width="${f(X(tgt.ey[1]) - X(tgt.ey[0]))}" height="${f(Y(tgt.tds[0]) - Y(tgt.tds[1]))}"/>`;
    [tgt.ey[0], tgt.ey[1]].forEach(v => { s += `<line class="c-zone" x1="${f(X(v))}" x2="${f(X(v))}" y1="${T}" y2="${H - B}"/>`; });
    [tgt.tds[0], tgt.tds[1]].forEach(v => { s += `<line class="c-zone" x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/>`; });
    // 九宮格標籤
    const cx = [(x0 + tgt.ey[0]) / 2, (tgt.ey[0] + tgt.ey[1]) / 2, (tgt.ey[1] + x1) / 2];
    const cy = [(tgt.tds[1] + y1) / 2, (tgt.tds[0] + tgt.tds[1]) / 2, (y0 + tgt.tds[0]) / 2];
    const names = [['濃・酸', '濃郁', '濃・苦'], ['偏酸', '理想', '偏苦'], ['淡・酸', '清淡', '淡・苦']];
    names.forEach((row, i) => row.forEach((n, j) => { s += `<text class="c-zonelabel${i === 1 && j === 1 ? ' ideal' : ''}" x="${f(X(cx[j]))}" y="${f(Y(cy[i])) + 4}" text-anchor="middle">${n}</text>`; }));
    // 粉水比斜線
    (o.ratios || []).forEach(r => {
      const pts = [];
      for (let e = x0; e <= x1 + 0.01; e += 0.5) { const t = r.fn(e); if (t >= y0 && t <= y1) pts.push([X(e), Y(t)]); }
      if (pts.length > 1) {
        s += `<polyline class="c-ratio" points="${pts.map(p => f(p[0]) + ',' + f(p[1])).join(' ')}"/>`;
        const last = pts[pts.length - 1];
        s += `<text class="c-ratiolabel" x="${f(Math.min(last[0] + 3, W - R - 2))}" y="${f(last[1] - 4)}" text-anchor="end">${esc(r.label)}</text>`;
      }
    });
    // 歷史點與本次
    (o.history || []).forEach((p, i) => {
      if (p.ey < x0 || p.ey > x1) return;
      const yy = clamp(p.tds, y0, y1);
      s += `<circle class="c-hist" cx="${f(X(p.ey))}" cy="${f(Y(yy))}" r="5"><title>${esc(p.label)}：EY ${p.ey.toFixed(1)}%、TDS ${p.tds.toFixed(2)}%</title></circle>`;
      s += `<text class="c-histnum" x="${f(X(p.ey))}" y="${f(Y(yy)) - 8}" text-anchor="middle">${p.n}</text>`;
    });
    if (o.current) {
      const p = o.current, cxp = X(clamp(p.ey, x0, x1)), cyp = Y(clamp(p.tds, y0, y1));
      s += `<line class="c-guide" x1="${f(cxp)}" x2="${f(cxp)}" y1="${f(cyp)}" y2="${H - B}"/><line class="c-guide" x1="${L}" x2="${f(cxp)}" y1="${f(cyp)}" y2="${f(cyp)}"/>`;
      s += `<circle class="c-now-halo" cx="${f(cxp)}" cy="${f(cyp)}" r="13"/><circle class="c-now" cx="${f(cxp)}" cy="${f(cyp)}" r="7"/>`;
    }
    s += `<text class="c-axis" x="${f((L + W - R) / 2)}" y="${H - 8}" text-anchor="middle">萃取率 EY（%）</text>`;
    s += `<text class="c-axis" transform="translate(14 ${f((T + H - B) / 2)}) rotate(-90)" text-anchor="middle">濃度 TDS（%）</text>`;
    return s + '</svg>';
  }

  function ratioLines(targetKey, absorb) {
    if (targetKey === 'espresso') return [1.5, 2, 2.5, 3].map(r => ({ label: '1:' + r, fn: e => e / r }));
    if (targetKey === 'moka') return [6, 8, 10].map(r => ({ label: '1:' + r, fn: e => e / (r * 0.75 - 1.4 + e / 100) }));
    if (targetKey === 'turkish') return [8, 10, 12].map(r => ({ label: '1:' + r, fn: e => e / (r - 1.6 + e / 100) }));
    if (targetKey === 'phin') return [4, 5, 6].map(r => ({ label: '1:' + r, fn: e => e / (r - 1.8 + e / 100) }));
    if (targetKey === 'cold') return [8, 10, 12].map(r => ({ label: '1:' + r, fn: e => e / (r - 2 + e / 100) }));
    const a = absorb == null ? 2 : absorb;
    return [13, 15, 17].map(r => ({ label: '1:' + r, fn: e => e / (r - a + e / 100) }));
  }

  /* ---------- 風味雷達 ---------- */
  const AXES = [['acid', '酸質'], ['sweet', '甜感'], ['bitter', '苦味'], ['body', '醇厚'], ['clarity', '乾淨度'], ['aroma', '香氣'], ['finish', '餘韻']];
  function radar(scores, potential) {
    const W = 360, H = 330, cx = 180, cy = 168, R = 118;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / AXES.length;
    const pt = (i, v) => [cx + Math.cos(ang(i)) * R * v / 10, cy + Math.sin(ang(i)) * R * v / 10];
    let s = `<svg class="chart radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="風味雷達圖">`;
    [2.5, 5, 7.5, 10].forEach(v => { s += `<polygon class="r-ring" points="${AXES.map((a, i) => pt(i, v).map(f).join(',')).join(' ')}"/>`; });
    AXES.forEach((a, i) => {
      const [x, y] = pt(i, 10);
      s += `<line class="r-spoke" x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}"/>`;
      const [lx, ly] = pt(i, 12.3);
      s += `<text class="r-label" x="${f(lx)}" y="${f(ly) + 4}" text-anchor="middle">${a[1]}</text>`;
      const [vx, vy] = pt(i, 12.3);
      s += `<text class="r-val" x="${f(vx)}" y="${f(vy) + 18}" text-anchor="middle">${scores[a[0]].toFixed(1)}</text>`;
    });
    if (potential) s += `<polygon class="r-pot" points="${AXES.map((a, i) => pt(i, clamp(potential[a[0]] || 0, 0, 10)).map(f).join(',')).join(' ')}"/>`;
    s += `<polygon class="r-area" points="${AXES.map((a, i) => pt(i, scores[a[0]]).map(f).join(',')).join(' ')}"/>`;
    AXES.forEach((a, i) => { const [x, y] = pt(i, scores[a[0]]); s += `<circle class="r-dot" cx="${f(x)}" cy="${f(y)}" r="3.2"/>`; });
    return s + '</svg>';
  }

  /* ---------- 萃取曲線（即時） ---------- */
  function liveChart(o) {
    const W = 560, H = 200, L = 40, R = 14, T = 12, B = 30;
    const sm = o.samples, tEnd = Math.max(1, o.tEnd);
    const sh = o.shares, em = o.emax;
    const maxY = Math.max(24, Math.ceil(Math.max(...sm.map(p => p.eyTot)) / 4) * 4 + 2);
    const X = scale(0, tEnd, L, W - R), Y = scale(0, maxY, H - B, T);
    let s = `<svg class="chart live" viewBox="0 0 ${W} ${H}" role="img" aria-label="萃取進度曲線">`;
    niceTicks(0, maxY, 4).forEach(v => { s += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="c-tick" x="${L - 6}" y="${f(Y(v)) + 4}" text-anchor="end">${v}</text>`; });
    const xt = tEnd >= 3600 ? niceTicks(0, tEnd / 3600, 6).map(v => v * 3600) : niceTicks(0, tEnd, 6);
    xt.forEach(v => { s += `<text class="c-tick" x="${f(X(v))}" y="${H - B + 16}" text-anchor="middle">${fmtT(v)}</text>`; });
    s += `<rect class="c-band" x="${L}" y="${f(Y(o.target.ey[1]))}" width="${W - L - R}" height="${f(Y(o.target.ey[0]) - Y(o.target.ey[1]))}"/>`;
    const lay = [['xa', 0, 'l-acid'], ['xs', 1, 'l-sweet'], ['xb', 2, 'l-bitter']];
    let prev = sm.map(() => 0);
    lay.forEach(([k, i, cls]) => {
      const cur = sm.map((p, j) => prev[j] + p[k] * em * sh[i]);
      const top = sm.map((p, j) => f(X(p.t)) + ',' + f(Y(cur[j]))).join(' ');
      const bot = sm.slice().reverse().map((p, j) => f(X(p.t)) + ',' + f(Y(prev[sm.length - 1 - j]))).join(' ');
      s += `<polygon class="${cls}" points="${top} ${bot}"/>`;
      prev = cur;
    });
    s += `<polyline class="l-cup" points="${sm.map(p => f(X(p.t)) + ',' + f(Y(p.ey))).join(' ')}"/>`;
    (o.marks || []).forEach(m => { s += `<line class="l-mark" x1="${f(X(m))}" x2="${f(X(m))}" y1="${H - B}" y2="${H - B + 5}"/>`; });
    if (o.release != null) s += `<line class="l-release" x1="${f(X(o.release))}" x2="${f(X(o.release))}" y1="${T}" y2="${H - B}"/>`;
    s += `<line class="l-play" id="live-play" x1="${f(X(o.playT || tEnd))}" x2="${f(X(o.playT || tEnd))}" y1="${T}" y2="${H - B}"/>`;
    s += `<text class="c-axis" x="${L}" y="${T - 2}" text-anchor="start" dy="0">%</text>`;
    return { svg: s + '</svg>', x: X };
  }

  /* ---------- 理論圖 ---------- */
  function lineChart(o) {
    const W = o.W || 560, H = o.H || 260, L = 46, R = 90, T = 16, B = 40;
    const X = scale(o.x[0], o.x[1], L, W - R), Y = scale(o.y[0], o.y[1], H - B, T);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}">`;
    (o.bands || []).forEach(b => { s += `<rect class="${b.cls}" x="${f(X(b.x0))}" y="${T}" width="${f(X(b.x1) - X(b.x0))}" height="${H - T - B}"/><text class="c-bandlabel" x="${f((X(b.x0) + X(b.x1)) / 2)}" y="${T + 14}" text-anchor="middle">${esc(b.label)}</text>`; });
    (o.yTicks || niceTicks(o.y[0], o.y[1], 5)).forEach(v => { s += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="c-tick" x="${L - 6}" y="${f(Y(v)) + 4}" text-anchor="end">${o.yFmt ? o.yFmt(v) : v}</text>`; });
    (o.xTicks || niceTicks(o.x[0], o.x[1], 6)).forEach(v => { s += `<text class="c-tick" x="${f(X(v))}" y="${H - B + 16}" text-anchor="middle">${o.xFmt ? o.xFmt(v) : v}</text>`; });
    (o.hlines || []).forEach(h => { s += `<line class="c-zone" x1="${L}" x2="${W - R}" y1="${f(Y(h.y))}" y2="${f(Y(h.y))}"/><text class="c-tick" x="${W - R + 4}" y="${f(Y(h.y)) + 4}">${esc(h.label)}</text>`; });
    (o.vlines || []).forEach(v => { s += `<line class="c-zone" x1="${f(X(v.x))}" x2="${f(X(v.x))}" y1="${T}" y2="${H - B}"/>`; });
    o.series.forEach(se => {
      s += `<polyline class="${se.cls}" points="${se.pts.map(p => f(X(p[0])) + ',' + f(Y(p[1]))).join(' ')}"/>`;
      const lp = se.pts[se.pts.length - 1];
      if (se.label) s += `<text class="c-serieslabel ${se.cls}-t" x="${f(X(lp[0]) + 6)}" y="${f(Y(lp[1]) + 4 + (se.dy || 0))}">${esc(se.label)}</text>`;
    });
    (o.points || []).forEach(p => { s += `<circle class="c-pt" cx="${f(X(p.x))}" cy="${f(Y(p.y))}" r="4"/><text class="c-ptlabel" x="${f(X(p.x) + (p.dx || 6))}" y="${f(Y(p.y) + (p.dy || -8))}" text-anchor="${p.anchor || 'start'}">${esc(p.label)}</text>`; });
    if (o.xLabel) s += `<text class="c-axis" x="${f((L + W - R) / 2)}" y="${H - 6}" text-anchor="middle">${esc(o.xLabel)}</text>`;
    if (o.yLabel) s += `<text class="c-axis" transform="translate(12 ${f((T + H - B) / 2)}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`;
    return s + '</svg>';
  }

  function grindLadder(methods) {
    const W = 600, rowH = 22, T = 26, L = 150, R = 20;
    const H = T + methods.length * rowH + 34;
    const lg = v => Math.log10(v);
    const X = scale(lg(60), lg(1700), L, W - R);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="各沖煮法的研磨範圍">`;
    [100, 200, 300, 500, 700, 1000, 1500].forEach(v => { s += `<line class="c-grid" x1="${f(X(lg(v)))}" x2="${f(X(lg(v)))}" y1="${T - 6}" y2="${H - 30}"/><text class="c-tick" x="${f(X(lg(v)))}" y="${H - 14}" text-anchor="middle">${v}</text>`; });
    [['麵粉', 90], ['細砂糖', 350], ['粗鹽', 1100]].forEach(([n, v]) => { s += `<text class="c-ref" x="${f(X(lg(v)))}" y="${T - 10}" text-anchor="middle">${n}</text>`; });
    methods.forEach((m, i) => {
      const y = T + i * rowH;
      s += `<text class="c-rowlabel" x="${L - 10}" y="${y + 14}" text-anchor="end">${esc(m.name)}</text>`;
      s += `<rect class="g-bar g-${m.cat}" x="${f(X(lg(m.grindRange[0])))}" y="${y + 4}" width="${f(X(lg(m.grindRange[1])) - X(lg(m.grindRange[0])))}" height="${rowH - 9}" rx="6"/>`;
    });
    s += `<text class="c-axis" x="${f((L + W - R) / 2)}" y="${H - 1}" text-anchor="middle">顆粒中位數（µm，對數刻度）</text>`;
    return s + '</svg>';
  }

  function distribution() {
    const W = 560, H = 230, L = 40, R = 110, T = 14, B = 40;
    const lg = v => Math.log10(v);
    const X = scale(lg(20), lg(2000), L, W - R), Y = scale(0, 1.05, H - B, T);
    const ln = (x, mu, sg) => Math.exp(-Math.pow(Math.log(x / mu), 2) / (2 * sg * sg));
    const curve = (fn) => { const p = []; for (let e = lg(20); e <= lg(2000); e += 0.02) { const x = Math.pow(10, e); p.push([X(e), Y(fn(x))]); } return p.map(q => f(q[0]) + ',' + f(q[1])).join(' '); };
    const flat = x => ln(x, 700, 0.28) + 0.12 * ln(x, 60, 0.5);
    const coni = x => 0.82 * ln(x, 680, 0.38) + 0.3 * ln(x, 55, 0.55);
    const blade = x => 0.5 * ln(x, 900, 0.7) + 0.45 * ln(x, 120, 0.8);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="不同磨豆機的粒徑分佈">`;
    [30, 100, 300, 1000].forEach(v => { s += `<line class="c-grid" x1="${f(X(lg(v)))}" x2="${f(X(lg(v)))}" y1="${T}" y2="${H - B}"/><text class="c-tick" x="${f(X(lg(v)))}" y="${H - B + 16}" text-anchor="middle">${v}</text>`; });
    s += `<rect class="c-band" x="${f(X(lg(20)))}" y="${T}" width="${f(X(lg(100)) - X(lg(20)))}" height="${H - T - B}"/><text class="c-bandlabel" x="${f(X(lg(45)))}" y="${T + 14}" text-anchor="middle">細粉</text>`;
    s += `<polyline class="d-flat" points="${curve(flat)}"/><polyline class="d-conical" points="${curve(coni)}"/><polyline class="d-blade" points="${curve(blade)}"/>`;
    s += `<text class="c-serieslabel d-flat-t" x="${W - R + 6}" y="${T + 20}">平刀</text><text class="c-serieslabel d-conical-t" x="${W - R + 6}" y="${T + 40}">錐刀</text><text class="c-serieslabel d-blade-t" x="${W - R + 6}" y="${T + 60}">刀片式</text>`;
    s += `<text class="c-axis" x="${f((L + W - R) / 2)}" y="${H - 6}" text-anchor="middle">顆粒大小（µm，對數刻度）· 縱軸為相對體積比例</text>`;
    return s + '</svg>';
  }

  root.Charts = { controlChart, ratioLines, radar, liveChart, lineChart, grindLadder, distribution, fmtT, niceTicks, AXES };
})(typeof window !== 'undefined' ? window : globalThis);
