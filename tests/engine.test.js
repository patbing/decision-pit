'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');

// Objects created inside the vm context have a different Array prototype than the test realm,
// so strict deepEqual would fail on identical data. Compare plain JSON copies instead.
const plain = (x) => JSON.parse(JSON.stringify(x));

function offlineGame(DP, over) {
  const cfg = Object.assign({
    seed: 12345, T: 30, survival: true, mode: 'offline',
    roster: DP.sim.BOT_IDS.map((b) => ({ kind: 'sim', botId: b })),
    ghosts: { buyhold: true, monkey: true }
  }, over || {});
  return DP.engine.createGame(cfg);
}

async function runAll(DP, game, deps) {
  deps = deps || { getKey: () => null, post: () => { throw new Error('no network in offline mode'); } };
  let guard = 0;
  while (game.state !== 'finished' && guard++ < 200) {
    const r = await DP.engine.playTurn(game, deps);
    if (r.paused) break;
  }
  return game;
}

test('same seed gives the same market path regardless of players', () => {
  const DP = load();
  const a = offlineGame(DP, { roster: [{ kind: 'sim', botId: 'momentum' }] });
  const b = offlineGame(DP, { roster: DP.sim.BOT_IDS.map((x) => ({ kind: 'sim', botId: x })) });
  assert.deepEqual(a.market.prices, b.market.prices);
  const c = offlineGame(DP, { seed: 999 });
  assert.notDeepEqual(a.market.prices, c.market.prices);
});

test('prices stay positive and rounded to 2 decimals', () => {
  const DP = load();
  const g = offlineGame(DP, { T: 40 });
  for (const p of g.market.prices) {
    assert.ok(p >= 1);
    assert.equal(Math.round(p * 100) / 100, p);
  }
  assert.equal(g.market.prices.length, DP.config.WARMUP + 40 + 1);
});

test('a shock card moves the price path only from its turn on', () => {
  const DP = load();
  const g = offlineGame(DP);
  const before = g.market.prices.slice();
  const res = DP.interventions.schedule(g, { type: 'shock', dir: 'down' });
  assert.ok(res.ok);
  const eff = res.intervention.turn + DP.config.WARMUP;
  for (let i = 0; i <= eff; i++) assert.equal(g.market.prices[i], before[i]);
  assert.ok(g.market.prices[eff + 1] < before[eff + 1]);
});

test('execute: buy then sell applies fees and keeps books consistent', () => {
  const DP = load();
  const p = DP.portfolio.newPortfolio();
  const e1 = DP.portfolio.execute(p, 'buy', 0.5, 100);
  assert.equal(e1.action, 'buy');
  assert.equal(p.cash, 5000);
  assert.equal(p.shares, DP.portfolio.r4((5000 * 0.999) / 100));
  const e2 = DP.portfolio.execute(p, 'sell', 1, 100);
  assert.equal(e2.action, 'sell');
  assert.equal(p.shares, 0);
  assert.ok(p.cash < 10000 && p.cash > 9980); // two 0.1% fees on 5000
});

test('execute: trades below the minimum become hold', () => {
  const DP = load();
  const p = DP.portfolio.newPortfolio();
  p.cash = 50;
  const e = DP.portfolio.execute(p, 'buy', 0.15, 100); // 7.5 < 10
  assert.equal(e.action, 'hold');
  assert.equal(p.cash, 50);
});

test('offered actions are always 2 or 3', () => {
  const DP = load();
  const p = DP.portfolio.newPortfolio();
  assert.deepEqual(plain(DP.portfolio.offeredActions(p).sort()), ['buy', 'hold']);
  DP.portfolio.execute(p, 'buy', 1, 100);
  assert.deepEqual(plain(DP.portfolio.offeredActions(p).sort()), ['hold', 'sell']);
  p.cash = 2000;
  assert.equal(DP.portfolio.offeredActions(p).length, 3);
});

test('sizeFromProb: min 15%, max 100%, linear in between', () => {
  const DP = load();
  assert.equal(DP.decide.sizeFromProb(1 / 3, 3), 0.15);
  assert.equal(DP.decide.sizeFromProb(1, 3), 1);
  assert.equal(DP.decide.sizeFromProb(0.1, 3), 0.15); // below baseline clamps
  const s = DP.decide.sizeFromProb(0.71, 3);
  assert.ok(Math.abs(s - 0.63) < 0.01, 'design example: p=0.71, n=3 -> ~0.63, got ' + s);
});

