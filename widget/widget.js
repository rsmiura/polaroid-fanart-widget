/* Polaroid Fanart Gallery: StreamElements custom widget. Paste into the JS tab.
   The overlay has no console: diagnostics go to the on-screen debug panel instead. */
const WIDGET_VERSION = '1.0.0';

// Used whenever a field is missing (older Fields JSON) or holds an unusable value.
const SETTING_DEFAULTS = {
  polaroidCount: 1,
  randomSinglePosition: false,
  maxOverlap: 0,
  polaroidWidth: 360,
  maxPhotoHeight: 480,
  rotationSeconds: 20,
  transitionSeconds: 1.2,
  orderMode: 'shuffle',
  replaceMode: 'oldest',
  maxTilt: 6,
  frameColor: '#fdfdf8',
  captionFont: 'Caveat',
  captionColor: '#2b2b2b',
  showHandle: true,
  creditPrefix: 'art by',
  pinStyle: 'pushpin',
  pinColor: '#d7263d',
  shadowStrength: 60,
  debugPanel: false,
};

const PRELOAD_TIMEOUT_MS = 5000;
const MAX_LOAD_ATTEMPTS = 3;
const MAX_EVENTS = 5;
const INITIAL_STAGGER_MS = 200;

// Layout estimate, in em of the polaroid (1em = width / 18, see widget.css).
const EM_PER_PX_WIDTH = 1 / 18;
const FRAME_PAD_EM = 0.72;
const STRIP_EST_EM = 3.9;
const PIN_ALLOWANCE_EM = 1;

// Random placement: at most this share of the box is covered by polaroids, so free spots
// remain findable; tries per spot and per full board; gap kept between polaroids (px).
const MAX_COVERAGE = 0.45;
const SPOT_TRIES = 200;
const LAYOUT_TRIES = 20;
const SPOT_GAP = 8;
// With overlap allowed: scale factor per step when no layout respects the limit.
const SHRINK_STEP = 0.92;

// Wall mode: how much exit and entry overlap.
const WALL_OVERLAP = 0.3;

// Everything belonging to the current onWidgetLoad. Replaced wholesale on every load, and
// async callbacks compare their captured run against this to know they are stale.
let run = null;

window.addEventListener('onWidgetLoad', (obj) => {
  const fieldData = (obj && obj.detail && obj.detail.fieldData) || {};
  start(fieldData);
});

// Lets the preview harness fire a rotation on demand. Unused on stream.
window.PolaroidWidget = {
  version: WIDGET_VERSION,
  tick: () => tick(),
};

// ---------- Lifecycle ----------

function start(fieldData) {
  stop();

  const settings = readSettings(fieldData);
  const artworks = readArtworks(fieldData);
  const r = {
    els: {
      gallery: document.getElementById('gallery'),
      debug: document.getElementById('debug-panel'),
    },
    settings,
    artworks,
    count: Math.min(settings.polaroidCount, artworks.length),
    queue: createQueue(artworks, settings.orderMode),
    spots: [],
    lastReplaced: null,
    box: null,
    scale: 1,
    gridFallback: false,
    busy: false,
    editorMode: false,
    interval: null,
    timers: new Set(),
    observer: null,
    onResize: null,
    onFontsLoaded: null,
    events: [],
    failedSlots: new Set(),
  };
  run = r;

  r.els.gallery.textContent = '';
  r.els.gallery.className = `pin-${settings.pinStyle}`;
  applyCssVars(settings);
  detectEditorMode(r);

  if (r.count > 0) {
    buildSpots(r);
    watchSize(r);
    watchFonts(r);
    fillInitial(r);
    r.interval = setInterval(tick, settings.rotationSeconds * 1000);
  }
  renderDebug(r);
}

// Must leave nothing behind: the preview re-dispatches onWidgetLoad on every control change.
function stop() {
  const r = run;
  if (!r) return;
  run = null;
  clearInterval(r.interval);
  r.timers.forEach((id) => clearTimeout(id));
  if (r.observer) r.observer.disconnect();
  if (r.onResize) window.removeEventListener('resize', r.onResize);
  if (r.onFontsLoaded) document.fonts.removeEventListener('loadingdone', r.onFontsLoaded);
  r.els.gallery.textContent = '';
}

