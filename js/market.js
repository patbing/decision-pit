/* Rule-based fictional market. Deterministic given (seed, T, interventions). */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var R = DP.rng;
  var C = DP.config;

  var REGIMES = {
    BULL: { mu: 0.004, sigma: 0.012 },
    BEAR: { mu: -0.004, sigma: 0.014 },
    CHOP: { mu: 0, sigma: 0.009 },
    PANIC: { mu: -0.015, sigma: 0.03 }
  };
  var NAMES = ['BULL', 'BEAR', 'CHOP', 'PANIC'];
  var TRANS = {
    BULL: [0.88, 0.03, 0.08, 0.01],
    BEAR: [0.03, 0.86, 0.09, 0.02],
    CHOP: [0.07, 0.07, 0.84, 0.02],
    PANIC: [0.05, 0.25, 0.15, 0.55]
  };

  // kind: real | rumor | hint. dir: +1 / -1 / 0. drift per turn for dur turns.
  var HEADLINES = [
    { id: 'p1', kind: 'real', dir: 1, drift: 0.010, dur: 3, text: 'HiveWorks beats quarterly earnings estimates and raises guidance.' },
    { id: 'p2', kind: 'real', dir: 1, drift: 0.008, dur: 3, text: 'HiveWorks signs a multi-year supply deal with a major retailer.' },
    { id: 'p3', kind: 'real', dir: 1, drift: 0.012, dur: 2, text: "Regulator approves HiveWorks' new pollination drone for sale." },
    { id: 'p4', kind: 'real', dir: 1, drift: 0.006, dur: 4, text: 'HiveWorks announces a share buyback program.' },
    { id: 'p5', kind: 'real', dir: 1, drift: 0.008, dur: 3, text: 'Two analysts upgrade HiveWorks to "buy" after a factory tour.' },
    { id: 'p6', kind: 'real', dir: 1, drift: 0.010, dur: 2, text: 'HiveWorks reports record monthly orders.' },
    { id: 'p7', kind: 'real', dir: 1, drift: 0.007, dur: 3, text: 'HiveWorks cuts costs; margins expected to improve next quarter.' },
    { id: 'p8', kind: 'real', dir: 1, drift: 0.009, dur: 2, text: 'A large pension fund discloses a new stake in HiveWorks.' },
    { id: 'n1', kind: 'real', dir: -1, drift: 0.010, dur: 3, text: 'HiveWorks misses earnings estimates and lowers guidance.' },
    { id: 'n2', kind: 'real', dir: -1, drift: 0.012, dur: 2, text: 'Regulator opens a safety probe into HiveWorks drones.' },
    { id: 'n3', kind: 'real', dir: -1, drift: 0.008, dur: 3, text: 'HiveWorks recalls 40,000 units over a battery defect.' },
    { id: 'n4', kind: 'real', dir: -1, drift: 0.007, dur: 4, text: "HiveWorks' biggest customer says it will switch suppliers." },
    { id: 'n5', kind: 'real', dir: -1, drift: 0.009, dur: 2, text: "HiveWorks' CFO resigns unexpectedly." },
    { id: 'n6', kind: 'real', dir: -1, drift: 0.006, dur: 3, text: "Rising component prices squeeze HiveWorks' margins." },
    { id: 'n7', kind: 'real', dir: -1, drift: 0.010, dur: 2, text: 'A court rules against HiveWorks in a patent dispute.' },
    { id: 'n8', kind: 'real', dir: -1, drift: 0.008, dur: 3, text: 'Two analysts downgrade HiveWorks to "sell".' },
    { id: 'r1', kind: 'rumor', dir: 1, drift: 0, dur: 0, text: 'Unverified social media post claims HiveWorks will be acquired.' },
    { id: 'r2', kind: 'rumor', dir: -1, drift: 0, dur: 0, text: 'Anonymous forum user says HiveWorks is about to go bankrupt.' },
    { id: 'r3', kind: 'rumor', dir: 1, drift: 0, dur: 0, text: 'Chatter on trading forums: "HIVE to the moon this week."' },
    { id: 'r4', kind: 'rumor', dir: -1, drift: 0, dur: 0, text: "Unconfirmed report says HiveWorks' CEO is under investigation." },
    { id: 'r5', kind: 'rumor', dir: 1, drift: 0, dur: 0, text: 'A viral video claims HiveWorks has a secret new product.' },
    { id: 'r6', kind: 'rumor', dir: -1, drift: 0, dur: 0, text: 'Unverified rumor: a major factory fire at HiveWorks.' },
    { id: 'h1', kind: 'hint', regime: 'BULL', dir: 0, drift: 0, dur: 0, text: 'Market commentators note steady buying in HIVE.' },
    { id: 'h2', kind: 'hint', regime: 'BEAR', dir: 0, drift: 0, dur: 0, text: 'Market commentators note persistent selling in HIVE.' },
    { id: 'h3', kind: 'hint', regime: 'CHOP', dir: 0, drift: 0, dur: 0, text: 'Trading in HIVE turns quiet and range-bound.' },
    { id: 'h4', kind: 'hint', regime: 'PANIC', dir: 0, drift: 0, dur: 0, text: 'Volatility desks report heavy, panicked selling in HIVE.' }
  ];

  function round2(x) { return Math.round(x * 100) / 100; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Pre-generate z, regimes, headlines. Arrays are indexed by t + WARMUP (t = -WARMUP .. T).
  function buildMarket(seed, T) {
    var W = C.WARMUP;
    var n = W + T + 1;
    var marketRng = R.mulberry32(seed);
    var newsRng = R.mulberry32((seed ^ 0x9e3779b9) >>> 0);

    var z = [], regimes = [], news = [];
    var cur = 'CHOP', i;
    for (i = 0; i < n; i++) {
      regimes.push(cur);
      z.push(R.normal(marketRng));
      var row = TRANS[cur];
      cur = NAMES[R.pickWeighted(row, marketRng)];
    }

    var lastUsed = {};
    for (i = 0; i < n; i++) {
      var idx = i - W; // turn index t
      var h = null;
      var changed = i > 0 && regimes[i] !== regimes[i - 1];
      var wantHint = changed && newsRng() < 0.6;
      if (idx >= -3) { // headlines only matter near/after turn 0; warmup history shows few
        if (wantHint) {
          for (var k = 0; k < HEADLINES.length; k++) {
            if (HEADLINES[k].kind === 'hint' && HEADLINES[k].regime === regimes[i]) { h = HEADLINES[k]; break; }
          }
        } else if (newsRng() < 0.35) {
          var pool = HEADLINES.filter(function (x) {
            return x.kind !== 'hint' && !(lastUsed[x.id] !== undefined && idx - lastUsed[x.id] < 5);
          });
          h = pool[Math.floor(newsRng() * pool.length)];
        }
        if (h) lastUsed[h.id] = idx;
      }
      news.push(h);
    }
    return { seed: seed, T: T, z: z, regimes: regimes, news: news, prices: null };
  }

  function activeNewsDrift(market, t, extraNews) {
    // Real news published at turn s affects turns s+1 .. s+dur.
    var W = C.WARMUP, d = 0;
    for (var s = Math.max(-W, t - 4); s < t; s++) {
      var h = market.news[s + W];
      if (h && h.kind === 'real' && t - s <= h.dur) d += h.dir * h.drift;
    }
    return d;
  }

  function sma(prices, endIdx, len) {
    var from = Math.max(0, endIdx - len + 1), s = 0, c = 0;
    for (var i = from; i <= endIdx; i++) { s += prices[i]; c++; }
    return s / c;
  }

  // Compute prices from index 0..(W+T). interventions: [{turn, type, dir}] applied for shock at "turn".
  // A card scheduled for turn t affects the price step t -> t+1 (shock only).
  function computePrices(market, interventions, upTo) {
    var W = C.WARMUP, T = market.T;
    var limit = upTo === undefined ? T : upTo;
    var prices = [C.START_PRICE];
    var shockAt = {};
    (interventions || []).forEach(function (iv) {
      if (iv.type === 'shock') shockAt[iv.turn] = (shockAt[iv.turn] || 0) + (iv.dir > 0 ? 0.06 : -0.06);
    });
    for (var i = 0; i < W + limit; i++) {
      var t = i - W;
      var rg = REGIMES[market.regimes[i]];
      var rev = 0;
      if (market.regimes[i] === 'CHOP') {
        var avg = sma(prices, i, 10);
        rev = -0.12 * Math.log(prices[i] / avg);
      }
      var r = rg.mu + rev + activeNewsDrift(market, t) + (shockAt[t] || 0) + rg.sigma * market.z[i];
      r = clamp(r, -0.12, 0.12);
      prices.push(Math.max(1, round2(prices[i] * Math.exp(r))));
    }
    return prices;
  }

  // Indicators at price index idx (t = idx - W). Returns ratios (not percents).
  function indicators(prices, idx) {
    function chg(k) {
      var j = Math.max(0, idx - k);
      return prices[idx] / prices[j] - 1;
    }
    var avg10 = sma(prices, idx, 10);
    var dev10 = prices[idx] / avg10 - 1;
    var s = 0, c = 0;
    for (var i = Math.max(1, idx - 4); i <= idx; i++) {
      s += Math.abs(Math.log(prices[i] / prices[i - 1]));
      c++;
    }
    var m = c ? s / c : 0;
    var vol = m < 0.008 ? 'low' : (m > 0.018 ? 'high' : 'normal');
    return { chg1: chg(1), chg5: chg(5), dev10: dev10, vol: vol };
  }

  DP.market = {
    REGIMES: REGIMES,
    HEADLINES: HEADLINES,
    buildMarket: buildMarket,
    computePrices: computePrices,
    indicators: indicators,
    round2: round2,
    clamp: clamp
  };
})();
