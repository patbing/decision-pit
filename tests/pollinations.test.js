'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');

const plain = (x) => JSON.parse(JSON.stringify(x));

function mkResponse(status, body, headers) {
  const txt = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (headers && headers[k]) || null },
    text: () => Promise.resolve(txt),
    json: () => Promise.resolve(JSON.parse(txt))
  };
}

// script: array of functions (req) => Promise<response> | response | 'hang'
function mockFetch(script) {
  const calls = [];
  const f = (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    const out = typeof step === 'function' ? step(init) : step;
    if (out === 'hang') {
      return new Promise((_, rej) => {
        init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
      });
    }
    if (out === 'netfail') return Promise.reject(new Error('network down'));
    return Promise.resolve(out);
  };
  f.calls = calls;
  return f;
}

function setup(script) {
  const fetch = mockFetch(script);
  const DP = load({ fetch });
  DP.config.RETRY_DELAY_MS = 5;
  DP.config.MAX_RETRY_AFTER_MS = 20;
  return { DP, fetch };
}

const OK_BODY = {
  id: 'dec-1', model: 'x',
  answers: {
    action: { type: 'choice', choice: 'buy', confidence: 0.7, probabilities: { hold: 0.2, buy: 0.7 } },
    next_move: { type: 'choice', choice: 'up', confidence: 0.6, probabilities: { up: 0.6, down: 0.4 } }
  },
  usage: { input_tokens: 700, output_tokens: 5 }
};

const REQ = { model: 'm', state: 's', questions: { action: { type: 'choice', instructions: 'i', criteria: { hold: 'h', buy: 'b' } } } };

test('request: POST with Bearer key, JSON body, no cookies, no referrer override', async () => {
  const { DP, fetch } = setup([mkResponse(200, OK_BODY)]);
  const r = await DP.net.postDecision(REQ, 'sk_testkey', {});
  assert.equal(r.result.kind, 'ok');
  const c = fetch.calls[0];
  assert.equal(c.url, 'https://gen.pollinations.ai/alpha/decisions');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers.Authorization, 'Bearer sk_testkey');
  assert.equal(c.init.credentials, 'omit');
  assert.equal(c.init.referrerPolicy, undefined);
  assert.deepEqual(plain(JSON.parse(c.init.body)), REQ);
});

test('5xx is retried once with the same body, then reported', async () => {
  const { DP, fetch } = setup([mkResponse(503, { error: { message: 'busy' } }), mkResponse(200, OK_BODY)]);
  const r = await DP.net.postDecision(REQ, 'sk_x', {});
  assert.equal(r.result.kind, 'ok');
  assert.equal(r.attempts, 2);
  assert.equal(fetch.calls[0].init.body, fetch.calls[1].init.body);

  const b = setup([mkResponse(502, { error: { message: 'bad' } })]);
  const r2 = await b.DP.net.postDecision(REQ, 'sk_x', {});
  assert.equal(r2.result.kind, 'http');
  assert.equal(r2.result.status, 502);
  assert.equal(r2.attempts, 2);
});

test('network error and timeout are retried once', async () => {
  const n = setup(['netfail', mkResponse(200, OK_BODY)]);
  const r = await n.DP.net.postDecision(REQ, 'sk_x', {});
  assert.equal(r.result.kind, 'ok');
  assert.equal(r.attempts, 2);

  const t = setup(['hang', 'hang']);
  const r2 = await t.DP.net.postDecision(REQ, 'sk_x', { timeoutMs: 30 });
  assert.equal(r2.result.kind, 'timeout');
  assert.equal(r2.attempts, 2);
});

test('429 waits for Retry-After (capped) and retries once', async () => {
  const { DP, fetch } = setup([mkResponse(429, { error: { message: 'slow down' } }, { 'Retry-After': '99' }), mkResponse(200, OK_BODY)]);
  const t0 = Date.now();
  const r = await DP.net.postDecision(REQ, 'sk_x', {});
  assert.equal(r.result.kind, 'ok');
  assert.equal(fetch.calls.length, 2);
  assert.ok(Date.now() - t0 < 2000, 'wait is capped, not 99 s');
});

test('401, 402, 403, 400 are not retried', async () => {
  for (const code of [400, 401, 402, 403]) {
    const { DP, fetch } = setup([mkResponse(code, { error: { message: 'no' } })]);
    const r = await DP.net.postDecision(REQ, 'sk_x', {});
    assert.equal(r.result.status, code);
    assert.equal(fetch.calls.length, 1, 'status ' + code);
  }
});

