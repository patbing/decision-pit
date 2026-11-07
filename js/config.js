/* Decision Pit - configuration. Classic script (no ES modules) so the app also runs from file://. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});

  DP.config = {
    VERSION: '1.0.0',
    // Public App Key (pk_...) created at enter.pollinations.ai/keys -> Apps. Safe to commit.
    APP_KEY: 'pk_BItEdjpCCzNJ0UhA',
    // Public repository, shown in the Connect menu and README.
    REPO_URL: 'https://github.com/patbing/decision-pit',

    ENDPOINT_DECISIONS: 'https://gen.pollinations.ai/alpha/decisions',
    ENDPOINT_MODELS: 'https://gen.pollinations.ai/v1/models',

    // Game defaults
    START_CASH: 10000,
    START_PRICE: 100,
    TICKER: 'HIVE',
    FEE: 0.001,
    BANKRUPT_BELOW: 6000,
    MIN_TRADE_VALUE: 10,
    WARMUP: 10,
    TURN_CHOICES: [20, 30, 40],
    DEFAULT_TURNS: 30,
    CARDS_PER_GAME: 3,

    // Hard caps
    MAX_AI_PLAYERS: 6,
    MAX_TURNS: 40,
    MAX_CONCURRENCY: 4,
    ATTEMPT_TIMEOUT_MS: 25000,
    TURN_DEADLINE_MS: 60000,
    RETRY_DELAY_MS: 1500,
    MAX_RETRY_AFTER_MS: 15000,
    CONSEC_FAIL_LIMIT: 3,
    DEFAULT_COST_CAP: 0.05,
    DEFAULT_SPEED_MS: 3000,

    // Sizing
    SIZE_MIN: 0.15,
    SIZE_SPAN: 0.85
  };
})();
