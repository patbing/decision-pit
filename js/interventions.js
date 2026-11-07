/* Spectator intervention cards: fake rumor, market shock, whisper. Three per match, one per turn. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config;

  var RUMOR_TEXT = {
    up: 'An anonymous account claims HiveWorks won a huge government contract.',
    down: 'Unverified post: HiveWorks is hiding big losses.'
  };
  var SHOCK_TEXT = {
    down: 'Flash crash: HIVE plunges on a sudden wave of sell orders.',
    up: 'Short squeeze: HIVE jumps on sudden heavy buying.'
  };
  var WHISPER_PRESETS = {
    buy: "Buy now, it's going to the moon!",
    sell: "Sell everything, it's about to crash!",
    hold: "Don't touch anything this turn."
  };

  // The first turn a card scheduled "now" can take effect: the next turn to be played.
  function nextEffectTurn(game) { return game.nextTurn; }

  // Cards cannot be used in the last two turns (turn indices T-2, T-1).
  function canSchedule(game) {
    if (game.cardsLeft <= 0) return { ok: false, reason: 'No cards left' };
    var eff = nextEffectTurn(game);
    if (eff > game.T - 3) return { ok: false, reason: 'Cards are locked in the last two turns' };
    if (game.interventions.some(function (iv) { return iv.turn === eff; })) {
      return { ok: false, reason: 'One card per turn' };
    }
    if (game.state === 'finished') return { ok: false, reason: 'Match is over' };
    return { ok: true, turn: eff };
  }

  // card: {type:'rumor', dir:'up'|'down'} | {type:'shock', dir} | {type:'whisper', target, action}
  function schedule(game, card) {
    var chk = canSchedule(game);
    if (!chk.ok) return chk;
    var iv = { turn: chk.turn, type: card.type };
    if (card.type === 'rumor') {
      if (card.dir !== 'up' && card.dir !== 'down') return { ok: false, reason: 'Pick up or down' };
      iv.dir = card.dir === 'up' ? 1 : -1;
      iv.text = RUMOR_TEXT[card.dir];
    } else if (card.type === 'shock') {
      if (card.dir !== 'up' && card.dir !== 'down') return { ok: false, reason: 'Pick up or down' };
      iv.dir = card.dir === 'up' ? 1 : -1;
      iv.text = SHOCK_TEXT[card.dir];
    } else if (card.type === 'whisper') {
      var target = game.players.filter(function (p) { return p.id === card.target; })[0];
      if (!target || target.kind === 'ghost' || target.status !== 'active') return { ok: false, reason: 'Pick an active AI player' };
      if (!WHISPER_PRESETS[card.action]) return { ok: false, reason: 'Pick buy, sell or hold' };
      iv.target = card.target;
      iv.action = card.action;
      iv.text = WHISPER_PRESETS[card.action];
    } else {
      return { ok: false, reason: 'Unknown card' };
    }
    game.interventions.push(iv);
    game.cardsLeft--;
    // Prices after the effect turn may change (shock): recompute the deterministic path.
    game.market.prices = DP.market.computePrices(game.market, game.interventions);
    return { ok: true, intervention: iv };
  }

  function forTurn(game, t) {
    return game.interventions.filter(function (iv) { return iv.turn === t; });
  }

  // Rumor reaction: did a player trade in the rumor's direction on that turn?
  function followedRumor(iv, choice) {
    return (iv.dir > 0 && choice === 'buy') || (iv.dir < 0 && choice === 'sell');
  }

  DP.interventions = {
    RUMOR_TEXT: RUMOR_TEXT,
    SHOCK_TEXT: SHOCK_TEXT,
    WHISPER_PRESETS: WHISPER_PRESETS,
    canSchedule: canSchedule,
    schedule: schedule,
    forTurn: forTurn,
    followedRumor: followedRumor
  };
})();
