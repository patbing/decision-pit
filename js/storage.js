/* Browser storage helpers. Everything is wrapped: storage can be blocked, full or missing.
 * The API key is never written here. */
(function () {
  'use strict';
  var DP = (window.DP = window.DP || {});

  var HALL_KEY = 'dp.hall.v1';
  var SETUP_KEY = 'dp.setup.v1';

  function readJSON(store, key) {
    try { var s = window[store] && window[store].getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function writeJSON(store, key, val) {
    try { window[store].setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  // ----- setup (sessionStorage, survives the sign-in redirect) -----
  function saveSetup(s) { return writeJSON('sessionStorage', SETUP_KEY, s); }
  function loadSetup() { return readJSON('sessionStorage', SETUP_KEY); }

  // ----- Hall of Fame (localStorage, this browser only; live and offline are kept apart) -----
  function loadHall() {
    var h = readJSON('localStorage', HALL_KEY);
    if (!h || typeof h !== 'object') h = {};
    h.live = h.live || {}; h.offline = h.offline || {};
    return h;
  }

  // Adds one finished (not ended-early) match.
  function recordMatch(game) {
    if (!game || !game.final || game.endedEarly) return false;
    if (game.mode !== 'live' && game.mode !== 'offline') return false;
    var hall = loadHall();
    var bucket = hall[game.mode === 'live' ? 'live' : 'offline'];
    var champion = game.awards && game.awards.champion;
    game.final.ranked.forEach(function (r) {
      var e = bucket[r.modelId] || (bucket[r.modelId] = { name: r.name, games: 0, wins: 0, retSum: 0, brierSum: 0, brierN: 0, whispers: 0, swayed: 0, rumorTurns: 0, rumorFollowed: 0 });
      e.name = r.name; e.games++; if (r.id === champion) e.wins++;
      e.retSum += r.ret;
      if (r.brier !== null && r.brierN > 0) { e.brierSum += r.brier * r.brierN; e.brierN += r.brierN; }
      e.whispers += r.whispers; e.swayed += r.swayed; e.rumorTurns += r.rumorTurns; e.rumorFollowed += r.rumorFollowed;
    });
    return writeJSON('localStorage', HALL_KEY, hall);
  }

  function clearHall() { try { localStorage.removeItem(HALL_KEY); return true; } catch (e) { return false; } }

  // ----- export / import -----
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function exportName(game) {
    var d = new Date();
    return 'decision-pit-' + game.seed + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  }
  function downloadJSON(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  function readFileJSON(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { try { resolve(JSON.parse(fr.result)); } catch (e) { reject(new Error('That file is not valid JSON')); } };
      fr.onerror = function () { reject(new Error('Could not read the file')); };
      fr.readAsText(file);
    });
  }

  DP.storage = {
    saveSetup: saveSetup, loadSetup: loadSetup, loadHall: loadHall, recordMatch: recordMatch, clearHall: clearHall,
    exportName: exportName, downloadJSON: downloadJSON, readFileJSON: readFileJSON
  };
})();
