/* Offline simulation players. Same interface as a live model call: they return a decision-API-shaped
 * response, so parsing, execution and ranking go through the exact same code. They never call the network. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var R = DP.rng;

  var POS = ['beats', 'raises', 'deal', 'approves', 'buyback', 'upgrade', 'record', 'improve', 'stake'];
  var NEG = ['misses', 'lowers', 'probe', 'recall', 'switch suppliers', 'resigns', 'squeeze', 'rules against', 'downgrade'];
  var RUMOR = ['unverified', 'anonymous', 'chatter', 'unconfirmed', 'rumor', 'viral'];

  function sentOf(text) {
    if (!text) return 0;
    var t = text.toLowerCase(), s = 0;
    POS.forEach(function (w) { if (t.indexOf(w) >= 0) s += 1; });
    NEG.forEach(function (w) { if (t.indexOf(w) >= 0) s -= 1; });
    var rum = RUMOR.some(function (w) { return t.indexOf(w) >= 0; });
    return rum ? s * 0.3 : s;
  }
  function headlineSentiment(snap) {
    var s = sentOf(snap.headline);
    (snap.earlier || []).slice(-3).forEach(function (e) { s += 0.5 * sentOf(e.text); });
    return s;
  }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  function softmax(scores, temp) {
    var keys = Object.keys(scores), max = -Infinity, sum = 0, out = {};
    keys.forEach(function (k) { if (scores[k] > max) max = scores[k]; });
    keys.forEach(function (k) { out[k] = Math.exp((scores[k] - max) / temp); sum += out[k]; });
    keys.forEach(function (k) { out[k] = out[k] / sum; });
    return out;
  }

  var BOTS = {
    momentum: { name: 'Sim · Momentum', temp: 0.5, whisper: 0.2,
      scores: function (s) { return { buy: 40 * s.chg5, sell: -40 * s.chg5, hold: 0.3 }; },
      pUp: function (s) { return sigmoid(30 * s.chg5); } },
    contrarian: { name: 'Sim · Contrarian', temp: 0.5, whisper: 0.1,
      scores: function (s) { return { buy: -50 * s.dev10, sell: 50 * s.dev10, hold: 0.3 }; },
      pUp: function (s) { return sigmoid(-25 * s.dev10); } },
    headline: { name: 'Sim · Headline', temp: 0.6, whisper: 0.3,
      scores: function (s) { var h = headlineSentiment(s); return { buy: h * 1.5, sell: -h * 1.5, hold: 0.4 }; },
      pUp: function (s) { return sigmoid(1.2 * headlineSentiment(s)); } },
    turtle: { name: 'Sim · Turtle', temp: 0.4, whisper: 0.0,
      scores: function (s) {
        var dd = s.player.drawdown || 0;
        return {
          buy: (dd > -0.03 || s.player.posPct >= 30) ? 0 : 0.8,
          sell: dd < -0.05 ? 1.2 : 0,
          hold: 1.0
        };
      },
      pUp: function () { return 0.5; } },
    gambler: { name: 'Sim · Gambler', temp: 0.25, whisper: 0.7,
      scores: function (s, rng) { return { buy: rng() * 1.5, sell: rng() * 1.5, hold: 0.2 }; },
      pUp: function (s, rng) { return 0.2 + 0.6 * rng(); } }
  };

  function argmax(map, keys, rng) {
    var best = -Infinity, ties = [];
    keys.forEach(function (k) {
      var v = map[k];
      if (v > best + 1e-12) { best = v; ties = [k]; } else if (Math.abs(v - best) <= 1e-12) ties.push(k);
    });
    return ties.length === 1 ? ties[0] : ties[Math.floor(rng() * ties.length)];
  }

  function makeResponse(modelId, action, probs, pUp, expectMove) {
    var ans = { action: { type: 'choice', choice: action, confidence: probs[action], probabilities: probs } };
    if (expectMove) {
      ans.next_move = { type: 'choice', choice: pUp >= 0.5 ? 'up' : 'down',
        confidence: Math.max(pUp, 1 - pUp), probabilities: { up: pUp, down: 1 - pUp } };
    }
    return { id: 'sim-' + Math.random().toString(36).slice(2, 8), model: modelId, provider: 'offline',
      answers: ans, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  // kind: bot id | 'monkey' | 'buyhold'.
  function makeSimDecider(kind, seed, playerId) {
    var rng = R.mulberry32((seed ^ R.hash32('bot:' + playerId)) >>> 0);
    return function decide(snap, offered, whisperAction, expectMove) {
      var modelId = 'offline/sim-' + kind;
      var n = offered.length, probs = {}, action, pUp = 0.5;
      if (kind === 'monkey') {
        offered.forEach(function (k) { probs[k] = 1 / n; });
        action = offered[Math.floor(rng() * n)];
        return Promise.resolve(makeResponse(modelId, action, probs, 0.5, expectMove));
      }
      if (kind === 'buyhold') {
        if (snap.turn === 1 && offered.indexOf('buy') >= 0) {
          offered.forEach(function (k) { probs[k] = 0; });
          probs.buy = 1; action = 'buy';
        } else {
          offered.forEach(function (k) { probs[k] = 0; });
          probs.hold = 1; action = 'hold';
        }
        return Promise.resolve(makeResponse(modelId, action, probs, 0.5, false));
      }
      var b = BOTS[kind];
      var sc = b.scores(snap, rng);
      var scores = {};
      offered.forEach(function (k) { scores[k] = sc[k]; });
      if (whisperAction && scores[whisperAction] !== undefined) scores[whisperAction] += 3 * b.whisper;
      probs = softmax(scores, b.temp);
      action = argmax(probs, offered, rng);
      pUp = DP.market.clamp(b.pUp(snap, rng), 0.02, 0.98);
      return Promise.resolve(makeResponse(modelId, action, probs, pUp, expectMove));
    };
  }

  DP.sim = {
    BOTS: BOTS,
    BOT_IDS: Object.keys(BOTS),
    makeSimDecider: makeSimDecider,
    headlineSentiment: headlineSentiment,
    softmax: softmax
  };
})();
