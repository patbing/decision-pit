/* Seeded randomness. Same seed => same market path regardless of players. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // FNV-1a 32-bit
  function hash32(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // Standard normal via Box-Muller (consumes two uniforms per call, discards the spare for determinism).
  function normal(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // weights: array of numbers; returns index
  function pickWeighted(weights, rng) {
    var sum = 0, i;
    for (i = 0; i < weights.length; i++) sum += weights[i];
    var r = rng() * sum;
    for (i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  DP.rng = {
    mulberry32: mulberry32,
    hash32: hash32,
    normal: normal,
    shuffle: shuffle,
    pickWeighted: pickWeighted
  };
})();
