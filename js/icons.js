/*
 * icons.js — original 16×16 pixel-art icons for the tracker, drawn as SVG.
 * Each icon is 16 rows of 16 characters; '.' is transparent and every other
 * letter is a palette entry. 'x' and 'z' are swapped per item level (a white
 * sword vs a magical sword, a blue vs a red candle, ...).
 */
(function () {
  'use strict';

  const PAL = {
    W: '#FCFCFC', G: '#BCBCBC', D: '#7C7C7C', Y: '#F8B800', O: '#E45C10', R: '#D82800',
    B: '#0058F8', C: '#3CBCFC', N: '#AC7C00', T: '#FCD8A8', E: '#00A800', L: '#B8F818',
    P: '#F878F8', K: '#000000',
  };

  const ART = {
    sword: [
      '.......xz.......', '.......xz.......', '.......xz.......', '.......xz.......',
      '.......xz.......', '.......xz.......', '.......xz.......', '.......xz.......',
      '.......xz.......', '....YYYYYYYY....', '....YOOOOOOY....', '.......NN.......',
      '.......NN.......', '.......NN.......', '......YYYY......', '......YYYY......'],
    boomerang: [
      '................', '................', '...zxxxxxxxxx...', '..xxxxxxxxxxx...',
      '..xxx...........', '..xxx...........', '..xxx...........', '..xxx...........',
      '..xxx...........', '..xxx...........', '..xxx...........', '...xx...........',
      '................', '................', '................', '................'],
    bomb: [
      '................', '..........Y.Y...', '...........Y....', '..........N.Y...',
      '.........N......', '......BBBN......', '....BBBBBBBB....', '...BBWWBBBBBB...',
      '...BBWBBBBBBB...', '..BBBBBBBBBBBB..', '..BBBBBBBBBBBB..', '..BBBBBBBBBBBB..',
      '...BBBBBBBBBB...', '....BBBBBBBB....', '......BBBB......', '................'],
    bow: [
      '................', '.....WNN........', '.....W.NN.......', '.....W..NN......',
      '.....W...NN.....', '.....W....NN....', '.....W.....NN...', '.....W.....NN...',
      '.....W.....NN...', '.....W.....NN...', '.....W....NN....', '.....W...NN.....',
      '.....W..NN......', '.....W.NN.......', '.....WNN........', '................'],
    arrow: [
      '................', '..........xxxxx.', '...........xxxx.', '..........NNxxx.',
      '.........NN..xx.', '........NN......', '.......NN.......', '......NN........',
      '.....NN.........', '....NN..........', '...NN...........', '.zNN............',
      '.zNz............', 'zz.z............', '................', '................'],
    candle: [
      '................', '.......O........', '......OYO.......', '......OYO.......',
      '.......Y........', '.......W........', '.....xxxxx......', '.....xzxxx......',
      '.....xzxxx......', '.....xzxxx......', '.....xzxxx......', '.....xzxxx......',
      '.....xxxxx......', '...GGGGGGGGG....', '....GGGGGGG.....', '................'],
    recorder: [
      '................', '.......YY.......', '......YYYY......', '.......YY.......',
      '.......YY.......', '.......NY.......', '.......YY.......', '.......NY.......',
      '.......YY.......', '.......NY.......', '.......YY.......', '.......YY.......',
      '......YYYY......', '.....YYYYYY.....', '......YYYY......', '................'],
    bait: [
      '................', '................', '.........WW.....', '........WWWW....',
      '.........WW.....', '........W.......', '....RRRRW.......', '...RRRRRR.......',
      '..RRORRRRR......', '..RORRRRRR......', '..RRRRRRRR......', '..RRRRRRR.......',
      '...RRRRR........', '....RRR.........', '................', '................'],
    potion: [
      '................', '......NNNN......', '......NNNN......', '.......WW.......',
      '.......WW.......', '......WWWW......', '.....WxxxxW.....', '....WxzxxxxW....',
      '....WxzxxxxW....', '....WxxxxxxW....', '....WxxxxxxW....', '....WxxxxxxW....',
      '.....WxxxxW.....', '......WWWW......', '................', '................'],
    letter: [
      '................', '................', '................', '..WWWWWWWWWWWW..',
      '..WGWWWWWWWWGW..', '..WWGWWWWWWGWW..', '..WWWGWWWWGWWW..', '..WWWWGWWGWWWW..',
      '..WWWWWxxWWWWW..', '..WWWWWWWWWWWW..', '..WWWWWWWWWWWW..', '..WWWWWWWWWWWW..',
      '..WWWWWWWWWWWW..', '................', '................', '................'],
    wand: [
      '................', '...........CC...', '..........CWWC..', '..........CWWC..',
      '...........CC...', '..........BB....', '.........BB.....', '........BB......',
      '.......BB.......', '......BB........', '.....BB.........', '....BB..........',
      '...BB...........', '..BB............', '................', '................'],
    raft: [
      '................', '................', '................', '................',
      '................', '.NNNNNNNNNNNNNN.', '.TNTNTNTNTNTNTN.', '.TNTNTNTNTNTNTN.',
      '.TNTNTNTNTNTNTN.', '.TNTNTNTNTNTNTN.', '.NNNNNNNNNNNNNN.', '................',
      '.CC..CC..CC..CC.', 'C..CC..CC..CC..C', '................', '................'],
    book: [
      '................', '................', '...RRRRRRRRRR...', '..RRRRRRRRRRRW..',
      '..RRYYYYYYRRRW..', '..RRRRRRRRRRRW..', '..RRYYYYRRRRRW..', '..RRRRRRRRRRRW..',
      '..RRRRRRRRRRRW..', '..RRRRRRRRRRRW..', '..RRRRRRRRRRRW..', '..RRRRRRRRRRRW..',
      '..RRRRRRRRRRRW..', '...WWWWWWWWWWW..', '................', '................'],
    ring: [
      '................', '................', '.......WW.......', '......WWWW......',
      '.....xxxxxx.....', '....xz....xx....', '...xz......xx...', '...x........x...',
      '...x........x...', '...x........x...', '...xx......xx...', '....xx....xx....',
      '.....xxxxxx.....', '................', '................', '................'],
    ladder: [
      '................', '...NN......NN...', '...NNNNNNNNNN...', '...NN......NN...',
      '...NN......NN...', '...NNNNNNNNNN...', '...NN......NN...', '...NN......NN...',
      '...NNNNNNNNNN...', '...NN......NN...', '...NN......NN...', '...NNNNNNNNNN...',
      '...NN......NN...', '...NN......NN...', '...NNNNNNNNNN...', '...NN......NN...'],
    key: [
      '................', '.....YYYY.......', '....YY..YY......', '....YY..YY......',
      '.....YYYY.......', '......YY........', '......YY........', '......YY........',
      '......YYYY......', '......YY........', '......YYYY......', '......YY........',
      '................', '................', '................', '................'],
    bracelet: [
      '................', '................', '................', '................',
      '....RRRRRRRR....', '..RRYRRYRRYRRR..', '.RR..........RR.', '.RR..........RR.',
      '..RRYRRYRRYRRR..', '....RRRRRRRR....', '................', '................',
      '................', '................', '................', '................'],
    shield: [
      '................', '..BBBBBBBBBBBB..', '..BCCCCCCCCCCB..', '..BCCCCYYCCCCB..',
      '..BCCCCYYCCCCB..', '..BCCYYYYYYCCB..', '..BCCCCYYCCCCB..', '..BCCCCYYCCCCB..',
      '..BCCCCCCCCCCB..', '...BCCCCCCCCB...', '...BCCCCCCCCB...', '....BCCCCCCB....',
      '.....BCCCCB.....', '......BCCB......', '.......BB.......', '................'],
    heart: [
      '................', '................', '................', '..RRRR..RRRR....',
      '.RRWRRRRRRRRR...', '.RWRRRRRRRRRR...', '.RRRRRRRRRRRR...', '.RRRRRRRRRRRR...',
      '..RRRRRRRRRR....', '...RRRRRRRR.....', '....RRRRRR......', '.....RRRR.......',
      '......RR........', '................', '................', '................'],
    triforce: [
      '................', '................', '................', '.......YY.......',
      '......YYYY......', '......YYYY......', '.....YYYYYY.....', '.....YYYYYY.....',
      '....YYYYYYYY....', '....YYYYYYYY....', '...YYYYYYYYYY...', '...YYYYYYYYYY...',
      '..YYYYYYYYYYYY..', '..YYYYYYYYYYYY..', '................', '................'],
    map: [
      '................', '................', '..TTTTTTTTTTTT..', '..TNNTTTTTTTTT..',
      '..TTNTTTTTRRTT..', '..TTNNNTTTRRTT..', '..TTTTNTTTTTTT..', '..TTTTNNNNTTTT..',
      '..TTTTTTTNTTTT..', '..TTEETTTNTTTT..', '..TTEETTTNNNTT..', '..TTTTTTTTTNTT..',
      '..TTTTTTTTTTTT..', '................', '................', '................'],
    compass: [
      '................', '................', '.....GGGGGG.....', '....GWWWWWWG....',
      '...GWWWWRWWWG...', '...GWWWWRWWWG...', '...GWWWRRWWWG...', '...GWWWYYWWWG...',
      '...GWWWDDWWWG...', '...GWWWDWWWWG...', '...GWWWDWWWWG...', '....GWWWWWWG....',
      '.....GGGGGG.....', '................', '................', '................'],
    rupee: [
      '................', '.......xx.......', '......xzxx......', '.....xzxxxx.....',
      '....xzxxxxxx....', '....xzxxxxxx....', '....xzxxxxxx....', '....xzxxxxxx....',
      '....xzxxxxxx....', '....xzxxxxxx....', '....xzxxxxxx....', '.....xzxxxx.....',
      '......xzxx......', '.......xx.......', '................', '................'],
  };

  // Validate shapes once (helps when editing art by hand).
  Object.keys(ART).forEach((k) => {
    const a = ART[k];
    if (a.length !== 16 || a.some((r) => r.length !== 16)) console.warn('[icons] bad shape:', k);
  });

  const cache = new Map();
  function svg(name, tint) {
    const key = name + '|' + (tint ? tint.x + tint.z : '');
    if (cache.has(key)) return cache.get(key);
    const art = ART[name];
    if (!art) return '';
    const pal = Object.assign({}, PAL, { x: PAL[(tint && tint.x) || 'W'], z: PAL[(tint && tint.z) || 'G'] });
    let rects = '';
    for (let y = 0; y < 16; y++) {
      const row = art[y];
      let x = 0;
      while (x < 16) {
        const c = row[x];
        if (c === '.') { x++; continue; }
        let w = 1;
        while (x + w < 16 && row[x + w] === c) w++;
        rects += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="1" fill="' + pal[c] + '"/>';
        x += w;
      }
    }
    const out = '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' + rects + '</svg>';
    cache.set(key, out);
    return out;
  }

  window.Z1Icons = { svg, names: Object.keys(ART), PAL };
})();
