/*
 * Input: keyboard, gamepads (Gamepad API) and the on-screen controller.
 * Produces a pad mask per frame via read() (libretro joypad bits; the NES uses B, A, Select, Start and the D-pad). Keyboard and gamepad
 * buttons can be remapped (keymap / padmap); every connected pad drives P1.
 *
 * Touch: every active finger is tracked. A finger on the D-pad picks a
 * direction from its angle to the pad's centre (8-way, so diagonals work);
 * a finger anywhere else presses whatever button is under it, and can slide
 * from one button to another (e.g. B -> Y) without lifting.
 */
(function () {
  'use strict';
  var B = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 };
  var bit = function (n) { return 1 << B[n]; };

  var DEFAULT_KEYS = {
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
    KeyZ: 'B', KeyX: 'A', KeyA: 'B', KeyS: 'A',
    Enter: 'START', ShiftRight: 'SELECT', Backspace: 'SELECT',
  };
  // Standard gamepad layout -> SNES, by position (bottom face = B, right = A ...)
  // NES: the bottom and left face buttons are B, the right and top are A.
  var DEFAULT_PAD = { 0: 'B', 1: 'A', 2: 'B', 3: 'A', 8: 'SELECT', 9: 'START',
    12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT' };

  function Input() {
    this.keys = 0;
    this.touch = 0;
    this.keymap = Object.assign({}, DEFAULT_KEYS);
    this.padmap = Object.assign({}, DEFAULT_PAD);
    this.hotkeys = {};            // code -> function(down)
    this.haptics = true;
    this.pointers = new Map();    // pointerId -> mask
    this.onActivity = null;       // any user input (unlocks audio)
    this.onPadPress = null;       // a physical controller button was pressed
    this.capture = null;          // remapping: function({key}|{pad}|{cancel}) taking the next press
    this.enabled = function () { return true; };
    this.padName = '';
    this._prevPad = 0;
    var self = this;

    window.addEventListener('keydown', function (e) {
      if (self.capture) {
        self.capture(e.code === 'Escape' ? { cancel: true } : { key: e.code });
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (isTyping(e) || !self.enabled()) return;
      if (self.hotkeys[e.code]) { e.preventDefault(); if (!e.repeat) self.hotkeys[e.code](true); return; }
      var b = self.keymap[e.code];
      if (!b) return;
      e.preventDefault();
      self.keys |= bit(b);
      if (self.onActivity) self.onActivity();
    }, true);
    window.addEventListener('keyup', function (e) {
      if (self.hotkeys[e.code]) { self.hotkeys[e.code](false); return; }
      var b = self.keymap[e.code];
      if (b) self.keys &= ~bit(b);
    }, true);
    window.addEventListener('blur', function () {
      self.keys = 0; self.touch = 0; self.pointers.clear();
      if (self.paintTouch) self.paintTouch(0);
    });
  }

  function isTyping(e) {
    var t = e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    return (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(t.type)) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  }

  Input.prototype.pads = function () {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); } catch (e) { return []; }
  };

  Input.prototype.gamepadMask = function () {
    var list = this.pads(), self = this, m = 0, any = 0;
    this.padName = list.length ? list[0].id : '';
    list.forEach(function (gp) {
      gp.buttons.forEach(function (btn, i) {
        var on = btn.pressed || btn.value > 0.5;
        if (on && i < 31) any |= 1 << i;
        if (on && self.padmap[i]) m |= bit(self.padmap[i]);
      });
      var x = gp.axes[0] || 0, y = gp.axes[1] || 0;
      if (x < -0.5) m |= bit('LEFT'); else if (x > 0.5) m |= bit('RIGHT');
      if (y < -0.5) m |= bit('UP'); else if (y > 0.5) m |= bit('DOWN');
    });
    var pressed = any & ~this._prevPad;
    this._prevPad = any;
    if (pressed) {
      if (this.capture) {
        for (var i = 0; i < 31; i++) if (pressed & (1 << i)) { this.capture({ pad: i }); break; }
        return 0;
      }
      if (this.onPadPress) this.onPadPress();
      if (this.onActivity) this.onActivity();
    }
    return this.capture ? 0 : m;
  };

  // Combined pad 1 mask. Opposite directions cancel (real pads can't press both).
  Input.prototype.read = function () {
    var m = this.gamepadMask() | this.touch | (this.enabled() ? this.keys : 0);
    if ((m & bit('LEFT')) && (m & bit('RIGHT'))) m &= ~(bit('LEFT') | bit('RIGHT'));
    if ((m & bit('UP')) && (m & bit('DOWN'))) m &= ~(bit('UP') | bit('DOWN'));
    return m;
  };

  // ── on-screen controller ────────────────────────────────────────────────
  Input.prototype.bindTouch = function (root) {
    var self = this;
    function maskAt(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el || !root.contains(el)) return 0;
      var dpad = el.closest('[data-dpad]');
      if (dpad) {
        var r = dpad.getBoundingClientRect();
        var dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
        var dead = r.width * 0.12;
        if (dx * dx + dy * dy < dead * dead) return 0;
        var a = Math.atan2(dy, dx) * 180 / Math.PI;      // 0 = right, 90 = down
        var sector = Math.round(a / 45);                 // -4..4
        var map = { 0: ['RIGHT'], 1: ['RIGHT', 'DOWN'], 2: ['DOWN'], 3: ['DOWN', 'LEFT'], 4: ['LEFT'],
          '-4': ['LEFT'], '-3': ['LEFT', 'UP'], '-2': ['UP'], '-1': ['UP', 'RIGHT'] };
        return (map[sector] || []).reduce(function (m, n) { return m | bit(n); }, 0);
      }
      var btn = el.closest('[data-btn]');
      if (!btn) return 0;
      return btn.dataset.btn.split(',').reduce(function (m, n) { return m | bit(n); }, 0);
    }
    function paint(m) {
      root.querySelectorAll('[data-btn]').forEach(function (b) {
        var bm = b.dataset.btn.split(',').reduce(function (a, n) { return a | bit(n); }, 0);
        b.classList.toggle('down', (m & bm) === bm);
      });
      root.querySelectorAll('[data-dpad]').forEach(function (d) {
        ['UP', 'DOWN', 'LEFT', 'RIGHT'].forEach(function (n) { d.classList.toggle('d-' + n.toLowerCase(), !!(m & bit(n))); });
      });
    }
    self.paintTouch = paint;
    function recompute() {
      var m = 0;
      self.pointers.forEach(function (v) { m |= v; });
      var pressed = m & ~self.touch;
      if (pressed && self.haptics && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
      self.touch = m;
      paint(m);
    }
    function move(e) {
      if (!self.pointers.has(e.pointerId)) return;
      e.preventDefault();
      self.pointers.set(e.pointerId, maskAt(e.clientX, e.clientY));
      recompute();
    }
    function end(e) {
      if (!self.pointers.delete(e.pointerId)) return;
      recompute();
    }
    root.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('[data-btn],[data-dpad]')) return;
      e.preventDefault(); e.stopPropagation();
      try { root.setPointerCapture(e.pointerId); } catch (x) {}
      self.pointers.set(e.pointerId, maskAt(e.clientX, e.clientY));
      recompute();
      if (self.onActivity) self.onActivity();
    });
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('lostpointercapture', end);
    // No iOS long-press magnifier / callout or double-tap zoom on the pad.
    root.addEventListener('contextmenu', function (e) { if (e.target.closest('[data-btn],[data-dpad]')) e.preventDefault(); });
    root.addEventListener('touchstart', function (e) { if (e.target.closest('[data-btn],[data-dpad]')) e.preventDefault(); }, { passive: false });
  };

  Input.BTN = B;
  Input.DEFAULT_KEYS = DEFAULT_KEYS;
  Input.DEFAULT_PAD = DEFAULT_PAD;
  window.EmuInput = Input;
})();
