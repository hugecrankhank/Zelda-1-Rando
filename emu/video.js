/*
 * WebGL2 renderer that runs RetroArch-style GLSL shader presets on the
 * Snes9x frame. Shaders in /shaders are the stock libretro .glsl files
 * (one source with VERTEX/FRAGMENT sections), compiled as GLSL ES 3.00.
 *
 * A preset is a list of passes: { file, scale (x source, or 0 = screen),
 * filter: 'nearest'|'linear' (how THIS pass samples its input) }.
 * The last pass always draws to the screen.
 */
(function () {
  'use strict';

  var PRESETS = {
    nearest: { name: 'Sharp pixels (nearest)', passes: [{ file: 'stock.glsl', filter: 'nearest' }] },
    smooth:  { name: 'Smooth (bilinear)',      passes: [{ file: 'stock.glsl', filter: 'linear' }] },
    sharpbl: { name: 'Sharp bilinear',         passes: [{ file: 'sharp-bilinear-simple.glsl', filter: 'linear' }] },
    xbrz6:   { name: '6xBRZ',                  passes: [{ file: '6xbrz.glsl', scale: 6, filter: 'nearest' }, { file: 'stock.glsl', filter: 'linear' }] },
    xbrz4:   { name: '4xBRZ (lighter)',        passes: [{ file: '4xbrz.glsl', scale: 4, filter: 'nearest' }, { file: 'stock.glsl', filter: 'linear' }] },
    crt:     { name: 'CRT (crt-pi)',           passes: [{ file: 'crt-pi.glsl', filter: 'linear' }] },
  };

  var shaderCache = {};
  function fetchShader(file) {
    if (!shaderCache[file]) shaderCache[file] = fetch(Video.base + 'shaders/' + file).then(function (r) {
      if (!r.ok) throw new Error('shader ' + file + ' ' + r.status);
      return r.text();
    });
    return shaderCache[file];
  }

  function Video(canvas) {
    this.canvas = canvas;
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available on this device');
    this.gl = gl;
    this.aspect = 8 / 7;         // display aspect of a 256x224 frame
    this.frameCount = 0;
    this.srcW = 256; this.srcH = 224;
    this.programs = null;        // compiled passes for the active preset
    this.fbos = [];
    this.presetId = null;
    this.dirty = true;          // something changed since the last draw

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    this.srcTex = this._tex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB565, 256, 224, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, null);

    // Full-screen quad: x,y clip coords. Texcoords are set per pass.
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tbUp = gl.createBuffer();      // input stored top-down (uploaded frame)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tbUp);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), gl.STATIC_DRAW);
    this.tbGl = gl.createBuffer();      // input stored bottom-up (a previous pass)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tbGl);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }

  Video.PRESETS = PRESETS;
  Video.base = 'emu/';        // where shaders/ lives, relative to the page

  Video.prototype._tex = function () {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };

  Video.prototype._compile = function (src, file) {
    // Drop #version and RetroArch's "#pragma parameter" lines (unknown to WebGL).
    src = src.replace(/^\s*#version.*$/m, '').replace(/^\s*#pragma parameter.*$/mg, '');
    try { return this._link(src, file, '#version 300 es\n'); }
    catch (e) { return this._link(src, file, ''); }   // older shaders: GLSL ES 1.00 (varying/texture2D)
  };

  Video.prototype._link = function (src, file, version) {
    var gl = this.gl;
    function sh(type, def) {
      var s = gl.createShader(type);
      var pre = version + (def === 'FRAGMENT' ? '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' : '');
      gl.shaderSource(s, pre + '#define ' + def + '\n' + src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(file + ' ' + def + ': ' + log); }
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, 'VERTEX'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'FRAGMENT'));
    gl.bindAttribLocation(p, 0, 'VertexCoord');
    gl.bindAttribLocation(p, 1, 'TexCoord');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(file + ': ' + gl.getProgramInfoLog(p));
    var u = {};
    ['MVPMatrix', 'FrameDirection', 'FrameCount', 'OutputSize', 'TextureSize', 'InputSize', 'Texture'].forEach(function (n) {
      u[n] = gl.getUniformLocation(p, n);
    });
    return { prog: p, u: u };
  };

  // Returns a promise; on failure falls back to nearest and rethrows.
  Video.prototype.setPreset = function (id) {
    var self = this, preset = PRESETS[id] || PRESETS.nearest;
    return Promise.all(preset.passes.map(function (ps) { return fetchShader(ps.file); })).then(function (srcs) {
      var progs = preset.passes.map(function (ps, i) {
        var c = self._compile(srcs[i], ps.file);
        c.pass = ps;
        return c;
      });
      if (self.programs) self.programs.forEach(function (p) { self.gl.deleteProgram(p.prog); });
      self.programs = progs;
      self.presetId = id;
      self.dirty = true;
      self._resizeFbos();
    });
  };

  Video.prototype._resizeFbos = function () {
    this.dirty = true;
    var gl = this.gl, self = this;
    this.fbos.forEach(function (f) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });
    this.fbos = [];
    if (!this.programs) return;
    var w = this.srcW, h = this.srcH;
    for (var i = 0; i < this.programs.length - 1; i++) {
      var s = this.programs[i].pass.scale || 1;
      w = Math.min(w * s, this.maxTex); h = Math.min(h * s, this.maxTex);
      var tex = this._tex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      self.fbos.push({ fb: fb, tex: tex, w: w, h: h });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  // frame: { w, h, data: Uint16Array RGB565 }
  Video.prototype.upload = function (frame) {
    var gl = this.gl;
    this.dirty = true;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    if (frame.w !== this.srcW || frame.h !== this.srcH) {
      this.srcW = frame.w; this.srcH = frame.h;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB565, frame.w, frame.h, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, frame.data);
      this._resizeFbos();
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frame.w, frame.h, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, frame.data);
    }
  };

  // Where the picture goes inside the canvas (device pixels).
  Video.prototype.viewport = function () {
    var cw = this.canvas.width, ch = this.canvas.height;
    var a = this.aspect;
    if (!a) return { x: 0, y: 0, w: cw, h: ch };   // 'fill'
    var w = cw, h = Math.round(cw / a);
    if (h > ch) { h = ch; w = Math.round(ch * a); }
    return { x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2), w: w, h: h };
  };

  Video.prototype.fit = function () {
    var c = this.canvas, r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.dirty = true; }
  };

  Video.prototype.draw = function () {
    if (!this.programs || !this.dirty) return;
    this.dirty = false;
    var gl = this.gl, n = this.programs.length;
    this.frameCount++;
    var inTex = this.srcTex, inW = this.srcW, inH = this.srcH, topDown = true;
    gl.disable(gl.BLEND);
    for (var i = 0; i < n; i++) {
      var p = this.programs[i], last = i === n - 1, outW, outH;
      if (last) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        var v = this.viewport();
        gl.viewport(v.x, v.y, v.w, v.h);
        outW = v.w; outH = v.h;
      } else {
        var f = this.fbos[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
        gl.viewport(0, 0, f.w, f.h);
        outW = f.w; outH = f.h;
      }
      gl.useProgram(p.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inTex);
      var filt = p.pass.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      var u = p.u;
      if (u.Texture) gl.uniform1i(u.Texture, 0);
      if (u.MVPMatrix) gl.uniformMatrix4fv(u.MVPMatrix, false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      if (u.FrameDirection) gl.uniform1i(u.FrameDirection, 1);
      if (u.FrameCount) gl.uniform1i(u.FrameCount, this.frameCount);
      if (u.OutputSize) gl.uniform2f(u.OutputSize, outW, outH);
      if (u.TextureSize) gl.uniform2f(u.TextureSize, inW, inH);
      if (u.InputSize) gl.uniform2f(u.InputSize, inW, inH);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, topDown ? this.tbUp : this.tbGl);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!last) { inTex = this.fbos[i].tex; inW = this.fbos[i].w; inH = this.fbos[i].h; topDown = false; }
    }
  };

  window.Video = Video;
})();
