/*
 * Crowd effects for Zelda 1: lets TikTok LIVE viewers change the game, the
 * same way Rando Hub's crowd/effects.js does for ALTTP. Gifts, likes, follows
 * and shares arrive from Crowd Control+ (crowd-plus/bridge.mjs in Rando Hub,
 * run on the streaming PC) over a WebSocket. Each names an effect below,
 * which is queued and applied while Link is in normal play.
 *
 * Effect ids are the ALTTP ones wherever the effect means the same thing, so
 * one mapping.json drives both games. Gifts mapped to an ALTTP-only effect
 * (magic, arrows, bottles, warps, boss detours…) are skipped by the bridge
 * while Zelda 1 is connected; it says so in its log.
 *
 * The ROM is never changed. Effects write the NES's RAM (hearts, rupees,
 * bombs, the clock) or change the buttons the game sees, or use the player's
 * picture and speed tricks (emu/player.js fx).
 *
 *   Z1Crowd.trigger('heal_full', 'someone')   // test from the console
 *   Z1Crowd.list()                            // ids and names
 *
 * Settings are in the emulator menu (⋯) under "Crowd effects".
 */
(function (root) {
  'use strict';

  var SETTINGS_KEY = 'z1r-crowd-settings';
  var cfg = { enabled: false, url: 'ws://localhost:21214', feed: true, alerts: true, allowReroll: false, showTimer: true };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) {}
  function saveCfg() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)); } catch (e) {} }

  // ── Zelda 1 RAM ($0000-$07FF) ────────────────────────────────────────────
  var A = {
    LEVEL: 0x10, MODE: 0x12, SLOT: 0x16,
    BOMBS: 0x658, MAXBOMBS: 0x67C,
    CLOCK: 0x66C,                  // the clock item: enemies stand still until Link leaves the screen
    RUPEES: 0x66D,
    HEARTS: 0x66F,                 // high nibble: containers - 1; low nibble: full hearts before the last one
    PARTIAL: 0x670,                // the last heart: 0 empty, 01-7F half, 80-FF full
    RUPEE_ADD: 0x67D, RUPEE_SUB: 0x67E,   // the game counts these into the wallet (with the sound), capped at 255
  };
  var PLAY = 0x05, CAVE = 0x0B;

  function fileLoaded(r) { return r.length >= 0x800 && r[0xF5] === 0x5A && r[0x528] === 0x5A && r[A.SLOT] < 3; }
  function containers(r) { return (r[A.HEARTS] >> 4) + 1; }
  // Health in half hearts.
  function halves(r) {
    var p = r[A.PARTIAL];
    return (r[A.HEARTS] & 0x0F) * 2 + (p >= 0x80 ? 2 : p > 0 ? 1 : 0);
  }
  function setHalves(r, h) {
    h = Math.max(1, Math.min(containers(r) * 2, h | 0));
    var low = (h & 1) ? (h >> 1) : (h >> 1) - 1;
    r[A.HEARTS] = (r[A.HEARTS] & 0xF0) | low;
    r[A.PARTIAL] = (h & 1) ? 0x7F : 0xFF;
  }
  function inPlay(r) {
    return fileLoaded(r) && (r[A.MODE] === PLAY || r[A.MODE] === CAVE) && halves(r) > 0;
  }
  function P() { return root.EmuPlayer; }
  function fx() { var p = P(); return p && p.fx; }
  function core() { var p = P(); return p && p.core; }

  // NES pad bits, same order as EmuCore.BTN. A is the sword, B the item.
  var B = { B: 1 << 0, UP: 1 << 4, DOWN: 1 << 5, LEFT: 1 << 6, RIGHT: 1 << 7, A: 1 << 8 };
  function swapBits(pad, a, b) {
    var ha = pad & a, hb = pad & b;
    pad &= ~(a | b);
    if (ha) pad |= b;
    if (hb) pad |= a;
    return pad;
  }

  // ── the effects ─────────────────────────────────────────────────────────
  // Instant effects run once (apply; a string back means "couldn't", shown
  // in the feed). Timed ones last `secs` seconds of play and can only filter
  // input or hold a value down each frame, so a save state can't leave the
  // game stuck changed.
  var EFFECTS = {
    heal_full:   { name: 'Full heal', good: true,
      apply: function (r) { setHalves(r, containers(r) * 2); } },
    heal_1:      { name: '+1 heart', good: true,
      apply: function (r) { setHalves(r, halves(r) + 2); } },
    hurt_2:      { name: '-2 hearts', good: false,            // never kills
      apply: function (r) { var h = halves(r); setHalves(r, Math.max(Math.min(2, h), h - 4)); } },
    hp_1:        { name: 'Down to 1 heart', good: false,
      apply: function (r) { if (halves(r) > 2) setHalves(r, 2); } },
    rupees_plus: { name: '+50 rupees', good: true,
      apply: function (r) { r[A.RUPEE_ADD] = Math.min(255, r[A.RUPEE_ADD] + 50); } },
    rupees_minus:{ name: '-50 rupees', good: false,
      apply: function (r) { r[A.RUPEE_SUB] = Math.min(255, r[A.RUPEE_SUB] + 50); } },
    bombs_plus:  { name: '+4 bombs', good: true,               // up to the bag size
      apply: function (r) { if (r[A.BOMBS] >= r[A.MAXBOMBS]) return 'Bomb bag is full'; r[A.BOMBS] = Math.min(r[A.MAXBOMBS], r[A.BOMBS] + 4); } },
    bombs_none:  { name: 'Lose all bombs', good: false,
      apply: function (r) { r[A.BOMBS] = 0; } },
    clock:       { name: 'Clock: enemies freeze', good: true,
      apply: function (r) { r[A.CLOCK] = 1; } },

    invert:      { name: 'Inverted D-pad', good: false, secs: 20,
      input: function (p) { return swapBits(swapBits(p, B.UP, B.DOWN), B.LEFT, B.RIGHT); } },
    no_sword:    { name: 'No sword', good: false, secs: 20,
      input: function (p) { return p & ~B.A; } },
    no_item:     { name: 'No B item', good: false, secs: 20,
      input: function (p) { return p & ~B.B; } },
    swap_by:     { name: 'A and B swapped', good: false, secs: 20,
      input: function (p) { return swapBits(p, B.A, B.B); } },
    freeze:      { name: 'Freeze!', good: false, secs: 3,
      input: function () { return 0; } },
    one_hit:     { name: 'One-heart mode', good: false, secs: 30,
      frame: function (r) { if (halves(r) > 2) setHalves(r, 2); } },

    mirror:      { name: 'Mirror mode', good: false, secs: 20, start: function () { fx() && fx().setScreen('mirror', true); }, end: function () { fx() && fx().setScreen('mirror', false); } },
    upside_down: { name: 'Upside down', good: false, secs: 15, start: function () { fx() && fx().setScreen('flip', true); }, end: function () { fx() && fx().setScreen('flip', false); } },
    wobble:      { name: 'Drunk wobble', good: false, secs: 20, start: function () { fx() && fx().setScreen('wobble', true); }, end: function () { fx() && fx().setScreen('wobble', false); } },
    tiny:        { name: 'Tiny screen', good: false, secs: 20, start: function () { fx() && fx().setScreen('tiny', true); }, end: function () { fx() && fx().setScreen('tiny', false); } },
    crt:         { name: 'Retro CRT', good: true, secs: 30, start: function () { fx() && fx().setTempFilter('crt'); }, end: function () { fx() && fx().setTempFilter(null); } },
    speed_up:    { name: 'Speed up (1.5x)', good: false, secs: 20, start: function () { fx() && fx().setSpeed(1.5); }, end: function () { fx() && fx().setSpeed(1); } },
    slow_mo:     { name: 'Slow motion', good: true, secs: 15, start: function () { fx() && fx().setSpeed(0.5); }, end: function () { fx() && fx().setSpeed(1); } },

    seed_roll:   { name: 'New seed!', good: false,
      app: function (job) { return startReroll(job); } },
  };

  // ── new seed (off unless allowed; 10 s countdown, cancel in the menu) ────
  var REROLL_SECS = 10, rerollT = null, rerollLeft = 0, rerollBy = '', rerollBusy = false;
  function startReroll(job) {
    if (!cfg.allowReroll) { feed('Seed reroll is turned off in Crowd effects', 'info'); return false; }
    if (rerollT || rerollBusy) { feed('A new seed is already coming', 'info'); return false; }
    if (!root.Z1Seed || !root.Z1Seed.rollAndPlay) { feed('Not available: new seed', 'info'); return false; }
    rerollBy = (job && job.user && job.user !== 'test') ? job.user : '';
    rerollLeft = REROLL_SECS;
    banner('count', 'NEW SEED IN ' + rerollLeft, (rerollBy ? 'from ' + rerollBy + ' · ' : '') + 'this game ends', 0, 1);
    rerollT = setInterval(function () {
      rerollLeft--;
      if (rerollLeft > 0) {
        banner('count', 'NEW SEED IN ' + rerollLeft, (rerollBy ? 'from ' + rerollBy + ' · ' : '') + 'this game ends', 0, rerollLeft / REROLL_SECS);
        if (rerollLeft <= 3) feed('New seed in ' + rerollLeft + '…', 'bad');
        render(); return;
      }
      clearInterval(rerollT); rerollT = null;
      rerollBusy = true;
      banner('roll', 'Rolling a new seed…', 'Same flags as last time', 0);
      root.Z1Seed.rollAndPlay().then(function (seed) {
        banner('done-ok', 'New seed ready!', (rerollBy ? 'Courtesy of ' + rerollBy : 'Good luck') + ' · seed ' + seed, 6000);
      }, function (e) {
        rerollBusy = false;
        banner('done-bad', 'Seed reroll failed', String((e && e.message) || e), 6000);
        render();
      });
      render();
    }, 1000);
    render();
    return true;
  }
  function cancelReroll() {
    if (!rerollT) return;
    clearInterval(rerollT); rerollT = null;
    feed('New seed cancelled', 'info');
    banner('done-bad', 'New seed cancelled', 'The streamer kept this seed', 4000);
  }

  // ── queue and timers ────────────────────────────────────────────────────
  var queue = [], active = {}, gap = 0, GAP_FRAMES = 45, MAX_QUEUE = 60, waitT = 0;
  var durations = {};
  function secsOf(id) {
    var f = EFFECTS[id]; if (!f || !f.secs) return 0;
    var d = +durations[id];
    return d > 0 && d <= 600 ? d : f.secs;
  }
  var hist = [];
  function note(t) {
    var d = new Date(); hist.push(('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + ' ' + t);
    if (hist.length > 14) hist.shift();
  }
  function trigger(id, user, label) {
    if (!EFFECTS[id]) { note('unknown effect ' + id); return false; }
    if (queue.length >= MAX_QUEUE) { note('queue full, dropped ' + id); return false; }
    queue.push({ id: id, user: user || '', label: label || '' });
    note('queued ' + id + (user ? ' (' + user + ')' : '') + ', ' + queue.length + ' waiting');
    render();
    return true;
  }

  function onFrame(c) {
    try { onFrameInner(c); } catch (e) { console.warn('[crowd]', e); note('error: ' + (e && e.message || e)); }
  }
  function onFrameInner(c) {
    var ram = c.wram();
    sendRun(ram);
    var playing = inPlay(ram);
    if (queue.length && !playing) {
      if (++waitT === 240) feed(queue.length + ' waiting: Link isn\'t in normal play', 'info');
    } else waitT = 0;
    if (!playing) return;
    for (var id in active) {
      var f = EFFECTS[id];
      if (f.frame) f.frame(ram);
      if (--active[id] <= 0) { delete active[id]; if (f.end) { try { f.end(); } catch (e) {} } feed(f.name + ' ended', 'end'); render(); }
    }
    if (gap > 0) { gap--; return; }
    var job = queue.shift();
    if (!job) return;
    note('running ' + job.id);
    var fe = EFFECTS[job.id];
    var secs = secsOf(job.id);
    if (secs) {
      if (!active[job.id] && fe.start) { try { fe.start(); } catch (e) { console.warn('[crowd]', job.id, e); } }
      active[job.id] = (active[job.id] || 0) + Math.round(secs * (c.fps || 60.1));
    } else if (fe.app) {
      try { if (fe.app(job) === false) { render(); return; } } catch (e) { console.warn('[crowd]', job.id, e); }
    } else {
      var res = fe.apply(ram);
      if (typeof res === 'string') { feed(fe.name + ': ' + res, 'info'); render(); return; }
    }
    gap = GAP_FRAMES;
    var who = job.user && job.user !== 'test' ? job.user : '';
    feed((who ? who + ': ' : '') + fe.name + (secs ? ' (' + secs + 's)' : ''), fe.good ? 'good' : 'bad');
    if (who) giftCard(who, job.label, fe.name, fe.good);
    send({ type: 'applied', effect: job.id, user: job.user });
    render();
  }
  function onInput(pad) {
    var c = core();
    if (!c) return pad;
    var any = false;
    for (var id in active) if (EFFECTS[id].input) { any = true; break; }
    if (!any || !inPlay(c.wram())) return pad;
    for (var k in active) if (EFFECTS[k].input) pad = EFFECTS[k].input(pad);
    return pad;
  }
  function endAll() {
    for (var id in active) { var f = EFFECTS[id]; if (f && f.end) { try { f.end(); } catch (e) {} } }
    active = {};
  }

  // ── run info for the control panel (once a second while connected) ──────
  var run = { game: 'z1r', deaths: 0, checks: 0, bonks: 0, place: '', seed: '', music: '', bosses: [], hearts: 0 };
  var runSent = '', runT = 0;
  function sendRun(ram) {
    if (status !== 'connected' || ++runT % 60) return;
    var p = P();
    run.seed = (p && p.gameName) || '';
    if (fileLoaded(ram)) {
      run.hearts = containers(ram);
      run.place = ram[A.LEVEL] ? 'Level ' + ram[A.LEVEL] : 'Overworld';
    }
    var j = JSON.stringify(run);
    if (j !== runSent) { runSent = j; send(Object.assign({ type: 'run' }, run)); }
  }

  // ── on-screen feed, gift card, banner, subathon clock ───────────────────
  function host() { return document.querySelector('.s9x'); }
  function style(id, css) {
    if (document.getElementById(id)) return;
    var st = document.createElement('style'); st.id = id; st.textContent = css; document.head.appendChild(st);
  }
  var CSS =
    '.cc-feed { position: absolute; right: 8px; top: 8px; z-index: 25; display: flex; flex-direction: column; align-items: flex-end;' +
    ' gap: 4px; pointer-events: none; max-width: 70%; font: 600 12px/1.25 system-ui, sans-serif; }' +
    '.cc-feed div { background: rgba(10,12,16,.82); color: #fff; padding: 4px 9px; border-radius: 6px; border-left: 3px solid #8b95a3;' +
    ' transition: opacity .4s; text-shadow: 0 1px 1px #000; }' +
    '.cc-feed .good { border-left-color: #3fb950; } .cc-feed .bad { border-left-color: #e5534b; } .cc-feed .end { opacity: .7; }' +
    '.cc-feed .info { border-left-color: #e3b341; }' +
    '.cc-gift { position: absolute; left: 50%; top: 40px; transform: translate(-50%, -8px); z-index: 26; pointer-events: none;' +
    ' display: flex; align-items: center; gap: 8px; max-width: 70%; padding: 5px 12px 5px 9px; border-radius: 8px;' +
    ' background: rgba(18,12,34,.92); border: 2px solid #e63946; box-shadow: 0 4px 14px rgba(0,0,0,.5); color: #fff;' +
    ' opacity: 0; transition: opacity .3s ease, transform .3s ease; font: 600 12px/1.25 system-ui, sans-serif; }' +
    '.cc-gift.show { opacity: 1; transform: translate(-50%, 0); } .cc-gift.good { border-color: #3fb950; }' +
    '.cc-gift .ic { font-size: 18px; } .cc-gift .nm { display: block; font-weight: 700; font-size: 13px; }' +
    '.cc-gift .fx { display: block; color: #ffd166; font-size: 11px; }' +
    '.cc-reroll { position: absolute; left: 50%; top: 14%; transform: translateX(-50%); z-index: 26; pointer-events: none;' +
    ' min-width: 58%; max-width: 92%; box-sizing: border-box; padding: 10px 16px 12px; border-radius: 10px; text-align: center;' +
    ' background: rgba(10,12,16,.86); color: #fff; font: 700 13px/1.3 system-ui, sans-serif; text-shadow: 0 1px 2px #000;' +
    ' border: 2px solid #e5534b; transition: opacity .5s; }' +
    '.cc-reroll .t { font-size: clamp(15px, 3.6vw, 28px); } .cc-reroll .s { margin-top: 3px; font-weight: 600; opacity: .9; }' +
    '.cc-reroll .bar { margin-top: 8px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.18); overflow: hidden; }' +
    '.cc-reroll .bar i { display: block; height: 100%; background: #e5534b; transition: width 1s linear; }' +
    '.cc-reroll.roll { border-color: #e3b341; } .cc-reroll.done-ok { border-color: #3fb950; } .cc-reroll.done-bad { border-color: #8b95a3; }' +
    '.cc-clock { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 24; pointer-events: none;' +
    ' padding: 4px 12px; border-radius: 8px; background: rgba(10,12,16,.8); color: #fff;' +
    ' font: 800 18px/1.1 ui-monospace, Consolas, monospace; border: 1px solid rgba(227,179,65,.6); }' +
    '.cc-clock.paused { opacity: .6; } .cc-clock.ended { border-color: #e5534b; }';

  var feedEl = null;
  function feed(text, kind) {
    if (!cfg.feed || typeof document === 'undefined') return;
    if (!feedEl || !feedEl.isConnected) {
      var h = host(); if (!h) return;
      style('cc-css', CSS);
      feedEl = document.createElement('div'); feedEl.className = 'cc-feed'; h.appendChild(feedEl);
    }
    var d = document.createElement('div');
    d.className = kind || ''; d.textContent = text;
    feedEl.appendChild(d);
    while (feedEl.children.length > 4) feedEl.firstChild.remove();
    setTimeout(function () { d.style.opacity = '0'; setTimeout(function () { d.remove(); }, 450); }, 4000);
  }

  var giftQ = [], giftEl = null, giftBusy = false;
  function giftCard(user, label, what, good) {
    if (!cfg.alerts || typeof document === 'undefined') return;
    giftQ.push({ user: user, label: label, what: what, good: good });
    if (giftQ.length > 6) giftQ.splice(0, giftQ.length - 6);
    if (!giftBusy) giftNext();
  }
  function giftNext() {
    var g = giftQ.shift(); if (!g) { giftBusy = false; return; }
    var h = host(); if (!h) { giftBusy = false; giftQ = []; return; }
    giftBusy = true;
    style('cc-css', CSS);
    if (!giftEl || !giftEl.isConnected) {
      giftEl = document.createElement('div'); giftEl.className = 'cc-gift';
      giftEl.innerHTML = '<span class="ic">🎁</span><span><span class="nm"></span><span class="fx"></span></span>';
      h.appendChild(giftEl);
    }
    var lab = String(g.label || '');
    giftEl.querySelector('.ic').textContent = /follow/i.test(lab) ? '⭐' : /share/i.test(lab) ? '📣' : /like/i.test(lab) ? '❤️' : '🎁';
    giftEl.querySelector('.nm').textContent = g.user + (lab && lab !== 'test' ? ' · ' + lab : '');
    giftEl.querySelector('.fx').textContent = '→ ' + g.what;
    giftEl.classList.toggle('good', !!g.good);
    giftEl.classList.remove('show'); void giftEl.offsetWidth; giftEl.classList.add('show');
    setTimeout(function () { if (giftEl) giftEl.classList.remove('show'); setTimeout(giftNext, 350); }, giftQ.length ? 2200 : 3000);
  }

  var bannerEl = null, bannerHideT = null;
  function banner(kind, title, sub, hideAfter, frac) {
    if (typeof document === 'undefined') return;
    clearTimeout(bannerHideT);
    var h = host(); if (!h) return;
    style('cc-css', CSS);
    if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.innerHTML = '<div class="t"></div><div class="s"></div><div class="bar"><i></i></div>'; }
    if (bannerEl.parentNode !== h) h.appendChild(bannerEl);
    bannerEl.className = 'cc-reroll ' + kind;
    bannerEl.style.opacity = '1';
    bannerEl.querySelector('.t').textContent = title;
    bannerEl.querySelector('.s').textContent = sub || '';
    var bar = bannerEl.querySelector('.bar');
    bar.hidden = kind !== 'count';
    if (kind === 'count') bar.firstChild.style.width = Math.max(0, Math.min(1, frac || 0)) * 100 + '%';
    if (hideAfter) bannerHideT = setTimeout(function () {
      if (!bannerEl) return;
      bannerEl.style.opacity = '0';
      bannerHideT = setTimeout(function () { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }, 550);
    }, hideAfter);
  }

  var clockEl = null;
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, x = sec % 60;
    return h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function showClock(t) {
    if (typeof document === 'undefined') return;
    if (!(cfg.showTimer && t && t.active)) { if (clockEl) { clockEl.remove(); clockEl = null; } return; }
    var h = host(); if (!h) return;
    style('cc-css', CSS);
    if (!clockEl) clockEl = document.createElement('div');
    if (clockEl.parentNode !== h) h.appendChild(clockEl);
    clockEl.className = 'cc-clock' + (t.ended ? ' ended' : !t.running ? ' paused' : '');
    clockEl.textContent = t.ended ? 'TIME!' : fmtClock(t.remaining);
  }

  // ── connection to Crowd Control+ ────────────────────────────────────────
  var ws = null, status = 'off', retryT = null, retryMs = 2000, bridgeInfo = '';
  function send(msg) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(msg)); } catch (e) {} } }
  function connect() {
    clearTimeout(retryT);
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; }
    if (!cfg.enabled) { status = 'off'; render(); return; }
    status = 'connecting'; render();
    try { ws = new WebSocket(cfg.url); } catch (e) { status = 'bad address'; render(); return; }
    ws.onopen = function () {
      status = 'connected'; retryMs = 2000; runSent = ''; render();
      send({ type: 'hello', app: 'z1r', effects: list() });
    };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.type === 'effect') {
        var n = Math.max(1, Math.min(10, m.count | 0 || 1));
        for (var i = 0; i < n; i++) trigger(m.effect, m.user, m.label);
      } else if (m.type === 'timer') showClock(m);
      else if (m.type === 'durations') { durations = m.secs && typeof m.secs === 'object' ? m.secs : {}; render(); }
      else if (m.type === 'status') { bridgeInfo = m.text || ''; render(); if (m.text) feed(m.text, 'info'); }
      else if (m.event && !m.type) { bridgeInfo = 'TikFinity, not the bridge: use ws://localhost:21214'; render(); }
    };
    ws.onclose = function () {
      ws = null;
      if (!cfg.enabled) return;
      status = 'waiting for bridge'; render();
      retryT = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
    ws.onerror = function () {};
  }

  // ── menu section (in the emulator's ⋯ menu) ─────────────────────────────
  var rerender = null;
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function menuHtml(rr) {
    if (rr) rerender = rr;
    var timed = Object.keys(active).map(function (id) { return EFFECTS[id].name + ' ' + Math.ceil(active[id] / 60) + 's'; });
    var tests = Object.keys(EFFECTS).map(function (id) {
      return '<button type="button" data-ext="cc-test" data-id="' + id + '">' + esc(EFFECTS[id].name) + '</button>';
    }).join('');
    var recent = hist.length ? '<p class="hint" style="font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap;margin-top:6px">' + esc(hist.slice().reverse().join('\n')) + '</p>' : '';
    return '<h4>Crowd effects</h4>' + recent +
      '<div class="row"><span>TikTok effects on</span><input type="checkbox" data-ext="cc-enabled"' + (cfg.enabled ? ' checked' : '') + '></div>' +
      '<div class="row"><span>Bridge address</span><input type="text" data-ext="cc-url" value="' + esc(cfg.url) + '" style="width:55%;max-width:240px"></div>' +
      '<div class="row"><span>Gift alerts on the game</span><input type="checkbox" data-ext="cc-alerts"' + (cfg.alerts ? ' checked' : '') + '></div>' +
      '<div class="row"><span>Show feed on game</span><input type="checkbox" data-ext="cc-feed"' + (cfg.feed ? ' checked' : '') + '></div>' +
      '<div class="row"><span>Allow seed reroll (ends this game)</span><input type="checkbox" data-ext="cc-reroll"' + (cfg.allowReroll ? ' checked' : '') + '></div>' +
      '<div class="row"><span>Show subathon clock on game</span><input type="checkbox" data-ext="cc-show-timer"' + (cfg.showTimer ? ' checked' : '') + '></div>' +
      (rerollT ? '<div class="acts"><button type="button" class="primary" data-ext="cc-cancel-reroll">Cancel new seed (' + rerollLeft + 's)</button></div>' : '') +
      '<p class="hint">Status: ' + esc(status) + (bridgeInfo ? ' · ' + esc(bridgeInfo) : '') +
        ' · ' + queue.length + ' queued' + (timed.length ? ' · active: ' + esc(timed.join(', ')) : '') + '</p>' +
      '<p class="hint">Test an effect (it runs when you return to the game):</p>' +
      '<div class="acts">' + tests + '</div>' +
      (status === 'connected'
        ? '<div class="acts" style="margin-top:6px"><button type="button" data-ext="cc-plus" data-what="gift">Fake gift (alert + effect)</button>' +
          '<button type="button" data-ext="cc-plus" data-what="mystery_box">Mystery box</button></div>'
        : '<p class="hint">Connect to Crowd Control+ for the mystery box and fake-gift tests.</p>') +
      '<div class="acts" style="margin-top:6px"><button type="button" data-ext="cc-clear">Clear queue and timers</button></div>';
  }
  function menuClick(b, rr) {
    rerender = rr;
    var a = b.dataset.ext;
    if (a === 'cc-test') { note('test button: ' + b.dataset.id); trigger(b.dataset.id, 'test'); }
    else if (a === 'cc-clear') { endAll(); queue.length = 0; cancelReroll(); }
    else if (a === 'cc-cancel-reroll') cancelReroll();
    else if (a === 'cc-plus') { send({ type: 'test', what: b.dataset.what }); feed('Sent to Crowd Control+: ' + (b.dataset.what === 'gift' ? 'fake gift' : 'mystery box'), 'info'); }
    rr();
  }
  function menuInput(el) {
    var a = el.dataset.ext;
    if (a === 'cc-enabled') { cfg.enabled = el.checked; saveCfg(); connect(); }
    else if (a === 'cc-feed') { cfg.feed = el.checked; saveCfg(); }
    else if (a === 'cc-alerts') { cfg.alerts = el.checked; saveCfg(); }
    else if (a === 'cc-show-timer') { cfg.showTimer = el.checked; saveCfg(); if (!el.checked && clockEl) { clockEl.remove(); clockEl = null; } }
    else if (a === 'cc-reroll') { cfg.allowReroll = el.checked; saveCfg(); if (!el.checked) cancelReroll(); rerender && rerender(); }
    else if (a === 'cc-url') { cfg.url = el.value.trim(); saveCfg(); clearTimeout(menuInput.t); menuInput.t = setTimeout(connect, 800); }
  }
  function render() {
    if (!rerender || typeof document === 'undefined') return;
    var m = document.querySelector('.s9x-menu');
    if (!m || m.hidden) return;
    var ae = document.activeElement;
    if (ae && ae.dataset && ae.dataset.ext === 'cc-url') return;
    clearTimeout(render.t); render.t = setTimeout(function () { try { rerender(); } catch (e) {} }, 50);
  }
  function list() {
    return Object.keys(EFFECTS).map(function (id) {
      return { id: id, name: EFFECTS[id].name, secs: secsOf(id), good: !!EFFECTS[id].good };
    });
  }

  // ── wire into the player ────────────────────────────────────────────────
  function install() {
    var p = P();
    if (!p || !p.hooks) return false;
    p.hooks.frame = onFrame;
    p.hooks.input = onInput;
    p.hooks.menu = { html: menuHtml, click: menuClick, input: menuInput };
    connect();
    return true;
  }
  root.Z1Crowd = {
    trigger: trigger, list: list, cancelReroll: cancelReroll, EFFECTS: EFFECTS, ADDR: A, inPlay: inPlay,
    halves: halves, setHalves: setHalves,
    get queue() { return queue.slice(); }, get active() { return Object.assign({}, active); },
    get status() { return status; },
    get recent() { return hist.slice(); },
    _onFrame: onFrame, _onInput: onInput,
  };
  if (!install()) {
    var tries = 0, t = setInterval(function () { if (install() || ++tries > 50) clearInterval(t); }, 200);
  }
})(window);
