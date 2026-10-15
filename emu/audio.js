/*
 * Main-thread side of audio: one AudioContext, a worklet that resamples the
 * core's output, and a master gain for volume. Browsers (iOS especially)
 * only allow sound after a tap, so unlock() is called from input handlers.
 */
(function () {
  'use strict';
  function Audio() {
    this.ctx = null; this.node = null; this.gain = null;
    this.volume = 0.7; this.muted = false; this.ready = false;
    this.inRate = 32040;
    this._starting = null;
    // iOS 16.4+: treat as media playback (volume buttons work, silent switch doesn't mute)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  }
  Audio.prototype.start = function () {
    if (this._starting) return this._starting;
    var self = this;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.applyVolume();
    this._starting = this.ctx.audioWorklet.addModule('emu/audio-worklet.js').then(function () {
      self.node = new AudioWorkletNode(self.ctx, 'snes9x-audio', {
        numberOfInputs: 0, outputChannelCount: [2], processorOptions: { inRate: self.inRate } });
      self.node.connect(self.gain);
      self.ready = true;
    }).catch(function (e) { console.warn('[audio] worklet failed', e); });
    return this._starting;
  };
  // Call from a user gesture.
  Audio.prototype.unlock = function () {
    if (!this.ctx) this.start();
    if (this.ctx && this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) {} }
  };
  Audio.prototype.setRate = function (r) {
    this.inRate = r;
    if (this.node) this.node.port.postMessage({ type: 'rate', rate: r });
  };
  Audio.prototype.push = function (s16) {
    if (!this.ready || !s16.length || this.ctx.state !== 'running') return;
    this.node.port.postMessage({ type: 'samples', data: s16.slice() });
  };
  Audio.prototype.clear = function () { if (this.node) this.node.port.postMessage({ type: 'clear' }); };
  Audio.prototype.applyVolume = function () {
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
  };
  Audio.prototype.setVolume = function (v) { this.volume = v; this.applyVolume(); };
  Audio.prototype.setMuted = function (m) { this.muted = m; this.applyVolume(); };
  window.EmuAudio = Audio;
})();
