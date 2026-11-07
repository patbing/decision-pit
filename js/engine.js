/* Game engine: state machine for setup -> check-in -> turn loop -> results.
 * Live players call the decision API; sim players return decision-shaped responses from rules.
 * Both go through the same validation, execution and ranking code. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config, M = DP.market, P = DP.portfolio, R = DP.rng;

  var W = C.WARMUP;

  function emit(game, type, data) {
    (game._listeners || []).forEach(function (fn) { try { fn(type, data); } catch (e) { /* ignore UI errors */ } });
  }

  // ---------- creation ----------
  // cfg: { seed, T, survival, mode, roster:[{kind:'live',modelId,name,pricing,rpm}|{kind:'sim',botId}], ghosts:{buyhold,monkey}, costCap, speedMs, pick }
  function createGame(cfg) {
    var T = Math.min(cfg.T || C.DEFAULT_TURNS, C.MAX_TURNS);
    var seed = (cfg.seed >>> 0);
    var market = M.buildMarket(seed, T);
    var interventions = [];
    market.prices = M.computePrices(market, interventions);
    var game = {
      version: 1, seed: seed, T: T, survival: !!cfg.survival, mode: cfg.mode || 'offline',
      createdAt: new Date().toISOString(), state: 'setup', nextTurn: 0,
      market: market, interventions: interventions, cardsLeft: C.CARDS_PER_GAME,
      players: [], turns: [], headlineLog: [], pending: {}, pauseReason: null,
      spent: 0, calls: 0, inTok: 0, outTok: 0, costCap: cfg.costCap || C.DEFAULT_COST_CAP, costCapBase: cfg.costCap || C.DEFAULT_COST_CAP,
      speedMs: cfg.speedMs || C.DEFAULT_SPEED_MS, cheers: {}, pick: cfg.pick || null,
      endedEarly: false, warnings: [], _listeners: [], _deciders: {}, _orderRng: {}, checkIn: []
    };
    var roster = cfg.roster || [];
    var liveN = roster.filter(function (r) { return r.kind === 'live'; }).length;
    var aiN = roster.length;
    game.maxCalls = liveN * T + liveN + 20;
    roster.forEach(function (r, i) {
      var id = r.kind === 'live' ? 'm' + i + ':' + r.modelId : 's:' + r.botId;
      var name = r.kind === 'live' ? (r.name || r.modelId) : DP.sim.BOTS[r.botId].name;
      game.players.push(newPlayer(id, r.kind, r.kind === 'live' ? r.modelId : 'offline/sim-' + r.botId, name, r));
      if (r.kind === 'sim') game._deciders[id] = DP.sim.makeSimDecider(r.botId, seed, id);
    });
    if (cfg.ghosts && cfg.ghosts.buyhold) addGhost(game, 'buyhold', 'Buy & Hold');
    if (cfg.ghosts && cfg.ghosts.monkey) addGhost(game, 'monkey', 'Random Monkey');
    game.players.forEach(function (p) {
      game._orderRng[p.id] = R.mulberry32((seed ^ R.hash32(p.id)) >>> 0);
    });
    game.aiCount = aiN;
    return game;
  }

  function newPlayer(id, kind, modelId, name, r) {
    return {
      id: id, kind: kind, modelId: modelId, name: name,
      pricing: (r && r.pricing) || {}, rpm: (r && r.rpm) || null,
      pf: P.newPortfolio(), equityHist: [C.START_CASH],
      status: 'active', statusNote: '', elimTurn: null, elimEquity: null,
      singleQuestion: false,
      stats: { trades: 0, errors: 0, consecFails: 0, calls: 0, inTok: 0, outTok: 0, pollen: 0, pollenKnown: true,
        brierSum: 0, brierN: 0, whispers: 0, swayed: 0, rumorTurns: 0, rumorFollowed: 0, latencySum: 0, latencyN: 0 }
    };
  }

  function addGhost(game, botId, name) {
    var id = 'g:' + botId;
    var p = newPlayer(id, 'ghost', 'offline/sim-' + botId, name, null);
    p.ghostKind = botId;
    game.players.push(p);
    game._deciders[id] = DP.sim.makeSimDecider(botId, game.seed, id);
  }

  // ---------- helpers ----------
  function aiPlayers(game) { return game.players.filter(function (p) { return p.kind !== 'ghost'; }); }
  function activeAI(game) { return aiPlayers(game).filter(function (p) { return p.status === 'active'; }); }
  function equityAt(game, p, price) { return P.equity(p.pf, price); }

  function brierOf(p) { return p.stats.brierN ? p.stats.brierSum / p.stats.brierN : null; }

  function headlineFor(game, t) {
    var base = game.market.news[t + W] || null;
    var ivs = DP.interventions.forTurn(game, t);
    var card = ivs.filter(function (iv) { return iv.type === 'rumor' || iv.type === 'shock'; })[0];
    if (card) {
      return { text: card.text, kind: card.type === 'rumor' ? 'card-rumor' : 'card-shock', displaced: base ? base.text : null, displacedKind: base ? base.kind : null };
    }
    if (base) return { text: base.text, kind: base.kind, displaced: null };
    return { text: null, kind: 'none', displaced: null };
  }

  function earlierHeadlines(game, t, currentDisplaced) {
    var out = [];
    if (currentDisplaced) out.push({ turn: t + 1, text: currentDisplaced });
    for (var k = t - 1; k >= 0 && out.length < 3; k--) {
      var h = game.headlineLog[k];
      if (!h) continue;
      if (h.text) out.push({ turn: k + 1, text: h.text });
      if (h.displaced && out.length < 3) out.push({ turn: k + 1, text: h.displaced });
    }
    return out.slice(0, 3).reverse();
  }

  function makeSnapshot(game, p, t, headline, whisperText) {
    var idx = t + W, prices = game.market.prices;
    var price = prices[idx];
    var ind = M.indicators(prices, idx);
    var last = prices.slice(Math.max(0, idx - 7), idx + 1);
    var eq = equityAt(game, p, price);
    var pos = p.pf.shares * price;
    var peak = Math.max.apply(null, p.equityHist.concat([eq]));
    var ai = activeAI(game);
    var ranked = ai.map(function (x) { return { id: x.id, eq: equityAt(game, x, price) }; })
      .sort(function (a, b) { return b.eq - a.eq; });
    var rank = 1;
    for (var i = 0; i < ranked.length; i++) if (ranked[i].id === p.id) { rank = i + 1; break; }
    var leaderEq = ranked.length ? ranked[0].eq : eq;
    var c1 = Math.round(game.T / 3), c2 = Math.round(2 * game.T / 3);
    return {
      turn: t + 1, T: game.T, price: price, last: last,
      chg1: ind.chg1, chg5: ind.chg5, dev10: ind.dev10, vol: ind.vol,
      headline: headline.text,
      earlier: earlierHeadlines(game, t, headline.displaced),
      player: {
        name: p.name, cash: p.pf.cash, shares: p.pf.shares, posValue: pos,
        posPct: eq > 0 ? (pos / eq) * 100 : 0, equity: eq, ret: eq / C.START_CASH - 1,
        avgCost: p.pf.avgCost, drawdown: peak > 0 ? eq / peak - 1 : 0
      },
      rank: rank, nActive: Math.max(1, ai.length), leaderRet: leaderEq / C.START_CASH - 1,
      survival: game.survival ? [c1, c2] : null,
      whisper: whisperText || null
    };
  }

  function minTurnGapMs(game) {
    var gap = game.speedMs;
    if (game.mode === 'live') {
      activeAI(game).forEach(function (p) {
        if (p.kind === 'live' && p.rpm) gap = Math.max(gap, Math.ceil((60000 / p.rpm) * 1.1));
      });
    }
    return gap;
  }

  // ---------- one decision ----------
  // Returns a decision record. Never throws.
  function decideLive(game, p, snap, offered, whisperAction, deps, signal) {
    var key = deps.getKey();
    var rec = { playerId: p.id, kind: 'live', offered: offered.slice(), status: 'pending', fallback: false, attempts: 0 };
    if (!key) { rec.status = 'auth'; rec.http = 401; rec.note = 'no key'; return Promise.resolve(rec); }
    if (game.calls >= game.maxCalls) {
      rec.status = 'fallback'; rec.fallback = true; rec.note = 'call cap reached';
      if (game.warnings.indexOf('call cap reached') < 0) game.warnings.push('call cap reached');
      return Promise.resolve(rec);
    }
    var state = DP.prompt.buildState(snap);
    var qs = DP.prompt.buildQuestions(offered, snap.price, game._orderRng[p.id], p.singleQuestion);
    function send(q) {
      var body = { model: p.modelId, state: state, questions: q.questions };
      rec.request = body; rec.order = { action: q.actionOrder, move: q.moveOrder };
      return deps.post(body, key, { signal: signal }).then(function (r) {
        game.calls += r.attempts; p.stats.calls += r.attempts;
        rec.attempts += r.attempts; rec.log = (rec.log || []).concat(r.log);
        return r.result;
      });
    }
    return send(qs).then(function (res) {
      if (res.kind === 'http' && (res.status === 400 || res.status === 422) && !p.singleQuestion) {
        p.singleQuestion = true;
        qs = DP.prompt.buildQuestions(offered, snap.price, game._orderRng[p.id], true);
        return send(qs);
      }
      return res;
    }).then(function (res) {
      rec.latencyMs = res.latencyMs;
      rec.http = res.status;
      if (res.kind === 'ok') {
        rec.response = res.json;
        var n = DP.decide.normalizeAnswer(res.json, offered, !p.singleQuestion);
        var u = res.json && res.json.usage;
        if (u && Number.isInteger(u.input_tokens) && Number.isInteger(u.output_tokens)) {
          rec.inTok = u.input_tokens; rec.outTok = u.output_tokens;
          rec.cost = DP.net.costOf(u, p.pricing);
        } else {
          rec.inTok = 0; rec.outTok = 0; rec.cost = null; p.stats.pollenKnown = false;
        }
        if (!n.valid) { rec.status = 'invalid'; rec.fallback = true; rec.note = n.reason; return rec; }
        rec.status = 'ok'; rec.choice = n.action; rec.p = n.p; rec.pUp = n.hasMove ? n.pUp : null;
        return rec;
      }
      if (res.kind === 'aborted') { rec.status = 'deadline'; rec.fallback = true; rec.note = 'turn deadline'; return rec; }
      rec.note = res.message || res.kind;
      if (res.kind === 'http') {
        if (res.status === 401) { rec.status = 'auth'; return rec; }
        if (res.status === 402) { rec.status = 'budget'; return rec; }
        if (res.status === 403) { rec.status = 'denied'; return rec; }
        if (res.status === 400 || res.status === 422) { rec.status = 'incompatible'; return rec; }
      }
      rec.status = 'error'; rec.fallback = true;
      return rec;
    });
  }

  function decideSim(game, p, snap, offered, whisperAction) {
    var expectMove = p.kind !== 'ghost' || false;
    if (p.ghostKind === 'buyhold') expectMove = false;
    var rec = { playerId: p.id, kind: p.kind, offered: offered.slice(), status: 'pending', fallback: false, attempts: 0, latencyMs: 0 };
    return game._deciders[p.id](snap, offered, whisperAction, expectMove).then(function (resp) {
      rec.response = resp;
      var n = DP.decide.normalizeAnswer(resp, offered, expectMove);
      if (!n.valid) { rec.status = 'invalid'; rec.fallback = true; rec.note = n.reason; return rec; }
      rec.status = 'ok'; rec.choice = n.action; rec.p = n.p; rec.pUp = n.hasMove ? n.pUp : null;
      rec.inTok = 0; rec.outTok = 0; rec.cost = 0;
      return rec;
    });
  }

  function runPool(items, limit, worker) {
    return new Promise(function (resolve) {
      var i = 0, running = 0, done = 0, n = items.length, out = new Array(n);
      if (!n) return resolve(out);
      function next() {
        while (running < limit && i < n) {
          (function (idx) {
            running++;
            worker(items[idx]).then(function (r) { out[idx] = r; }, function (e) { out[idx] = { status: 'error', fallback: true, note: String(e) }; })
              .then(function () { running--; done++; if (done === n) resolve(out); else next(); });
          })(i++);
        }
      }
      next();
    });
  }

  // ---------- turn ----------
  // deps: { getKey():string|null, post(body,key,opts) }
  function playTurn(game, deps) {
    if (game.state === 'finished') return Promise.resolve({ finished: true });
    if (game.state === 'paused') game.pauseReason = null;
    game.state = 'running';
    var t = game.nextTurn, idx = t + W;
    var prices = game.market.prices;
    var price = prices[idx], nextPrice = prices[idx + 1];
    var headline = headlineFor(game, t);
    var ivs = DP.interventions.forTurn(game, t);
    var whisperIv = ivs.filter(function (iv) { return iv.type === 'whisper'; })[0] || null;
    var rumorIv = ivs.filter(function (iv) { return iv.type === 'rumor'; })[0] || null;
    var pend = game.pending[t] || {};

    var participants = game.players.filter(function (p) { return p.status === 'active'; });
    var snaps = {}, offeredBy = {};
    participants.forEach(function (p) {
      var wText = whisperIv && whisperIv.target === p.id ? whisperIv.text : null;
      snaps[p.id] = makeSnapshot(game, p, t, headline, wText);
      offeredBy[p.id] = P.offeredActions(p.pf);
    });

    var deadlineCtl = new AbortController();
    var timer = setTimeout(function () { deadlineCtl.abort(); }, C.TURN_DEADLINE_MS);

    var todo = participants.filter(function (p) { return !pend[p.id]; });
    var live = todo.filter(function (p) { return p.kind === 'live'; });
    var sims = todo.filter(function (p) { return p.kind !== 'live'; });

    emit(game, 'turnStart', { t: t, price: price, headline: headline, live: live.map(function (p) { return p.id; }) });

    var simPromise = Promise.all(sims.map(function (p) {
      var wa = whisperIv && whisperIv.target === p.id ? whisperIv.action : null;
      return decideSim(game, p, snaps[p.id], offeredBy[p.id], wa);
    }));
    var livePromise = runPool(live, C.MAX_CONCURRENCY, function (p) {
      var wa = whisperIv && whisperIv.target === p.id ? whisperIv.action : null;
      return decideLive(game, p, snaps[p.id], offeredBy[p.id], wa, deps, deadlineCtl.signal).then(function (rec) {
        emit(game, 'decision', { t: t, rec: rec });
        return rec;
      });
    });

    return Promise.all([simPromise, livePromise]).then(function (both) {
      clearTimeout(timer);
      var recs = {};
      Object.keys(pend).forEach(function (k) { recs[k] = pend[k]; });
      both[0].concat(both[1]).forEach(function (r) { if (r) recs[r.playerId] = r; });

      // Pause conditions: key problems or budget problems stop the turn before anything is applied.
      var authFail = participants.some(function (p) { return recs[p.id] && recs[p.id].status === 'auth'; });
      var budgetFail = participants.some(function (p) { return recs[p.id] && recs[p.id].status === 'budget'; });
      if (authFail || budgetFail) {
        var keep = {};
        Object.keys(recs).forEach(function (k) { if (recs[k].status !== 'auth' && recs[k].status !== 'budget') keep[k] = recs[k]; });
        game.pending[t] = keep;
        game.state = 'paused';
        game.pauseReason = authFail ? 'auth' : 'budget';
        emit(game, 'paused', { reason: game.pauseReason });
        return { paused: game.pauseReason };
      }
      delete game.pending[t];
      return applyTurn(game, t, price, nextPrice, headline, whisperIv, rumorIv, participants, recs, offeredBy);
    });
  }

  function applyTurn(game, t, price, nextPrice, headline, whisperIv, rumorIv, participants, recs, offeredBy) {
    var decisions = [];
    var outcomeUp = nextPrice > price ? 1 : 0;

    participants.forEach(function (p) {
      var rec = recs[p.id] || { playerId: p.id, status: 'error', fallback: true, note: 'no result', offered: offeredBy[p.id] };
      var st = rec.status;
      // Status transitions caused by this call
      if (st === 'denied') { p.status = 'dnf'; p.statusNote = 'access denied (403)'; p.elimTurn = t; rec.dnf = true; }
      else if (st === 'incompatible') { p.status = 'dnf'; p.statusNote = 'model rejected the request (400)'; p.elimTurn = t; rec.dnf = true; }
      var failed = st !== 'ok';
      if (p.kind === 'live') {
        if (failed) { p.stats.errors++; p.stats.consecFails++; } else p.stats.consecFails = 0;
        if (p.status === 'active' && p.stats.consecFails >= C.CONSEC_FAIL_LIMIT) {
          p.status = 'dnf'; p.statusNote = 'failed ' + C.CONSEC_FAIL_LIMIT + ' turns in a row'; p.elimTurn = t; rec.dnf = true;
        }
        p.stats.inTok += rec.inTok || 0; p.stats.outTok += rec.outTok || 0;
        game.inTok += rec.inTok || 0; game.outTok += rec.outTok || 0;
        if (typeof rec.cost === 'number') { p.stats.pollen += rec.cost; game.spent += rec.cost; }
        if (rec.latencyMs && st === 'ok') { p.stats.latencySum += rec.latencyMs; p.stats.latencyN++; }
      } else if (failed && p.kind === 'sim') {
        p.stats.errors++;
      }

      var choice = st === 'ok' ? rec.choice : 'hold';
      var size = 0, eff = null;
      if (st === 'ok') {
        var n = (rec.offered || offeredBy[p.id]).length;
        size = choice === 'hold' ? 0 : DP.decide.sizeFromProb(rec.p, n);
        if (p.ghostKind === 'buyhold') size = choice === 'buy' ? 1 : 0;
        eff = P.execute(p.pf, choice, size, price);
        if (eff.traded) p.stats.trades++;
      } else {
        eff = { action: 'hold', traded: false };
      }
      rec.effective = eff.action; rec.size = size; rec.tradeInfo = eff;
      rec.t = t;

      // Whisper / rumor measurements use the model's choice (not the fallback)
      if (st === 'ok' && p.kind !== 'ghost') {
        if (whisperIv && whisperIv.target === p.id) {
          p.stats.whispers++;
          rec.whispered = whisperIv.action;
          if (choice === whisperIv.action) { p.stats.swayed++; rec.swayed = true; }
        }
        if (rumorIv) {
          p.stats.rumorTurns++;
          if (DP.interventions.followedRumor(rumorIv, choice)) { p.stats.rumorFollowed++; rec.followedRumor = true; }
        }
        if (typeof rec.pUp === 'number') {
          p.stats.brierSum += Math.pow(rec.pUp - outcomeUp, 2);
          p.stats.brierN++;
        }
      }
      // keep the response bulky data out of the in-memory turn record unless needed by the inspector
      decisions.push(rec);
    });

    game.headlineLog[t] = { text: headline.text, kind: headline.kind, displaced: headline.displaced, displacedKind: headline.displacedKind || null };

    // Advance market, mark to market
    game.players.forEach(function (p) {
      if (p.status === 'active' || p.status === 'dnf') {
        p.equityHist.push(equityAt(game, p, nextPrice));
      }
    });

    // Eliminations at the end of the turn
    var events = [];
    activeAI(game).forEach(function (p) {
      var eq = equityAt(game, p, nextPrice);
      if (eq < C.BANKRUPT_BELOW) {
        eliminate(game, p, t, nextPrice, 'bankrupt');
        events.push({ type: 'bankrupt', player: p.id, turn: t + 1 });
      }
    });
    if (game.survival) {
      var c1 = Math.round(game.T / 3), c2 = Math.round(2 * game.T / 3);
      if (t + 1 === c1 || t + 1 === c2) {
        var act = activeAI(game);
        if (act.length >= 3) {
          act.sort(function (a, b) {
            var ea = equityAt(game, a, nextPrice), eb = equityAt(game, b, nextPrice);
            if (ea !== eb) return ea - eb;
            var ba = brierOf(a), bb = brierOf(b);
            ba = ba === null ? 0.25 : ba; bb = bb === null ? 0.25 : bb;
            if (ba !== bb) return bb - ba; // worse (higher) Brier goes first
            return a.name < b.name ? -1 : 1;
          });
          eliminate(game, act[0], t, nextPrice, 'checkpoint');
          events.push({ type: 'checkpoint', player: act[0].id, turn: t + 1 });
        }
      }
    }

    var record = { t: t, price: price, nextPrice: nextPrice, headline: headline, decisions: decisions, events: events, interventions: DP.interventions.forTurn(game, t) };
    game.turns.push(record);
    game.nextTurn = t + 1;

    var done = game.nextTurn >= game.T;
    if (done) {
      game.state = 'finished';
      finalize(game);
      emit(game, 'finished', {});
    } else if (game.mode === 'live' && game.spent > game.costCap) {
      game.state = 'paused'; game.pauseReason = 'cap';
      emit(game, 'paused', { reason: 'cap' });
    } else if (activeAI(game).length === 0) {
      game.state = 'finished'; game.endedEarly = true;
      finalize(game);
      emit(game, 'finished', {});
    } else {
      game.state = 'ready';
    }
    emit(game, 'turnEnd', { record: record });
    return { record: record, finished: game.state === 'finished', paused: game.state === 'paused' ? game.pauseReason : null };
  }

  function eliminate(game, p, t, price, why) {
    p.status = 'eliminated'; p.statusNote = why; p.elimTurn = t + 1;
    P.liquidate(p.pf, price);
    p.elimEquity = equityAt(game, p, price);
    if (p.equityHist.length) p.equityHist[p.equityHist.length - 1] = p.elimEquity;
  }

  // ---------- pause handling ----------
  function continueAfterCap(game) {
    game.costCap = game.spent + game.costCapBase;
    game.state = 'ready'; game.pauseReason = null;
  }

  function endEarly(game) {
    if (game.state === 'finished') return;
    game.endedEarly = true; game.state = 'finished'; game.pauseReason = null;
    game.pending = {};
    finalize(game);
    emit(game, 'finished', {});
  }

  function resume(game) { if (game.state === 'paused') { game.state = 'ready'; game.pauseReason = null; } }

  // ---------- check-in ----------
  // One real call per live model using the opening snapshot. Not applied to portfolios.
  function checkInAll(game, deps) {
    var live = game.players.filter(function (p) { return p.kind === 'live'; });
    var headline = headlineFor(game, 0);
    var results = [];
    var key = deps.getKey();
    if (!key) return Promise.resolve({ ok: false, reason: 'auth', results: results });
    return runPool(live, C.MAX_CONCURRENCY, function (p) {
      var snap = makeSnapshot(game, p, 0, headline, null);
      var offered = P.offeredActions(p.pf);
      var before = game.calls;
      return decideLive(game, p, snap, offered, null, deps, null).then(function (rec) {
        var r = { playerId: p.id, status: rec.status, latencyMs: rec.latencyMs || null, http: rec.http || null,
          single: p.singleQuestion, note: rec.note || '', stance: rec.choice || null, p: rec.p || null,
          inTok: rec.inTok || 0, cost: rec.cost || 0, request: rec.request, response: rec.response, attempts: rec.attempts };
        game.spent += (typeof rec.cost === 'number' ? rec.cost : 0);
        game.inTok += rec.inTok || 0; game.outTok += rec.outTok || 0;
        p.stats.inTok += rec.inTok || 0; p.stats.outTok += rec.outTok || 0;
        if (typeof rec.cost === 'number') p.stats.pollen += rec.cost;
        return r;
      });
    }).then(function (rs) {
      rs.forEach(function (r) { results.push(r); });
      var auth = rs.some(function (r) { return r.status === 'auth'; });
      var budget = rs.some(function (r) { return r.status === 'budget'; });
      if (auth) return { ok: false, reason: 'auth', results: results };
      if (budget) return { ok: false, reason: 'budget', results: results };
      var removed = [];
      rs.forEach(function (r) {
        var p = game.players.filter(function (x) { return x.id === r.playerId; })[0];
        if (r.status === 'ok') { p.ready = true; return; }
        // a model that cannot answer is removed from the roster instead of failing mid-match
        removed.push({ id: p.id, name: p.name, reason: r.note || r.status });
      });
      game.players = game.players.filter(function (p) { return !removed.some(function (x) { return x.id === p.id; }); });
      game.checkIn = results;
      var ready = game.players.filter(function (p) { return p.kind === 'live'; }).length;
      return { ok: ready > 0 || game.players.some(function (p) { return p.kind === 'sim'; }), removed: removed, results: results, readyLive: ready };
    });
  }

  // ---------- ranking and awards ----------
  function standings(game) {
    var last = game.endedEarly ? Math.max(0, game.nextTurn) : game.T;
    var finalPrice = game.market.prices[last + W];
    var rows = game.players.map(function (p) {
      var eq = p.status === 'eliminated' && p.elimEquity !== null && p.elimEquity !== undefined ? p.elimEquity : equityAt(game, p, finalPrice);
      var br = brierOf(p);
      return {
        id: p.id, name: p.name, modelId: p.modelId, kind: p.kind, status: p.status, statusNote: p.statusNote,
        elimTurn: p.elimTurn, equity: eq, ret: eq / C.START_CASH - 1, mdd: P.maxDrawdown(p.equityHist),
        trades: p.stats.trades, brier: br, brierN: p.stats.brierN,
        whispers: p.stats.whispers, swayed: p.stats.swayed,
        rumorTurns: p.stats.rumorTurns, rumorFollowed: p.stats.rumorFollowed,
        errors: p.stats.errors, calls: p.stats.calls, inTok: p.stats.inTok, pollen: p.stats.pollen, pollenKnown: p.stats.pollenKnown,
        avgLatency: p.stats.latencyN ? Math.round(p.stats.latencySum / p.stats.latencyN) : null
      };
    });
    var ai = rows.filter(function (r) { return r.kind !== 'ghost'; });
    var ghosts = rows.filter(function (r) { return r.kind === 'ghost'; });
    var alive = ai.filter(function (r) { return r.status !== 'eliminated'; }).sort(function (a, b) { return b.equity - a.equity; });
    var out = ai.filter(function (r) { return r.status === 'eliminated'; }).sort(function (a, b) {
      if (b.elimTurn !== a.elimTurn) return b.elimTurn - a.elimTurn;
      return b.equity - a.equity;
    });
    var ranked = alive.concat(out);
    ranked.forEach(function (r, i) { r.rank = i + 1; });
    return { ranked: ranked, ghosts: ghosts, finalPrice: finalPrice, lastTurn: last };
  }

  function awards(game, st) {
    var res = { champion: null, forecaster: null, unshakable: [], lostToMonkey: [] };
    var ranked = st.ranked;
    if (ranked.length) res.champion = ranked[0].id;
    var best = null;
    ranked.forEach(function (r) {
      if (r.brierN >= 10 && r.brier !== null && (best === null || r.brier < best.brier)) best = r;
      if (r.whispers >= 1 && r.swayed === 0) res.unshakable.push(r.id);
    });
    if (best) res.forecaster = best.id;
    var monkey = st.ghosts.filter(function (g) { return g.id === 'g:monkey'; })[0];
    if (monkey) ranked.forEach(function (r) { if (r.equity < monkey.equity) res.lostToMonkey.push(r.id); });
    return res;
  }

  function finalize(game) {
    game.final = standings(game);
    game.awards = awards(game, game.final);
  }

  // ---------- export ----------
  function exportGame(game) {
    var strip = function (rec) {
      var c = {};
      Object.keys(rec).forEach(function (k) { if (k !== 'headers') c[k] = rec[k]; });
      return c;
    };
    return {
      version: 1, app: 'decision-pit', seed: game.seed, T: game.T, survival: game.survival, mode: game.mode,
      createdAt: game.createdAt, endedEarly: game.endedEarly,
      interventions: game.interventions,
      players: game.players.map(function (p) {
        return { id: p.id, kind: p.kind, ghostKind: p.ghostKind || null, modelId: p.modelId, name: p.name, status: p.status,
          statusNote: p.statusNote, elimTurn: p.elimTurn, stats: p.stats, equityHist: p.equityHist, pricing: p.pricing };
      }),
      turns: game.turns.map(function (tr) {
        return { t: tr.t, price: tr.price, nextPrice: tr.nextPrice, headline: tr.headline, events: tr.events,
          decisions: tr.decisions.map(strip) };
      }),
      totals: { calls: game.calls, inTok: game.inTok, outTok: game.outTok, pollen: game.spent },
      cheers: game.cheers, pick: game.pick,
      final: game.final || null, awards: game.awards || null
    };
  }

  // ---------- replay ----------
  // Rebuilds a recorded match from an export: same seed, same roster, same interventions. Live players'
  // answers come from the recording through replayDeps(); sim players and ghosts are deterministic.
  function createReplayGame(data) {
    if (!data || data.app !== 'decision-pit' || !data.players || !data.turns) throw new Error('Not a Decision Pit export');
    var roster = [], ghosts = {};
    data.players.forEach(function (p) {
      if (p.kind === 'live') roster.push({ kind: 'live', modelId: p.modelId, name: p.name, pricing: p.pricing || {}, rpm: null });
      else if (p.kind === 'sim') roster.push({ kind: 'sim', botId: String(p.id).slice(2) });
      else if (p.kind === 'ghost' && p.ghostKind) ghosts[p.ghostKind] = true;
    });
    var game = createGame({ seed: data.seed, T: data.T, survival: data.survival, mode: 'replay', roster: roster, ghosts: ghosts,
      costCap: 1e9, speedMs: 1200 });
    // keep the recorded ids (a check-in may have removed a model, which shifts roster indexes)
    var recorded = data.players.filter(function (p) { return p.kind === 'live'; });
    var k = 0;
    game.players.forEach(function (p) {
      if (p.kind !== 'live') return;
      var rp = recorded[k++];
      if (rp && rp.id !== p.id) { game._orderRng[rp.id] = game._orderRng[p.id]; delete game._orderRng[p.id]; p.id = rp.id; }
    });
    (data.interventions || []).forEach(function (iv) { game.interventions.push(JSON.parse(JSON.stringify(iv))); });
    game.cardsLeft = Math.max(0, C.CARDS_PER_GAME - game.interventions.length);
    game.market.prices = M.computePrices(game.market, game.interventions);
    var bad = 0;
    (data.turns || []).forEach(function (tr) {
      var p = game.market.prices[tr.t + W];
      if (Math.abs(p - tr.price) > 0.005) bad++;
    });
    if (bad) game.warnings.push('replay price mismatch on ' + bad + ' turns (different app version?)');
    game.replayData = data;
    game.cheers = JSON.parse(JSON.stringify(data.cheers || {}));
    game.pick = data.pick || null;
    return game;
  }

  function replayDeps(game) {
    var data = game.replayData;
    return {
      getKey: function () { return 'replay'; },
      post: function (body) {
        var t = game.nextTurn;
        var tr = data.turns[t];
        var p = game.players.filter(function (x) { return x.kind === 'live' && x.modelId === body.model; })[0];
        var d = tr && p ? tr.decisions.filter(function (x) { return x.playerId === p.id; })[0] : null;
        var res;
        if (!d) res = { kind: 'http', status: 500, latencyMs: 0, message: 'no recorded answer' };
        else if (d.request && d.request.questions && Object.keys(body.questions).length > Object.keys(d.request.questions).length) {
          res = { kind: 'http', status: 400, latencyMs: 0, message: 'recorded as single-question' };
        } else if (d.response) res = { kind: 'ok', status: 200, json: d.response, latencyMs: d.latencyMs || 0 };
        else if (d.status === 'deadline') res = { kind: 'aborted', status: 0, latencyMs: 0 };
        else res = { kind: 'http', status: d.http || 500, latencyMs: d.latencyMs || 0, message: d.note || 'recorded failure' };
        return Promise.resolve({ result: res, attempts: (d && d.attempts) || 1, log: [] });
      }
    };
  }

  // After a replay finishes: do the rebuilt results match the recording?
  function verifyReplay(game) {
    var data = game.replayData, out = { ok: true, checked: 0, diffs: [] };
    if (!data || !data.final || !game.final) return { ok: null, checked: 0, diffs: [] };
    data.final.ranked.concat(data.final.ghosts || []).forEach(function (r) {
      var mine = game.final.ranked.concat(game.final.ghosts).filter(function (x) { return x.id === r.id; })[0];
      out.checked++;
      if (!mine || Math.abs(mine.equity - r.equity) > 0.02) { out.ok = false; out.diffs.push(r.name); }
    });
    return out;
  }

  DP.engine = {
    createReplayGame: createReplayGame, replayDeps: replayDeps, verifyReplay: verifyReplay,
    createGame: createGame, playTurn: playTurn, checkInAll: checkInAll,
    standings: standings, awards: awards, finalize: finalize,
    continueAfterCap: continueAfterCap, endEarly: endEarly, resume: resume,
    minTurnGapMs: minTurnGapMs, exportGame: exportGame, makeSnapshot: makeSnapshot,
    headlineFor: headlineFor, activeAI: activeAI, aiPlayers: aiPlayers, equityAt: equityAt, brierOf: brierOf,
    onEvent: function (game, fn) { game._listeners.push(fn); }
  };
})();
