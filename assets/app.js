/* Landkarte: Umgang mit besonders schützenswerten Daten
   Layout wird aus landkarte.json berechnet, es stehen keine Koordinaten in den Daten.
   Insel -> Ursprung im Hexraster, Bereich -> Cluster, Kacheln -> Ringe um den Bereich. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 46;                  // Hexradius in Nutzereinheiten
const LATTICE = 3;             // Abstand zweier Bereichs-Mittelpunkte in Hexzellen.
                               // Bei 3 bleibt ein Bereich auf Ring 1, also höchstens sechs
                               // Kacheln. Wächst er auf Ring 2, ist dessen Zelle die Ring-1-
                               // Zelle des Nachbarn und die Kacheln überlappen.
                               // check-landkarte.py prüft das.
const AREA_LABELS_ABOVE = 0.5; // ab hier passen die Bereichsnamen nebeneinander.
                               // Abgeleitet: zwei Bereichs-Mittelpunkte liegen 239
                               // Nutzereinheiten auseinander, die längste Zeile nach dem
                               // Umbruch hat 15 Zeichen und ist bei 15px Bildschirmschrift
                               // rund 117px breit. 117 / 239 ist 0.49. Darunter würden sich
                               // die Bereichsnamen überlappen, dort stehen nur Inselnamen.
const OVERVIEW_BELOW = 0.9;    // unterhalb dieser Skalierung nur Bereichsnamen.
                               // Abgeleitet, nicht geschätzt: die Kacheltitel stehen mit 9.5px
                               // in Nutzereinheiten, auf dem Schirm also 9.5 * scale. Bei 0.62
                               // wären das 5.9px, und 13 Zeichen Zeile bräuchten 69px in einem
                               // 57px breiten Sechseck. Ab 0.9 passt der Text und ist lesbar.

const DRAG_SLOP = 4;           // Bildschirmpixel, ab denen aus einem Klick ein Ziehen wird
const WHEEL_LINE = 16;         // Pixel je Zeile, wenn das Gerät deltaMode 1 meldet
const WHEEL_MAX = 120;         // Betrag je Rad-Ereignis, begrenzt schnelle Wischbewegungen

/* Belebtes Wasser. Alles davon liegt in layer-sea, also unter der Küste, und ist
   pointer-events: none. Die Streuung ist gesät und nicht echt zufällig, damit die Karte
   bei jedem Laden gleich aussieht. */
const SEA_SEED = 20260908;
const WAVE_STEP = 160;         // Rasterweite der Wellenstriche in Nutzereinheiten
/* Jeder Strich ist ein Pfad, der bei jedem Zoomschritt mitgezeichnet wird. Die Zahl ist
   deshalb keine reine Geschmacksfrage: sie war der größte Posten, den das Seeleben zu den
   rund 960 übrigen Elementen unter #viewport hinzugefügt hat. Draußen deutlich dünner,
   dort schaut man selten hin. */
const WAVE_KEEP = 0.62;
const WAVE_KEEP_OUTER = 0.10;
/* Das Wellenfeld muss größer sein als die Karte. Bei fit bestimmt die Höhe die
   Skalierung, waagerecht sieht man deshalb immer über die Karte hinaus: auf
   3440x1440 sind das 7047 Nutzereinheiten Breite bei 2866 Kartenbreite. Die
   Zuschläge decken jedes Fenster bis 3440 Breite ab, darüber kann am linken und
   rechten Rand blanker Ozean auftauchen. */
const SEA_PAD_X = 2300;
const SEA_PAD_Y = 550;
const SEA_MARGIN = 3.3;        // Abstand zur Küste in Hexradien, Flachwasser reicht bis 3.0
const SHIP_SPEED = 6;          // Nutzereinheiten je Sekunde, daraus folgt die Fahrtdauer

const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

/* Fenstermaße gepuffert. clampPan und der Zoom brauchen sie bei jedem Rad-Ereignis;
   ein Lesen von clientWidth erzwingt dort ein Layout, direkt gefolgt von einem Schreiben
   der Transformation. Das ist Layout-Thrashing und der Zoom ruckelt davon. */
const view = { w: 0, h: 0, left: 0, top: 0 };

function measure() {
  const svg = document.getElementById('map');
  const r = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { left: 0, top: 0 };
  view.w = svg.clientWidth;
  view.h = svg.clientHeight;
  view.left = r.left;
  view.top = r.top;
}

