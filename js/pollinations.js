/* All network access lives here.
 * Endpoints used:
 *   POST https://gen.pollinations.ai/alpha/decisions   (decision models)
 *   GET  https://gen.pollinations.ai/v1/models   (model list)
 * The user's sk_ key is only ever passed in as an argument and never logged or stored.
 */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // GET /v1/models (public; with a key it is filtered to what that key may use).
  // The endpoint has no category filter, so decision models are picked by supported_endpoints below.
  function listDecisionModels(key) {
    var headers = {};
    if (key) headers['Authorization'] = 'Bearer ' + key;
    return fetch(C.ENDPOINT_MODELS, {
      method: 'GET', headers: headers, credentials: 'omit', cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (j) {
      var arr = (j && (j.data || j.models)) || (Array.isArray(j) ? j : []);
      return arr.filter(function (m) {
        var eps = m.supported_endpoints;
        return !eps || eps.indexOf('/alpha/decisions') >= 0;
      }).map(function (m) {
        var id = m.id || m.name;
        var desc = String(m.description || '');
        return {
          id: id,
          title: m.title || m.name || id,
          description: desc,
          paidOnly: !!m.paid_only,
          pricing: m.pricing || {},
          rpm: typeof m.per_user_rpm === 'number' ? m.per_user_rpm : null,
          context: m.context_length || null,
          health: (m.health && m.health.status) || null,
          noulOnly: /only noul/i.test(desc)
        };
      });
    });
  }

  function pricePerToken(pricing, field) {
    var v = pricing && pricing[field];
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  // Pollen cost from the response's own usage block. Returns null when usage is missing.
  function costOf(usage, pricing) {
    if (!usage || !Number.isInteger(usage.input_tokens) || !Number.isInteger(usage.output_tokens)) return null;
    return usage.input_tokens * pricePerToken(pricing, 'promptTextTokens') +
           usage.output_tokens * pricePerToken(pricing, 'completionTextTokens');
  }

  // One HTTP attempt. Resolves {kind, status, json, latencyMs, retryAfterMs, message}.
  // kind: ok | timeout | network | http
  function attempt(body, key, outerSignal, timeoutMs) {
    var ctrl = new AbortController();
    var timedOut = false;
    var t0 = Date.now();
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
    function onOuter() { ctrl.abort(); }
    if (outerSignal) {
      if (outerSignal.aborted) ctrl.abort();
      else outerSignal.addEventListener('abort', onOuter, { once: true });
    }
    return fetch(C.ENDPOINT_DECISIONS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal
      // referrerPolicy is deliberately left at the default (used for app request counts)
    }).then(function (res) {
      var latency = Date.now() - t0;
      var ra = Number(res.headers.get('Retry-After'));
      return res.text().then(function (txt) {
        var json = null;
        try { json = JSON.parse(txt); } catch (e) { json = null; }
        if (res.ok && json) return { kind: 'ok', status: res.status, json: json, latencyMs: latency };
        var msg = (json && json.error && json.error.message) || (res.ok ? 'response was not JSON' : txt.slice(0, 200));
        return {
          kind: 'http', status: res.status, json: json, latencyMs: latency,
          retryAfterMs: isFinite(ra) && ra > 0 ? ra * 1000 : null, message: msg
        };
      });
    }).catch(function (e) {
      var latency = Date.now() - t0;
      if (outerSignal && outerSignal.aborted && !timedOut) return { kind: 'aborted', status: 0, latencyMs: latency, message: 'aborted' };
      if (timedOut) return { kind: 'timeout', status: 0, latencyMs: latency, message: 'timeout after ' + timeoutMs + ' ms' };
      return { kind: 'network', status: 0, latencyMs: latency, message: String((e && e.message) || e) };
    }).then(function (r) {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuter);
      return r;
    });
  }

  // Retry rules (design 4.7): timeout/network/5xx -> 1 retry with the same body after 1.5 s;
  // 429 -> wait Retry-After (max 15 s), 1 retry. Everything else is returned as-is.
  // Resolves {result, attempts, log:[...]} where result is the last attempt.
  function postDecision(body, key, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || C.ATTEMPT_TIMEOUT_MS;
    var signal = opts.signal || null;
    var attempts = 0, log = [];
    function go() {
      attempts++;
      return attempt(body, key, signal, timeoutMs).then(function (r) {
        log.push({ n: attempts, kind: r.kind, status: r.status, latencyMs: r.latencyMs, message: r.message || null });
        if (r.kind === 'ok' || r.kind === 'aborted' || attempts >= 2) return { result: r, attempts: attempts, log: log };
        var retryable = r.kind === 'timeout' || r.kind === 'network' ||
          (r.kind === 'http' && (r.status === 500 || r.status === 502 || r.status === 503));
        if (retryable) return sleep(C.RETRY_DELAY_MS).then(go);
        if (r.kind === 'http' && r.status === 429) {
          var wait = Math.min(r.retryAfterMs || 3000, C.MAX_RETRY_AFTER_MS);
          r.rateLimited = true;
          return sleep(wait).then(go);
        }
        return { result: r, attempts: attempts, log: log };
      });
    }
    return go();
  }

  // Same request as it would be sent, with the key replaced by an env var name (never prints a key).
  function asCurl(body) {
    return "curl -X POST '" + C.ENDPOINT_DECISIONS + "' \\\n  -H 'Content-Type: application/json' \\\n  -H \"Authorization: Bearer $POLLINATIONS_KEY\" \\\n  -d '" +
      JSON.stringify(body).replace(/'/g, "'\\''") + "'";
  }

  DP.net = { listDecisionModels: listDecisionModels, postDecision: postDecision, costOf: costOf, asCurl: asCurl, sleep: sleep };
})();
