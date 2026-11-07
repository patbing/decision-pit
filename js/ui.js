/* DOM rendering. All dynamic text goes through esc(): model titles and API messages come from the network. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(x) { return Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(x, d) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function pollen(x, known) { return (known === false ? '≥ ' : '') + Number(x).toFixed(5); }
  function cls(x) { return x > 0.00005 ? 'pos' : (x < -0.00005 ? 'neg' : ''); }
  function ico(a) { return a === 'buy' ? '▲' : (a === 'sell' ? '▼' : '■'); }

  // ---------- model helpers ----------
  function priceNum(m, f) { var n = Number(m.pricing && m.pricing[f]); return isFinite(n) ? n : 0; }
  function modelBadge(m) {
    var free = !priceNum(m, 'promptTextTokens') && !priceNum(m, 'completionTextTokens');
    if (free) return { cls: 'free', text: 'Free' };
    return m.paidOnly ? { cls: 'paid', text: 'Paid Pollen' } : { cls: 'quest', text: 'Quest Pollen OK' };
  }
  // rough estimate for one model: (turns + 1 check-in) calls of ~700 input and ~8 output tokens
  function estCost(m, T) {
    return (T + 1) * (700 * priceNum(m, 'promptTextTokens') + 8 * priceNum(m, 'completionTextTokens'));
  }

  // ---------- top bar ----------
  function renderTop(app) {
    var g = app.game;
    var mode = app.view === 'setup' ? (app.setup.mode === 'live' ? 'live' : 'offline') : (g ? g.mode : 'offline');
    var b = $('mode-badge');
    b.className = 'badge mode ' + mode;
    b.textContent = mode === 'live' ? 'LIVE' : (mode === 'replay' ? 'REPLAY' : 'OFFLINE SIMULATION');
    var sp = $('spent');
    if (g && g.mode === 'live') {
      sp.hidden = false;
      sp.innerHTML = 'Spent: <b>' + pollen(g.spent, true) + '</b> Pollen' + (g.state !== 'finished' ? ' <small>/ cap ' + Number(g.costCap).toFixed(3) + '</small>' : '');
    } else sp.hidden = true;
    var note = $('reconnect-note');
    if (note) note.hidden = !(app.view === 'match' && g && g.mode === 'live' && g.state !== 'finished');
  }

  // ---------- setup ----------
  function renderSetup(app) {
    var s = app.setup, T = Number(s.T);
    var liveOk = !app.liveReason();
    var h = '';

    h += '<div class="panel"><h2>1 · Mode</h2><div class="radios">' +
      '<label class="radio ' + (liveOk ? '' : 'disabled') + '" title="' + esc(liveOk ? '' : app.liveReason()) + '"><input type="radio" name="mode" value="live" data-change="mode"' +
      (s.mode === 'live' ? ' checked' : '') + (liveOk ? '' : ' disabled') + '><span><b>Live</b> · real decision models, your Pollen</span></label>' +
      '<label class="radio"><input type="radio" name="mode" value="offline" data-change="mode"' + (s.mode === 'offline' ? ' checked' : '') +
      '><span><b>Offline simulation</b> · rule-based bots, 0 Pollen</span></label></div>';
    if (!liveOk) h += '<p class="hint warn">Live is off: ' + esc(app.liveReason()) + '.</p>';
    h += '</div>';

    // players
    h += '<div class="panel"><h2>2 · Players <small>(max ' + C.MAX_AI_PLAYERS + ')</small></h2>';
    h += '<h3 class="sub">Decision models <small>from GET /v1/models?category=decision</small></h3>';
    if (app.modelsStatus === 'loading') h += '<p class="hint">Loading model list…</p>';
    else if (app.modelsStatus === 'error') h += '<p class="hint warn">Model list unavailable. <button class="btn small" data-act="retry-models">Retry</button></p>';
    else if (!app.models.length) h += '<p class="hint">The API returned no decision models.</p>';
    else {
      h += '<ul class="rows">';
      app.models.forEach(function (m) {
        var bd = modelBadge(m), noul = m.noulOnly;
        var dis = s.mode !== 'live' || !app.key || noul;
        var checked = !!s.models[m.id] && !dis;
        var why = noul ? 'noul-only — not compatible' : (!app.key ? 'Connect to play live' : (s.mode !== 'live' ? 'Switch to Live mode' : ''));
        h += '<li class="row' + (dis ? ' dim' : '') + '"><label><input type="checkbox" data-change="model" data-id="' + esc(m.id) + '"' + (checked ? ' checked' : '') + (dis ? ' disabled' : '') + '>' +
          '<span class="rname"><b>' + esc(m.title) + '</b> <code>' + esc(m.id) + '</code></span></label>' +
          '<span class="chips"><span class="chip ' + bd.cls + '">' + bd.text + '</span>' +
          (m.rpm ? '<span class="chip">' + m.rpm + ' rpm</span>' : '') +
          (m.health ? '<span class="chip ' + (m.health === 'ok' ? 'free' : 'warnc') + '">' + esc(m.health) + '</span>' : '') +
          (bd.cls !== 'free' ? '<span class="chip">≈ ' + estCost(m, T).toFixed(4) + ' Pollen / match</span>' : '') +
          (why ? '<span class="chip muted">' + esc(why) + '</span>' : '') + '</span></li>';
      });
      h += '</ul>';
    }
    h += '<h3 class="sub">Simulated bots <small>(tagged “Sim”, never calls the network)</small></h3><ul class="rows two">';
    DP.sim.BOT_IDS.forEach(function (id) {
      h += '<li class="row"><label><input type="checkbox" data-change="sim" data-id="' + id + '"' + (s.sims[id] ? ' checked' : '') + '><span class="rname"><b>' + esc(DP.sim.BOTS[id].name) + '</b></span></label></li>';
    });
    h += '</ul><h3 class="sub">Baselines</h3><ul class="rows two">' +
      '<li class="row"><label><input type="checkbox" data-change="ghost" data-id="buyhold"' + (s.ghosts.buyhold ? ' checked' : '') + '><span class="rname"><b>Buy &amp; Hold</b> <small>buys on turn 1, never sells</small></span></label></li>' +
      '<li class="row"><label><input type="checkbox" data-change="ghost" data-id="monkey"' + (s.ghosts.monkey ? ' checked' : '') + '><span class="rname"><b>Random Monkey</b> <small>random, same sizing rule</small></span></label></li></ul></div>';

    // rules
    h += '<div class="panel"><h2>3 · Rules</h2><div class="fields">' +
      '<label>Turns<select data-change="T">' + C.TURN_CHOICES.map(function (n) { return '<option' + (n === T ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<label class="chk"><input type="checkbox" data-change="survival"' + (s.survival ? ' checked' : '') + '> Survival (lowest equity out at ⅓ and ⅔)</label>' +
      '<label>Seed<span class="seedrow"><input id="seed" inputmode="numeric" maxlength="9" value="' + esc(s.seed) + '"><button class="btn small" data-act="dice" title="New random seed">🎲</button></span></label>' +
      '<label>Speed<select data-change="speedMs">' + [[1500, 'Fast · 1.5 s'], [3000, 'Normal · 3 s'], [6000, 'Slow · 6 s']].map(function (o) { return '<option value="' + o[0] + '"' + (Number(s.speedMs) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      (s.mode === 'live' ? '<label>Cost cap (Pollen)<input id="costcap" type="number" min="0.001" max="1" step="0.005" value="' + esc(s.costCap) + '"></label>' : '') +
      '</div></div>';

    // pick
    var cand = candidates(app);
    h += '<div class="panel"><h2>4 · Your pick <small>(optional)</small></h2><label class="fields one">Cheer for one player<select data-change="pick"><option value="">— no pick —</option>' +
      cand.map(function (c) { return '<option value="' + esc(c.key) + '"' + (s.pick === c.key ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label></div>';

    // cost notice + start
    h += '<div class="panel">';
    if (s.mode === 'live') {
      var est = app.estimateLive();
      h += '<p class="notice">Each AI player makes 1 decision call per turn (+1 check-in). Estimated cost for this match: ≤ <b>' + est.toFixed(4) +
        '</b> Pollen, paid from your own Pollen. Failed or retried calls may still cost. The market is fictional and nothing here is investment advice. D3 inputs may be logged by its provider.</p>';
    } else {
      h += '<p class="notice">Offline simulation uses rule-based bots and costs nothing. The market is fictional and nothing here is investment advice.</p>';
    }
    h += '<div class="startrow"><button class="btn primary big" data-act="start"' + (app.starting ? ' disabled' : '') + '>' +
      (app.starting ? 'Checking in…' : (s.mode === 'live' ? 'Check-in &amp; Start' : 'Start')) + '</button>' +
      '<span id="setup-msg" class="hint ' + (app.setupMsg ? 'warn' : '') + '">' + esc(app.setupMsg || '') + '</span></div></div>';

    // replay
    h += '<div class="panel"><h2>Replay</h2><p class="hint">Watch a recorded match. Nothing is sent over the network.</p><div class="btnrow">';
    if (app.featured) {
      var f = app.featured;
      h += '<button class="btn" data-act="replay-featured">▶ Recorded live match · ' + esc((f.createdAt || '').slice(0, 10)) + '</button><span class="hint">' + esc(f.players.filter(function (p) { return p.kind === 'live'; }).map(function (p) { return p.name; }).join(', ') || 'sim players') + '</span>';
    }
    h += '<label class="btn filebtn">Load a match JSON…<input type="file" accept="application/json,.json" data-change="file" hidden></label></div></div>';

    $('setup-body').innerHTML = h;
  }

  // players that can be picked (same order the roster is built in)
  function candidates(app) {
    var s = app.setup, out = [];
    if (s.mode === 'live' && app.key) {
      app.models.forEach(function (m) { if (s.models[m.id] && !m.noulOnly) out.push({ key: 'live:' + m.id, name: m.title }); });
    }
    DP.sim.BOT_IDS.forEach(function (id) { if (s.sims[id]) out.push({ key: 'sim:' + id, name: DP.sim.BOTS[id].name }); });
    return out;
  }

  // ---------- match: pieces ----------
  function currentHeadline(app) {
    var g = app.game;
    if (!g || g.state === 'finished') return null;
    return DP.engine.headlineFor(g, g.nextTurn);
  }

  function renderHeadline(app) {
    var g = app.game; if (!g) return;
    var hl = currentHeadline(app);
    var h;
    if (!hl) h = '<span class="muted">Match over.</span>';
    else {
      var tag = hl.kind === 'card-rumor' ? '🗞 your rumor' : (hl.kind === 'card-shock' ? '⚡ your shock' : '📰');
      h = '<span class="hl-tag">' + tag + ' · turn ' + (g.nextTurn + 1) + '</span> ' + (hl.text ? '“' + esc(hl.text) + '”' : '<span class="muted">No headline this turn.</span>') +
        '<span class="hl-note">Real news or rumor? It is revealed after the match.</span>';
    }
    $('headline').innerHTML = h;
  }

  function renderLegend(app) {
    var g = app.game; if (!g) return;
    var h = '<span class="lg price"><i></i>HIVE price</span>';
    g.players.forEach(function (p) {
      var on = !app.ui.hidden[p.id];
      h += '<button class="lg' + (on ? '' : ' off') + (p.kind === 'ghost' ? ' ghost' : '') + '" data-act="toggle-line" data-id="' + esc(p.id) + '" aria-pressed="' + on + '" style="--c:' + DP.chart.colorFor(g, p) + '"><i></i>' + esc(p.name) + '</button>';
    });
    $('chart-legend').innerHTML = h;
  }

  function lastDecision(app, p) {
    var g = app.game;
    for (var i = g.turns.length - 1; i >= 0; i--) {
      var d = g.turns[i].decisions.filter(function (x) { return x.playerId === p.id; })[0];
      if (d) return { d: d, turn: g.turns[i].t + 1 };
    }
    return null;
  }

  function probsOf(d) {
    var offered = d.offered || ['hold', 'buy', 'sell'];
    var out = {}, a = d.response && d.response.answers && d.response.answers.action;
    var pr = a && a.probabilities;
    offered.forEach(function (k) { out[k] = pr && typeof pr[k] === 'number' ? pr[k] : null; });
    var known = offered.filter(function (k) { return out[k] !== null; });
    if (!known.length && d.choice) {
      var rest = (1 - (d.p || 0)) / Math.max(1, offered.length - 1);
      offered.forEach(function (k) { out[k] = k === d.choice ? d.p : rest; });
    } else offered.forEach(function (k) { if (out[k] === null) out[k] = 0; });
    return out;
  }

  function cardHTML(app, p, rank) {
    var g = app.game;
    var eq = p.equityHist[p.equityHist.length - 1];
    var ret = eq / C.START_CASH - 1;
    var price = g.market.prices[Math.min(g.nextTurn, g.T) + C.WARMUP];
    var posPct = p.status === 'eliminated' ? 0 : (eq > 0 ? (p.pf.shares * price / eq) * 100 : 0);
    var color = DP.chart.colorFor(g, p);
    var tag = p.kind === 'live' ? '<span class="tag live">Live</span>' : (p.kind === 'ghost' ? '<span class="tag ghost">Baseline</span>' : '<span class="tag sim">Sim</span>');
    var h = '<article class="card ' + esc(p.status) + (p.kind === 'ghost' ? ' ghostcard' : '') + '" style="--c:' + color + '"><header><span class="dot"></span><h3>' +
      (rank ? '<span class="rk">' + rank + '</span>' : '') + esc(p.name) + '</h3>' + tag + '</header>';
    h += '<div class="mid"><code>' + esc(p.modelId) + '</code></div>';
    h += '<div class="eq"><b>' + money(eq) + '</b> <small>cr</small> <span class="' + cls(ret) + '">' + pct(ret) + '</span></div>';
    h += '<div class="posbar" title="Share of equity held in HIVE"><i style="width:' + Math.max(0, Math.min(100, posPct)).toFixed(0) + '%"></i><span>' + posPct.toFixed(0) + '% in HIVE</span></div>';

    var ld = lastDecision(app, p), ans = app.ui.answered[p.id];
    if (app.ui.thinking[p.id]) h += '<div class="dec thinking"><span class="spin"></span> Thinking…</div>';
    else if (ld) {
      var d = ld.d;
      var actTxt = d.status === 'ok' ? '<b class="act ' + d.effective + '">' + ico(d.effective) + ' ' + d.effective.toUpperCase() + (d.effective !== 'hold' ? ' ' + Math.round(d.size * 100) + '%' : '') + '</b>' : '<b class="act hold">■ HOLD</b>';
      h += '<div class="dec"><div class="dechead"><span>Turn ' + ld.turn + '</span>' + actTxt + (d.latencyMs ? '<small>' + d.latencyMs + ' ms</small>' : '') + '</div>';
      if (d.status === 'ok') {
        var pr = probsOf(d);
        h += '<div class="probs">' + Object.keys(pr).map(function (k) {
          return '<div class="pb ' + k + '" title="' + k + ' ' + Math.round(pr[k] * 100) + '%"><span class="pl">' + k + '</span><span class="bar"><i style="width:' + Math.round(pr[k] * 100) + '%"></i></span><span class="pv">' + Math.round(pr[k] * 100) + '</span></div>';
        }).join('') + '</div>';
        if (typeof d.pUp === 'number') h += '<div class="gauge" title="Forecast: chance the next price is higher"><span class="gl">p(up)</span><span class="gbar"><i style="left:' + (d.pUp * 100).toFixed(0) + '%"></i></span><span class="gv">' + Math.round(d.pUp * 100) + '%</span></div>';
      } else h += '<div class="warnline">' + (d.fallback ? 'Fallback HOLD' : esc(d.status)) + (d.note ? ' · ' + esc(d.note) : '') + '</div>';
      h += '</div>';
    } else if (ans) {
      h += '<div class="dec"><span class="muted">Answered in ' + ans + ' ms</span></div>';
    } else if (p.status === 'active') h += '<div class="dec muted">Waiting for turn 1.</div>';

    var badge = '';
    if (p.status === 'eliminated') badge = '<span class="sb out">Eliminated · turn ' + p.elimTurn + ' · ' + esc(p.statusNote) + '</span>';
    else if (p.status === 'dnf') badge = '<span class="sb dnf">⚠ DNF · ' + esc(p.statusNote) + '</span>';
    else if (app.ui.thinking[p.id]) badge = '';
    else if (ld && ld.d.fallback) badge = '<span class="sb fb">Fallback HOLD</span>';
    else if (p.singleQuestion) badge = '<span class="sb">single-question mode</span>';
    else badge = '<span class="sb ok">Ready</span>';
    h += '<footer>' + badge;
    if (p.kind !== 'ghost') {
      h += '<button class="btn small cheer" data-act="cheer" data-id="' + esc(p.id) + '" title="Cheering is just for fun. It does not affect the result.">📣 <span class="cn">' + (g.cheers[p.id] || 0) + '</span></button>';
    }
    h += '</footer></article>';
    return h;
  }

  function renderCards(app) {
    var g = app.game; if (!g) return;
    var price = g.market.prices[Math.min(g.nextTurn, g.T) + C.WARMUP];
    var ai = g.players.filter(function (p) { return p.kind !== 'ghost'; }).sort(function (a, b) {
      var ea = a.equityHist[a.equityHist.length - 1], eb = b.equityHist[b.equityHist.length - 1];
      var ra = a.status === 'eliminated' ? 1 : 0, rb = b.status === 'eliminated' ? 1 : 0;
      return ra - rb || eb - ea;
    });
    var ghosts = g.players.filter(function (p) { return p.kind === 'ghost'; });
    var h = '';
    ai.forEach(function (p, i) { h += cardHTML(app, p, i + 1); });
    ghosts.forEach(function (p) { h += cardHTML(app, p, 0); });
    $('cards').innerHTML = h;
  }

  function renderControls(app) {
    var g = app.game; if (!g) return;
    var fin = g.state === 'finished';
    var n = Math.min(g.nextTurn + 1, g.T);
    var cps = g.survival ? [Math.round(g.T / 3), Math.round(2 * g.T / 3)].filter(function (c) { return c > g.nextTurn; }) : [];
    var busy = app.busy;
    var paused = g.state === 'paused';
    var h = '<div class="turnlabel"><b>Turn ' + n + ' / ' + g.T + '</b>' + (g.survival ? '<small>' + (cps.length ? 'Next checkpoint: turn ' + cps[0] : 'No more checkpoints') + '</small>' : '<small>Survival off</small>') + '</div>';
    h += '<div class="btnrow">';
    if (fin) h += '<button class="btn primary" data-act="show-results">See results</button>';
    else {
      h += '<button class="btn primary" data-act="next"' + (busy || paused ? ' disabled' : '') + '>⏭ Next turn</button>';
      h += '<button class="btn" data-act="auto" aria-pressed="' + app.auto + '"' + (paused ? ' disabled' : '') + '>' + (app.auto ? '⏸ Pause' : '▶ Auto') + '</button>';
      h += '<label class="inl">Speed<select data-change="speedLive">' + [[1500, '1.5 s'], [3000, '3 s'], [6000, '6 s']].map(function (o) { return '<option value="' + o[0] + '"' + (Number(g.speedMs) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
      h += '<button class="btn danger small" data-act="end-early">' + (app.confirmEnd ? 'Click again to end' : 'End match') + '</button>';
    }
    h += '<button class="btn small" data-act="inspector">🔎 Inspector</button></div>';
    $('controls').innerHTML = h;
  }

  function renderTray(app) {
    var g = app.game; if (!g) return;
    var chk = DP.interventions.canSchedule(g);
    var dis = chk.ok ? '' : ' disabled title="' + esc(chk.reason) + '"';
    var activeAI = g.players.filter(function (p) { return p.kind !== 'ghost' && p.status === 'active'; });
    var h = '<div class="trayhead"><h3>Spectator cards <small>' + g.cardsLeft + ' left · one per turn · apply from the next turn · locked in the last two turns</small></h3></div><div class="cards3">';
    h += '<div class="icard"><b>🗞 Fake rumor</b><p>Shows every player a made-up headline next turn. No price effect.</p><div class="btnrow">' +
      '<button class="btn small" data-act="card" data-type="rumor" data-dir="up"' + dis + '>▲ Bullish</button><button class="btn small" data-act="card" data-type="rumor" data-dir="down"' + dis + '>▼ Bearish</button></div></div>';
    h += '<div class="icard"><b>⚡ Market shock</b><p>A real ±6% jolt to the next price move, with a headline.</p><div class="btnrow">' +
      '<button class="btn small" data-act="card" data-type="shock" data-dir="up"' + dis + '>▲ Squeeze</button><button class="btn small" data-act="card" data-type="shock" data-dir="down"' + dis + '>▼ Crash</button></div></div>';
    h += '<div class="icard"><b>🤫 Whisper</b><p>One line shown only to one player. We measure whether it follows.</p>' +
      '<select id="whisper-target" aria-label="Whisper target"' + (chk.ok && activeAI.length ? '' : ' disabled') + '>' + activeAI.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select>' +
      '<div class="btnrow">' + ['buy', 'sell', 'hold'].map(function (a) { return '<button class="btn small" data-act="card" data-type="whisper" data-action="' + a + '" title="' + esc(DP.interventions.WHISPER_PRESETS[a]) + '"' + dis + '>' + ico(a) + ' ' + a + '</button>'; }).join('') + '</div></div></div>';
    if (g.interventions.length) {
      h += '<ul class="ivlist">' + g.interventions.map(function (iv) {
        var name = iv.type === 'whisper' ? ('🤫 whisper “' + iv.action + '” → ' + esc((g.players.filter(function (p) { return p.id === iv.target; })[0] || { name: '?' }).name)) : (iv.type === 'rumor' ? '🗞 rumor ' + (iv.dir > 0 ? '▲' : '▼') : '⚡ shock ' + (iv.dir > 0 ? '▲' : '▼'));
        return '<li>Turn ' + (iv.turn + 1) + ' · ' + name + '</li>';
      }).join('') + '</ul>';
    }
    $('tray').innerHTML = h;
  }

  function renderLog(app) {
    var g = app.game; if (!g) return;
    var rows = [];
    g.turns.forEach(function (tr) {
      var parts = tr.decisions.filter(function (d) { return d.kind !== 'ghost'; }).map(function (d) {
        var p = g.players.filter(function (x) { return x.id === d.playerId; })[0];
        return esc(p ? p.name : d.playerId) + ' ' + (d.status === 'ok' ? ico(d.effective) + (d.effective !== 'hold' ? Math.round(d.size * 100) + '%' : '') : '■ (' + esc(d.status) + ')');
      });
      var line = '<li><b>T' + (tr.t + 1) + '</b> · ' + tr.price.toFixed(2) + ' → ' + tr.nextPrice.toFixed(2) + ' · ' + parts.join(' · ');
      tr.events.forEach(function (e) {
        var p = g.players.filter(function (x) { return x.id === e.player; })[0];
        line += ' · <span class="neg">✖ ' + esc(p ? p.name : '') + ' (' + e.type + ')</span>';
      });
      (tr.interventions || []).forEach(function (iv) { line += ' · ' + (iv.type === 'whisper' ? '🤫' : iv.type === 'rumor' ? '🗞' : '⚡'); });
      rows.push(line + '</li>');
    });
    $('log').innerHTML = rows.length ? '<ol reversed>' + rows.reverse().join('') + '</ol>' : '<p class="muted">Nothing yet.</p>';
  }

  function renderBanner(app) {
    var g = app.game; if (!g) return;
    var h = '';
    if (g.state === 'paused') {
      var r = g.pauseReason;
      if (r === 'auth') h += '<div class="banner err"><b>Sign-in problem (401).</b> The key was rejected or is missing. Your position is kept and the turn has not been played. Reconnecting reloads the page and the match restarts from its seed. <div class="btnrow"><button class="btn small" data-act="resume">Retry</button><button class="btn small danger" data-act="end-early">End match</button></div></div>';
      else if (r === 'budget') h += '<div class="banner err"><b>Out of Pollen or key budget (402).</b> The turn has not been played. Top up or raise the key budget, then retry. <div class="btnrow"><button class="btn small" data-act="resume">Retry</button><button class="btn small danger" data-act="end-early">End match</button></div></div>';
      else if (r === 'cap') h += '<div class="banner warn"><b>Cost cap reached.</b> Spent ' + pollen(g.spent, true) + ' of ' + Number(g.costCap).toFixed(3) + ' Pollen. <div class="btnrow"><button class="btn small" data-act="cap-continue">Continue (+' + Number(g.costCapBase).toFixed(3) + ')</button><button class="btn small danger" data-act="end-early">End match</button></div></div>';
    }
    if (app.ui.checkInNote) h += '<div class="banner info">' + app.ui.checkInNote + ' <button class="btn small" data-act="dismiss-note">Dismiss</button></div>';
    g.warnings.forEach(function (w) { h += '<div class="banner warn">' + esc(w) + '</div>'; });
    if (g.mode === 'replay') h += '<div class="banner info">Replay of a recorded match. No network calls are made. <button class="btn small" data-act="back-setup">Exit replay</button></div>';
    $('banner').innerHTML = h;
  }

  function drawChart(app, canvasId, reveal) {
    var g = app.game; if (!g) return;
    var cv = $(canvasId || 'chart'); if (!cv) return;
    DP.chart.draw(cv, g, { hidden: app.ui.hidden, reveal: !!reveal || g.state === 'finished', cursorTurn: app.ui.cursor });
  }

  function renderMatchAll(app) {
    renderHeadline(app); renderLegend(app); renderControls(app); renderTray(app); renderCards(app); renderLog(app); renderBanner(app);
    drawChart(app, 'chart');
    renderTop(app);
  }

  // ---------- results ----------
  var KIND_LABEL = {
    real: ['Real news', 'Moved the price'], rumor: ['Rumor', 'No effect on price'], hint: ['Regime hint', 'Hinted at a market-mood change'],
    'card-rumor': ['Your fake rumor', 'No effect on price'], 'card-shock': ['Your market shock', 'Moved the price']
  };

  function renderResults(app) {
    var g = app.game; if (!g || !g.final) return;
    var f = g.final, aw = g.awards;
    var byId = {}; g.players.forEach(function (p) { byId[p.id] = p; });
    var champ = f.ranked[0];
    var h = '';
    h += '<div class="panel hero"><div><small class="muted">' + (g.endedEarly ? 'Match ended early at turn ' + f.lastTurn : 'Final standings after ' + g.T + ' turns') + '</small><h2>' +
      (champ ? '🏆 ' + esc(champ.name) + ' <span class="' + cls(champ.ret) + '">' + pct(champ.ret) + '</span>' : 'No players') + '</h2>' +
      '<p class="muted">Final price ' + f.finalPrice.toFixed(2) + ' · ' + (g.interventions.length ? 'Intervened match' : 'Pure match') + ' · seed ' + g.seed + ' · ' + g.mode + '</p></div>';
    var chips = [];
    if (aw.forecaster) chips.push('<span class="award">🎯 Best Forecaster · ' + esc(byId[aw.forecaster].name) + '</span>');
    aw.unshakable.forEach(function (id) { chips.push('<span class="award">🧊 Unshakable · ' + esc(byId[id].name) + '</span>'); });
    aw.lostToMonkey.forEach(function (id) { chips.push('<span class="award bad">🐒 Lost to the Monkey · ' + esc(byId[id].name) + '</span>'); });
    if (g.pick) {
      var pk = f.ranked.filter(function (r) { return r.id === g.pick; })[0];
      if (pk) chips.push('<span class="award">📣 Your pick finished #' + pk.rank + ' of ' + f.ranked.length + '</span>');
    }
    h += '<div class="awards">' + (chips.join('') || '<span class="muted">No special awards this match.</span>') + '</div></div>';

    h += '<div class="panel"><div class="scroll"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Final equity</th><th>Return</th><th>Max DD</th><th>Trades</th><th>Brier (n)</th><th>Swayed</th><th>Rumor</th><th>Errors</th><th>Calls</th><th>In tokens</th><th>Pollen</th></tr></thead><tbody>';
    function row(r, ghost) {
      var p = byId[r.id];
      var live = p.kind === 'live';
      var status = r.status === 'eliminated' ? ' <span class="sb out">out T' + r.elimTurn + '</span>' : (r.status === 'dnf' ? ' <span class="sb dnf">⚠ ' + esc(r.statusNote) + '</span>' : '');
      return '<tr class="' + (ghost ? 'ghostrow' : '') + '"><td>' + (ghost ? '–' : r.rank) + '</td><td><b>' + esc(r.name) + '</b>' + (p.kind === 'sim' ? ' <span class="tag sim">Sim</span>' : '') + (ghost ? ' <span class="tag ghost">Baseline</span>' : '') + '<br><code>' + esc(r.modelId) + '</code>' + status + '</td>' +
        '<td>' + money(r.equity) + '</td><td class="' + cls(r.ret) + '">' + pct(r.ret) + '</td><td>' + (r.mdd * 100).toFixed(1) + '%</td><td>' + r.trades + '</td>' +
        '<td>' + (r.brier === null ? '–' : r.brier.toFixed(3) + ' (' + r.brierN + ')') + '</td>' +
        '<td>' + (r.whispers ? r.swayed + '/' + r.whispers : '–') + '</td><td>' + (r.rumorTurns ? r.rumorFollowed + '/' + r.rumorTurns : '–') + '</td>' +
        '<td>' + (live || p.kind === 'sim' ? r.errors : '–') + '</td><td>' + (live ? r.calls : '–') + '</td><td>' + (live ? r.inTok.toLocaleString('en-US') : '–') + '</td><td>' + (live ? pollen(r.pollen, r.pollenKnown) : '–') + '</td></tr>';
    }
    f.ranked.forEach(function (r) { h += row(r, false); });
    f.ghosts.forEach(function (r) { h += row(r, true); });
    h += '</tbody></table></div><p class="hint">Brier: lower is better (0.25 = coin flip). Swayed: followed a whisper. Rumor: traded in the fake rumor’s direction. A Best Forecaster award needs 10+ forecasts.</p></div>';

    h += '<div class="panel"><h2>The market, revealed</h2><div class="legendline"><span class="rg BULL">BULL</span><span class="rg BEAR">BEAR</span><span class="rg CHOP">CHOP</span><span class="rg PANIC">PANIC</span></div>' +
      '<div class="chartbox"><canvas id="chart-final" role="img" aria-label="Final chart: HIVE price and player equity with market regimes revealed"></canvas></div>' +
      '<p class="hint">Total: ' + g.calls + ' API calls · ' + (g.inTok + g.outTok).toLocaleString('en-US') + ' tokens · ' + (g.mode === 'live' ? pollen(g.spent, true) + ' Pollen' : '0 Pollen') + '.</p></div>';

    var rows = [];
    g.turns.forEach(function (tr) {
      var hl = tr.headline; if (!hl || !hl.text) return;
      var lab = KIND_LABEL[hl.kind] || [hl.kind, ''];
      rows.push('<tr><td>' + (tr.t + 1) + '</td><td>“' + esc(hl.text) + '”</td><td><span class="kind ' + esc(hl.kind) + '">' + esc(lab[0]) + '</span></td><td class="muted">' + esc(lab[1]) + '</td></tr>');
      if (hl.displaced) rows.push('<tr class="sub"><td></td><td>“' + esc(hl.displaced) + '” <small>(pushed out by your card)</small></td><td colspan="2"></td></tr>');
    });
    h += '<div class="panel"><h2>Headline truth</h2>' + (rows.length ? '<div class="scroll"><table class="tbl"><thead><tr><th>Turn</th><th>Headline</th><th>Was</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '<p class="muted">There were no headlines.</p>') + '</div>';

    if (g.mode === 'replay') {
      var v = DP.engine.verifyReplay(g);
      h += '<div class="panel"><p class="hint">' + (v.ok === true ? '✔ The replay reproduced the recorded final equity for all ' + v.checked + ' players.' : (v.ok === false ? '⚠ The rebuilt result differs from the recording for: ' + esc(v.diffs.join(', ')) : 'No recorded standings to compare.')) + '</p></div>';
    }

    h += '<div class="panel btnrow wrap"><button class="btn primary" data-act="rematch">Rematch same seed</button><button class="btn" data-act="new-seed">New seed</button>' +
      '<button class="btn" data-act="export">Export match JSON</button><button class="btn" data-act="share">Copy share link</button><button class="btn" data-act="hall">Hall of Fame</button>' +
      '<button class="btn" data-act="back-match">Back to match</button><button class="btn" data-act="back-setup">Setup</button></div>';
    $('results-body').innerHTML = h;
    var cv = $('chart-final');
    if (cv) DP.chart.draw(cv, g, { hidden: {}, reveal: true });
  }

  // ---------- modal ----------
  function showModal(html, onClose) {
    var m = $('modal');
    m.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><button class="btn small close" data-act="close-modal" aria-label="Close">✕</button>' + html + '</div>';
    m.hidden = false;
    var btn = m.querySelector('.close'); if (btn) btn.focus();
  }
  function hideModal() { var m = $('modal'); m.hidden = true; m.innerHTML = ''; }

  function renderHall(app, tab) {
    var hall = DP.storage.loadHall();
    tab = tab || 'live';
    var b = hall[tab] || {};
    var ids = Object.keys(b).sort(function (a, c) { return b[c].wins - b[a].wins || (b[c].retSum / b[c].games) - (b[a].retSum / b[a].games); });
    var h = '<h2>Hall of Fame</h2><p class="hint">This browser only. Matches that were ended early or replayed are not counted.</p><div class="btnrow"><button class="btn small' + (tab === 'live' ? ' primary' : '') + '" data-act="hall-tab" data-tab="live">Live</button><button class="btn small' + (tab === 'offline' ? ' primary' : '') + '" data-act="hall-tab" data-tab="offline">Offline</button></div>';
    if (!ids.length) h += '<p class="muted">No ' + tab + ' matches recorded yet.</p>';
    else {
      h += '<div class="scroll"><table class="tbl"><thead><tr><th>Model</th><th>Matches</th><th>Wins</th><th>Avg return</th><th>Avg Brier</th><th>Swayed</th><th>Rumor</th></tr></thead><tbody>' + ids.map(function (id) {
        var e = b[id];
        return '<tr><td><b>' + esc(e.name) + '</b><br><code>' + esc(id) + '</code></td><td>' + e.games + '</td><td>' + e.wins + '</td><td class="' + cls(e.retSum) + '">' + pct(e.retSum / e.games) + '</td><td>' + (e.brierN ? (e.brierSum / e.brierN).toFixed(3) : '–') + '</td><td>' + (e.whispers ? Math.round(e.swayed / e.whispers * 100) + '%' : '–') + '</td><td>' + (e.rumorTurns ? Math.round(e.rumorFollowed / e.rumorTurns * 100) + '%' : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div><div class="btnrow"><button class="btn small danger" data-act="hall-clear">Clear Hall of Fame</button></div>';
    }
    showModal(h);
  }

  // ---------- inspector ----------
  function collectCalls(app) {
    var g = app.game, out = [];
    (g.checkIn || []).forEach(function (r) {
      var p = g.players.filter(function (x) { return x.id === r.playerId; })[0];
      out.push({ turn: 'check-in', name: p ? p.name : r.playerId, model: p ? p.modelId : '', http: r.http, latency: r.latencyMs, attempts: r.attempts, tokens: r.inTok, cost: r.cost, status: r.status, request: r.request, response: r.response, note: r.note, live: true });
    });
    g.turns.forEach(function (tr) {
      tr.decisions.forEach(function (d) {
        if (d.kind === 'ghost') return;
        var p = g.players.filter(function (x) { return x.id === d.playerId; })[0];
        out.push({ turn: tr.t + 1, name: p ? p.name : d.playerId, model: p ? p.modelId : '', http: d.http, latency: d.latencyMs, attempts: d.attempts, tokens: d.inTok, cost: d.cost, status: d.status, request: d.request, response: d.response, order: d.order, note: d.note, live: d.kind === 'live', log: d.log });
      });
    });
    return out;
  }

  function renderInspector(app) {
    var g = app.game, box = $('inspector');
    if (!g || !app.ui.inspectorOpen) { box.hidden = true; return; }
    box.hidden = false;
    var calls = collectCalls(app); app.ui.calls = calls;
    var sel = app.ui.inspectorSel;
    var h = '<div class="insp-head"><h2>Inspector</h2><button class="btn small" data-act="inspector" aria-label="Close inspector">✕</button></div>' +
      '<p class="hint">Every request and response. The key is never shown.</p>';
    var shown = calls.filter(function (c) { return c.live || g.mode !== 'live'; });
    h += '<div class="scroll short"><table class="tbl sel"><thead><tr><th>Turn</th><th>Player</th><th>HTTP</th><th>ms</th><th>Try</th><th>Tok</th><th>Pollen</th></tr></thead><tbody>' +
      shown.map(function (c) {
        var i = calls.indexOf(c);
        return '<tr data-act="inspect" data-i="' + i + '" class="' + (sel === i ? 'on' : '') + (c.status !== 'ok' ? ' bad' : '') + '" tabindex="0"><td>' + esc(c.turn) + '</td><td>' + esc(c.name) + '</td><td>' + (c.http || (c.live ? '–' : 'sim')) + '</td><td>' + (c.latency || '–') + '</td><td>' + (c.attempts || '–') + '</td><td>' + (c.tokens || '–') + '</td><td>' + (typeof c.cost === 'number' && c.live ? c.cost.toFixed(6) : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (!shown.length) h += '<p class="muted">No calls yet.</p>';
    if (sel !== null && calls[sel]) {
      var c = calls[sel];
      h += '<h3 class="sub">' + esc(c.name) + ' · turn ' + esc(c.turn) + (c.live ? '' : ' · <span class="tag sim">Sim, no network call</span>') + '</h3>';
      if (c.note) h += '<p class="hint warn">' + esc(c.status) + ': ' + esc(c.note) + '</p>';
      if (c.order) h += '<p class="hint">Option order sent: action = ' + esc((c.order.action || []).join(', ')) + (c.order.move ? ' · next_move = ' + esc(c.order.move.join(', ')) : '') + '</p>';
      if (c.request) {
        h += '<div class="btnrow"><button class="btn small" data-act="copy-curl" data-i="' + sel + '">Copy as curl</button></div><h4>Request body</h4><pre>' + esc(JSON.stringify(c.request, null, 2)) + '</pre>';
      }
      h += '<h4>Response</h4><pre>' + esc(c.response ? JSON.stringify(c.response, null, 2) : '(none)') + '</pre>';
      if (c.log && c.log.length > 1) h += '<h4>Attempts</h4><pre>' + esc(JSON.stringify(c.log, null, 2)) + '</pre>';
    }
    box.innerHTML = h;
  }

  // ---------- views ----------
  function showView(name) {
    ['setup', 'match', 'results'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.body.setAttribute('data-view', name);
    window.scrollTo(0, 0);
  }

  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg; t.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 3800);
  }

  function popEmoji(btn, emoji) {
    var r = btn.getBoundingClientRect();
    var s = document.createElement('span');
    s.className = 'pop'; s.textContent = emoji;
    s.style.left = (r.left + r.width / 2) + 'px'; s.style.top = (r.top) + 'px';
    document.body.appendChild(s);
    setTimeout(function () { s.remove(); }, 900);
  }

  DP.ui = {
    esc: esc, money: money, renderTop: renderTop, renderSetup: renderSetup, renderMatchAll: renderMatchAll,
    renderHeadline: renderHeadline, renderLegend: renderLegend, renderCards: renderCards, renderControls: renderControls,
    renderTray: renderTray, renderLog: renderLog, renderBanner: renderBanner, drawChart: drawChart,
    renderResults: renderResults, renderInspector: renderInspector, renderHall: renderHall,
    showModal: showModal, hideModal: hideModal, showView: showView, toast: toast, popEmoji: popEmoji,
    estCost: estCost, candidates: candidates
  };
})();