const state = {
  data: null,
  tiles: [],          // { id, tile, cell, el, hex, label, haystack }
  scale: 1, tx: 0, ty: 0,
  minScale: 0.2,      // wird in fit() auf die Skalierung der Gesamtansicht gesetzt
  bounds: null,
  sea: null,          // Wellenfeld, größer als bounds
  query: '',
  filters: { branche: null, daten: new Set(), pb: false, cloud: false, ki: false, drittland: false },
  lastFocus: null,
  dragged: false     // wurde der letzte Zeigerzug zum Verschieben benutzt
};

/* ---------- Hexgeometrie (flat top, axiale Koordinaten) ---------- */

const center = (q, r) => ({
  x: 1.5 * R * q,
  y: Math.sqrt(3) * R * (r + q / 2)
});

// Umkehrung von center(): zu welcher Zelle gehört ein Punkt
function cellAt(x, y) {
  const q = x / (1.5 * R), r = y / (Math.sqrt(3) * R) - q / 2;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - (-q - r));
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

// Liegt der Punkt in dem um factor vergrößerten Sechseck der Zelle?
function inHex(px, py, q, r, factor) {
  const c = center(q, r), inr = R * factor * Math.cos(Math.PI / 6);
  const dx = px - c.x, dy = py - c.y;
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 6 + Math.PI / 3 * k;
    if (Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) > inr) return false;
  }
  return true;
}

function hexPath(q, r, factor = 1) {
  const c = center(q, r), rad = R * factor;
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i;
    d += (i ? 'L' : 'M') + (c.x + rad * Math.cos(a)).toFixed(2) + ' ' + (c.y + rad * Math.sin(a)).toFixed(2);
  }
  return d + 'Z';
}

function ring(q, r, radius) {
  const out = [];
  let cq = q + DIRS[4][0] * radius, cr = r + DIRS[4][1] * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push([cq, cr]);
      cq += DIRS[side][0];
      cr += DIRS[side][1];
    }
  }
  return out;
}

/* ---------- Textumbruch im Sechseck ---------- */

function hexLabel(title) {
  // Klammerzusätze sind für die Kachel zu lang, im Detail steht der ganze Titel
  if (title.length > 24) {
    const stripped = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (stripped.length >= 6) return stripped;
  }
  return title;
}

