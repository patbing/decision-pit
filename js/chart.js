/* Canvas chart: HIVE price (thick) and player equity (thin, ghosts dashed), all as % change from the start of turn 1.
 * The regime band is only painted after the match is over. Markers: headlines, cards, eliminations. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config;
  var W = C.WARMUP;

  var PALETTE = ['#e8a33d', '#4cc3a8', '#6aa7ff', '#ff7a90', '#b69cff', '#9ad65b', '#ffb86b', '#5fd0e8'];
  var GHOST = { 'g:buyhold': '#9aa4b2', 'g:monkey': '#c9a27a' };
  var REGIME_FILL = { BULL: 'rgba(76,195,168,0.13)', BEAR: 'rgba(255,122,144,0.13)', CHOP: 'rgba(154,164,178,0.10)', PANIC: 'rgba(182,100,255,0.16)' };

  function colorFor(game, p) {
    if (p.kind === 'ghost') return GHOST[p.id] || '#9aa4b2';
    var i = game.players.filter(function (x) { return x.kind !== 'ghost'; }).indexOf(p);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }

  function themeColors(canvas) {
    var cs = getComputedStyle(canvas);
    function v(n, d) { var x = cs.getPropertyValue(n).trim(); return x || d; }
    return { text: v('--muted', '#8d98a8'), grid: v('--line', '#263040'), price: v('--ink', '#f1f4f8'), bg: v('--panel', '#121823'), accent: v('--accent', '#e8a33d') };
  }

  // opts: { hidden:{id:true}, reveal:boolean, cursorTurn:number|null }
  function draw(canvas, game, opts) {
    opts = opts || {};
    var hidden = opts.hidden || {};
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 600, cssH = canvas.clientHeight || 320;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var th = themeColors(canvas);
    var padL = 46, padR = 12, padT = 18, padB = 22;
    var w = cssW - padL - padR, h = cssH - padT - padB;
    var T = game.T;
    var shown = Math.min(game.nextTurn, T);       // prices are known up to turn index "shown"
    var base = game.market.prices[W];              // price at the start of turn 1
    function x(t) { return padL + ((t + W) / (T + W)) * w; }

    // series values in % over the start
    var priceSeries = [];
    for (var t = -W; t <= shown; t++) priceSeries.push([t, (game.market.prices[t + W] / base - 1) * 100]);
    var lines = [];
    game.players.forEach(function (p) {
      if (hidden[p.id]) return;
      var pts = [];
      for (var i = 0; i < p.equityHist.length; i++) pts.push([i, (p.equityHist[i] / C.START_CASH - 1) * 100]);
      lines.push({ p: p, pts: pts });
    });
    var lo = Infinity, hi = -Infinity;
    function scan(pts) { pts.forEach(function (q) { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; }); }
    scan(priceSeries); lines.forEach(function (l) { scan(l.pts); });
    if (!isFinite(lo)) { lo = -5; hi = 5; }
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    var span = Math.max(hi - lo, 4); var mid = (hi + lo) / 2;
    lo = mid - span * 0.56; hi = mid + span * 0.56;
    function y(v) { return padT + (1 - (v - lo) / (hi - lo)) * h; }

    // regime bands (after the match only)
    if (opts.reveal) {
      for (var i2 = 0; i2 < T + W; i2++) {
        var rg = game.market.regimes[i2];
        ctx.fillStyle = REGIME_FILL[rg] || 'transparent';
        ctx.fillRect(padL + (i2 / (T + W)) * w, padT, w / (T + W) + 0.5, h);
      }
    }
    // warm-up shading
    ctx.fillStyle = 'rgba(128,140,160,0.06)';
    ctx.fillRect(padL, padT, x(0) - padL, h);

    // grid + axes
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    var step = niceStep((hi - lo) / 5);
    ctx.lineWidth = 1;
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      var yy = Math.round(y(g)) + 0.5;
      ctx.strokeStyle = Math.abs(g) < 1e-9 ? th.text : th.grid;
      ctx.globalAlpha = Math.abs(g) < 1e-9 ? 0.55 : 0.6;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + w, yy); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.text; ctx.fillText((g > 0 ? '+' : '') + trim(g) + '%', padL - 6, yy);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = th.text;
    var xs = [-W, 0, Math.round(T / 3), Math.round(2 * T / 3), T];
    xs.forEach(function (tt) { ctx.fillText(tt === 0 ? 'start' : String(tt), x(tt), padT + h + 5); });
    // survival checkpoints
    if (game.survival) {
      [Math.round(T / 3), Math.round(2 * T / 3)].forEach(function (c) {
        ctx.strokeStyle = th.accent; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(Math.round(x(c)) + 0.5, padT); ctx.lineTo(Math.round(x(c)) + 0.5, padT + h); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      });
    }

    function stroke(pts, color, width, dash, alpha) {
      if (!pts.length) return;
      ctx.beginPath();
      pts.forEach(function (q, k) { if (k === 0) ctx.moveTo(x(q[0]), y(q[1])); else ctx.lineTo(x(q[0]), y(q[1])); });
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // equity lines
    lines.forEach(function (l) {
      var p = l.p;
      var faded = p.status === 'eliminated';
      stroke(l.pts, colorFor(game, p), p.kind === 'ghost' ? 1.4 : 1.8, p.kind === 'ghost' ? [5, 4] : null, faded ? 0.45 : 0.95);
      var last = l.pts[l.pts.length - 1];
      if (p.status === 'eliminated' && last) {
        ctx.fillStyle = colorFor(game, p); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 12px system-ui, sans-serif'; ctx.fillText('✖', x(last[0]), y(last[1]));
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      }
    });
    // price on top (warm-up part is dimmer)
    stroke(priceSeries.filter(function (q) { return q[0] <= 0; }), th.price, 2.4, null, 0.45);
    stroke(priceSeries.filter(function (q) { return q[0] >= 0; }), th.price, 2.6, null, 1);

    // markers: headlines along the bottom of the plot, cards along the top
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '11px system-ui, sans-serif';
    for (var tk = 0; tk < shown; tk++) {
      var hl = game.headlineLog[tk];
      if (hl && hl.text && hl.kind !== 'card-rumor' && hl.kind !== 'card-shock') {
        ctx.fillStyle = th.text; ctx.globalAlpha = 0.9; ctx.fillText('▴', x(tk), padT + h - 6); ctx.globalAlpha = 1;
      }
    }
    (game.interventions || []).forEach(function (iv) {
      if (iv.turn > shown) return;
      var icon = iv.type === 'rumor' ? '🗞' : (iv.type === 'shock' ? '⚡' : '🤫');
      ctx.font = '13px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.fillText(icon, x(iv.turn), padT + 9);
    });

    // cursor
    if (typeof opts.cursorTurn === 'number' && opts.cursorTurn >= -W && opts.cursorTurn <= shown) {
      var cx = Math.round(x(opts.cursorTurn)) + 0.5;
      ctx.strokeStyle = th.text; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + h); ctx.stroke(); ctx.globalAlpha = 1;
    }
    return { padL: padL, padR: padR, w: w, T: T, shown: shown };
  }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }
  function trim(n) { var s = (Math.round(n * 10) / 10).toString(); return s; }

  // Turn index under a pointer x (css px relative to the canvas)
  function turnAt(canvas, game, px) {
    var padL = 46, padR = 12;
    var w = (canvas.clientWidth || 600) - padL - padR;
    var f = (px - padL) / w;
    var t = Math.round(f * (game.T + W) - W);
    return Math.max(-W, Math.min(Math.min(game.nextTurn, game.T), t));
  }

  DP.chart = { draw: draw, colorFor: colorFor, turnAt: turnAt, PALETTE: PALETTE };
})();
