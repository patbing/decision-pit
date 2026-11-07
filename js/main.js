/* Boot and controller: Pollinations Connect (BYOP), model list, match loop, user actions. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config, UI = DP.ui, ST = DP.storage;

  var app = {
    view: 'setup',
    key: null,                 // the user's sk_ key, memory only
    models: [], modelsStatus: 'loading',
    connectUnavailable: false,
    featured: null,
    game: null, busy: false, auto: false, starting: false, confirmEnd: false, setupMsg: '',
    setup: { mode: 'offline', T: C.DEFAULT_TURNS, survival: true, seed: randomSeed(), speedMs: C.DEFAULT_SPEED_MS, costCap: C.DEFAULT_COST_CAP,
      models: {}, sims: {}, ghosts: { buyhold: true, monkey: true }, pick: '' },
    ui: { hidden: {}, thinking: {}, answered: {}, cursor: null, inspectorOpen: false, inspectorSel: null, checkInNote: '', calls: [], hallTab: 'live' },
    timer: null, recorded: false
  };
  DP.app = app; // handy in the console

  // The App Key lives in js/config.js only. Set it before the <polli-connect> element upgrades.
  (function () {
    var el = document.getElementById('connect');
    if (!el) return;
    el.setAttribute('app-key', C.APP_KEY);
    el.setAttribute('menu-links', JSON.stringify([{ label: 'Source code', href: C.REPO_URL }]));
  })();

  function randomSeed() { return String(100000 + Math.floor(Math.random() * 900000)); }
  function $(id) { return document.getElementById(id); }

  // ---------- Live availability ----------
  app.liveReason = function () {
    if (location.protocol === 'file:') return 'Live play needs the hosted page or http://localhost';
    if (/REPLACE_ME/.test(C.APP_KEY)) return 'the App Key is not configured (see README)';
    if (app.connectUnavailable) return 'sign-in is unavailable (Pollinations Connect did not load)';
    if (!app.key) return 'connect your Pollinations account first (button at the top)';
    if (app.modelsStatus === 'error') return 'the model list could not be loaded';
    return '';
  };
  // For the disabled "Live" radio the reason is shown, and the model rows show "Connect to play live".

  app.selectedLiveModels = function () {
    return app.models.filter(function (m) { return app.setup.models[m.id] && !m.noulOnly; });
  };
  app.estimateLive = function () {
    var sum = 0;
    app.selectedLiveModels().forEach(function (m) { sum += UI.estCost(m, Number(app.setup.T)); });
    return sum * 1.25;
  };

  // ---------- setup persistence ----------
  function persistSetup() {
    ST.saveSetup({ mode: app.setup.mode, T: app.setup.T, survival: app.setup.survival, seed: app.setup.seed, speedMs: app.setup.speedMs,
      costCap: app.setup.costCap, models: app.setup.models, sims: app.setup.sims, ghosts: app.setup.ghosts, pick: app.setup.pick });
  }
  function restoreSetup() {
    var s = ST.loadSetup();
    if (s) Object.keys(s).forEach(function (k) { if (s[k] !== undefined && s[k] !== null) app.setup[k] = s[k]; });
    DP.sim.BOT_IDS.forEach(function (id) { if (app.setup.sims[id] === undefined) app.setup.sims[id] = true; });
    var q = new URLSearchParams(location.search);
    if (q.get('seed') && /^\d{1,9}$/.test(q.get('seed'))) app.setup.seed = q.get('seed');
    if (q.get('turns') && C.TURN_CHOICES.indexOf(Number(q.get('turns'))) >= 0) app.setup.T = Number(q.get('turns'));
    if (q.get('survival') !== null) app.setup.survival = q.get('survival') !== '0';
    if (q.get('mode') === 'offline') app.setup.mode = 'offline';
    if (q.get('mode') === 'live') app.setup.mode = 'live';
  }

  // ---------- models ----------
  function loadModels() {
    app.modelsStatus = 'loading'; render();
    return DP.net.listDecisionModels(app.key).then(function (list) {
      app.models = list; app.modelsStatus = 'ok';
      // first time with a key: tick every usable model (max 6)
      if (app.key && !Object.keys(app.setup.models).length) {
        list.filter(function (m) { return !m.noulOnly; }).slice(0, C.MAX_AI_PLAYERS).forEach(function (m) { app.setup.models[m.id] = true; });
      }
      // drop stale ticks
      Object.keys(app.setup.models).forEach(function (id) { if (!list.some(function (m) { return m.id === id; })) delete app.setup.models[id]; });
      render();
    }).catch(function () {
      app.models = []; app.modelsStatus = 'error'; render();
    });
  }

  // ---------- Pollinations Connect ----------
  function readKey(el, e) {
    var k = (el && el.apiKey) || (e && e.detail && (e.detail.apiKey || e.detail.key)) || null;
    return typeof k === 'string' && k ? k : null;
  }
  function wireConnect() {
    var el = $('connect');
    var ready = Promise.race([customElements.whenDefined('polli-connect'), new Promise(function (r) { setTimeout(r, 8000); })]);
    ready.then(function () {
      if (!customElements.get('polli-connect')) { app.connectUnavailable = true; el.hidden = true; $('connect-fallback').hidden = false; render(); }
      var k = readKey(el);
      if (k !== app.key) onKeyChange(k);
    });
    el.addEventListener('change', function (e) { var k = readKey(el, e); if (k !== app.key) onKeyChange(k); });
  }
  function onKeyChange(k) {
    var had = !!app.key;
    app.key = k;
    if (!k && had && app.game && app.game.mode === 'live' && app.game.state !== 'finished') {
      UI.toast('Signed out. The match will pause on its next call.', 'warn');
    }
    if (app.setup.mode === 'live' && !k) app.setup.mode = 'offline';
    if (k && !had && !q('mode')) app.setup.mode = 'live';
    loadModels();
  }
  function q(name) { return new URLSearchParams(location.search).get(name); }

  // ---------- featured replay ----------
  function loadFeatured() {
    if (window.DP_FEATURED && window.DP_FEATURED.app === 'decision-pit') { app.featured = window.DP_FEATURED; return Promise.resolve(); }
    if (location.protocol === 'file:') return Promise.resolve();
    return fetch('replays/featured.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.app === 'decision-pit') app.featured = j; }).catch(function () { /* optional file */ });
  }

  // ---------- rendering ----------
  function render() {
    UI.renderTop(app);
    if (app.view === 'setup') UI.renderSetup(app);
    else if (app.view === 'match') UI.renderMatchAll(app);
    else if (app.view === 'results') UI.renderResults(app);
    UI.renderInspector(app);
  }
  function goto(view) { app.view = view; UI.showView(view); render(); }

  // ---------- game start ----------
  function buildRoster() {
    var roster = [];
    if (app.setup.mode === 'live') {
      app.selectedLiveModels().forEach(function (m) { roster.push({ kind: 'live', modelId: m.id, name: m.title, pricing: m.pricing, rpm: m.rpm }); });
    }
    DP.sim.BOT_IDS.forEach(function (id) { if (app.setup.sims[id]) roster.push({ kind: 'sim', botId: id }); });
    return roster;
  }

  function readSetupFields() {
    var seed = ($('seed') && $('seed').value || '').trim();
    if (!/^\d{1,9}$/.test(seed)) return 'Seed must be a number with up to 9 digits.';
    app.setup.seed = seed;
    var cc = $('costcap');
    if (cc) {
      var v = Number(cc.value);
      if (!(v > 0 && v <= 1)) return 'Cost cap must be between 0.001 and 1 Pollen.';
      app.setup.costCap = v;
    }
    return '';
  }

  function startMatch(opts) {
    opts = opts || {};
    var err = readSetupFields();
    var roster = buildRoster();
    if (!err && !roster.length) err = 'Pick at least one player.';
    if (!err && roster.length > C.MAX_AI_PLAYERS) err = 'At most ' + C.MAX_AI_PLAYERS + ' players. Untick some.';
    if (!err && app.setup.mode === 'live' && app.liveReason()) err = 'Live is not available: ' + app.liveReason() + '.';
    if (!err && app.setup.mode === 'live' && !roster.some(function (r) { return r.kind === 'live'; })) err = 'Tick at least one decision model, or switch to Offline.';
    if (err) { app.setupMsg = err; render(); return; }
    app.setupMsg = ''; persistSetup();

    var game = DP.engine.createGame({
      seed: Number(app.setup.seed), T: Number(app.setup.T), survival: !!app.setup.survival, mode: app.setup.mode,
      roster: roster, ghosts: app.setup.ghosts, costCap: Number(app.setup.costCap), speedMs: Number(app.setup.speedMs)
    });
    var pk = app.setup.pick;
    if (pk) {
      var pl = game.players.filter(function (p) { return pk === (p.kind === 'live' ? 'live:' + p.modelId : 'sim:' + p.id.slice(2)); })[0];
      if (pl) game.pick = pl.id;
    }
    attachGame(game);
    if (app.setup.mode !== 'live') { goto('match'); return; }

    app.starting = true; render();
    DP.engine.checkInAll(game, { getKey: function () { return app.key; }, post: DP.net.postDecision }).then(function (res) {
      app.starting = false;
      if (!res.ok) {
        app.game = null;
        app.setupMsg = res.reason === 'auth' ? 'Check-in failed: the key was rejected (401). Reconnect and try again.'
          : (res.reason === 'budget' ? 'Check-in failed: out of Pollen or key budget (402).' : 'Check-in failed: no model could answer.');
        render(); return;
      }
      var removed = res.removed || [];
      var note = 'Check-in: <b>' + res.readyLive + '</b> decision model' + (res.readyLive === 1 ? '' : 's') + ' ready' +
        (removed.length ? '; removed: ' + removed.map(function (r) { return '<b>' + UI.esc(r.name) + '</b> (' + UI.esc(r.reason) + ')'; }).join(', ') : '') +
        (game.players.some(function (p) { return p.singleQuestion; }) ? '; some run in single-question mode (no forecast score).' : '.') + ' Spent ' + game.spent.toFixed(5) + ' Pollen.';
      app.ui.checkInNote = note;
      goto('match');
    });
  }

  function attachGame(game) {
    clearTimeout(app.timer);
    app.game = game; app.auto = false; app.busy = false; app.recorded = false; app.confirmEnd = false;
    app.ui.hidden = {}; app.ui.thinking = {}; app.ui.answered = {}; app.ui.cursor = null; app.ui.inspectorSel = null; app.ui.checkInNote = '';
    DP.engine.onEvent(game, function (type, data) {
      if (game !== app.game) return;
      if (type === 'turnStart') {
        app.ui.answered = {}; app.ui.thinking = {};
        data.live.forEach(function (id) { app.ui.thinking[id] = true; });
        UI.renderCards(app); UI.renderControls(app);
      } else if (type === 'decision') {
        delete app.ui.thinking[data.rec.playerId];
        if (data.rec.latencyMs) app.ui.answered[data.rec.playerId] = data.rec.latencyMs;
        UI.renderCards(app);
      }
    });
  }

  // ---------- turn loop ----------
  function depsFor(game) {
    return game.mode === 'replay' ? DP.engine.replayDeps(game) : { getKey: function () { return app.key; }, post: DP.net.postDecision };
  }

  function step() {
    var g = app.game;
    if (!g || app.busy || g.state === 'finished' || g.state === 'paused') return;
    app.busy = true; app.confirmEnd = false;
    UI.renderControls(app);
    var t0 = Date.now();
    DP.engine.playTurn(g, depsFor(g)).then(function (res) {
      app.busy = false; app.ui.thinking = {};
      afterTurn(res, t0);
    }, function (e) {
      app.busy = false; app.auto = false; app.ui.thinking = {};
      UI.toast('Unexpected error: ' + (e && e.message || e), 'err');
      UI.renderMatchAll(app);
    });
  }

  function afterTurn(res, t0) {
    var g = app.game;
    UI.renderMatchAll(app); UI.renderInspector(app);
    if (g.state === 'finished') { onFinished(); return; }
    if (g.state === 'paused') { app.auto = false; UI.renderControls(app); return; }
    if (app.auto) {
      var gap = Math.max(0, DP.engine.minTurnGapMs(g) - (Date.now() - t0));
      clearTimeout(app.timer);
      app.timer = setTimeout(step, gap);
    }
  }

  function onFinished() {
    var g = app.game;
    app.auto = false; clearTimeout(app.timer);
    if (!app.recorded) { app.recorded = true; ST.recordMatch(g); }
    UI.renderMatchAll(app);
    setTimeout(function () { if (app.game === g && app.view === 'match') goto('results'); }, 1200);
  }

  // ---------- actions ----------
  var actions = {
    start: function () { startMatch(); },
    dice: function () { app.setup.seed = randomSeed(); var i = $('seed'); if (i) i.value = app.setup.seed; },
    'retry-models': function () { loadModels(); },
    next: function () { step(); },
    auto: function () {
      app.auto = !app.auto; UI.renderControls(app);
      if (app.auto) step(); else clearTimeout(app.timer);
    },
    resume: function () { DP.engine.resume(app.game); UI.renderMatchAll(app); step(); },
    'cap-continue': function () { DP.engine.continueAfterCap(app.game); UI.renderMatchAll(app); step(); },
    'end-early': function () {
      if (!app.confirmEnd) { app.confirmEnd = true; UI.renderControls(app); setTimeout(function () { app.confirmEnd = false; if (app.view === 'match') UI.renderControls(app); }, 3500); return; }
      app.confirmEnd = false; app.auto = false; clearTimeout(app.timer);
      DP.engine.endEarly(app.game); onFinished();
    },
    'show-results': function () { goto('results'); },
    'back-match': function () { goto('match'); },
    'back-setup': function () { clearTimeout(app.timer); app.auto = false; app.game = null; app.ui.inspectorOpen = false; goto('setup'); },
    'toggle-line': function (d) { app.ui.hidden[d.id] = !app.ui.hidden[d.id]; UI.renderLegend(app); UI.drawChart(app, 'chart'); },
    cheer: function (d, el) {
      var g = app.game; g.cheers[d.id] = (g.cheers[d.id] || 0) + 1;
      var cn = el.querySelector('.cn'); if (cn) cn.textContent = g.cheers[d.id];
      UI.popEmoji(el, ['📣', '🎉', '👏', '🔥'][g.cheers[d.id] % 4]);
    },
    card: function (d) {
      var g = app.game, card = { type: d.type };
      if (d.type === 'whisper') { var sel = $('whisper-target'); card.target = sel && sel.value; card.action = d.action; } else card.dir = d.dir;
      var r = DP.interventions.schedule(g, card);
      if (!r.ok) { UI.toast(r.reason, 'warn'); return; }
      UI.toast('Card set for turn ' + (r.intervention.turn + 1), 'ok');
      UI.renderTray(app); UI.renderHeadline(app); UI.drawChart(app, 'chart');
    },
    inspector: function () { app.ui.inspectorOpen = !app.ui.inspectorOpen; UI.renderInspector(app); },
    inspect: function (d) { app.ui.inspectorSel = Number(d.i); UI.renderInspector(app); },
    'copy-curl': function (d) {
      var c = app.ui.calls[Number(d.i)]; if (!c || !c.request) return;
      copyText(DP.net.asCurl(c.request)).then(function (ok) { UI.toast(ok ? 'Copied. Set POLLINATIONS_KEY in your shell first.' : 'Copy failed', ok ? 'ok' : 'err'); });
    },
    'dismiss-note': function () { app.ui.checkInNote = ''; UI.renderBanner(app); },
    rematch: function () { rematch(false); },
    'new-seed': function () { rematch(true); },
    export: function () { ST.downloadJSON(DP.engine.exportGame(app.game), ST.exportName(app.game)); },
    share: function () {
      var g = app.game;
      var url = location.href.split('?')[0].split('#')[0] + '?seed=' + g.seed + '&turns=' + g.T + '&survival=' + (g.survival ? 1 : 0);
      copyText(url).then(function (ok) { UI.toast(ok ? 'Link copied' : url, ok ? 'ok' : 'warn'); });
    },
    hall: function () { UI.renderHall(app, app.ui.hallTab); },
    'hall-tab': function (d) { app.ui.hallTab = d.tab; UI.renderHall(app, d.tab); },
    'hall-clear': function () { ST.clearHall(); UI.renderHall(app, app.ui.hallTab); },
    'close-modal': function () { UI.hideModal(); },
    'replay-featured': function () { startReplay(app.featured); }
  };

  function rematch(newSeed) {
    var g = app.game, s = app.setup;
    s.seed = newSeed ? randomSeed() : String(g.seed);
    s.T = g.T; s.survival = g.survival; s.mode = g.mode === 'replay' ? 'offline' : g.mode;
    if (g.mode === 'replay') { UI.toast('A replay cannot be rematched. Pick players in Setup.', 'warn'); actions['back-setup'](); return; }
    // same roster as the finished match
    s.models = {}; s.sims = {};
    DP.sim.BOT_IDS.forEach(function (id) { s.sims[id] = false; });
    g.players.forEach(function (p) {
      if (p.kind === 'live') s.models[p.modelId] = true;
      else if (p.kind === 'sim') s.sims['' + p.id.slice(2)] = true;
    });
    s.ghosts = { buyhold: g.players.some(function (p) { return p.id === 'g:buyhold'; }), monkey: g.players.some(function (p) { return p.id === 'g:monkey'; }) };
    s.speedMs = g.speedMs; s.costCap = g.costCapBase;
    s.pick = g.pick ? (function () { var p = g.players.filter(function (x) { return x.id === g.pick; })[0]; return p ? (p.kind === 'live' ? 'live:' + p.modelId : 'sim:' + p.id.slice(2)) : ''; })() : '';
    app.game = null; app.view = 'setup'; UI.showView('setup'); render();
    // fill the hidden fields the way the form would, then start
    if ($('seed')) $('seed').value = s.seed;
    startMatch();
  }

  function startReplay(data) {
    var game;
    try { game = DP.engine.createReplayGame(data); } catch (e) { app.setupMsg = e.message; render(); return; }
    attachGame(game);
    goto('match');
    actions.auto();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }

  // ---------- events ----------
  var changes = {
    mode: function (el) { app.setup.mode = el.value; persistSetup(); render(); },
    model: function (el) {
      if (el.checked) app.setup.models[el.dataset.id] = true; else delete app.setup.models[el.dataset.id];
      persistSetup(); render();
    },
    sim: function (el) { app.setup.sims[el.dataset.id] = el.checked; persistSetup(); render(); },
    ghost: function (el) { app.setup.ghosts[el.dataset.id] = el.checked; persistSetup(); },
    T: function (el) { app.setup.T = Number(el.value); persistSetup(); render(); },
    survival: function (el) { app.setup.survival = el.checked; persistSetup(); },
    speedMs: function (el) { app.setup.speedMs = Number(el.value); persistSetup(); },
    pick: function (el) { app.setup.pick = el.value; persistSetup(); },
    speedLive: function (el) { if (app.game) { app.game.speedMs = Number(el.value); } },
    file: function (el) {
      var f = el.files && el.files[0]; if (!f) return;
      ST.readFileJSON(f).then(startReplay, function (e) { app.setupMsg = e.message; render(); });
    }
  };

  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      var fn = actions[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el.dataset, el); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (!$('modal').hidden) UI.hideModal(); else if (app.ui.inspectorOpen) { app.ui.inspectorOpen = false; UI.renderInspector(app); } }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-act]')) { e.preventDefault(); e.target.click(); }
    });
    document.addEventListener('change', function (e) {
      var el = e.target;
      var name = el.dataset && el.dataset.change;
      if (name && changes[name]) changes[name](el);
    });
    // chart hover
    var cv = $('chart'), tip = $('chart-tip');
    cv.addEventListener('mousemove', function (e) {
      var g = app.game; if (!g) return;
      var rect = cv.getBoundingClientRect();
      var t = DP.chart.turnAt(cv, g, e.clientX - rect.left);
      app.ui.cursor = t; UI.drawChart(app, 'chart');
      var idx = t + C.WARMUP;
      var lines = ['<b>' + (t <= 0 ? (t === 0 ? 'Start' : 'Warm-up ' + t) : 'Turn ' + t) + '</b> · HIVE ' + g.market.prices[idx].toFixed(2)];
      if (t >= 0) {
        g.players.filter(function (p) { return !app.ui.hidden[p.id] && p.equityHist[t] !== undefined; }).sort(function (a, b) { return b.equityHist[t] - a.equityHist[t]; }).forEach(function (p) {
          lines.push('<span style="color:' + DP.chart.colorFor(g, p) + '">●</span> ' + UI.esc(p.name) + ' ' + UI.money(p.equityHist[t]));
        });
      }
      tip.innerHTML = lines.join('<br>'); tip.hidden = false;
      var x = e.clientX - rect.left + 14;
      tip.style.left = Math.min(x, rect.width - 190) + 'px'; tip.style.top = '8px';
    });
    cv.addEventListener('mouseleave', function () { app.ui.cursor = null; tip.hidden = true; if (app.game) UI.drawChart(app, 'chart'); });
    var rz;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        if (app.view === 'match') UI.drawChart(app, 'chart');
        if (app.view === 'results' && app.game) { var f = $('chart-final'); if (f) DP.chart.draw(f, app.game, { hidden: {}, reveal: true }); }
      }, 120);
    });
    window.addEventListener('beforeunload', function () { app.key = null; });
  }

  // ---------- boot ----------
  function boot() {
    restoreSetup();
    bind();
    UI.showView('setup');
    render();
    loadFeatured().then(function () { if (app.view === 'setup') render(); });
    loadModels();
    if (typeof customElements !== 'undefined') wireConnect(); else { app.connectUnavailable = true; render(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