test('normalizeAnswer boundary cases', () => {
  const DP = load();
  const n = DP.decide.normalizeAnswer;
  const ok = {
    answers: {
      action: { type: 'choice', choice: 'Buy ', confidence: 0.7, probabilities: { hold: 0.2, buy: 0.7, sell: 0.1 } },
      next_move: { type: 'choice', choice: 'up', confidence: 0.6, probabilities: { up: 0.6, down: 0.4 } }
    }
  };
  const r = n(ok, ['hold', 'buy', 'sell'], true);
  assert.equal(r.valid, true);
  assert.equal(r.action, 'buy');
  assert.equal(r.p, 0.7);
  assert.equal(r.pUp, 0.6);
  assert.equal(n(null, ['hold', 'buy'], true).valid, false);
  assert.equal(n({ answers: {} }, ['hold', 'buy'], true).valid, false);
  // choice not offered
  assert.equal(n({ answers: { action: { choice: 'sell' } } }, ['hold', 'buy'], true).valid, false);
  // bad probabilities -> falls back to confidence
  const bad = n({ answers: { action: { choice: 'buy', confidence: 0.9, probabilities: { hold: 5, buy: 7 } } } }, ['hold', 'buy'], false);
  assert.equal(bad.valid, true);
  assert.equal(bad.p, 0.9);
  // no probabilities, no confidence -> 1/n
  const none = n({ answers: { action: { choice: 'hold' } } }, ['hold', 'buy'], false);
  assert.equal(none.p, 0.5);
  // probabilities that do not sum to 1 get normalized
  const sc = n({ answers: { action: { choice: 'buy', probabilities: { hold: 0.2, buy: 0.6 } } } }, ['hold', 'buy'], false);
  assert.ok(Math.abs(sc.p - 0.75) < 1e-9);
  // missing next_move only drops the forecast
  const nm = n({ answers: { action: { choice: 'buy', confidence: 0.8 } } }, ['hold', 'buy'], true);
  assert.equal(nm.valid, true);
  assert.equal(nm.hasMove, false);
  // forecast derived from confidence when probabilities are absent
  const dn = n({ answers: { action: { choice: 'buy' }, next_move: { choice: 'down', confidence: 0.8 } } }, ['hold', 'buy'], true);
  assert.ok(Math.abs(dn.pUp - 0.2) < 1e-9);
});

test('questions: keys fixed, order shuffled per player, only offered actions', () => {
  const DP = load();
  const rng = DP.rng.mulberry32(5);
  const q = DP.prompt.buildQuestions(['hold', 'buy'], 104.32, rng, false);
  assert.deepEqual(Object.keys(q.questions.action.criteria).sort(), ['buy', 'hold']);
  assert.ok(q.questions.next_move.instructions.includes('104.32'));
  const single = DP.prompt.buildQuestions(['hold', 'buy', 'sell'], 100, rng, true);
  assert.equal(single.questions.next_move, undefined);
  assert.equal(Object.keys(single.questions.action.criteria).length, 3);
});

test('state text is a string and mentions the fictional disclaimer', () => {
  const DP = load();
  const g = offlineGame(DP);
  const p = g.players[0];
  const snap = DP.engine.makeSnapshot(g, p, 0, DP.engine.headlineFor(g, 0), null);
  const s = DP.prompt.buildState(snap);
  assert.equal(typeof s, 'string');
  assert.ok(s.startsWith('FICTIONAL MARKET GAME'));
  assert.ok(s.includes('Turn 1 of 30'));
  assert.ok(!/whisper/i.test(s));
  const w = DP.prompt.buildState(DP.engine.makeSnapshot(g, p, 0, DP.engine.headlineFor(g, 0), 'Buy now'));
  assert.ok(w.includes('Spectator whisper'));
});

test('offline 30-turn match finishes with sane standings', async () => {
  const DP = load();
  const g = await runAll(DP, offlineGame(DP));
  assert.equal(g.state, 'finished');
  assert.equal(g.turns.length, 30);
  const st = g.final;
  assert.ok(st.ranked.length >= 3);
  assert.equal(st.ghosts.length, 2);
  // ranks are 1..n without gaps, survivors ahead of the eliminated
  st.ranked.forEach((r, i) => assert.equal(r.rank, i + 1));
  const firstOut = st.ranked.findIndex((r) => r.status === 'eliminated');
  if (firstOut >= 0) st.ranked.slice(firstOut).forEach((r) => assert.equal(r.status, 'eliminated'));
  // buy&hold equals shares*price at the end
  const bh = st.ghosts.find((x) => x.id === 'g:buyhold');
  assert.ok(bh.equity > 0);
  // no live calls, no cost
  assert.equal(g.calls, 0);
  assert.equal(g.spent, 0);
});

