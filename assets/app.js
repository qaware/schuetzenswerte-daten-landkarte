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
const OVERVIEW_BELOW = 0.9;    // unterhalb dieser Skalierung nur Bereichsnamen.
                               // Abgeleitet, nicht geschätzt: die Kacheltitel stehen mit 9.5px
                               // in Nutzereinheiten, auf dem Schirm also 9.5 * scale. Bei 0.62
                               // wären das 5.9px, und 13 Zeichen Zeile bräuchten 69px in einem
                               // 57px breiten Sechseck. Ab 0.9 passt der Text und ist lesbar.

const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

const state = {
  data: null,
  tiles: [],          // { id, tile, cell, el, hex, label, haystack }
  scale: 1, tx: 0, ty: 0,
  bounds: null,
  query: '',
  filters: { branche: null, daten: new Set(), pb: false, cloud: false, ki: false, drittland: false },
  lastFocus: null
};

/* ---------- Hexgeometrie (flat top, axiale Koordinaten) ---------- */

const center = (q, r) => ({
  x: 1.5 * R * q,
  y: Math.sqrt(3) * R * (r + q / 2)
});

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
    g('layer-areas').appendChild(text);
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
    grp.addEventListener('click', () => openDetail(entry));
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

  buildLegend();
  buildProjectPanel();
  fit();
  applyHighlight();
  document.getElementById('loading').hidden = true;
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
      mk('ja', on => {
        state.filters[f.id] = on;
        opts.querySelector('button').setAttribute('aria-pressed', String(on));
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

function applyTransform() {
  document.getElementById('viewport')
    .setAttribute('transform', `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
  const overview = state.scale < OVERVIEW_BELOW;
  document.body.classList.toggle('overview', overview);
  const root = document.documentElement.style;
  root.setProperty('--area-font', overview ? (15 / state.scale).toFixed(1) + 'px' : '13px');
  root.setProperty('--island-font', overview ? (21 / state.scale).toFixed(1) + 'px' : '30px');
}

function fit() {
  const svg = document.getElementById('map');
  const w = svg.clientWidth, h = svg.clientHeight;
  const b = state.bounds;
  // Die Inselnamen stehen in der Übersicht mit fester Bildschirmgröße über ihrer
  // Landmasse und ragen damit über state.bounds hinaus, das nur Zellmittelpunkte
  // kennt. Der Rand wird deshalb in Bildschirmpixeln reserviert und nicht in
  // Nutzereinheiten, sonst schneidet er die Namen der Randinseln ab.
  const mx = Math.min(130, w / 6), my = Math.min(70, h / 8);
  state.scale = Math.min((w - 2 * mx) / (b.x1 - b.x0), (h - 2 * my) / (b.y1 - b.y0));
  state.tx = (w - (b.x1 + b.x0) * state.scale) / 2;
  state.ty = (h - (b.y1 + b.y0) * state.scale) / 2;
  applyTransform();
}

function zoomAt(factor, cx, cy) {
  const next = Math.min(2.6, Math.max(0.1, state.scale * factor));
  const k = next / state.scale;
  state.tx = cx - (cx - state.tx) * k;
  state.ty = cy - (cy - state.ty) * k;
  state.scale = next;
  applyTransform();
}

function wireInteraction() {
  const svg = document.getElementById('map');
  let dragging = false, moved = false, lastX = 0, lastY = 0;

  svg.addEventListener('pointerdown', e => {
    if (e.target.closest('.tile')) return;
    dragging = true; moved = false;
    lastX = e.clientX; lastY = e.clientY;
    svg.classList.add('dragging');
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!dragging) return;
    state.tx += e.clientX - lastX;
    state.ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved = true;
    applyTransform();
  });
  const stop = () => { dragging = false; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  const mid = () => {
    const r = svg.getBoundingClientRect();
    return [r.width / 2, r.height / 2];
  };
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
    resizeTimer = setTimeout(fit, 150);
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
      'landkarte.json konnte nicht geladen werden. Den Ordner über einen Webserver ausliefern, etwa mit python3 -m http.server, oder standalone.html öffnen.';
  }
}

start();