test('cost uses response usage and model pricing; unknown usage gives null', () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const pricing = { promptTextTokens: '0.000000042' };
  const c = DP.net.costOf({ input_tokens: 1000, output_tokens: 10 }, pricing);
  assert.ok(Math.abs(c - 0.000042) < 1e-12);
  assert.equal(DP.net.costOf({}, pricing), null);
  assert.equal(DP.net.costOf(null, pricing), null);
});

test('curl export never contains a real key', () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const s = DP.net.asCurl(REQ);
  assert.ok(s.includes('$POLLINATIONS_KEY'));
  assert.ok(!/sk_/.test(s));
});

test('model list: filters to the decision endpoint and flags noul-only models', async () => {
  const list = { data: [
    { id: 'vllm-sr/d3', title: 'D3', supported_endpoints: ['/alpha/decisions'], paid_only: false, pricing: {}, per_user_rpm: 30, health: { status: 'ok' } },
    { id: 'respan/span-01-lite', title: 'Span', supported_endpoints: ['/alpha/decisions'], description: 'Returns only noul answers', paid_only: false },
    { id: 'other/text', title: 'Text', supported_endpoints: ['/v1/chat/completions'] }
  ] };
  const { DP, fetch } = setup([mkResponse(200, list)]);
  const ms = await DP.net.listDecisionModels(null);
  assert.equal(ms.length, 2);
  assert.equal(ms[0].rpm, 30);
  assert.equal(ms[1].noulOnly, true);
  assert.ok(fetch.calls[0].url.endsWith('/v1/models?category=decision'));
  assert.equal(fetch.calls[0].init.headers.Authorization, undefined);
});

// ---- engine behaviour on top of a scripted post() ----

function liveGame(DP, n) {
  const roster = [];
  for (let i = 0; i < n; i++) roster.push({ kind: 'live', modelId: 'model-' + i, name: 'Model ' + i, pricing: { promptTextTokens: '0.000001' }, rpm: null });
  return DP.engine.createGame({ seed: 7, T: 20, survival: false, mode: 'live', roster, ghosts: {} });
}

const okRes = (choice, p) => ({
  result: { kind: 'ok', status: 200, latencyMs: 50, json: {
    id: 'dec-x', answers: {
      action: { type: 'choice', choice, confidence: p, probabilities: { [choice]: p } },
      next_move: { type: 'choice', choice: 'up', confidence: 0.6, probabilities: { up: 0.6, down: 0.4 } } },
    usage: { input_tokens: 1000, output_tokens: 4 } } },
  attempts: 1, log: []
});
const failRes = (status, kind) => ({ result: { kind: kind || 'http', status, latencyMs: 10, message: 'm' }, attempts: 1, log: [] });

test('live turn: valid answer trades, cost is booked from usage', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  const deps = { getKey: () => 'sk_x', post: async () => ({ result: { kind: 'ok', status: 200, latencyMs: 40, json: {
    answers: { action: { choice: 'buy', confidence: 0.9, probabilities: { hold: 0.1, buy: 0.9 } },
      next_move: { choice: 'up', confidence: 0.7, probabilities: { up: 0.7, down: 0.3 } } },
    usage: { input_tokens: 1000, output_tokens: 4 } } }, attempts: 1, log: [] }) };
  await DP.engine.playTurn(g, deps);
  const p = g.players[0];
  assert.ok(p.pf.shares > 0);
  assert.equal(p.stats.calls, 1);
  assert.ok(Math.abs(g.spent - 0.001) < 1e-9);
  assert.equal(p.stats.brierN, 1);
});

test('live turn: 3 failures in a row make the player DNF; position is kept', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 2);
  let turn = 0;
  const deps = { getKey: () => 'sk_x', post: async (body) => {
    if (body.model === 'model-1') return failRes(503);
    return okRes('buy', 0.8);
  } };
  for (let i = 0; i < 3; i++) await DP.engine.playTurn(g, deps);
  const bad = g.players.find((p) => p.modelId === 'model-1');
  assert.equal(bad.status, 'dnf');
  assert.match(bad.statusNote, /3 turns/);
  // every failed turn became a HOLD, never a simulated trade
  g.turns.forEach((t) => {
    const d = t.decisions.find((x) => x.playerId === bad.id);
    if (d) assert.equal(d.effective, 'hold');
  });
  assert.equal(bad.pf.shares, 0);
});