function later(r, fn, ms) {
  const id = setTimeout(() => {
    r.timers.delete(id);
    if (r === run) fn();
  }, ms);
  r.timers.add(id);
}

function wait(r, ms) {
  return new Promise((resolve) => later(r, resolve, ms));
}

function detectEditorMode(r) {
  try {
    if (typeof SE_API === 'undefined' || !SE_API.getOverlayStatus) return;
    Promise.resolve(SE_API.getOverlayStatus())
      .then((status) => {
        if (r !== run) return;
        r.editorMode = !!(status && status.isEditorMode);
        renderDebug(r);
      })
      .catch(() => {});
  } catch (e) {
    // Optional API; editor mode stays false.
  }
}

// ---------- Fields ----------

function readSettings(fd) {
  const missing = [];
  const get = (key) => {
    if (!(key in fd)) {
      missing.push(key);
      return SETTING_DEFAULTS[key];
    }
    return fd[key];
  };
  const num = (key, min, max) => {
    const v = get(key);
    const n = v === '' || v === null ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : SETTING_DEFAULTS[key];
  };
  const bool = (key) => {
    const v = get(key);
    return typeof v === 'boolean' ? v : v === 'true';
  };
  const pick = (key, options) => {
    const v = get(key);
    return options.includes(v) ? v : SETTING_DEFAULTS[key];
  };
  const str = (key) => {
    const v = get(key);
    return typeof v === 'string' && v.trim() ? v.trim() : SETTING_DEFAULTS[key];
  };

  // Unlike other text settings, an empty prefix is meaningful (no prefix at all).
  const prefix = get('creditPrefix');

  return {
    polaroidCount: Math.round(num('polaroidCount', 1, 6)),
    randomSinglePosition: bool('randomSinglePosition'),
    maxOverlap: num('maxOverlap', 0, 100),
    polaroidWidth: num('polaroidWidth', 200, 800),
    maxPhotoHeight: num('maxPhotoHeight', 200, 1000),
    rotationSeconds: num('rotationSeconds', 5, 600),
    transitionSeconds: num('transitionSeconds', 0.3, 4),
    orderMode: pick('orderMode', ['shuffle', 'slots']),
    replaceMode: pick('replaceMode', ['oldest', 'random']),
    maxTilt: num('maxTilt', 0, 20),
    frameColor: str('frameColor'),
    captionFont: str('captionFont').replace(/['"\\;]/g, ''),
    captionColor: str('captionColor'),
    showHandle: bool('showHandle'),
    creditPrefix: typeof prefix === 'string' ? prefix.trim() : SETTING_DEFAULTS.creditPrefix,
    pinStyle: pick('pinStyle', ['pushpin', 'tape', 'none']),
    pinColor: str('pinColor'),
    shadowStrength: num('shadowStrength', 0, 100),
    debugPanel: bool('debugPanel'),
    missing,
  };
}

// Slots are discovered by key pattern, never by a hardcoded count, so adding slots
// to the Fields JSON needs no code change.
function readArtworks(fd) {
  // U+FE0F asks for color emoji and would override the monochrome Noto Emoji fallback.
  const text = (v) => (typeof v === 'string' ? v.replace(/️/g, '').trim() : '');
  return Object.keys(fd)
    .map((key) => /^slot(\d{2})_image$/.exec(key))
    .filter(Boolean)
    .map((m) => m[1])
    .sort((a, b) => Number(a) - Number(b))
    .filter((n) => {
      const show = fd[`slot${n}_show`];
      return text(fd[`slot${n}_image`]) && show !== false && show !== 'false';
    })
    .map((n) => ({
      slot: n,
      imageUrl: text(fd[`slot${n}_image`]),
      artist: text(fd[`slot${n}_artist`]),
      handle: text(fd[`slot${n}_handle`]),
      caption: text(fd[`slot${n}_caption`]),
    }));
}

function applyCssVars(s) {
  const root = document.documentElement.style;
  root.setProperty('--polaroid-width', `${s.polaroidWidth}px`);
  root.setProperty('--max-photo-height', `${s.maxPhotoHeight}px`);
  root.setProperty('--frame-color', s.frameColor);
  root.setProperty('--caption-color', s.captionColor);
  root.setProperty('--caption-font', `'${s.captionFont}'`);
  root.setProperty('--shadow-alpha', String((s.shadowStrength / 100) * 0.6));
  root.setProperty('--transition-seconds', `${s.transitionSeconds}s`);
  root.setProperty('--pin-color', s.pinColor);
}

// ---------- Play queue ----------

// Both modes draw from a "cycle" of the artwork list; shuffle mode shuffles each new cycle.
// Items in `exclude` (slot numbers already on the board) are passed over but stay in the
// cycle; when nothing drawable remains, a new cycle starts.
function createQueue(list, mode) {
  let cycle = [];
  let cycleNo = 0;
  let last = null;

  const refill = () => {
    cycleNo += 1;
    cycle = list.slice();
    if (mode !== 'shuffle') return;
    for (let i = cycle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cycle[i], cycle[j]] = [cycle[j], cycle[i]];
    }
    // Avoid showing the same piece twice in a row across the cycle boundary.
    if (cycle.length > 1 && cycle[0] === last) {
      const j = 1 + Math.floor(Math.random() * (cycle.length - 1));
      [cycle[0], cycle[j]] = [cycle[j], cycle[0]];
    }
  };

  const take = (exclude) => {
    const i = cycle.findIndex((a) => !exclude.has(a.slot));
    return i < 0 ? null : cycle.splice(i, 1)[0];
  };

  return {
    next(exclude) {
      let item = take(exclude);
      if (!item) {
        refill();
        item = take(exclude);
      }
      if (item) last = item;
      return item;
    },
    position() {
      return `cycle ${cycleNo}, ${list.length - cycle.length}/${list.length}`;
    },
  };
}

function preload(url) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), PRELOAD_TIMEOUT_MS);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
}