function wrap(text, maxChars) {
  const lines = [];
  let line = '';
  for (let word of text.split(/\s+/)) {
    while (word.length > maxChars) {
      const cut = maxChars - 1;
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, cut) + '\u2011');
      word = word.slice(cut);
    }
    const candidate = line ? line + ' ' + word : word;
    if (candidate.length > maxChars && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function labelFor(title) {
  let lines = wrap(hexLabel(title), 13);
  let tight = false;
  if (lines.length > 4) { lines = wrap(hexLabel(title), 16); tight = true; }
  return { lines: lines.slice(0, 5), tight };
}

/* ---------- Aufbau ---------- */

function layout(data) {
  const areaCenter = {}, cellsByIsland = {}, tilesByArea = {};

  for (const [id, t] of Object.entries(data.tiles)) (tilesByArea[t.area] ||= []).push({ id, ...t });

  for (const [aid, area] of Object.entries(data.areas)) {
    const o = data.islands[area.island].origin;
    areaCenter[aid] = [o[0] + LATTICE * area.lattice[0], o[1] + LATTICE * area.lattice[1]];
    (cellsByIsland[area.island] ||= []).push(areaCenter[aid]);
  }

  const placed = [];
  for (const [aid, list] of Object.entries(tilesByArea)) {
    const [cq, cr] = areaCenter[aid];
    const slots = [...ring(cq, cr, 1), ...ring(cq, cr, 2)];
    list.forEach((tile, i) => {
      const cell = slots[i];
      placed.push({ tile, cell, area: aid });
      cellsByIsland[data.areas[aid].island].push(cell);
    });
  }
  return { areaCenter, cellsByIsland, placed };
}

function build(data) {
  state.data = data;
  const { areaCenter, cellsByIsland, placed } = layout(data);

  document.getElementById('subtitle').textContent = data.meta.subtitle;
  document.getElementById('disclaimer').textContent = data.meta.disclaimer;

  const g = id => document.getElementById(id);
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // Küstenlinie: vergrößerte Sechsecke verschmelzen zu einer Landmasse.
  // 2.15 lässt der Küste ihre Lappen, hinterlässt im Kern aber drei kleine Lücken
  // zwischen Bereichen. Das Flachwasser reicht mit 3.0 darunter hinweg, die Lücken
  // werden dadurch zu Seen statt zu Ozeanflecken im Land.
  for (const cells of Object.values(cellsByIsland)) {
    for (const [q, r] of cells) {
      g('layer-shallow').appendChild(el('path', { d: hexPath(q, r, 3.0), class: 'shallow' }));
      g('layer-coast').appendChild(el('path', { d: hexPath(q, r, 2.15), class: 'coast' }));
    }
  }

  // Bereiche
  for (const [aid, area] of Object.entries(data.areas)) {
    const [q, r] = areaCenter[aid], c = center(q, r);
    g('layer-areas').appendChild(el('path', { d: hexPath(q, r, 0.92), class: 'area-ring' }));
    const lines = wrap(area.label, 15);
    const text = el('text', { class: 'area-label', x: c.x, y: c.y - (lines.length - 1) * 7 + 4 });
    lines.forEach((ln, i) => {
      const ts = el('tspan', { x: c.x, dy: i ? '1.15em' : 0 });
      ts.textContent = ln;
      text.appendChild(ts);
    });
    g('layer-area-labels').appendChild(text);
  }

  // Kacheln
  for (const { tile, cell, area } of placed) {
    const [q, r] = cell, c = center(q, r);
    const dim = data.dimensions[tile.dimension];
    const grp = el('g', {
      class: 'tile', tabindex: '0', role: 'button',
      'aria-label': tile.title + ', ' + dim.short
    });
    const hex = el('path', { d: hexPath(q, r), class: 'hex', fill: dim.color });
    const { lines, tight } = labelFor(tile.title);
    const text = el('text', {
      class: 'tile-label' + (tight ? ' tight' : ''),
      x: c.x, y: c.y - (lines.length - 1) * (tight ? 4.6 : 5.4) + 3.4
    });
    lines.forEach((ln, i) => {
      const ts = el('tspan', { x: c.x, dy: i ? '1.2em' : 0 });
      ts.textContent = ln;
      text.appendChild(ts);
    });
    grp.append(hex, text);
    g('layer-tiles').appendChild(grp);

    const entry = {
      id: tile.id, tile, area, el: grp,
      haystack: [tile.title, ...(tile.aliases || []), tile.what, tile.why, tile.when || '']
        .join(' ').toLowerCase()
    };
    state.tiles.push(entry);
    grp.addEventListener('click', () => { if (!state.dragged) openDetail(entry); });
    grp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(entry); }
    });
  }

  // Inselnamen über der jeweiligen Landmasse
  for (const [iid, island] of Object.entries(data.islands)) {
    const cells = cellsByIsland[iid] || [];
    if (!cells.length) continue;
    const pts = cells.map(([q, r]) => center(q, r));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const top = Math.min(...pts.map(p => p.y));
    const text = el('text', { class: 'island-label', x: cx, y: top - 2.6 * R });
    text.textContent = island.label;
    g('layer-islands').appendChild(text);
  }

  // Bounds für das Einpassen
  const pts = Object.values(cellsByIsland).flat().map(([q, r]) => center(q, r));
  const pad = 3.4 * R;
  state.bounds = {
    x0: Math.min(...pts.map(p => p.x)) - pad, x1: Math.max(...pts.map(p => p.x)) + pad,
    y0: Math.min(...pts.map(p => p.y)) - pad, y1: Math.max(...pts.map(p => p.y)) + pad
  };

  state.sea = {
    x0: state.bounds.x0 - SEA_PAD_X, x1: state.bounds.x1 + SEA_PAD_X,
    y0: state.bounds.y0 - SEA_PAD_Y, y1: state.bounds.y1 + SEA_PAD_Y
  };

  buildSea(cellsByIsland);
  buildLegend();
  buildProjectPanel();
  fit();
  applyHighlight();
  document.getElementById('loading').hidden = true;
}

/* ---------- Belebtes Wasser ---------- */

