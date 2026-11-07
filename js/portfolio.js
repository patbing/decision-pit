/* Portfolio math: execution, mark-to-market, drawdown. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});
  var C = DP.config;

  function r2(x) { return Math.round(x * 100) / 100; }
  function r4(x) { return Math.round(x * 1e4) / 1e4; }

  function newPortfolio() {
    return { cash: C.START_CASH, shares: 0, avgCost: null, peak: C.START_CASH };
  }

  function equity(p, price) { return r2(p.cash + p.shares * price); }

  // Which actions can be offered this turn (always 2 or 3 options).
  function offeredActions(p) {
    var out = ['hold'];
    if (p.cash >= C.MIN_TRADE_VALUE) out.push('buy');
    if (p.shares > 0 && p.shares * 1 > 0) out.push('sell');
    return out;
  }

  // Returns {action: effective action, spent/received, traded:boolean}
  function execute(p, action, size, price) {
    var fee = C.FEE;
    if (action === 'buy') {
      var spend = size * p.cash;
      if (spend < C.MIN_TRADE_VALUE) return { action: 'hold', traded: false, note: 'below minimum trade' };
      var bought = r4((spend * (1 - fee)) / price);
      var prevCost = (p.avgCost || 0) * p.shares;
      p.cash = r2(p.cash - spend);
      p.shares = r4(p.shares + bought);
      p.avgCost = p.shares > 0 ? (prevCost + spend * (1 - fee)) / p.shares : null;
      return { action: 'buy', traded: true, amount: r2(spend), shares: bought };
    }
    if (action === 'sell') {
      var sellShares = r4(size * p.shares);
      var value = sellShares * price;
      if (value < C.MIN_TRADE_VALUE) { sellShares = p.shares; value = sellShares * price; }
      if (sellShares <= 0) return { action: 'hold', traded: false, note: 'nothing to sell' };
      p.cash = r2(p.cash + value * (1 - fee));
      p.shares = r4(p.shares - sellShares);
      if (p.shares <= 0.00005) { p.shares = 0; p.avgCost = null; }
      return { action: 'sell', traded: true, amount: r2(value), shares: sellShares };
    }
    return { action: 'hold', traded: false };
  }

  function liquidate(p, price) {
    if (p.shares > 0) {
      p.cash = r2(p.cash + p.shares * price * (1 - C.FEE));
      p.shares = 0;
      p.avgCost = null;
    }
  }

  function maxDrawdown(equityHist) {
    var peak = -Infinity, mdd = 0;
    for (var i = 0; i < equityHist.length; i++) {
      var e = equityHist[i];
      if (e > peak) peak = e;
      var dd = peak > 0 ? (peak - e) / peak : 0;
      if (dd > mdd) mdd = dd;
    }
    return mdd;
  }

  DP.portfolio = {
    newPortfolio: newPortfolio,
    equity: equity,
    offeredActions: offeredActions,
    execute: execute,
    liquidate: liquidate,
    maxDrawdown: maxDrawdown,
    r2: r2,
    r4: r4
  };
})();