// Draws and preloads the next artwork, skipping failed loads (up to MAX_LOAD_ATTEMPTS).
// `fallbackExclude`, when given, is tried if nothing outside `exclude` can be drawn.
async function loadNext(r, exclude, fallbackExclude) {
  for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
    const art = r.queue.next(exclude) || (fallbackExclude && r.queue.next(fallbackExclude));
    if (!art) return null;
    const ok = await preload(art.imageUrl);
    if (r !== run) return null;
    if (ok) return art;
    // Not a permanent blacklist: the slot comes around again next cycle.
    r.failedSlots.add(art.slot);
    exclude.add(art.slot);
    if (fallbackExclude) fallbackExclude.add(art.slot);
    logEvent(r, `skipped slot ${art.slot}: image failed to load`);
  }
  return null;
}

// ---------- Board layout ----------

// Each polaroid on the board owns a "spot": a centre point in the box. Spots never
// overlap by more than maxOverlap % of their area. The grid below sizes the polaroids and is the fallback
// when no random arrangement fits: 1 row for 2-3, 2×2 for 4, 2 rows of 3 for 5-6 (short
// last row centered).
function cellRects(count, width, height) {
  const rows = count <= 3 ? 1 : 2;
  const perRow = count <= 3 ? count : count === 4 ? 2 : 3;
  const w = width / perRow;
  const h = height / rows;
  const rects = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const offset = (width - inRow * w) / 2;
    rects.push({ x: offset + (i % perRow) * w, y: row * h, w, h });
  }
  return rects;
}

// Bounding box of a polaroid at the max photo height and max tilt, before scaling.
function footprint(s) {
  const em = s.polaroidWidth * EM_PER_PX_WIDTH;
  const w = s.polaroidWidth;
  const h = s.maxPhotoHeight + em * (FRAME_PAD_EM + STRIP_EST_EM + PIN_ALLOWANCE_EM);
  const t = (s.maxTilt * Math.PI) / 180;
  return {
    w: w * Math.cos(t) + h * Math.sin(t),
    h: w * Math.sin(t) + h * Math.cos(t),
  };
}

function randomizesSpots(r) {
  return r.count > 1 || r.settings.randomSinglePosition;
}

function buildSpots(r) {
  for (let i = 0; i < r.count; i++) r.spots.push({ pos: null, current: null });
  layout(r);
}