test('live turn: 403 and a second 400 mark DNF immediately', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 2);
  const deps = { getKey: () => 'sk_x', post: async (body) => body.model === 'model-0' ? failRes(403) : failRes(400) };
  await DP.engine.playTurn(g, deps);
  assert.equal(g.players[0].status, 'dnf');
  assert.equal(g.players[1].status, 'dnf');
  assert.equal(g.players[1].singleQuestion, true, 'it first retried with a single question');
});

test('live turn: 400 on the two-question request retries with one question and keeps playing', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  const seen = [];
  const deps = { getKey: () => 'sk_x', post: async (body) => {
    seen.push(Object.keys(body.questions));
    if (body.questions.next_move) return failRes(400);
    return { result: { kind: 'ok', status: 200, latencyMs: 20, json: { answers: { action: { choice: 'buy', confidence: 0.8, probabilities: { hold: 0.2, buy: 0.8 } } }, usage: { input_tokens: 500, output_tokens: 3 } } }, attempts: 1, log: [] };
  } };
  await DP.engine.playTurn(g, deps);
  assert.equal(g.players[0].status, 'active');
  assert.equal(g.players[0].singleQuestion, true);
  assert.equal(plain(seen).length, 2);
  assert.ok(g.players[0].pf.shares > 0);
  assert.equal(g.players[0].stats.brierN, 0, 'no forecast score without the second question');
  // next turn sends a single question right away
  await DP.engine.playTurn(g, deps);
  assert.deepEqual(plain(seen[2]), ['action']);
});

test('live turn: invalid answer becomes HOLD with an error count and no retry', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  let calls = 0;
  const deps = { getKey: () => 'sk_x', post: async () => { calls++; return { result: { kind: 'ok', status: 200, latencyMs: 5, json: { answers: { action: { choice: 'sell' } } } }, attempts: 1, log: [] }; } };
  await DP.engine.playTurn(g, deps);
  assert.equal(calls, 1);
  assert.equal(g.players[0].stats.errors, 1);
  assert.equal(g.turns[0].decisions[0].effective, 'hold');
  assert.equal(g.turns[0].decisions[0].fallback, true);
});

test('401 pauses the match without applying the turn; resume repeats it and reuses finished answers', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 2);
  let phase = 'fail';
  const calls = { 'model-0': 0, 'model-1': 0 };
  const deps = { getKey: () => 'sk_x', post: async (body) => {
    calls[body.model]++;
    if (body.model === 'model-1' && phase === 'fail') return failRes(401);
    return okRes('buy', 0.8);
  } };
  const r = await DP.engine.playTurn(g, deps);
  assert.equal(r.paused, 'auth');
  assert.equal(g.state, 'paused');
  assert.equal(g.turns.length, 0);
  assert.equal(g.nextTurn, 0);
  phase = 'ok';
  DP.engine.resume(g);
  const r2 = await DP.engine.playTurn(g, deps);
  assert.ok(r2.record);
  assert.equal(g.turns.length, 1);
  assert.equal(calls['model-0'], 1, 'the answer that already succeeded is not paid for twice');
  assert.equal(calls['model-1'], 2);
});

test('402 pauses; ending early finalizes standings from the current prices', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  const ok = { getKey: () => 'sk_x', post: async () => okRes('buy', 0.8) };
  await DP.engine.playTurn(g, ok);
  await DP.engine.playTurn(g, ok);
  const r = await DP.engine.playTurn(g, { getKey: () => 'sk_x', post: async () => failRes(402) });
  assert.equal(r.paused, 'budget');
  DP.engine.endEarly(g);
  assert.equal(g.state, 'finished');
  assert.equal(g.endedEarly, true);
  assert.equal(g.final.lastTurn, 2);
  assert.equal(g.final.ranked.length, 1);
});

test('cost cap pauses after the turn that crosses it; continue raises the cap', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  g.costCap = 0.0005; g.costCapBase = 0.0005;
  const deps = { getKey: () => 'sk_x', post: async () => okRes('buy', 0.8) }; // 1000 tokens * 1e-6 = 0.001
  const r = await DP.engine.playTurn(g, deps);
  assert.equal(r.paused, 'cap');
  DP.engine.continueAfterCap(g);
  assert.equal(g.state, 'ready');
  assert.ok(g.costCap > g.spent);
});