test('offline match is reproducible from the seed', async () => {
  const DP1 = load(), DP2 = load();
  const a = await runAll(DP1, offlineGame(DP1));
  const b = await runAll(DP2, offlineGame(DP2));
  assert.deepEqual(plain(a.final.ranked.map((r) => [r.id, r.equity])), plain(b.final.ranked.map((r) => [r.id, r.equity])));
});

test('survival checkpoints eliminate exactly one at turns 10 and 20', async () => {
  const DP = load();
  const g = await runAll(DP, offlineGame(DP, { T: 30 }));
  const cps = [];
  g.turns.forEach((t) => t.events.forEach((e) => { if (e.type === 'checkpoint') cps.push(e.turn); }));
  assert.deepEqual(plain(cps), [10, 20]);
});

test('survival off: no checkpoint eliminations', async () => {
  const DP = load();
  const g = await runAll(DP, offlineGame(DP, { survival: false }));
  let cps = 0;
  g.turns.forEach((t) => t.events.forEach((e) => { if (e.type === 'checkpoint') cps++; }));
  assert.equal(cps, 0);
});

test('cards: max 3, one per turn, locked in the last two turns', () => {
  const DP = load();
  const g = offlineGame(DP, { T: 20 });
  assert.ok(DP.interventions.schedule(g, { type: 'rumor', dir: 'up' }).ok);
  assert.equal(DP.interventions.schedule(g, { type: 'shock', dir: 'up' }).ok, false); // same turn
  g.nextTurn = 5;
  assert.ok(DP.interventions.schedule(g, { type: 'shock', dir: 'down' }).ok);
  g.nextTurn = 6;
  const w = DP.interventions.schedule(g, { type: 'whisper', target: g.players[0].id, action: 'buy' });
  assert.ok(w.ok);
  g.nextTurn = 7;
  assert.equal(DP.interventions.schedule(g, { type: 'rumor', dir: 'down' }).ok, false); // no cards left
  const g2 = offlineGame(DP, { T: 20 });
  g2.nextTurn = 18;
  assert.equal(DP.interventions.schedule(g2, { type: 'rumor', dir: 'up' }).ok, false); // locked
});

test('rumor card has no price effect, whisper affects only the target state', async () => {
  const DP = load();
  const g = offlineGame(DP);
  const before = g.market.prices.slice();
  assert.ok(DP.interventions.schedule(g, { type: 'rumor', dir: 'up' }).ok);
  assert.deepEqual(g.market.prices, before);
  const g2 = offlineGame(DP);
  const target = g2.players[0];
  DP.interventions.schedule(g2, { type: 'whisper', target: target.id, action: 'sell' });
  await DP.engine.playTurn(g2, { getKey: () => null, post: () => {} });
  const t0 = g2.turns[0];
  assert.equal(t0.decisions.filter((d) => d.whispered).length <= 1, true);
});

test('bankruptcy eliminates a player below the line', async () => {
  const DP = load();
  const g = offlineGame(DP, { survival: false });
  const victim = g.players[0];
  victim.pf.cash = 100; // equity far below 6000 once marked
  await DP.engine.playTurn(g, { getKey: () => null, post: () => {} });
  assert.equal(victim.status, 'eliminated');
  assert.equal(victim.statusNote, 'bankrupt');
});

test('awards: forecaster needs 10 forecasts; monkey tag only when below the monkey', async () => {
  const DP = load();
  const g = await runAll(DP, offlineGame(DP));
  const aw = g.awards;
  assert.ok(aw.champion);
  if (aw.forecaster) {
    const r = g.final.ranked.find((x) => x.id === aw.forecaster);
    assert.ok(r.brierN >= 10);
  }
  const monkey = g.final.ghosts.find((x) => x.id === 'g:monkey');
  aw.lostToMonkey.forEach((id) => {
    const r = g.final.ranked.find((x) => x.id === id);
    assert.ok(r.equity < monkey.equity);
  });
});

test('export contains no Authorization header and no key-like strings', async () => {
  const DP = load();
  const g = await runAll(DP, offlineGame(DP));
  const json = JSON.stringify(DP.engine.exportGame(g));
  assert.ok(!/Authorization/i.test(json));
  assert.ok(!/sk_[A-Za-z0-9]{6,}/.test(json));
});