function watchSize(r) {
  const relayout = () => {
    if (r !== run) return;
    layout(r);
    renderDebug(r);
  };
  if (typeof ResizeObserver !== 'undefined') {
    r.observer = new ResizeObserver(relayout);
    r.observer.observe(r.els.gallery);
  } else {
    r.onResize = relayout;
    window.addEventListener('resize', relayout);
  }
}

// Sizes the polaroids for the box and gives every spot a position. Runs at start and on
// every resize; polaroids already on the board move to their spot's new position.
function layout(r) {
  const { clientWidth: width, clientHeight: height } = r.els.gallery;
  if (!width || !height) return;
  r.box = { width, height };
  const fp = footprint(r.settings);
  const rects = cellRects(r.count, width, height);
  // At this scale the grid cells never overlap, so the grid fallback always respects the limit.
  const gridScale = Math.min(1, rects[0].w / fp.w, rects[0].h / fp.h);
  const overlapAllowed = r.settings.maxOverlap > 0;
  let scale;
  if (overlapAllowed) {
    // Start at full size (or whatever lets one polaroid fit the box) and shrink below if needed.
    scale = Math.max(gridScale, Math.min(1, width / fp.w, height / fp.h));
  } else {
    scale = gridScale;
    if (r.count > 1) {
      scale = Math.min(scale, Math.sqrt((MAX_COVERAGE * width * height) / (r.count * fp.w * fp.h)));
    }
  }

  // With overlap allowed, shrink step by step until a random layout respects the limit,
  // down to the grid scale.
  let positions = null;
  for (;;) {
    r.scale = scale;
    r.spotSize = { w: fp.w * scale, h: fp.h * scale };
    for (let t = 0; t < LAYOUT_TRIES && !positions && randomizesSpots(r); t++) {
      positions = randomLayout(r);
    }
    if (positions || !randomizesSpots(r) || !overlapAllowed || scale <= gridScale) break;
    scale = Math.max(gridScale, scale * SHRINK_STEP);
  }
  r.gridFallback = !positions && randomizesSpots(r);
  if (!positions) positions = rects.map((c) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 }));
  r.spots.forEach((spot, i) => {
    spot.pos = positions[i];
    if (spot.current) positionMount(r, spot.current, spot.pos);
  });
}

function randomLayout(r) {
  const positions = [];
  for (let i = 0; i < r.count; i++) {
    const pos = freeSpot(r, positions);
    if (!pos) return null;
    positions.push(pos);
  }
  return positions;
}

// A random centre point where a polaroid fits in the box and no polaroid in `taken` covers
// more than maxOverlap % of it (all footprints are the same size, so this is symmetric).
// At 0 %, a small gap is kept instead.
function freeSpot(r, taken) {
  const { width, height } = r.box;
  const { w, h } = r.spotSize;
  const maxArea = (r.settings.maxOverlap / 100) * w * h;
  const fits = (p, pos) => {
    const dx = Math.abs(p.x - pos.x);
    const dy = Math.abs(p.y - pos.y);
    if (maxArea === 0) return dx >= w + SPOT_GAP || dy >= h + SPOT_GAP;
    return Math.max(0, w - dx) * Math.max(0, h - dy) <= maxArea;
  };
  const along = (size, room) => (room > size ? size / 2 + Math.random() * (room - size) : room / 2);
  for (let i = 0; i < SPOT_TRIES; i++) {
    const pos = { x: along(w, width), y: along(h, height) };
    if (taken.every((p) => fits(p, pos))) return pos;
  }
  return null;
}

function positionMount(r, placed, pos) {
  if (!pos) return;
  placed.mount.style.left = `${pos.x.toFixed(1)}px`;
  placed.mount.style.top = `${pos.y.toFixed(1)}px`;
  placed.mount.style.transform = `translate(-50%, -50%) scale(${r.scale.toFixed(4)})`;
}

// ---------- Polaroids ----------

// Name and handle become separate spans so fitCredit can put them on one line each.
function buildCredit(art, s) {
  const prefix = s.creditPrefix ? `${s.creditPrefix} ` : '';
  if (!(art.artist && s.showHandle && art.handle)) {
    return div('credit', `${prefix}${art.artist || art.handle || '?'}`);
  }
  const credit = div('credit two-part');
  credit.appendChild(span('credit-name', `${prefix}${art.artist}`));
  credit.appendChild(span('credit-sep', ' · '));
  credit.appendChild(span('credit-handle', art.handle));
  return credit;
}