// Kleiner gesäter Zufallsgenerator (mulberry32), damit die Karte reproduzierbar bleibt
function seeded(seed) {
  return function () {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildSea(cellsByIsland) {
  const layer = document.getElementById('layer-sea');
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const rnd = seeded(SEA_SEED);
  const still = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Belegte Zellen einmal in eine Menge, die Wasserprüfung fragt sie oft
  const occupied = new Set();
  for (const cells of Object.values(cellsByIsland)) {
    for (const [q, r] of cells) occupied.add(q + ',' + r);
  }
  // Ein Punkt ist Wasser, wenn kein vergrößertes Sechseck einer belegten Zelle ihn deckt.
  // Es reichen die Zellen im Umkreis von zwei, weiter reicht SEA_MARGIN nicht.
  const isWater = (x, y) => {
    const [hq, hr] = cellAt(x, y);
    for (const [q, r] of [[hq, hr], ...ring(hq, hr, 1), ...ring(hq, hr, 2)]) {
      if (occupied.has(q + ',' + r) && inHex(x, y, q, r, SEA_MARGIN)) return false;
    }
    return true;
  };

  /* Wellenstriche auf einem gejitterten Raster über das offene Wasser. Das Feld reicht
     über die Karte hinaus, weil man bei der Gesamtansicht waagerecht darüber hinaussieht.

     Sie liegen flach in layer-sea, ohne Gruppe darüber. Eine Zwischengruppe mit einer
     Deckkraft unter 1 hatte den Inselhintergrund aufblitzen lassen, siehe die Begründung
     bei .wave in style.css. Die Reihenfolge zählt: die Wellen entstehen vor den Schiffen
     und liegen deshalb unter ihnen. */
  const b = state.bounds, f = state.sea;
  const inner = (x, y) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
  let waves = 0;
  for (let y = f.y0; y < f.y1; y += WAVE_STEP) {
    for (let x = f.x0; x < f.x1; x += WAVE_STEP) {
      const px = x + (rnd() - 0.5) * WAVE_STEP * 0.7;
      const py = y + (rnd() - 0.5) * WAVE_STEP * 0.7;
      const keep = rnd() < (inner(px, py) ? WAVE_KEEP : WAVE_KEEP_OUTER);
      const scale = 0.75 + rnd() * 0.5;
      const tilt = (rnd() - 0.5) * 16;
      if (!keep || !isWater(px, py)) continue;
      layer.appendChild(el('path', {
        class: 'wave',
        d: 'M-15 0q7.5 -5 15 0q7.5 5 15 0',
        transform: `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${tilt.toFixed(1)}) scale(${scale.toFixed(2)})`
      }));
      waves++;
    }
  }

  // Schiffskurse. Ein Kurs pro Archipel, vom Kern aus. Die Endpunkte werden aus der
  // Inselmitte heraus verschoben, bis sie im Wasser liegen, dann ein leichter Bogen.
  const mid = {};
  for (const [iid, cells] of Object.entries(cellsByIsland)) {
    const pts = cells.map(([q, r]) => center(q, r));
    mid[iid] = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length
    };
  }
  const pushOut = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy);
    for (let t = 0; t < L; t += R / 3) {
      const p = { x: from.x + dx / L * t, y: from.y + dy / L * t };
      if (isWater(p.x, p.y)) return p;
    }
    return null;
  };
  const clear = (a, c, e) => {
    for (let k = 0; k <= 40; k++) {
      const t = k / 40, u = 1 - t;
      if (!isWater(u * u * a.x + 2 * u * t * c.x + t * t * e.x,
                    u * u * a.y + 2 * u * t * c.y + t * t * e.y)) return false;
    }
    return true;
  };

  let ships = 0, nr = 0;
  for (const iid of Object.keys(cellsByIsland)) {
    if (iid === 'kern' || !mid.kern) continue;
    // Fahrtrichtung gesät auslosen. An die Lage der Insel gekoppelt wäre sie es nicht:
    // "jede zweite umgekehrt" traf hier genau die westlichen Inseln, dann fuhren alle
    // vier nach Osten.
    nr++;
    const hin = rnd() < 0.5;
    const von = hin ? mid.kern : mid[iid], nach = hin ? mid[iid] : mid.kern;
    const a = pushOut(von, nach), e = pushOut(nach, von);
    if (!a || !e) continue;
    const L = Math.hypot(e.x - a.x, e.y - a.y);
    const mx = (a.x + e.x) / 2, my = (a.y + e.y) / 2;
    const nx = -(e.y - a.y) / L, ny = (e.x - a.x) / L;
    // Bogen probieren, sonst gerade. Findet sich nichts Freies, fährt hier kein Schiff.
    let c = null;
    for (const f of [0.12, -0.12, 0.05, -0.05, 0]) {
      const cand = { x: mx + nx * L * f, y: my + ny * L * f };
      if (clear(a, cand, e)) { c = cand; break; }
    }
    if (!c) continue;

    const id = 'sea-route-' + iid;
    layer.appendChild(el('path', {
      id, class: 'sea-route',
      d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`
    }));

    /* Das Schiff ist von der Seite gezeichnet und bleibt deshalb immer aufrecht.
       Kein rotate="auto": dessen Winkel folgt der Pfadtangente, nicht der Fahrt.
       Auf einem westlichen Kurs stünde der Mast nach unten, und auf einer Rückfahrt
       führe das Schiff rückwärts. Die Richtung zeigt stattdessen die Spiegelung,
       so wie Schiffe auf gezeichneten Karten gehalten werden. */
    const ship = el('g', { class: 'ship', opacity: '0.72' });
    const rumpf = el('g', e.x < a.x ? { transform: 'scale(-1 1)' } : {});
    rumpf.appendChild(el('path', { d: 'M-11 2L11 2L8 6L-8 6Z' }));    // Rumpf
    rumpf.appendChild(el('path', { d: 'M0 2L0-11L9-2Z' }));           // Segel
    ship.appendChild(rumpf);

    if (still) {
      // Ohne Bewegung liegt das Schiff auf der Kursmitte, t = 0.5 der Kurve
      const px = 0.25 * a.x + 0.5 * c.x + 0.25 * e.x;
      const py = 0.25 * a.y + 0.5 * c.y + 0.25 * e.y;
      ship.setAttribute('transform', `translate(${px.toFixed(1)} ${py.toFixed(1)})`);
    } else {
      // Eine Geschwindigkeit für alle Schiffe, die Dauer folgt aus der Kurslänge.
      const dur = (L / SHIP_SPEED).toFixed(0);
      const begin = '-' + (rnd() * dur).toFixed(0) + 's';
      const move = el('animateMotion', {
        dur: dur + 's', repeatCount: 'indefinite', begin
      });
      const mpath = el('mpath', { href: '#' + id });
      mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + id);
      move.appendChild(mpath);
      ship.appendChild(move);
      // Am Kursende springt das Schiff zurück an den Anfang. Das Ein- und Ausblenden
      // verdeckt den Sprung und läuft über dieselbe Zeitachse, ist also synchron.
      ship.appendChild(el('animate', {
        attributeName: 'opacity', dur: dur + 's', repeatCount: 'indefinite', begin,
        values: '0;0.72;0.72;0', keyTimes: '0;0.08;0.92;1'
      }));
    }
    layer.appendChild(ship);
    ships++;
  }
  return { waves, ships };
}

function buildLegend() {
  const ul = document.getElementById('legend-list');
  for (const d of Object.values(state.data.dimensions)) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = d.color;
    const label = document.createElement('span');
    label.innerHTML = '';
    label.append(d.short, ' ');
    const frage = document.createElement('span');
    frage.className = 'frage';
    frage.textContent = d.frage;
    label.append(frage);
    li.append(sw, label);
    ul.appendChild(li);
  }
}

/* ---------- Projektfilter ---------- */

function buildProjectPanel() {
  const host = document.getElementById('project-fields');
  for (const f of state.data.filters) {
    const group = document.createElement('div');
    group.className = 'qgroup';
    const q = document.createElement('p');
    q.textContent = f.label;
    const opts = document.createElement('div');
    opts.className = 'qopts';

    const mk = (label, onToggle, pressed = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(pressed));
      b.addEventListener('click', () => {
        const now = b.getAttribute('aria-pressed') !== 'true';
        onToggle(now, b);
        applyHighlight();
      });
      opts.appendChild(b);
      return b;
    };

    if (f.type === 'toggle') {
      mk('ja', (on, b) => {
        state.filters[f.id] = on;
        b.setAttribute('aria-pressed', String(on));
      });
    } else if (f.type === 'single') {
      const buttons = f.options.map(o => mk(o.label, (on, b) => {
        buttons.forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', String(on));
        state.filters.branche = on ? o.tags : null;
      }));
    } else {
      f.options.forEach(o => mk(o.label, (on, b) => {
        b.setAttribute('aria-pressed', String(on));
        const set = state.filters[f.id];
        o.tags.forEach(t => on ? set.add(t) : set.delete(t));
      }));
    }

    group.append(q, opts);
    host.appendChild(group);
  }
}

function activeTags() {
  const tags = new Set();
  if (state.filters.branche) state.filters.branche.forEach(t => tags.add(t));
  state.filters.daten.forEach(t => tags.add(t));
  if (state.filters.pb) tags.add('pb:ja');
  if (state.filters.cloud) tags.add('cloud:hyperscaler');
  if (state.filters.ki) tags.add('ki:ja');
  if (state.filters.drittland) tags.add('drittland:ja');
  return tags;
}

function filterActive() {
  const f = state.filters;
  return f.branche !== null || f.daten.size > 0 || f.pb || f.cloud || f.ki || f.drittland;
}

function matching() {
  const on = filterActive(), tags = activeTags();
  if (on) tags.add('immer');
  const q = state.query;
  return state.tiles.filter(e => {
    if (on && !e.tile.triggers.some(t => tags.has(t))) return false;
    if (q && !e.haystack.includes(q)) return false;
    return true;
  });
}

function applyHighlight() {
  const on = filterActive() || state.query.length > 0;
  const set = new Set(matching().map(e => e.id));
  for (const e of state.tiles) {
    const hit = set.has(e.id);
    e.el.classList.toggle('faded', on && !hit);
    e.el.classList.toggle('marked', on && hit);
  }
  const count = document.getElementById('count');
  count.textContent = on
    ? `${set.size} von ${state.tiles.length} Kacheln`
    : `${state.tiles.length} Kacheln`;
}

function exportChecklist() {
  const hits = matching();
  const status = document.getElementById('export-status');
  if (!hits.length) { status.textContent = 'Keine Kacheln ausgewählt.'; return; }

  const byDim = {};
  for (const e of hits) (byDim[e.tile.dimension] ||= []).push(e.tile);

  let md = `# Zu klärende Themen für dieses Projekt\n\n`;
  md += `Ausgewählt: ${hits.length} von ${state.tiles.length} Kacheln der Landkarte.\n`;
  md += `Das ist eine Orientierung, keine Vollständigkeitszusage und kein Rechtsrat.\n`;
  for (const [key, dim] of Object.entries(state.data.dimensions)) {
    const list = byDim[key];
    if (!list) continue;
    md += `\n## ${dim.label}\n\n`;
    for (const t of list) md += `- [ ] **${t.title}** — ${t.when || t.why}\n`;
  }

  navigator.clipboard?.writeText(md).then(
    () => status.textContent = 'In die Zwischenablage kopiert.',
    () => status.textContent = 'Kopieren nicht möglich, bitte Datei herunterladen.'
  );

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = 'checkliste-schuetzenswerte-daten.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Detailkarte ---------- */

let TAG_LABELS = null;
function tagLabel(tag) {
  if (tag === 'immer') return 'jedem Projekt';
  if (!TAG_LABELS) {
    TAG_LABELS = {};
    for (const f of state.data.filters) {
      if (f.type === 'toggle') f.tags.forEach(t => TAG_LABELS[t] = f.label.replace(/\?$/, '').trim());
      else f.options.forEach(o => o.tags.forEach(t => TAG_LABELS[t] = o.label));
    }
  }
  return TAG_LABELS[tag] || tag;
}

function openDetail(entry) {
  const t = entry.tile, d = state.data;
  const dim = d.dimensions[t.dimension];
  const area = d.areas[entry.area];

  const chip = document.getElementById('detail-dimension');
  chip.textContent = dim.label;
  chip.style.background = dim.color;

  document.getElementById('detail-title').textContent = t.title;
  document.getElementById('detail-place').textContent =
    `${d.islands[area.island].label}, Bereich ${area.label}`;

  const body = document.getElementById('detail-body');
  body.textContent = '';
  const section = (heading, text) => {
    if (!text) return;
    const h = document.createElement('h3');
    h.textContent = heading;
    const p = document.createElement('p');
    p.textContent = text;
    body.append(h, p);
  };
  section('Was ist das?', t.what);
  section('Warum ist das wichtig?', t.why);
  section('Wann wird es relevant?', t.when);

  if (t.tlandkarte) {
    const h = document.createElement('h3');
    h.textContent = 'Vertiefung';
    const p = document.createElement('p');
    p.append(`Allgemeines Handwerkszeug dazu steht in der T-Landkarte unter „${t.tlandkarte}“. `);
    const a = document.createElement('a');
    a.href = d.meta.verwandt.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'T-Landkarte öffnen';
    p.appendChild(a);
    body.append(h, p);
  }

  document.getElementById('detail-triggers').textContent =
    'Wird relevant bei: ' + t.triggers.map(tagLabel).join(', ');

  state.lastFocus = document.activeElement;
  document.getElementById('overlay').hidden = false;
  document.getElementById('detail').focus();
}

function closeDetail() {
  document.getElementById('overlay').hidden = true;
  state.lastFocus?.focus();
}

/* ---------- Pan und Zoom ---------- */

// Der sichtbare Bereich bleibt im Wellenfeld, sonst schaut man auf blanken Ozean.
// Ist das Fenster breiter als das Feld, wird auf dieser Achse zentriert.
function clampPan() {
  const w = view.w, h = view.h, f = state.sea, s = state.scale;
  if (!f || !w || !h) return;
  state.tx = w / s >= f.x1 - f.x0
    ? (w - (f.x0 + f.x1) * s) / 2
    : Math.min(-f.x0 * s, Math.max(w - f.x1 * s, state.tx));
  state.ty = h / s >= f.y1 - f.y0
    ? (h - (f.y0 + f.y1) * s) / 2
    : Math.min(-f.y0 * s, Math.max(h - f.y1 * s, state.ty));
}

let lastAreaFont = '', lastIslandFont = '';

function applyTransform() {
  clampPan();
  document.getElementById('viewport')
    .setAttribute('transform', `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
  // Drei Stufen: ganz draußen nur Inselnamen, dann die Bereichsnamen, dann die Kacheltitel.
  const overview = state.scale < OVERVIEW_BELOW;
  const world = state.scale < AREA_LABELS_ABOVE;
  document.body.classList.toggle('overview', overview);
  document.body.classList.toggle('world', world);
  // In der Übersicht behalten die Namen eine feste Bildschirmgröße, deshalb durch scale.
  // Nur schreiben, wenn sich der Wert ändert: beim Verschieben bleibt die Skalierung gleich,
  // ein Schreiben würde dort die Stilberechnung aller Bereichstexte umsonst anstoßen.
  const root = document.documentElement.style;
  const areaFont = overview ? (15 / state.scale).toFixed(1) + 'px' : '13px';
  const islandFont = overview ? (21 / state.scale).toFixed(1) + 'px' : '30px';
  if (areaFont !== lastAreaFont) { root.setProperty('--area-font', lastAreaFont = areaFont); }
  if (islandFont !== lastIslandFont) { root.setProperty('--island-font', lastIslandFont = islandFont); }
}

/* Ein Trackpad liefert mehr Rad-Ereignisse als es Bilder gibt. Ohne Bündelung wird die
   Transformation mehrmals je Bild geschrieben und der ganze Baum unter #viewport, gut
   1300 Elemente, jedes Mal neu gezeichnet. */
let pending = false;

// Spät nachgesehen, nicht beim Laden festgelegt: ohne requestAnimationFrame läuft es
// unmittelbar, dann bleibt die Karte auch in einer Umgebung ohne Bildtakt bedienbar.
function raf(fn) {
  return typeof window !== 'undefined' && window.requestAnimationFrame
    ? window.requestAnimationFrame(fn)
    : (fn(), 0);
}

function scheduleTransform() {
  if (pending) return;
  // Das Flag wird vor dem Anmelden gesetzt. Andernfalls käme die Zuweisung erst nach
  // dem Callback zurück, und wenn der unmittelbar läuft, bliebe das Flag hängen und
  // alle weiteren Ereignisse würden verworfen.
  pending = true;
  raf(() => { pending = false; applyTransform(); });
}

function fit() {
  measure();
  const w = view.w, h = view.h;
  const b = state.bounds;
  // Die Inselnamen stehen in der Übersicht mit fester Bildschirmgröße über ihrer
  // Landmasse und ragen damit über state.bounds hinaus, das nur Zellmittelpunkte
  // kennt. Der Rand wird deshalb in Bildschirmpixeln reserviert und nicht in
  // Nutzereinheiten, sonst schneidet er die Namen der Randinseln ab.
  const mx = Math.min(130, w / 6), my = Math.min(70, h / 8);
  state.scale = Math.min((w - 2 * mx) / (b.x1 - b.x0), (h - 2 * my) / (b.y1 - b.y0));
  // Weiter heraus als die Gesamtansicht gibt es nichts zu sehen, deshalb ist das die Grenze.
  state.minScale = state.scale;
  state.tx = (w - (b.x1 + b.x0) * state.scale) / 2;
  state.ty = (h - (b.y1 + b.y0) * state.scale) / 2;
  applyTransform();
}

function zoomAt(factor, cx, cy) {
  const next = Math.min(2.6, Math.max(state.minScale, state.scale * factor));
  const k = next / state.scale;
  state.tx = cx - (cx - state.tx) * k;
  state.ty = cy - (cy - state.ty) * k;
  state.scale = next;
  scheduleTransform();
}

function wireInteraction() {
  const svg = document.getElementById('map');
  let dragging = false, moved = false, lastX = 0, lastY = 0, startX = 0, startY = 0;

  // Verschieben geht von jeder Stelle aus, auch von einer Kachel. Als Ziehen gilt es
  // erst ab DRAG_SLOP, und erst dann wird der Zeiger übernommen. Darunter bleibt es ein
  // Klick und verhält sich unverändert, damit ein leichtes Zittern die Kachel noch öffnet.
  svg.addEventListener('pointerdown', e => {
    dragging = true; moved = false;
    state.dragged = false;
    startX = lastX = e.clientX; startY = lastY = e.clientY;
  });
  svg.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (!moved) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) <= DRAG_SLOP) return;
      moved = true;
      svg.classList.add('dragging');
      svg.setPointerCapture(e.pointerId);
    }
    state.tx += dx; state.ty += dy;
    lastX = e.clientX; lastY = e.clientY;
    scheduleTransform();
  });
  // dragged wird hier gesetzt, weil click erst nach pointerup kommt
  const stop = () => { dragging = false; state.dragged = moved; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);

  /* deltaY kommt je nach Gerät in Pixeln, Zeilen oder Seiten. Ohne Auswertung von
     deltaMode zoomt ein Mausrad, das drei Zeilen meldet, fast gar nicht, während ein
     Trackpad mit Pixeln in winzigen Schritten zappelt. Der Betrag wird begrenzt, sonst
     springt eine schnelle Wischbewegung. */
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    let px = e.deltaY;
    if (e.deltaMode === 1) px *= WHEEL_LINE;
    else if (e.deltaMode === 2) px *= view.h || WHEEL_LINE * 40;
    px = Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, px));
    zoomAt(Math.exp(-px * 0.0015), e.clientX - view.left, e.clientY - view.top);
  }, { passive: false });

  const mid = () => [view.w / 2, view.h / 2];
  document.getElementById('btn-zoom-in').onclick = () => zoomAt(1.3, ...mid());
  document.getElementById('btn-zoom-out').onclick = () => zoomAt(1 / 1.3, ...mid());
  document.getElementById('btn-zoom-fit').onclick = fit;

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    applyHighlight();
  });

  const panel = document.getElementById('project');
  const toggle = document.getElementById('btn-project');
  toggle.onclick = () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  document.getElementById('btn-export').onclick = exportChecklist;
  document.getElementById('btn-reset').onclick = () => {
    state.filters = { branche: null, daten: new Set(), pb: false, cloud: false, ki: false, drittland: false };
    panel.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', 'false'));
    document.getElementById('export-status').textContent = '';
    applyHighlight();
  };

  document.getElementById('detail-close').onclick = closeDetail;
  document.getElementById('overlay').addEventListener('click', e => {
    if (e.target.id === 'overlay') closeDetail();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('overlay').hidden) closeDetail();
      else if (!panel.hidden) toggle.click();
    }
    if (e.target.tagName === 'INPUT') return;
    if (e.key === '+') zoomAt(1.3, ...mid());
    if (e.key === '-') zoomAt(1 / 1.3, ...mid());
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, 150);   // fit() misst selbst neu
  });
}

/* ---------- Start ---------- */

async function start() {
  wireInteraction();
  if (window.LANDKARTE_DATA) { build(window.LANDKARTE_DATA); return; }
  try {
    const res = await fetch('landkarte.json');
    if (!res.ok) throw new Error(res.status);
    build(await res.json());
  } catch (err) {
    document.getElementById('loading').textContent =
      'landkarte.json konnte nicht geladen werden. Den Ordner über einen Webserver ausliefern, etwa mit python3 -m http.server.';
  }
}

start();
