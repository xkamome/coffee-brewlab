/* 沖煮器具的 SVG 插圖（吧台動畫與器具圖鑑共用）
 * 顏色走 CSS token（.s-*），只有咖啡液本身依濃度著色。viewBox 0 0 320 340。
 */
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const f = n => Math.round(n * 10) / 10;
  const pts = arr => arr.map(p => f(p[0]) + ',' + f(p[1])).join(' ');
  const poly = (arr, cls, extra) => `<polygon class="${cls}" points="${pts(arr)}" ${extra || ''}/>`;
  const rect = (x, y, w, h, cls, rx, extra) => `<rect class="${cls}" x="${f(x)}" y="${f(y)}" width="${f(Math.max(0, w))}" height="${f(Math.max(0, h))}" rx="${rx || 0}" ${extra || ''}/>`;
  const circ = (cx, cy, r, cls, extra) => `<circle class="${cls}" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${extra || ''}/>`;
  const path = (d, cls, extra) => `<path class="${cls}" d="${d}" ${extra || ''}/>`;
  const lerp = (a, b, k) => a + (b - a) * k;

  // 依 TDS 決定咖啡液顏色：淡琥珀 → 深褐（實物顏色，兩種主題相同）
  function coffeeRGB(tds) {
    const stops = [[0, [196, 150, 96]], [0.6, [176, 112, 58]], [1.3, [110, 58, 26]], [3, [66, 32, 14]], [9, [38, 18, 9]]];
    const x = clamp(tds || 0, 0, 9);
    let i = 0; while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
    const [x0, c0] = stops[i], [x1, c1] = stops[i + 1];
    const k = clamp((x - x0) / (x1 - x0), 0, 1);
    return c0.map((v, j) => Math.round(lerp(v, c1[j], k)));
  }
  function coffeeColor(tds, alpha) {
    const c = coffeeRGB(tds);
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha == null ? 0.92 : alpha})`;
  }

  // 平頂漏斗：在 y 位置的左右邊界
  function funnel(y0, xl0, xr0, y1, xl1, xr1) {
    return y => { const k = clamp((y - y0) / (y1 - y0), 0, 1); return [lerp(xl0, xl1, k), lerp(xr0, xr1, k)]; };
  }
  function band(at, yTop, yBot) {
    const a = at(yTop), b = at(yBot);
    return [[a[0], yTop], [a[1], yTop], [b[1], yBot], [b[0], yBot]];
  }

  function kettle(s, tx, ty) {
    const on = s.pour;
    const wig = s.style === 'center' || s.style === 'melodrip' ? 0 : s.style === 'stir' ? 10 * Math.sin(s.t * 7) : 16 * Math.sin(s.t * 3.2);
    const sx = 232, sy = 34;
    let out = `<g class="kettle ${on ? 'on' : ''}">`;
    out += path('M272 44 q-4 -26 20 -26 h14 v40 h-34 z', 's-solid');
    out += path('M306 24 q14 4 10 22', 's-line');
    out += path(`M274 50 C256 56 246 30 ${sx} ${sy}`, 's-spout');
    out += '</g>';
    if (on) {
      const w = clamp(1.2 + s.rate * 0.35, 1.2, 4.5);
      const ex = tx + wig;
      out += path(`M${sx} ${sy + 1} Q${sx - 6} ${sy + 20} ${f(ex)} ${f(ty)}`, 's-stream', `stroke-width="${f(w)}"`);
      if (s.style === 'melodrip') out += rect(tx - 22, ty - 10, 44, 4, 's-metal', 2);
    }
    return out;
  }

  function drips(x, y0, y1, s, color) {
    if (!s.flow || y1 - y0 < 4) return '';
    if (s.flowRate > 1.8) return path(`M${x} ${y0} L${x} ${f(y1)}`, 's-stream-c', `stroke="${color}" stroke-width="${f(clamp(s.flowRate * 0.7, 1, 4))}"`);
    let o = '';
    for (let i = 0; i < 3; i++) {
      const ph = ((s.t * 1.8 + i / 3) % 1);
      o += circ(x, lerp(y0, y1, ph), 2.2, '', `fill="${color}"`);
    }
    return o;
  }

  function server(s, x0, x1, top, bot, id) {
    const cp = `clip-${id}`;
    const shape = `M${x0 + 8} ${top} L${x1 - 8} ${top} Q${x1 + 4} ${top + 10} ${x1 + 6} ${top + 40} L${x1} ${bot - 12} Q${x1 - 2} ${bot} ${x1 - 16} ${bot} L${x0 + 16} ${bot} Q${x0 + 2} ${bot} ${x0} ${bot - 12} L${x0 - 6} ${top + 40} Q${x0 - 4} ${top + 10} ${x0 + 8} ${top} Z`;
    const fill = clamp(s.cupFrac || 0, 0, 1) * (bot - top - 26);
    let o = `<defs><clipPath id="${cp}"><path d="${shape}"/></clipPath></defs>`;
    o += path(shape, 's-glass');
    o += `<g clip-path="url(#${cp})">${rect(x0 - 10, bot - fill, x1 - x0 + 20, fill + 2, '', 0, `fill="${coffeeColor(s.tds)}"`)}</g>`;
    o += path(`M${x1 + 4} ${top + 16} q24 6 18 44 q-4 22 -18 26`, 's-line');
    return o;
  }

  function mug(s, x0, x1, top, bot, id) {
    const fill = clamp(s.cupFrac || 0, 0, 1) * (bot - top - 8);
    const cp = `clip-${id}`;
    const shape = `M${x0} ${top} L${x1} ${top} L${x1 - 4} ${bot - 8} Q${x1 - 6} ${bot} ${x1 - 14} ${bot} L${x0 + 14} ${bot} Q${x0 + 6} ${bot} ${x0 + 4} ${bot - 8} Z`;
    let o = `<defs><clipPath id="${cp}"><path d="${shape}"/></clipPath></defs>`;
    o += path(shape, 's-cup');
    o += `<g clip-path="url(#${cp})">${rect(x0, bot - fill, x1 - x0, fill + 1, '', 0, `fill="${coffeeColor(s.tds)}"`)}</g>`;
    o += path(`M${x1 - 1} ${top + 10} q18 2 14 18 q-3 12 -16 12`, 's-line');
    return o;
  }

  function flame(cx, y, size, on) {
    if (!on) return '';
    const h = 10 + size * 10;
    return `<g class="flame">${path(`M${cx - 14} ${y} q14 ${-h} 14 ${-h * 1.3} q2 ${h * 0.6} 14 ${h * 1.3} z`, 's-flame')}${path(`M${cx - 6} ${y} q6 ${-h * 0.6} 6 ${-h * 0.8} q2 ${h * 0.4} 6 ${h * 0.8} z`, 's-flame-in')}</g>`;
  }

  /* ---------- 各器具 ---------- */
  function coneLike(s, kind) {
    const top = 70, bot = 180;
    const flat = kind === 'flat';
    const at = flat ? funnel(top, 88, 232, bot - 6, 122, 198) : funnel(top, 86, 234, bot - 6, 150, 170);
    let o = counter();
    o += server(s, 108, 212, 204, 314, 'srv');
    // 濾杯外殼與底座
    const outer = flat ? [[80, top - 6], [240, top - 6], [204, bot], [116, bot]] : [[78, top - 6], [242, top - 6], [178, bot], [142, bot]];
    o += poly(outer, 's-solid');
    o += rect(118, bot - 2, 84, 10, 's-solid', 3);
    o += poly(band(at, top, bot - 6), 's-paper');
    if (kind === 'origami') for (let i = 1; i < 10; i++) { const k = i / 10; o += path(`M${f(lerp(78, 242, k))} ${top - 6} L${f(lerp(142, 178, k))} ${bot}`, 's-pleat'); }
    if (kind === 'cone') for (let i = 0; i < 4; i++) o += path(`M${104 + i * 30} ${top + 6} q10 40 ${34 - i * 6} 92`, 's-rib');
    if (flat) { let z = `M${at(top + 2)[0]} ${top + 2}`; for (let i = 0; i <= 20; i++) z += ` L${f(lerp(at(top + 2)[0], at(top + 2)[1], i / 20))} ${top + 2 + (i % 2 ? 5 : 0)}`; o += path(z, 's-line'); }
    // 粉層與液面
    const bedH = 40 * (1 + 0.18 * (s.bedWet || 0));
    const bedTop = bot - 6 - bedH;
    o += poly(band(at, bedTop, bot - 6), 's-ground');
    if (s.bedWet > 0) o += poly(band(at, bedTop, bot - 6), '', `fill="${coffeeColor(3, 0.5 * s.bedWet)}"`);
    const liqH = clamp(s.level || 0, 0, 1) * (bedTop - top - 8);
    if (liqH > 0.5) o += poly(band(at, bedTop - liqH, bedTop + 2), '', `fill="${coffeeColor(s.slurryTds || 1, 0.55)}"`);
    if (s.bloom) for (let i = 0; i < 6; i++) o += circ(lerp(at(bedTop)[0] + 10, at(bedTop)[1] - 10, (i * 0.37 + s.t * 0.05) % 1), bedTop - 2, 2 + (i % 3), 's-bubble');
    o += drips(160, bot + 8, 314 - clamp(s.cupFrac || 0, 0, 1) * 84, s, coffeeColor(s.tds + 1.2));
    o += kettle(s, 160, bedTop - liqH);
    return o;
  }

  function chemex(s) {
    const up = funnel(40, 92, 228, 150, 150, 170);
    const lo = funnel(150, 150, 170, 312, 86, 234);
    let o = counter();
    const body = `M92 40 L228 40 L170 150 L234 300 Q236 314 222 314 L98 314 Q84 314 86 300 L150 150 Z`;
    o += path(body, 's-glass');
    const fill = clamp(s.cupFrac || 0, 0, 1) * 110;
    if (fill > 0.5) o += poly(band(lo, 312 - fill, 312), '', `fill="${coffeeColor(s.tds)}"`);
    o += poly([[88, 30], [232, 30], [168, 146], [152, 146]], 's-paper');
    const bedH = 34 * (1 + 0.15 * (s.bedWet || 0)), bedTop = 146 - bedH;
    o += poly(band(up, bedTop, 146), 's-ground');
    if (s.bedWet > 0) o += poly(band(up, bedTop, 146), '', `fill="${coffeeColor(3, 0.5 * s.bedWet)}"`);
    const liqH = clamp(s.level || 0, 0, 1) * (bedTop - 50);
    if (liqH > 0.5) o += poly(band(up, bedTop - liqH, bedTop + 2), '', `fill="${coffeeColor(s.slurryTds || 1, 0.55)}"`);
    o += poly([[136, 128], [184, 128], [178, 170], [142, 170]], 's-wood');
    o += path('M140 150 L180 150', 's-line');
    o += circ(186, 156, 3.5, 's-wood');
    o += drips(160, 152, 312 - fill, s, coffeeColor(s.tds + 1.2));
    o += kettle(s, 160, bedTop - liqH);
    return o;
  }

  function clever(s) {
    const top = 72, bot = 182;
    const at = funnel(top, 96, 224, bot - 6, 134, 186);
    let o = counter();
    o += server(s, 108, 212, 212, 314, 'srv');
    o += poly([[88, top - 6], [232, top - 6], [194, bot], [126, bot]], 's-solid');
    o += poly(band(at, top, bot - 6), 's-paper');
    o += rect(120, bot, 80, 14, 's-solid', 3);
    o += circ(160, bot + 7, 4.2, s.valveOpen ? 's-ok' : 's-stop');
    const bedH = 36, bedTop = bot - 6 - bedH;
    const liqH = clamp(s.level || 0, 0, 1) * (bedTop - top - 8);
    o += poly(band(at, bedTop, bot - 6), 's-ground');
    if (liqH > 0.5) o += poly(band(at, bedTop - liqH, bot - 6), '', `fill="${coffeeColor(s.slurryTds || 1, 0.6)}"`);
    o += `<text class="s-label" x="210" y="${bot + 11}">${s.valveOpen ? '閥門開' : '閥門關'}</text>`;
    o += drips(160, bot + 16, 314 - clamp(s.cupFrac || 0, 0, 1) * 76, s, coffeeColor(s.tds + 1.2));
    o += kettle(s, 160, bedTop - liqH);
    return o;
  }

  function press(s) {
    const x0 = 110, x1 = 210, top = 92, bot = 300;
    let o = counter();
    o += mug(s, 22, 88, 262, 312, 'mug');
    const waterTop = bot - clamp(s.fillFrac || 0, 0, 1) * 170;
    o += rect(x0, top, x1 - x0, bot - top, 's-glass', 6);
    if (s.fillFrac > 0.01) {
      o += rect(x0 + 2, waterTop, x1 - x0 - 4, bot - waterTop - 2, '', 4, `fill="${coffeeColor(s.slurryTds || 0.8, 0.85)}"`);
      const settle = clamp(s.settle || 0, 0, 1);
      const crustY = lerp(waterTop, bot - 26, settle);
      o += rect(x0 + 2, crustY, x1 - x0 - 4, lerp(14, 24, settle), 's-ground', 3);
    }
    const discY = s.released ? lerp(waterTop, bot - 30, clamp(s.releaseProg || 0, 0, 1)) : Math.min(waterTop - 4, top + 4);
    o += rect(x0 + 3, discY, x1 - x0 - 6, 5, 's-metal', 2);
    o += rect(157, 32, 6, discY - 32, 's-metal');
    o += circ(160, 30, 8, 's-metal');
    o += rect(x0 - 6, top - 12, x1 - x0 + 12, 12, 's-metal', 3);
    o += rect(x0 - 8, bot, x1 - x0 + 16, 10, 's-metal', 3);
    o += path(`M${x1} 130 q40 0 36 60 q-4 50 -36 56`, 's-handle');
    o += kettle(s, 160, waterTop);
    return o;
  }

  function aero(s) {
    const x0 = 128, x1 = 192, top = 100, bot = 262;
    let o = counter();
    o += mug(s, 112, 208, 272, 318, 'mug');
    o += rect(x0, top, x1 - x0, bot - top, 's-glass', 3);
    for (let i = 1; i <= 4; i++) o += path(`M${x0 + 4} ${bot - i * 32} h10`, 's-line');
    const liq = clamp(s.fillFrac || 0, 0, 1) * 130;
    const liqTop = bot - liq;
    if (liq > 0.5) o += rect(x0 + 2, liqTop, x1 - x0 - 4, liq - 2, '', 2, `fill="${coffeeColor(s.slurryTds || 0.8, 0.85)}"`);
    o += rect(x0 + 2, bot - 18, x1 - x0 - 4, 16, 's-ground', 2);
    o += rect(x0 - 6, bot, x1 - x0 + 12, 8, 's-solid', 2);
    const plY = s.released ? lerp(liqTop - 4, bot - 22, clamp(s.releaseProg || 0, 0, 1)) : Math.min(liqTop - 4, top + 6);
    if (s.fillFrac > 0.05 || s.static) {
      o += rect(x0 + 4, plY - 110, x1 - x0 - 8, 110, 's-plunger', 3);
      o += rect(x0 + 1, plY - 6, x1 - x0 - 2, 8, 's-seal', 2);
      o += rect(x0 - 8, plY - 118, x1 - x0 + 16, 8, 's-plunger', 3);
    }
    o += drips(160, bot + 8, 318 - clamp(s.cupFrac || 0, 0, 1) * 38, s, coffeeColor(s.tds + 1));
    o += kettle(s, 160, liqTop);
    return o;
  }

  function siphon(s) {
    let o = counter();
    o += rect(70, 318, 180, 8, 's-solid', 3);
    o += rect(236, 60, 6, 258, 's-metal');
    o += path('M236 120 L196 120 M236 214 L210 214', 's-line');
    // 上座
    o += path('M124 64 L196 64 L196 160 Q196 176 170 182 L166 196 L154 196 L150 182 Q124 176 124 160 Z', 's-glass');
    o += rect(157, 196, 6, 96, 's-glass');
    // 下壺
    o += circ(160, 262, 52, 's-glass');
    const up = clamp(s.upFrac || 0, 0, 1), down = clamp(s.downFrac || 0, 0, 1);
    const upH = up * 100;
    if (upH > 1) o += `<defs><clipPath id="clip-sy"><path d="M124 64 L196 64 L196 160 Q196 176 170 182 L150 182 Q124 176 124 160 Z"/></clipPath></defs><g clip-path="url(#clip-sy)">${rect(120, 182 - upH, 80, upH, '', 0, `fill="${coffeeColor(s.slurryTds || 0.8, 0.85)}"`)}${rect(120, 182 - upH, 80, Math.min(upH, 12), 's-ground')}</g>`;
    const lowH = s.released ? down : (1 - up);
    if (lowH > 0.01) o += `<defs><clipPath id="clip-sl"><circle cx="160" cy="262" r="52"/></clipPath></defs><g clip-path="url(#clip-sl)">${rect(100, 314 - lowH * 80, 120, lowH * 80, s.released ? '' : 's-water', 0, s.released ? `fill="${coffeeColor(s.tds)}"` : '')}</g>`;
    o += flame(160, 318, 0.4, !s.released || s.static);
    o += kettle(Object.assign({}, s, { pour: false }), 160, 100);
    return o;
  }

  function jar(s) {
    let o = counter();
    const x0 = 96, x1 = 224, top = 98, bot = 308;
    o += rect(x0, top, x1 - x0, bot - top, 's-glass', 12);
    const fillH = clamp(s.fillFrac || 0, 0, 1) * 180;
    if (fillH > 1) {
      o += rect(x0 + 3, bot - fillH, x1 - x0 - 6, fillH - 3, '', 10, `fill="${coffeeColor(s.slurryTds || 0.5, 0.85)}"`);
      o += rect(x0 + 3, bot - 30, x1 - x0 - 6, 27, 's-ground', 8);
    }
    o += rect(x0 - 4, top - 14, x1 - x0 + 8, 16, 's-metal', 4);
    const p = clamp(s.prog || 0, 0, 1);
    const a = -Math.PI / 2 + p * Math.PI * 2;
    o += circ(268, 76, 24, 's-line');
    if (p > 0) o += path(`M268 76 L268 52 A24 24 0 ${p > 0.5 ? 1 : 0} 1 ${f(268 + 24 * Math.cos(a))} ${f(76 + 24 * Math.sin(a))} Z`, 's-clock');
    o += `<text class="s-label" x="268" y="118" text-anchor="middle">${s.hoursLabel || ''}</text>`;
    if (s.fridge) o += `<text class="s-label" x="268" y="136" text-anchor="middle">冷藏 5°C</text>`;
    return o;
  }

  function espresso(s) {
    let o = counter();
    o += rect(58, 16, 204, 62, 's-solid', 8);
    o += rect(128, 78, 64, 16, 's-metal', 3);
    o += path('M124 96 L196 96 L188 122 L132 122 Z', 's-metal');
    o += rect(30, 101, 96, 11, 's-wood', 5);
    o += rect(92, 312, 136, 8, 's-metal', 2);
    // 壓力錶
    const P = clamp(s.pressure || 0, 0, 12);
    const ang = (-210 + (P / 12) * 240) * Math.PI / 180;
    o += circ(236, 47, 20, 's-gauge');
    o += path(`M236 47 L${f(236 + 15 * Math.cos(ang))} ${f(47 + 15 * Math.sin(ang))}`, 's-needle');
    o += `<text class="s-label" x="236" y="62" text-anchor="middle">${P.toFixed(1)}</text>`;
    // 杯
    const cupTop = 236, cupBot = 312;
    const fill = clamp(s.cupFrac || 0, 0, 1) * 58;
    o += `<defs><clipPath id="clip-esp"><path d="M130 ${cupTop} L190 ${cupTop} L186 ${cupBot - 6} Q185 ${cupBot} 178 ${cupBot} L142 ${cupBot} Q135 ${cupBot} 134 ${cupBot - 6} Z"/></clipPath></defs>`;
    o += path(`M130 ${cupTop} L190 ${cupTop} L186 ${cupBot - 6} Q185 ${cupBot} 178 ${cupBot} L142 ${cupBot} Q135 ${cupBot} 134 ${cupBot - 6} Z`, 's-glass');
    if (fill > 0.5) o += `<g clip-path="url(#clip-esp)">${rect(128, cupBot - fill, 64, fill, '', 0, `fill="${coffeeColor(9)}"`)}${rect(128, cupBot - fill, 64, Math.min(7, fill), 's-crema')}</g>`;
    if (s.flow) {
      const col = coffeeColor(s.instTds || 9, 0.95);
      const w = clamp(0.8 + s.flowRate * 1.3, 1, 5);
      o += path(`M160 122 L160 ${f(cupBot - fill)}`, 's-stream-c', `stroke="${col}" stroke-width="${f(w)}"`);
    } else if (s.prog > 0 && s.prog < 1) {
      for (let i = 0; i < 3; i++) o += circ(146 + i * 14, 125, 2 + ((s.t * 2 + i) % 1) * 2, '', `fill="${coffeeColor(10)}"`);
    }
    return o;
  }

  function moka(s) {
    let o = counter();
    o += flame(160, 316, s.heat === 'high' ? 1 : s.heat === 'low' ? 0.2 : 0.55, !s.done || s.static);
    o += poly([[112, 202], [208, 202], [218, 302], [102, 302]], 's-metal');
    const w = clamp(s.boilerFrac == null ? 1 : s.boilerFrac, 0, 1);
    o += `<defs><clipPath id="clip-mk"><polygon points="114,206 206,206 214,298 106,298"/></clipPath></defs>`;
    o += `<g clip-path="url(#clip-mk)">${rect(100, 298 - w * 80, 120, w * 80, 's-water')}</g>`;
    o += rect(106, 190, 108, 14, 's-metal', 2);
    o += poly([[116, 96], [204, 96], [198, 190], [122, 190]], 's-glass');
    const fill = clamp(s.cupFrac || 0, 0, 1) * 76;
    if (fill > 0.5) o += poly([[lerp(122, 116, fill / 94), 188 - fill], [lerp(198, 204, fill / 94), 188 - fill], [198, 188], [122, 188]], '', `fill="${coffeeColor(s.tds)}"`);
    o += rect(156, 110, 8, 80, 's-metal');
    if (s.flow) {
      const col = coffeeColor(s.sputter ? 1.2 : 3.2, 0.95);
      for (let i = 0; i < 3; i++) { const k = (s.t * 1.6 + i / 3) % 1; o += circ(160 + (i - 1) * 10 * k, 108 + k * 22, s.sputter ? 3.4 : 2.4, '', `fill="${col}"`); }
      if (s.sputter) for (let i = 0; i < 3; i++) o += circ(150 + i * 10, 88 - ((s.t * 2 + i / 3) % 1) * 24, 4, 's-steam');
    }
    o += path('M116 96 L96 88 L116 110', 's-line');
    o += path('M204 112 q34 0 32 36 q-2 30 -32 34', 's-handle');
    o += rect(112, 88, 96, 8, 's-metal', 3);
    return o;
  }

  function cezve(s) {
    let o = counter();
    o += rect(84, 300, 152, 16, 's-sand', 4);
    const heat = s.heating;
    if (heat) o += rect(96, 296, 128, 6, 's-glow', 3);
    o += mug(Object.assign({}, s, { cupFrac: s.done ? s.cupFrac : 0 }), 18, 76, 262, 306, 'tc');
    const body = 'M134 196 L186 196 Q190 222 204 250 Q214 272 210 292 L110 292 Q106 272 116 250 Q130 222 134 196 Z';
    o += `<defs><clipPath id="clip-cz"><path d="${body}"/></clipPath></defs>`;
    o += path(body, 's-copper');
    const foam = clamp(((s.T || 25) - 70) / 27, 0, 1) * (s.done ? 0.4 : 1);
    const liqTop = 238 - foam * 30;
    o += `<g clip-path="url(#clip-cz)" opacity="0.92">${rect(100, liqTop, 120, 292 - liqTop, '', 0, `fill="${coffeeColor(2.6)}"`)}${rect(100, liqTop - 2, 120, 6 + foam * 16, 's-foam')}</g>`;
    o += path('M130 194 L190 194', 's-line');
    o += path('M200 222 L292 200', 's-handle');
    if (heat && foam > 0.4) for (let i = 0; i < 3; i++) o += circ(146 + i * 14, liqTop - 6 - ((s.t * 1.5 + i / 3) % 1) * 30, 4, 's-steam');
    return o;
  }

  function phin(s) {
    let o = counter();
    const x0 = 118, x1 = 202, top = 196, bot = 314;
    o += `<defs><clipPath id="clip-ph"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bot - top}" rx="8"/></clipPath></defs>`;
    o += rect(x0, top, x1 - x0, bot - top, 's-glass', 8);
    const milk = s.milk ? 22 : 0;
    const fill = clamp(s.cupFrac || 0, 0, 1) * 62;
    o += `<g clip-path="url(#clip-ph)">${milk ? rect(x0, bot - milk, x1 - x0, milk, 's-milk') : ''}${fill > 0.5 ? rect(x0, bot - milk - fill, x1 - x0, fill, '', 0, `fill="${coffeeColor(s.tds)}"`) : ''}</g>`;
    o += rect(106, 184, 108, 8, 's-metal', 3);
    o += rect(128, 118, 64, 68, 's-metal', 4);
    o += rect(124, 108, 72, 10, 's-metal', 4);
    o += circ(160, 104, 5, 's-metal');
    for (let i = 0; i < 6; i++) o += circ(136 + i * 10, 182, 1.4, 's-hole');
    o += drips(160, 196, bot - milk - fill, s, coffeeColor(s.tds + 2));
    o += kettle(s, 160, 118);
    return o;
  }

  function tower(s) {
    let o = counter();
    o += rect(84, 312, 152, 8, 's-wood', 3);
    o += rect(86, 18, 8, 296, 's-wood', 3);
    o += rect(226, 18, 8, 296, 's-wood', 3);
    o += rect(86, 18, 148, 10, 's-wood', 3);
    const w = clamp(s.boilerFrac == null ? 1 : s.boilerFrac, 0, 1);
    o += `<defs><clipPath id="clip-tw"><circle cx="160" cy="66" r="32"/></clipPath></defs>`;
    o += circ(160, 66, 32, 's-glass');
    o += `<g clip-path="url(#clip-tw)">${rect(120, 98 - w * 62, 80, w * 62, 's-water')}</g>`;
    o += rect(156, 98, 8, 16, 's-glass');
    o += circ(160, 118, 4, 's-metal');
    if (s.flow || s.pour) { const k = (s.t * 2) % 1; o += circ(160, lerp(124, 150, k), 2.4, 's-water-drop'); }
    o += rect(126, 150, 68, 50, 's-glass', 4);
    o += rect(128, 170, 64, 28, 's-ground', 3);
    if (s.bedWet > 0) o += rect(128, 170, 64, 28, '', 3, `fill="${coffeeColor(3, 0.55 * s.bedWet)}"`);
    o += path('M160 200 q-22 8 0 14 q22 6 0 14 q-22 6 0 14 q22 6 0 12', 's-coil');
    const fill = clamp(s.cupFrac || 0, 0, 1) * 44;
    o += rect(124, 260, 72, 52, 's-glass', 8);
    if (fill > 0.5) o += rect(126, 310 - fill, 68, fill, '', 6, `fill="${coffeeColor(s.tds)}"`);
    o += drips(160, 250, 310 - fill, s, coffeeColor(s.tds + 1));
    return o;
  }

  const counter = () => path('M8 322 L312 322', 's-counter');

  const DRAW = { cone: s => coneLike(s, 'cone'), origami: s => coneLike(s, 'origami'), flat: s => coneLike(s, 'flat'),
    chemex, clever, press, aero, siphon, jar, espresso, moka, cezve, phin, tower };

  let uid = 0;
  function svg(type, s, cls, key) {
    const fn = DRAW[type] || DRAW.cone;
    const id = key || 'u' + (++uid);
    const body = fn(Object.assign({ t: 0, level: 0, bedWet: 0, cupFrac: 0, tds: 1.3 }, s)).replace(/clip-/g, 'c' + id + '-');
    return `<svg class="${cls || 'brewer'}" viewBox="0 0 320 340" role="img" aria-hidden="true">${body}</svg>`;
  }

  // 靜態展示用的狀態
  function staticState(type) {
    const base = { static: true, t: 0.3, pour: false, bedWet: 1, level: 0.35, cupFrac: 0.55, tds: 1.35, slurryTds: 1.1, fillFrac: 0.8, settle: 0.2, valveOpen: false, flow: true, flowRate: 0.6 };
    const per = {
      espresso: { cupFrac: 0.55, tds: 9, instTds: 6, flow: true, flowRate: 1.4, pressure: 9, prog: 0.6 },
      moka: { cupFrac: 0.5, flow: true, boilerFrac: 0.4, heat: 'med' },
      cezve: { T: 94, heating: true, cupFrac: 0 },
      phin: { milk: true, cupFrac: 0.5, tds: 4.5 },
      jar: { prog: 0.62, hoursLabel: '10 / 16 小時', fillFrac: 0.85, slurryTds: 1.6 },
      siphon: { upFrac: 0.9, slurryTds: 1.2 },
      tower: { boilerFrac: 0.6, cupFrac: 0.45, tds: 2 },
      press: { fillFrac: 0.82, slurryTds: 1.2, cupFrac: 0 },
      aero: { fillFrac: 0.65, slurryTds: 1.2, cupFrac: 0 }
    };
    return Object.assign(base, per[type] || {});
  }

  root.Draw = { svg, coffeeColor, coffeeRGB, staticState };
})(typeof window !== 'undefined' ? window : globalThis);