// Name and handle share one line, with a dot, when they fit. Otherwise each gets its own
// line without the dot, and a line still too wide shrinks until it fits. Measured in layout
// px, so the board's scale transform doesn't affect it.
function fitCredit(credit) {
  if (!credit.classList.contains('two-part') || !credit.isConnected) return;
  const lines = credit.querySelectorAll('.credit-name, .credit-handle');
  credit.classList.remove('split');
  lines.forEach((line) => {
    line.style.fontSize = '';
  });
  if (credit.scrollWidth <= credit.clientWidth) return;
  credit.classList.add('split');
  lines.forEach((line) => {
    if (line.scrollWidth > line.clientWidth) {
      // A little margin: handwriting glyphs can overhang their advance width.
      line.style.fontSize = `${((line.clientWidth / line.scrollWidth) * 0.96).toFixed(3)}em`;
    }
  });
}

function div(className, text) {
  const el = document.createElement('div');
  el.className = className;
  if (text !== undefined) el.textContent = text; // streamer input: never innerHTML
  return el;
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function buildPolaroid(art, s) {
  const tilt = (Math.random() * 2 - 1) * s.maxTilt;
  const el = div('polaroid entering');
  el.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`);

  const photo = div('photo');
  const img = document.createElement('img');
  img.alt = '';
  img.src = art.imageUrl;
  photo.appendChild(img);

  const strip = div('strip');
  if (art.caption) strip.appendChild(div('caption', art.caption));
  strip.appendChild(buildCredit(art, s));

  el.appendChild(div('pin'));
  el.appendChild(photo);
  el.appendChild(strip);
  return el;
}

function place(r, spot, art) {
  const mount = div('mount');
  const el = buildPolaroid(art, r.settings);
  mount.appendChild(el);
  r.els.gallery.appendChild(mount);
  const placed = { mount, el, art, placedAt: Date.now() };
  spot.current = placed;
  positionMount(r, placed, spot.pos);

  // Measure now; the caption font may still be loading, see watchFonts.
  fitCredit(el.querySelector('.credit'));
}

// The Google Font can finish loading after a polaroid is placed (even after
// document.fonts.ready, if its stylesheet arrives late) and changes text widths,
// so every credit is re-fitted whenever a font load completes.
function watchFonts(r) {
  if (!document.fonts || !document.fonts.addEventListener) return;
  r.onFontsLoaded = () => {
    if (r !== run) return;
    r.els.gallery.querySelectorAll('.credit.two-part').forEach(fitCredit);
  };
  document.fonts.addEventListener('loadingdone', r.onFontsLoaded);
  if (document.fonts.ready) document.fonts.ready.then(r.onFontsLoaded);
}

function unpin(r, placed) {
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    placed.mount.remove();
  };
  placed.el.addEventListener('animationend', (e) => {
    if (e.target === placed.el && e.animationName === 'polaroid-lift-fall') remove();
  });
  placed.el.classList.add('leaving');
  // Fallback in case animationend is lost.
  later(r, remove, r.settings.transitionSeconds * 1000 + 100);
}

function visibleSlots(r) {
  return new Set(r.spots.filter((s) => s.current).map((s) => s.current.art.slot));
}

async function fillInitial(r) {
  const transitionMs = r.settings.transitionSeconds * 1000;
  r.busy = true;
  for (let i = 0; i < r.spots.length; i++) {
    if (i > 0) await wait(r, INITIAL_STAGGER_MS);
    const art = await loadNext(r, visibleSlots(r));
    if (r !== run) return;
    if (art) {
      place(r, r.spots[i], art);
      logEvent(r, `placed slot ${art.slot}`);
    }
  }
  later(r, () => {
    r.busy = false;
  }, transitionMs);
}

// Empty spots (left by failed loads) are filled first. Otherwise the oldest polaroid, or
// in random mode any polaroid except the one replaced last time.
function pickSpot(r) {
  const empty = r.spots.find((s) => !s.current);
  if (empty) return empty;
  if (r.settings.replaceMode === 'random' && r.spots.length > 1) {
    const choices = r.spots.filter((s) => s !== r.lastReplaced);
    return choices[Math.floor(Math.random() * choices.length)];
  }
  return r.spots.reduce((oldest, s) => (s.current.placedAt < oldest.current.placedAt ? s : oldest));
}

// One rotation step: swap out one polaroid; the new one lands on a fresh random spot.
async function tick() {
  const r = run;
  if (!r || r.count === 0) return;
  if (r.busy) {
    logEvent(r, 'tick skipped: transition still running');
    return;
  }
  r.busy = true;

  const spot = pickSpot(r);
  const leaving = spot.current;
  const exclude = visibleSlots(r);
  // If every artwork is on the board, the leaving one may come back.
  const fallback = new Set(exclude);
  if (leaving) fallback.delete(leaving.art.slot);

  const art = await loadNext(r, exclude, fallback);
  if (r !== run) return;
  if (!art) {
    r.busy = false;
    logEvent(r, 'nothing loaded this tick; waiting for the next one');
    return;
  }

  const transitionMs = r.settings.transitionSeconds * 1000;
  let enterDelay = 0;
  if (leaving) {
    spot.current = null;
    unpin(r, leaving);
    // Single mode waits for the exit so two credits are never visible at once.
    enterDelay = r.count === 1 ? transitionMs : transitionMs * (1 - WALL_OVERLAP);
  }
  r.lastReplaced = spot;
  later(r, () => {
    // Keep the old position if no free one turns up; it is clear of every other spot.
    if (randomizesSpots(r) && r.box) {
      const others = r.spots.filter((s) => s !== spot && s.pos).map((s) => s.pos);
      spot.pos = freeSpot(r, others) || spot.pos;
    }
    place(r, spot, art);
    logEvent(r, leaving ? `replaced slot ${leaving.art.slot} with ${art.slot}` : `placed slot ${art.slot}`);
    later(r, () => {
      r.busy = false;
    }, transitionMs);
  }, enterDelay);
}

// ---------- Diagnostics ----------

function logEvent(r, message) {
  const time = new Date().toTimeString().slice(0, 8);
  r.events.unshift(`${time} ${message}`);
  r.events.length = Math.min(r.events.length, MAX_EVENTS);
  renderDebug(r);
}

function renderDebug(r) {
  const { debug } = r.els;
  const s = r.settings;
  const noArt = r.artworks.length === 0;

  const show = s.debugPanel || (r.editorMode && noArt);
  debug.hidden = !show;
  if (!show) return;

  const warnings = [];
  if (noArt) warnings.push('No artwork: fill at least one Artwork slot');
  if (s.missing.length) {
    warnings.push(`Missing fields, defaults used (re-paste the FIELDS tab): ${s.missing.join(', ')}`);
  }
  if (r.scale < 1) {
    warnings.push(`Widget box too small: polaroids scaled down to ${Math.round(r.scale * 100)}%`);
  }
  if (r.gridFallback) {
    warnings.push('No random layout fits: using the grid (enlarge the box or raise max overlap)');
  }

  let countLine = `Polaroids on screen: ${r.count}`;
  if (r.count < s.polaroidCount) {
    countLine += ` (asked for ${s.polaroidCount}, only ${r.artworks.length} active artwork${r.artworks.length === 1 ? '' : 's'})`;
  }

  const lines = [
    `Polaroid Fanart Gallery v${WIDGET_VERSION}`,
    `Active slots: ${r.artworks.length}${noArt ? '' : ` (${r.artworks.map((a) => a.slot).join(', ')})`}`,
    countLine,
    `Queue: ${r.queue.position()} (${s.orderMode === 'shuffle' ? 'shuffle' : 'slot order'}, replace ${s.replaceMode})`,
    `Failed loads: ${r.failedSlots.size ? Array.from(r.failedSlots).join(', ') : 'none'}`,
    'Last events:',
    ...(r.events.length ? r.events.map((e) => `  ${e}`) : ['  (none yet)']),
  ];
  if (warnings.length) {
    lines.push('Warnings:', ...warnings.map((w) => `  ! ${w}`));
  }
  debug.textContent = lines.join('\n');
}