test('call cap stops real calls and falls back to HOLD', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  g.maxCalls = 1;
  let n = 0;
  const deps = { getKey: () => 'sk_x', post: async () => { n++; return okRes('buy', 0.8); } };
  await DP.engine.playTurn(g, deps);
  await DP.engine.playTurn(g, deps);
  assert.equal(n, 1);
  assert.equal(g.turns[1].decisions[0].effective, 'hold');
  assert.ok(g.warnings.includes('call cap reached'));
});

test('check-in removes models that cannot answer and keeps the rest', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 3);
  const deps = { getKey: () => 'sk_x', post: async (body) => {
    if (body.model === 'model-1') return failRes(403);
    return okRes('buy', 0.7);
  } };
  const res = await DP.engine.checkInAll(g, deps);
  assert.equal(res.ok, true);
  assert.equal(res.removed.length, 1);
  assert.equal(g.players.length, 2);
  assert.ok(g.players.every((p) => p.pf.shares === 0), 'check-in answers are never traded');
});

test('check-in with a bad key reports auth and removes nobody', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 2);
  const res = await DP.engine.checkInAll(g, { getKey: () => 'sk_x', post: async () => failRes(401) });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'auth');
  assert.equal(g.players.length, 2);
});

test('no key: live players report auth instead of calling', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  let called = false;
  const r = await DP.engine.playTurn(g, { getKey: () => null, post: async () => { called = true; return okRes('buy', 0.8); } });
  assert.equal(called, false);
  assert.equal(r.paused, 'auth');
});

// ---- replay ----

async function playAll(DP, g, deps) {
  let guard = 0;
  while (g.state !== 'finished' && guard++ < 100) {
    if (g.state === 'paused') DP.engine.resume(g);
    await DP.engine.playTurn(g, deps);
  }
}

test('replay: an offline match with cards is reproduced exactly from its export', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = DP.engine.createGame({ seed: 4242, T: 20, survival: true, mode: 'offline',
    roster: DP.sim.BOT_IDS.map((b) => ({ kind: 'sim', botId: b })), ghosts: { buyhold: true, monkey: true } });
  const deps = { getKey: () => null, post: async () => { throw new Error('no network'); } };
  await DP.engine.playTurn(g, deps);
  DP.interventions.schedule(g, { type: 'shock', dir: 'down' });
  await DP.engine.playTurn(g, deps);
  DP.interventions.schedule(g, { type: 'whisper', target: g.players[0].id, action: 'buy' });
  await playAll(DP, g, deps);
  const data = plain(DP.engine.exportGame(g));
  const r = DP.engine.createReplayGame(data);
  await playAll(DP, r, DP.engine.replayDeps(r));
  const v = DP.engine.verifyReplay(r);
  assert.equal(v.ok, true);
  assert.deepEqual(plain(r.final.ranked.map((x) => [x.id, x.equity])), plain(g.final.ranked.map((x) => [x.id, x.equity])));
  assert.equal(r.warnings.length, 0);
});

test('replay: a live match (with a single-question downgrade and a failure) replays without network', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 2);
  g.T = 20; // keep it short; market was built for T=20 in liveGame already
  const deps = { getKey: () => 'sk_x', post: async (body) => {
    if (body.model === 'model-0') {
      if (body.questions.next_move) return failRes(400);
      return okRes('buy', 0.7);
    }
    return g.nextTurn === 2 ? failRes(503) : okRes(g.nextTurn % 2 ? 'sell' : 'buy', 0.8);
  } };
  await playAll(DP, g, deps);
  const data = plain(DP.engine.exportGame(g));
  const r = DP.engine.createReplayGame(data);
  await playAll(DP, r, DP.engine.replayDeps(r));
  assert.equal(DP.engine.verifyReplay(r).ok, true);
  assert.equal(r.players[0].singleQuestion, true);
  assert.equal(r.players[1].stats.errors, g.players[1].stats.errors);
  assert.ok(Math.abs(r.spent - g.spent) < 1e-9);
});

test('replay: rejects files that are not exports', () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  assert.throws(() => DP.engine.createReplayGame({ foo: 1 }));
});

test('export never contains an Authorization header or a key', async () => {
  const { DP } = setup([mkResponse(200, OK_BODY)]);
  const g = liveGame(DP, 1);
  await DP.engine.playTurn(g, { getKey: () => 'sk_SECRETKEY', post: async () => okRes('buy', 0.8) });
  const s = JSON.stringify(DP.engine.exportGame(g));
  assert.ok(!/sk_SECRETKEY|Authorization|Bearer/i.test(s));
});
