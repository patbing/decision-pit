/* Validates a decision response and turns probabilities into trade size / forecast. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config;

  function norm(s) { return String(s === undefined || s === null ? '' : s).trim().toLowerCase(); }
  function isProb(x) { return typeof x === 'number' && isFinite(x) && x >= 0 && x <= 1; }

  // Returns {probs, usedConfidence} for the offered keys, or null if nothing usable.
  function readProbs(ans, keys) {
    if (!ans || typeof ans !== 'object') return null;
    var raw = ans.probabilities;
    if (raw && typeof raw === 'object') {
      var map = {}, ok = true, sum = 0;
      Object.keys(raw).forEach(function (k) { map[norm(k)] = raw[k]; });
      var out = {};
      keys.forEach(function (k) {
        var v = map[k];
        if (!isProb(v)) ok = false; else { out[k] = v; sum += v; }
      });
      if (ok && sum >= 0.5 && sum <= 1.5) {
        if (Math.abs(sum - 1) > 1e-9) keys.forEach(function (k) { out[k] = out[k] / sum; });
        return { probs: out, source: 'probabilities' };
      }
    }
    return null;
  }

  // resp: parsed JSON body. offered: action keys shown. moveKeys: ['up','down'] or null.
  function normalizeAnswer(resp, offered, expectMove) {
    var res = { valid: false, reason: '', action: null, p: null, pUp: null, hasMove: false };
    if (!resp || typeof resp !== 'object' || !resp.answers || typeof resp.answers !== 'object') {
      res.reason = 'no answers object';
      return res;
    }
    var a = resp.answers.action;
    if (!a || typeof a !== 'object') { res.reason = 'no action answer'; return res; }
    var choice = norm(a.choice);
    if (offered.indexOf(choice) < 0) { res.reason = 'choice "' + choice + '" was not offered'; return res; }
    res.action = choice;

    var pr = readProbs(a, offered);
    var p = pr ? pr.probs[choice] : null;
    if (p === null) p = isProb(a.confidence) ? a.confidence : (1 / offered.length);
    res.p = p;
    res.valid = true;

    if (expectMove) {
      var m = resp.answers.next_move;
      if (m && typeof m === 'object') {
        var mc = norm(m.choice);
        if (mc === 'up' || mc === 'down') {
          var mp = readProbs(m, ['up', 'down']);
          var pUp = null;
          if (mp) pUp = mp.probs.up;
          else if (isProb(m.confidence)) pUp = mc === 'up' ? m.confidence : 1 - m.confidence;
          if (pUp !== null) { res.pUp = pUp; res.hasMove = true; }
        }
      }
    }
    return res;
  }

  // size in [SIZE_MIN, 1]
  function sizeFromProb(p, n) {
    var base = 1 / n;
    var f = Math.max(0, Math.min(1, (p - base) / (1 - base)));
    return C.SIZE_MIN + C.SIZE_SPAN * f;
  }

  DP.decide = { normalizeAnswer: normalizeAnswer, sizeFromProb: sizeFromProb };
})();
