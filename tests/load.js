// Loads the browser scripts (classic <script> files) into a Node vm context.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORDER = ['config', 'pollinations', 'rng', 'market', 'portfolio', 'prompt', 'decide', 'sim-players', 'interventions', 'engine'];

function load(extra) {
  const sandbox = Object.assign({
    console, setTimeout, clearTimeout, AbortController, Promise, Math, Date, JSON, Number, Object, Array, String, Error, isFinite
  }, extra || {});
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ORDER) {
    const code = fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8');
    vm.runInContext(code, sandbox, { filename: 'js/' + f + '.js' });
  }
  return sandbox.DP;
}

module.exports = { load, ROOT };
