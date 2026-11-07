/* Builds the decision request: a plain-text state and two independent questions. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var R = DP.rng;
  var C = DP.config;

  function pct(x, d) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function num(x) { return Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // snap: see engine.makeSnapshot()
  function buildState(snap) {
    var p = snap.player;
    var lines = [];
    lines.push('FICTIONAL MARKET GAME. Not real money, not a real company, not investment advice.');
    lines.push('You are player "' + p.name + '" trading ' + C.TICKER + ' (fictional HiveWorks Inc.) against ' +
      Math.max(0, snap.nActive - 1) + ' other AI players.');
    lines.push('Turn ' + snap.turn + ' of ' + snap.T + ' (' + (snap.T - snap.turn) + ' turns left after this one).');
    lines.push('Price now: ' + snap.price.toFixed(2) + '.');
    lines.push('Last ' + snap.last.length + ' prices, oldest to newest: ' + snap.last.map(function (x) { return x.toFixed(2); }).join(', ') + '.');
    lines.push('Change: last turn ' + pct(snap.chg1) + ', last 5 turns ' + pct(snap.chg5) +
      '. Price is ' + Math.abs(snap.dev10 * 100).toFixed(1) + '% ' + (snap.dev10 >= 0 ? 'above' : 'below') +
      ' its 10-turn average. Recent volatility: ' + snap.vol + '.');
    lines.push('Headline this turn: "' + (snap.headline || 'none') + '"');
    if (snap.earlier && snap.earlier.length) {
      lines.push('Earlier headlines: ' + snap.earlier.map(function (e) { return '[turn ' + e.turn + '] "' + e.text + '"'; }).join('; '));
    } else {
      lines.push('Earlier headlines: none');
    }
    lines.push('Your portfolio: cash ' + num(p.cash) + '; shares ' + p.shares.toFixed(4) + ' worth ' + num(p.posValue) + '; ' +
      Math.round(p.posPct) + '% of your equity is in ' + C.TICKER + '; equity ' + num(p.equity) + ' (' + pct(p.ret) +
      ' since start); average cost ' + (p.avgCost ? p.avgCost.toFixed(2) : 'n/a') + '.');
    lines.push('Standing: you are ' + snap.rank + ' of ' + snap.nActive + ' active players; the leader is at ' + pct(snap.leaderRet) + '.');
    var survival = '';
    if (snap.survival) {
      survival = ' At the end of turns ' + snap.survival[0] + ' and ' + snap.survival[1] + ', the lowest-equity player is eliminated.';
    }
    lines.push('Rules: BUY spends part of your cash on ' + C.TICKER + '. SELL sells part of your ' + C.TICKER +
      '. HOLD makes no trade. The more confident you are in your choice, the bigger the trade. Fee 0.1% per trade. No short selling. ' +
      'If your equity falls below ' + C.BANKRUPT_BELOW.toLocaleString('en-US') + ' you are eliminated.' + survival);
    var goal = 'Goal: have the highest equity at the end of turn ' + snap.T + '.';
    if (snap.whisper) goal += '\nSpectator whisper (unverified, from the crowd): "' + snap.whisper + '"';
    lines.push(goal);
    return lines.join('\n');
  }

  var ACTION_TEXT = {
    hold: 'HOLD: make no trade this turn',
    buy: 'BUY: use part of your cash to buy more ' + C.TICKER + ' now',
    sell: 'SELL: sell part of your ' + C.TICKER + ' shares now'
  };

  // Returns { questions, actionOrder, moveOrder }. Key order is shuffled per player to reduce position bias.
  function buildQuestions(offeredKeys, price, orderRng, singleQuestion) {
    var actionOrder = R.shuffle(offeredKeys, orderRng);
    var criteria = {};
    actionOrder.forEach(function (k) { criteria[k] = ACTION_TEXT[k]; });
    var q = {
      action: {
        type: 'choice',
        instructions: 'Choose your trade for this turn.',
        criteria: criteria
      }
    };
    var moveOrder = null;
    if (!singleQuestion) {
      moveOrder = R.shuffle(['up', 'down'], orderRng);
      var ps = price.toFixed(2);
      var mc = {};
      moveOrder.forEach(function (k) {
        mc[k] = k === 'up'
          ? 'Yes: the next price will be higher than ' + ps
          : 'No: the next price will be ' + ps + ' or lower';
      });
      q.next_move = {
        type: 'choice',
        instructions: "Will " + C.TICKER + "'s price at the next turn be higher than the current price of " + ps + '?',
        criteria: mc
      };
    }
    return { questions: q, actionOrder: actionOrder, moveOrder: moveOrder };
  }

  DP.prompt = { buildState: buildState, buildQuestions: buildQuestions, ACTION_TEXT: ACTION_TEXT };
})();
