/*
 * Audio output for the emulator. The main thread posts each frame's samples
 * (Int16 stereo at the core's rate, ~32040 Hz); this resamples to the
 * device rate with linear interpolation. The step is nudged by how full the
 * queue is, so emulation speed and the sound card never drift apart
 * (no crackle from underruns, no growing latency).
 */
class Snes9xAudio extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.inRate = (opts.processorOptions && opts.processorOptions.inRate) || 32040;
    this.cap = 1 << 15;                       // stereo frames
    this.buf = new Float32Array(this.cap * 2);
    this.r = 0; this.w = 0;                   // frame indices, wrap at cap
    this.pos = 0;                             // fractional read offset
    this.target = Math.round(this.inRate * 0.06);   // ~60 ms queued
    this.primed = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'samples') this.push(d.data);
      else if (d.type === 'clear') { this.r = this.w = 0; this.pos = 0; this.primed = false; }
      else if (d.type === 'rate') this.inRate = d.rate;
    };
  }
  avail() { return (this.w - this.r + this.cap) % this.cap; }
  push(s16) {
    const n = s16.length >> 1;
    if (this.avail() + n >= this.cap - 1) return;   // overflow: drop (e.g. fast-forward)
    for (let i = 0; i < n; i++) {
      const j = this.w * 2;
      this.buf[j] = s16[i * 2] / 32768;
      this.buf[j + 1] = s16[i * 2 + 1] / 32768;
      this.w = (this.w + 1) % this.cap;
    }
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    const avail = this.avail();
    if (!this.primed) {
      if (avail < this.target) { L.fill(0); if (R !== L) R.fill(0); return true; }
      this.primed = true;
    }
    // Rate control: +/-0.5% max, proportional to how far we are from target.
    const err = (avail - this.target) / this.target;
    const adj = 1 + Math.max(-0.005, Math.min(0.005, err * 0.005));
    const step = this.inRate / sampleRate * adj;
    for (let i = 0; i < L.length; i++) {
      if (this.avail() < 2) { L[i] = 0; R[i] = 0; this.primed = false; continue; }
      const a = this.r * 2, b = ((this.r + 1) % this.cap) * 2, f = this.pos;
      L[i] = this.buf[a] + (this.buf[b] - this.buf[a]) * f;
      R[i] = this.buf[a + 1] + (this.buf[b + 1] - this.buf[a + 1]) * f;
      this.pos += step;
      while (this.pos >= 1) { this.pos -= 1; this.r = (this.r + 1) % this.cap; }
    }
    return true;
  }
}
registerProcessor('snes9x-audio', Snes9xAudio);
