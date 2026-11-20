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
const AREA_LABELS_ABOVE = 0.55; // ab hier passen die Bereichsnamen nebeneinander.
                               // Abgeleitet: zwei Bereichs-Mittelpunkte liegen 239
                               // Nutzereinheiten auseinander, die breiteste Zeile nach dem
                               // Umbruch ist "Entwurf für Betrieb" mit 8.72 em, bei 15px
                               // Bildschirmschrift also 131px. 131 / 239 ergibt 0.55.
                               // Darunter würden sich die Bereichsnamen überlappen, dort
                               // stehen nur Inselnamen. Wer AREA_EM ändert, rechnet das neu.
const OVERVIEW_BELOW = 0.9;    // unterhalb dieser Skalierung nur Bereichsnamen.
                               // Abgeleitet, nicht geschätzt: die Kacheltitel stehen mit
                               // 10.2px in Nutzereinheiten, auf dem Schirm also 10.2 * scale.
                               // Bei 0.9 sind das 9.2px, darunter wird es unlesbar. Dass der
                               // Text ins Sechseck passt, sichert TILE_EM ab.

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
   3440x1440 sind das 7785 Nutzereinheiten Breite bei 2866 Kartenbreite. Die
   Zuschläge decken jedes Fenster bis 3440 Breite ab, darüber kann am linken und
   rechten Rand blanker Ozean auftauchen.
   Achtung: die Werte hängen an der Kartenhöhe. Wächst die Karte, sinkt die
   Skalierung der Gesamtansicht und der sichtbare Bereich wird breiter. Wer eine
   Insel vergrößert, rechnet das nach; der Test prüft es für fünf Fenstergrößen. */
const SEA_PAD_X = 2500;
const SEA_PAD_Y = 600;
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
  filters: {},        // wird in initFilters() aus data.filters aufgebaut
  lastFocus: null,
  dragged: false,    // wurde der letzte Zeigerzug zum Verschieben benutzt
  antw: null         // Zwischenspeicher von answers() während eines Durchlaufs
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

/* ---------- Textumbruch ---------- */

const HYPHEN = '\u2011';  // nicht umbrechender Bindestrich, bleibt am Wortende stehen
const SHY = '\u00ad';     // weiches Trennzeichen in den Daten, erlaubte Bruchstelle
                          // Als Escape geschrieben: U+00AD ist im Quelltext unsichtbar.
const MIN_FRAG = 5;       // kleinstes Bruchstück, das eine erzwungene Trennung stehen lässt
const MAX_LINES = 5;

/* Gemessen wird in geschätzter Breite, nicht in Zeichen. Zeichen zu zählen war zu grob:
   "Zusammenarbeit" mit 14 Zeichen ist schmaler als "Schulungsnachweise" mit 18, ein Limit
   in Zeichen lässt deshalb entweder Platz liegen oder läuft aus dem Sechseck heraus. Die
   Werte sind Vorschussbreiten einer humanistischen Groteske in em, grob geschätzt und kein
   Ersatz für echte Metriken, aber ein ganzes Stück näher an der Wahrheit. */
const EM_DEFAULT = 0.55;
const EM = {};
for (const c of "iljtI.,;:!|'’ ") EM[c] = 0.29;
for (const c of 'fr()[]-' + HYPHEN)  EM[c] = 0.36;
for (const c of 'mw')                EM[c] = 0.85;
for (const c of 'MW')                EM[c] = 0.88;
for (const c of 'ABCDEFGHJKLNOPQRSTUVXYZÄÖÜ&') EM[c] = 0.66;
EM[SHY] = 0;              // unsichtbar, solange dort nicht umbrochen wird
const emOf = c => EM[c] === undefined ? EM_DEFAULT : EM[c];
function textEm(s) { let n = 0; for (const c of s) n += emOf(c); return n; }

/* Ein weiches Trennzeichen in den Daten ist nur für den Umbruch da. Überall, wo der Titel
   als Text weiterverwendet wird, muss es weg: in der Suche würde es sonst mitten im Wort
   die Übereinstimmung verhindern, und im Checklisten-Export landete ein unsichtbares
   Zeichen in der Datei. */
const plain = s => (s || '').split(SHY).join('');

/* Platz im Sechseck. Es ist 2 * R breit, also 92 Nutzereinheiten; TILE_PAD lässt Rand,
   weil die Beschriftung mittig sitzt und ein Sechseck oben und unten schmaler wird. Das
   Limit ist damit die tatsächliche Geometrie und keine geratene Zeichenzahl. */
const TILE_PAD = 10;
const TILE_EM = (2 * R - TILE_PAD) / 10.2;        // normale Kachelschrift
const TILE_EM_TIGHT = (2 * R - TILE_PAD) / 8.8;   // enge Variante, passt mehr Text
/* Bereichsnamen stehen frei über der Insel. Hier begrenzt nicht das Sechseck, sondern der
   Abstand zweier Bereiche, siehe AREA_LABELS_ABOVE. */
const AREA_EM = 8.8;

function hexLabel(title) {
  // Klammerzusätze sind für die Kachel zu lang, im Detail steht der ganze Titel
  if (title.length > 24) {
    const stripped = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (stripped.length >= 6) return stripped;
  }
  return title;
}

/* Ein Titel wird in Stücke zerlegt, zwischen denen umbrochen werden darf: an
   Leerzeichen, nach einem Bindestrich im Wort und an einem weichen Trennzeichen aus den
   Daten. Dadurch bricht "Architektur-Prinzipien" hinter dem Bindestrich, statt mitten im
   zweiten Wort getrennt zu werden. Wer einen bestimmten Umbruch erzwingen will, setzt in
   landkarte.json ein weiches Trennzeichen U+00AD an die gewünschte Stelle; es wird nur
   sichtbar, wenn dort tatsächlich umbrochen wird. */
function pieces(text) {
  const out = [];
  text.trim().split(/\s+/).forEach((word, wi) => {
    let start = 0;
    for (let i = 0; i < word.length - 1; i++) {
      if (word[i] === '-' || word[i] === SHY) {
        out.push({ text: word.slice(start, i + 1), space: wi > 0 && start === 0 });
        start = i + 1;
      }
    }
    out.push({ text: word.slice(start), space: wi > 0 && start === 0 });
  });
  return out;
}

const SPACE_EM = 0.29;

/* Ein Stück, das auf ein weiches Trennzeichen endet, ist unterschiedlich breit: am
   Zeilenende zeigt es einen Trennstrich, mitten in der Zeile nichts. Wer das ignoriert,
   misst das Stück zu breit und zerlegt es noch einmal. Genau das passierte bei
   "Zahlungsdienste" plus Hinweis: es kam auf 8.14 em gegen ein Limit von 8.04 und wurde
   zu "Zahlungsdie-nsterecht", also mitten im Wort statt an der markierten Fuge. */
const pieceEm = (p, letzte) => {
  let t = p.text;
  if (t.endsWith(SHY)) t = t.slice(0, -1) + (letzte ? HYPHEN : '');
  return textEm(t);
};

const lineLen = (ps, i, j) => {
  let n = 0;
  for (let k = i; k <= j; k++) n += pieceEm(ps[k], k === j) + (k > i && ps[k].space ? SPACE_EM : 0);
  return n;
};

function lineText(ps, i, j) {
  let s = '';
  for (let k = i; k <= j; k++) {
    let t = ps[k].text;
    if (t.endsWith(SHY)) t = t.slice(0, -1) + (k === j ? HYPHEN : '');
    s += (k > i && ps[k].space ? ' ' : '') + t;
  }
  return s;
}

/* Ein Stück, das allein nicht in eine Zeile passt, muss getrennt werden. Der Schnitt geht
   so weit nach rechts wie möglich, lässt aber mindestens MIN_FRAG stehen. Bei deutschen
   Zusammensetzungen trifft das die Wortgrenze häufiger als ein mittiger Schnitt, etwa
   "Schutzbedarf-sstufen" statt "Schutzbeda-rfsstufen". Sicher ist das nicht, dafür
   bräuchte es Trennmuster; wer einen Treffer erzwingen will, nimmt U+00AD. */
function splitLong(ps, limit) {
  const out = [];
  const hy = emOf(HYPHEN);
  for (const p of ps) {
    let rest = p.text, space = p.space;
    // Im ungünstigsten Fall steht das Stück am Zeilenende und zeigt seinen Trennstrich
    while (pieceEm({ text: rest }, true) > limit) {
      // So weit nach rechts schneiden, wie die Breite zulässt, aber MIN_FRAG Zeichen
      // stehen lassen, damit keine Zwei-Buchstaben-Waise entsteht.
      let cut = 0, w = 0;
      for (let i = 0; i < rest.length - MIN_FRAG; i++) {
        const nw = w + emOf(rest[i]);
        if (nw + hy > limit) break;
        w = nw;
        cut = i + 1;
      }
      if (cut < MIN_FRAG) break;
      // hart: hier wurde gegen den Text geschnitten, nicht an einer markierten Fuge
      out.push({ text: rest.slice(0, cut) + HYPHEN, space, hart: true });
      rest = rest.slice(cut);
      space = false;
    }
    out.push({ text: rest, space });
  }
  return out;
}

// Passen die Stücke in n Zeilen der Breite w? Von links auffüllen ist dafür optimal.
function fitsLines(ps, w, n) {
  let lines = 1, start = 0;
  for (let k = 0; k < ps.length; k++) {
    if (pieceEm(ps[k], true) > w) return false;
    if (lineLen(ps, start, k) > w) {
      if (++lines > n) return false;
      start = k;
    }
  }
  return true;
}

function pack(ps, w) {
  const lines = [];
  let start = 0;
  for (let k = 0; k < ps.length; k++) {
    if (lineLen(ps, start, k) > w) { lines.push(lineText(ps, start, k - 1)); start = k; }
  }
  lines.push(lineText(ps, start, ps.length - 1));
  return { lines, hart: ps.filter(p => p.hart).length };
}

/* Die Zeilen werden ausgeglichen, nicht von links vollgefüllt. Gesucht ist die kleinste
   Zeilenzahl, die unter das Limit passt, und darin die kleinste mögliche längste Zeile.
   Vollfüllen ergab sonst Zeilen wie nur "&" hinter einer randvollen ersten Zeile. */
function wrap(text, limit) {
  const ps = splitLong(pieces(text), limit);
  const longest = ps.reduce((m, p) => Math.max(m, pieceEm(p, true)), 0.1);
  const total = lineLen(ps, 0, ps.length - 1);
  // Die Suche läuft in Zehntel-em, das ist fein genug und bleibt ganzzahlig.
  for (let n = 1; n <= MAX_LINES; n++) {
    let lo = Math.ceil(longest * 10), hi = Math.max(lo, Math.ceil(total * 10));
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fitsLines(ps, mid / 10, n)) hi = mid; else lo = mid + 1;
    }
    if (lo / 10 <= limit && fitsLines(ps, lo / 10, n)) return pack(ps, lo / 10);
  }
  return pack(ps, Math.max(longest, limit));
}

// Bequemer Zugriff, wo nur die Zeilen gebraucht werden
const wrapLines = (text, limit) => wrap(text, limit).lines;

/* Die enge Variante ist nicht die Notbremse bei zu vielen Zeilen, sondern das Mittel gegen
   erzwungene Trennungen: ein Titel, der in normaler Größe mitten im Wort zerlegt werden
   müsste, wird lieber eine Spur kleiner gesetzt.

   Entscheidend ist `hart`, also die Zahl der Schnitte gegen den Text. Vorher entschied
   nur, ob überhaupt ein Trennstrich vorkam, und dann verlor die enge Variante gegen die
   normale, obwohl sie an der markierten Fuge brach und die normale mitten im Wort:
   "Feinabstimm-ungsdaten" statt "Feinabstimmungs-daten". */
function labelFor(title) {
  const t = hexLabel(title);
  const normal = wrap(t, TILE_EM);
  if (normal.lines.length <= 4 && !normal.hart) return { lines: normal.lines, tight: false };
  const eng = wrap(t, TILE_EM_TIGHT);
  const hilft = eng.hart < normal.hart || (normal.lines.length > 4 && !eng.hart);
  if (hilft && eng.lines.length <= MAX_LINES) {
    return { lines: eng.lines.slice(0, MAX_LINES), tight: true };
  }
  return { lines: normal.lines.slice(0, MAX_LINES), tight: false };
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
    const lines = wrapLines(area.label, AREA_EM);
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
      'aria-label': plain(tile.title) + ', ' + dim.short
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
      id: tile.id, tile, area, el: grp, x: c.x, y: c.y,
      haystack: [tile.title, ...(tile.aliases || []), tile.what, tile.why, tile.when || '']
        .map(plain).join(' ').toLowerCase()
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
  state.byId = Object.fromEntries(state.tiles.map(e => [e.id, e]));
  const kachel = readHash();
  buildProjectPanel(true);
  fit();
  applyHighlight();
  document.getElementById('loading').hidden = true;
  if (filterActive()) document.getElementById('btn-project').click();
  if (kachel && state.byId[kachel]) openDetail(state.byId[kachel]);
}

/* ---------- Adresse ---------- */

/* Kachel und Antworten stehen in der Adresse, damit man eine Kachel oder die Sicht eines
   Projekts als Link weitergeben kann. Die Antworten stehen dort mit ihrer Beschriftung und
   nicht als Index: ein Link bleibt damit gültig, wenn sich die Reihenfolge der Optionen
   ändert, und man kann ihn lesen. Geschrieben wird mit replaceState, sonst füllt jeder
   Klick auf eine Antwort den Verlauf. */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  initFilters();
  for (const q of state.data.filters) {
    const werte = p.getAll(q.id);
    if (!werte.length) continue;
    const idx = werte.map(w => q.options.findIndex(o => o.label === w)).filter(i => i >= 0);
    if (!idx.length) continue;
    if (q.type === 'single') state.filters[q.id] = idx[0];
    else idx.forEach(i => { if (!q.options[i].neutral) state.filters[q.id].add(i); });
  }
  return p.get('kachel');
}

function writeHash() {
  const p = new URLSearchParams();
  for (const q of state.data.filters) {
    const v = state.filters[q.id];
    if (q.type === 'single') {
      if (v !== neutralIndex(q)) p.append(q.id, q.options[v].label);
    } else {
      [...v].sort((a, b) => a - b).forEach(i => p.append(q.id, q.options[i].label));
    }
  }
  if (state.openTile) p.set('kachel', state.openTile);
  const hash = p.toString();
  history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
}

/* Rückmeldung am Knopf selbst: das Icon wird kurz zum Haken. Bei den reinen Icon-Knöpfen
   gibt es keinen Text, den man austauschen könnte, und eine Meldung woanders sieht man nicht. */
function bestaetigen(button, ok, text) {
  const svg = button.querySelector(':scope > svg.icon');
  if (svg && ok) svg.innerHTML = ICONS.check;
  button.classList.toggle('done', ok);
  if (text) document.getElementById('export-status').textContent = text;
  clearTimeout(button._t);
  button._t = setTimeout(() => {
    if (svg) svg.innerHTML = ICONS[button.dataset.icon];
    button.classList.remove('done');
  }, 1600);
}

function copyLink(button) {
  const inPanel = !!button.closest('#project');
  if (!navigator.clipboard) {
    bestaetigen(button, false, inPanel ? 'Der Link steht in der Adresszeile.' : '');
    return;
  }
  navigator.clipboard.writeText(location.href).then(
    () => bestaetigen(button, true, inPanel ? 'Link zu dieser Auswahl kopiert.' : ''),
    () => bestaetigen(button, false, inPanel ? 'Der Link steht in der Adresszeile.' : ''));
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

function buildProjectPanel(keep = false) {
  if (!keep) initFilters();
  const host = document.getElementById('project-fields');
  for (const f of state.data.filters) {
    const group = document.createElement('div');
    group.className = 'qgroup';
    const q = document.createElement('p');
    q.textContent = f.label;
    const opts = document.createElement('div');
    opts.className = 'qopts';

    const nIdx = neutralIndex(f);
    const chips = f.options.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (o.neutral ? ' neutral' : '');
      b.textContent = o.label;
      b.setAttribute('aria-pressed', 'false');
      opts.appendChild(b);
      return b;
    });
    const zeigen = () => {
      const v = state.filters[f.id];
      chips.forEach((b, i) => b.setAttribute('aria-pressed',
        String(f.type === 'single' ? i === v : (v.size ? v.has(i) : i === nIdx))));
    };

    chips.forEach((b, i) => b.addEventListener('click', () => {
      if (f.type === 'single') {
        // Eine Auswahl ist immer gesetzt. Ein Klick auf die gewählte führt zurück
        // auf die neutrale Antwort, sonst gäbe es keinen Weg zurück.
        state.filters[f.id] = state.filters[f.id] === i ? nIdx : i;
      } else {
        const set = state.filters[f.id];
        if (f.options[i].neutral) set.clear();
        else if (set.has(i)) set.delete(i);
        else set.add(i);
      }
      zeigen();
      applyHighlight();
      writeHash();
    }));
    zeigen();

    group.append(q, opts);
    host.appendChild(group);
  }
}

/* Der Filterzustand wird aus den Daten aufgebaut und nicht im Code aufgezählt. Vorher
   stand jede Frage an vier Stellen: in state.filters, in der Tag-Sammlung, in filterActive und
   im Zurücksetzen. Eine neue Frage in landkarte.json brauchte damit vier Codeänderungen,
   und drei davon vergisst man leicht. Jetzt genügt der Eintrag in den Daten.

   Jede Frage hat eine Antwort mit `neutral: true`, die von Anfang an gewählt ist und
   nichts einengt. Vorher war überhaupt nichts gewählt, und dann war nicht zu sehen, ob
   die Karte alles zeigt oder ob die Auswahl nur noch nicht gewirkt hat.

   Wichtig ist, dass die neutrale Antwort keine Tags trägt. Würde sie alle Tags ihres
   Abschnitts tragen, wie es die naheliegende Lesart von "Alle" wäre, dann engte eine
   einzelne Antwort kaum ein: gemessen brachte "Branche Automotive" dann 128 von 155
   Kacheln statt 55, weil die übrigen sechs Fragen weiter alles zuließen. Der Filter
   würde erst wirken, wenn alle sieben Fragen beantwortet sind.

   Der Zustand wird als Index in options gehalten, nicht als Tag-Liste. Die Antwort
   "andere" bei der Branche trägt nämlich auch keine Tags und wäre sonst von der
   neutralen Antwort nicht zu unterscheiden, obwohl sie etwas völlig anderes bedeutet:
   "meine Branche ist keine davon", also keine branchenspezifische Kachel. */
const neutralIndex = q => q.options.findIndex(o => o.neutral);

function initFilters() {
  const f = {};
  for (const q of state.data.filters) {
    f[q.id] = q.type === 'single' ? neutralIndex(q) : new Set();
  }
  state.filters = f;
}

// Eingeengt wird nur, wo die Antwort von der neutralen abweicht.
function filterActive() {
  return state.data.filters.some(q => {
    const v = state.filters[q.id];
    return q.type === 'single' ? v !== neutralIndex(q) : v.size > 0;
  });
}

/* Dreiwertige Auswertung. Rein additiv gedacht konnte "nein" nichts bedeuten, weil es
   wie "egal" keine Tags beiträgt: gemessen lieferten beide in 10 von 15 Fällen genau
   dieselben Kacheln. Hier wird stattdessen je Tag unterschieden, ob die Frage mit ja
   beantwortet ist, mit nein, oder noch offen.

   Bei einer Auswahl gilt: die gewählte Antwort ist ja, die übrigen sind nein. Trägt die
   gewählte Antwort keine Tags, also "nein" bei einer Ja-Nein-Frage oder "andere" bei der
   Branche, dann sind alle Tags der Frage nein. Auf der neutralen Antwort bleibt alles
   offen. */
function answers() {
  const ja = new Set(), nein = new Set();
  for (const q of state.data.filters) {
    const v = state.filters[q.id];
    const nIdx = neutralIndex(q);
    const echte = q.options.filter(o => !o.neutral);
    if (q.type === 'single') {
      if (v === nIdx) continue;                                  // offen
      const gewaehlt = q.options[v];
      const ohneTags = !(gewaehlt.tags || []).length;
      for (const o of echte) {
        const ziel = (!ohneTags && o === gewaehlt) ? ja : nein;
        (o.tags || []).forEach(t => ziel.add(t));
      }
    } else {
      if (!v.size) continue;                                     // offen
      q.options.forEach((o, i) => {
        if (o.neutral) return;
        (o.tags || []).forEach(t => (v.has(i) ? ja : nein).add(t));
      });
    }
  }
  return { ja, nein };
}

/* gesichert: gilt sicher, weil die Kachel immer gilt oder eine Frage mit ja beantwortet
   ist. ausgeschlossen: jeder Grund für sie ist mit nein beantwortet. offen: es hängt an
   einer Frage, die noch nicht beantwortet ist.

   Ist keine Frage beantwortet, ist alles offen. Sonst wären die 29 immer-Kacheln von
   Anfang an hervorgehoben, und die Karte sähe gefiltert aus, ohne dass jemand gefiltert
   hat. */
function classify(entry) {
  if (!filterActive()) return 'offen';
  const { ja, nein } = state.antw || answers();
  const tr = entry.tile.triggers;
  // Auf einer Brancheninsel entscheidet allein die Branche, die übrigen Trigger sind dort
  // kein weiterer Grund. Sonst kam TISAX über "Nachweis nötig" in jedes Versicherungsprojekt:
  // gemessen waren das 11 von 108 Kacheln aus fremden Branchen. Im Kern bleibt ein
  // Branchen-Tag dagegen ein Grund unter mehreren: § 203 gilt für eine Kanzlei über die
  // Datenart, auch wenn die Branche "andere" ist.
  const frage = state.data.islands[state.data.areas[entry.area].island].voraussetzung;
  if (frage) {
    const bedingt = tr.filter(t => voraussetzungsTags(frage).has(t));
    if (bedingt.length) {
      if (bedingt.some(t => ja.has(t))) return 'gesichert';
      return bedingt.every(t => nein.has(t)) ? 'ausgeschlossen' : 'offen';
    }
  }
  if (tr.indexOf('immer') >= 0 || tr.some(t => ja.has(t))) return 'gesichert';
  if (tr.every(t => nein.has(t))) return 'ausgeschlossen';
  return 'offen';
}

const VORAUSSETZUNG = {};
function voraussetzungsTags(frage) {
  if (!VORAUSSETZUNG[frage]) {
    const tags = VORAUSSETZUNG[frage] = new Set();
    const q = state.data.filters.find(f => f.id === frage);
    if (q) q.options.forEach(o => (o.tags || []).forEach(t => tags.add(t)));
  }
  return VORAUSSETZUNG[frage];
}

function zaehleKlassen() {
  state.antw = answers();
  const zahl = { gesichert: 0, offen: 0, ausgeschlossen: 0 };
  for (const e of state.tiles) zahl[classify(e)]++;
  state.antw = null;
  return zahl;
}

// Was der Nutzer tatsächlich angegeben hat, für den Kopf des Agenten-Kontexts.
function antworten() {
  const out = [];
  for (const q of state.data.filters) {
    const v = state.filters[q.id];
    const frage = q.label.replace(/\?$/, '').trim();
    if (q.type === 'single') {
      if (v !== neutralIndex(q)) out.push(frage + ': ' + q.options[v].label);
    } else if (v.size) {
      out.push(frage + ': ' + [...v].map(i => q.options[i].label).join(', '));
    }
  }
  return out;
}

/* Die Auswahl für Liste und Exporte ist genau die Menge der gesicherten Kacheln. Sie
   fragt deshalb classify() und bildet die Regel nicht ein zweites Mal nach. */
function matching() {
  const on = filterActive(), q = state.query;
  state.antw = answers();
  const out = state.tiles.filter(e => {
    if (on && classify(e) !== 'gesichert') return false;
    if (q && !e.haystack.includes(q)) return false;
    return true;
  });
  state.antw = null;
  return out;
}

function applyHighlight() {
  const q = state.query;
  const gefiltert = filterActive();
  state.antw = answers();                       // einmal je Durchlauf, nicht je Kachel
  const zahl = { gesichert: 0, offen: 0, ausgeschlossen: 0 };
  for (const e of state.tiles) {
    const klasse = classify(e);
    zahl[klasse]++;
    const trifft = !q || e.haystack.includes(q);
    // Ausgeschlossen wiegt schwerer als ein Suchtreffer: was ausgeschlossen ist,
    // soll auch dann blass bleiben, wenn der Suchbegriff darin vorkommt.
    const faded = klasse === 'ausgeschlossen' || (q && !trifft);
    const marked = !faded && (klasse === 'gesichert' || !!q);
    // Offen wird nur halb zurückgenommen. Sonst sah eine gesicherte Kachel aus wie jede
    // Kachel auf der unberührten Karte, und die Hervorhebung war nicht zu erkennen.
    const pending = gefiltert && !faded && !marked;
    e.el.classList.toggle('faded', faded);
    e.el.classList.toggle('marked', marked);
    e.el.classList.toggle('pending', pending);
  }
  state.antw = null;
  renderResult(gefiltert);

  const count = document.getElementById('count');
  if (gefiltert) {
    count.textContent = `${zahl.gesichert} gesichert, ${zahl.offen} offen, `
      + `${zahl.ausgeschlossen} ausgeschlossen`;
  } else if (q) {
    count.textContent = `${matching().length} von ${state.tiles.length} Kacheln`;
  } else {
    count.textContent = `${state.tiles.length} Kacheln`;
  }
}

/* Die Ergebnisliste neben der Karte, nach Phase geordnet. Die Karte ist zum Einordnen da,
   die Liste zum Abarbeiten: vorher musste man die hervorgehobenen Sechsecke suchen. */
function byPhase(hits) {
  const groups = {};
  for (const e of hits) (groups[e.tile.phase] ||= []).push(e);
  return Object.entries(state.data.phases)
    .filter(([key]) => groups[key])
    .map(([key, ph]) => [ph, groups[key]]);
}

function renderResult(gefiltert) {
  const beantwortet = state.data.filters.filter(q => {
    const v = state.filters[q.id];
    return q.type === 'single' ? v !== neutralIndex(q) : v.size > 0;
  }).length;
  document.getElementById('answered').textContent = `${beantwortet}/${state.data.filters.length}`;
  const list = document.getElementById('result-list');
  list.textContent = '';
  document.getElementById('result-empty').hidden = gefiltert;
  if (!gefiltert) { document.getElementById('result-count').textContent = ''; return; }
  const hits = matching();
  document.getElementById('result-count').textContent = String(hits.length);
  for (const [ph, entries] of byPhase(hits)) {
    const h = document.createElement('h3');
    h.textContent = `${ph.label} (${entries.length})`;
    const ul = document.createElement('ul');
    for (const e of entries) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'result-item';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = state.data.dimensions[e.tile.dimension].color;
      b.append(sw, plain(e.tile.title));
      b.onclick = () => openDetail(e);
      li.appendChild(b);
      ul.appendChild(li);
    }
    list.append(h, ul);
  }
}

/* Trefferliste unter dem Suchfeld. Vorher hob die Suche nur Sechsecke hervor, die man dann
   auf der Karte finden musste. Treffer im Titel oder in den Synonymen stehen vor Treffern
   im Text. Die Liste folgt nur der Suche, nicht dem Projektfilter: wer ein Wort sucht, will
   die Kachel finden, auch wenn sie für sein Vorhaben ausgeschlossen ist. */
const SEARCH_MAX = 8;
function renderSearch() {
  const box = document.getElementById('search-results');
  const q = state.query;
  box.textContent = '';
  if (!q) { box.hidden = true; return; }
  const rang = e => {
    const kopf = [e.tile.title, ...(e.tile.aliases || [])].map(plain).join(' ').toLowerCase();
    return plain(e.tile.title).toLowerCase().startsWith(q) ? 0 : kopf.includes(q) ? 1 : 2;
  };
  const hits = state.tiles.filter(e => e.haystack.includes(q))
    .map(e => [rang(e), e]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  box.hidden = false;
  if (!hits.length) {
    const p = document.createElement('p');
    p.textContent = 'Kein Treffer.';
    box.appendChild(p);
    return;
  }
  for (const e of hits.slice(0, SEARCH_MAX)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'result-item';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = state.data.dimensions[e.tile.dimension].color;
    const ort = document.createElement('span');
    ort.className = 'ort';
    ort.textContent = plain(state.data.islands[state.data.areas[e.area].island].label);
    b.append(sw, plain(e.tile.title), ort);
    b.onclick = () => openDetail(e);
    box.appendChild(b);
  }
  if (hits.length > SEARCH_MAX) {
    const p = document.createElement('p');
    p.textContent = `${hits.length - SEARCH_MAX} weitere Treffer sind auf der Karte hervorgehoben.`;
    box.appendChild(p);
  }
}

function exportChecklist() {
  const hits = matching();
  const status = document.getElementById('export-status');
  if (!hits.length) { status.textContent = 'Keine Kacheln ausgewählt.'; return; }

  let md = `# Zu klärende Themen für dieses Projekt\n\n`;
  md += `Ausgewählt: ${hits.length} von ${state.tiles.length} Kacheln der Landkarte.\n`;
  if (filterActive()) {
    const z = zaehleKlassen();
    if (z.offen) md += `Weitere ${z.offen} Kacheln hängen an Fragen, die im Projektfilter `
      + `noch nicht beantwortet sind.\n`;
  }
  md += `Das ist eine Orientierung, keine Vollständigkeitszusage und kein Rechtsrat.\n`;
  for (const [ph, entries] of byPhase(hits)) {
    md += `\n## ${ph.label}\n\n`;
    for (const { tile: t } of entries) {
      md += `- [ ] **${plain(t.title)}** — ${plain(t.when || t.why)}\n`;
      if (t.kundenfrage) md += `  Frage an den Kunden: ${plain(t.kundenfrage)}\n`;
      if (t.qaware?.length) md += `  Bei QAware: `
        + t.qaware.map(r => `[${r.label}](${r.url})`).join(', ') + `\n`;
    }
  }

  liefern(md, 'checkliste-schuetzenswerte-daten.md', hits.length + ' Kacheln');
}

/* Derselbe gefilterte Stand, nur ausführlicher: mit what, why und when, damit ein Agent
   damit arbeiten kann, ohne die Datei selbst zu holen. Die Auswahl kommt aus matching(),
   es gibt also keine zweite Filterlogik. */
function exportAgentContext() {
  const hits = matching();
  const status = document.getElementById('export-status');
  if (!hits.length) { status.textContent = 'Keine Kacheln ausgewählt.'; return; }

  const d = state.data;
  const tags = antworten();
  let md = `# Kontext: Umgang mit besonders schützenswerten Daten\n\n`;
  md += `Auszug aus der Landkarte, gefiltert auf dieses Vorhaben.\n`;
  if (d.meta.quelle) md += `Vollständige Daten: ${d.meta.quelle}\n`;
  md += `Ausgewählt: ${hits.length} von ${state.tiles.length} Kacheln.\n`;
  md += tags.length
    ? `Angegeben: ${tags.join('; ')}.\n`
    : `Keine Frage im Projektfilter beantwortet, es sind alle Kacheln enthalten.\n`;
  if (filterActive()) {
    const z = zaehleKlassen();
    if (z.offen) md += `Weitere ${z.offen} Kacheln der Landkarte hängen an Fragen, die noch `
      + `nicht beantwortet sind, und fehlen hier deshalb.\n`;
  }
  md += `\n${d.meta.disclaimer}\n`;
  md += `\nDas Feld „Wann relevant“ sagt, warum eine Kachel für dieses Vorhaben gilt.\n`;

  const byDim = {};
  for (const e of hits) (byDim[e.tile.dimension] ||= []).push(e);
  for (const [key, dim] of Object.entries(d.dimensions)) {
    const list = byDim[key];
    if (!list) continue;
    md += `\n## ${dim.label} — ${dim.frage}\n`;
    for (const e of list) {
      const t = e.tile, area = d.areas[e.area];
      md += `\n### ${plain(t.title)}\n`;
      md += `Ort: ${plain(d.islands[area.island].label)}, Bereich ${plain(area.label)}\n`;
      md += `Zuerst zu klären in: ${d.phases[t.phase].label}\n`;
      md += `Was: ${plain(t.what)}\n`;
      md += `Warum: ${plain(t.why)}\n`;
      if (t.when) md += `Wann relevant: ${plain(t.when)}\n`;
      if (t.kundenfrage) md += `Frage an den Kunden: ${plain(t.kundenfrage)}\n`;
      if (t.tlandkarte) md += `Allgemeines Handwerkszeug dazu: T-Landkarte, ${t.tlandkarte}\n`;
      if (t.qaware?.length) md += `Bei QAware geregelt (internes Confluence): `
        + t.qaware.map(r => `${r.label} ${r.url}`).join('; ') + `\n`;
      if (t.quellen?.length) md += `Quelle: `
        + t.quellen.map(r => `${r.label} ${r.url}`).join('; ') + `\n`;
      if (t.stand) md += `Stand der Kachel: ${standText(t.stand)}\n`;
    }
  }
  liefern(md, 'agenten-kontext-schuetzenswerte-daten.md', hits.length + ' Kacheln');
}

/* Zwischenablage zuerst, Datei nur als Rückfall. Vorher wurde immer zusätzlich eine Datei
   heruntergeladen, auch wenn das Kopieren geklappt hat, und das legt bei jedem Klick eine
   Datei ab, die niemand wollte. */
function liefern(md, dateiname, was) {
  const status = document.getElementById('export-status');
  const herunterladen = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = dateiname;
    a.click();
    URL.revokeObjectURL(a.href);
    status.textContent = was + ' als Datei ' + dateiname + ' gespeichert.';
  };
  const knopf = state.exportKnopf;   // Safari fokussiert Knöpfe beim Klick nicht
  if (!navigator.clipboard) { herunterladen(); return; }
  navigator.clipboard.writeText(md).then(
    () => {
      status.textContent = was + ' in die Zwischenablage kopiert.';
      if (knopf) bestaetigen(knopf, true);
    },
    herunterladen
  );
}

/* ---------- Detailkarte ---------- */

let TAG_LABELS = null;
function tagLabel(tag) {
  if (tag === 'immer') return 'jedem Projekt';
  if (!TAG_LABELS) {
    TAG_LABELS = {};
    for (const f of state.data.filters) {
      for (const o of f.options) {
        // Bei einer Ja-Nein-Frage sagt "ja" allein nichts, dort trägt die Frage die Bedeutung
        const label = (o.label === 'ja' || o.label === 'nein')
          ? f.label.replace(/\?$/, '').trim() : o.label;
        (o.tags || []).forEach(t => TAG_LABELS[t] = label);
      }
    }
  }
  return TAG_LABELS[tag] || tag;
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];
// "2026-11" wird zu "November 2026"
function standText(stand) {
  const [jahr, monat] = stand.split('-');
  return `${MONATE[Number(monat) - 1]} ${jahr}`;
}

function openDetail(entry) {
  const t = entry.tile, d = state.data;
  const dim = d.dimensions[t.dimension];
  const area = d.areas[entry.area];

  const chip = document.getElementById('detail-dimension');
  chip.hidden = false;                                  // die Hilfe versteckt ihn
  document.getElementById('detail-place').hidden = false;
  document.getElementById('detail-triggers').hidden = false;
  chip.textContent = dim.label;
  chip.style.background = dim.color;

  document.getElementById('detail-title').textContent = plain(t.title);
  document.getElementById('detail-place').textContent =
    `${plain(d.islands[area.island].label)}, Bereich ${plain(area.label)}`
    + ` · zuerst zu klären: ${d.phases[t.phase].label}`;

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
  section('Frage an den Kunden', t.kundenfrage);

  if (t.tlandkarte) {
    const h = document.createElement('h3');
    h.textContent = 'Vertiefung';
    const p = document.createElement('p');
    p.append(`Allgemeines Handwerkszeug dazu steht in der T-Landkarte unter „${t.tlandkarte}“. `);
    p.appendChild(externalLink(d.meta.verwandt.url, 'T-Landkarte öffnen'));
    body.append(h, p);
  }

  /* Die Verweise nennen nur, wo es bei QAware geregelt ist, nicht was dort steht: das Repo
     ist öffentlich, die Seiten dahinter nicht. */
  if (t.qaware?.length) {
    const h = document.createElement('h3');
    h.textContent = 'Bei QAware';
    const p = document.createElement('p');
    p.append('Wie das bei uns geregelt ist, steht im Confluence: ');
    t.qaware.forEach((ref, i) => {
      if (i) p.append(', ');
      p.appendChild(externalLink(ref.url, ref.label));
    });
    p.append('.');
    body.append(h, p);
  }

  /* Quellen sind Primärquellen, also Gesetzestext, Behörde oder Herausgeber. Der Stand sagt,
     wann der Kacheltext zuletzt gegen die Quelle geprüft wurde; ein altes Datum ist damit
     eine ehrliche Auskunft und kein Mangel. */
  if (t.quellen?.length) {
    const h = document.createElement('h3');
    h.textContent = 'Quelle';
    const p = document.createElement('p');
    t.quellen.forEach((ref, i) => {
      if (i) p.append(', ');
      p.appendChild(externalLink(ref.url, ref.label));
    });
    body.append(h, p);
  }

  document.getElementById('detail-triggers').textContent =
    'Wird relevant bei: ' + t.triggers.map(tagLabel).join(', ')
    + (t.stand ? ' · Stand: ' + standText(t.stand) : '');
  document.getElementById('detail-actions').hidden = false;
  state.openTile = entry.id;
  writeHash();

  state.lastFocus = document.activeElement;
  document.getElementById('overlay').hidden = false;
  document.getElementById('detail').focus();
}

/* Die Hilfe benutzt dieselbe Karte wie die Kacheldetails. Damit gelten Escape, Klick
   daneben, Fokusrückgabe und das Scrollen ohne zweite Umsetzung. Die Aufzählungen kommen
   aus den Daten, eine neue Insel oder Dimension steht damit automatisch drin. */
function openHelp() {
  const d = state.data;
  document.getElementById('detail-dimension').hidden = true;
  document.getElementById('detail-place').hidden = true;
  document.getElementById('detail-triggers').hidden = true;
  document.getElementById('detail-actions').hidden = true;
  document.getElementById('detail-title').textContent = 'Wie diese Karte funktioniert';

  const body = document.getElementById('detail-body');
  body.textContent = '';
  const el = (name, text, cls) => {
    const n = document.createElement(name);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const abschnitt = (titel, ...knoten) => {
    body.append(el('h3', titel), ...knoten);
  };

  body.append(el('p', 'Die Karte hilft beim Einordnen. Sie ist kein Framework, kein Prozess '
    + 'und kein Rechtsrat.'));

  if (d.meta.zielgruppe) abschnitt('Für wen', el('p', d.meta.zielgruppe));

  abschnitt('So fängst du an',
    el('p', 'Öffne „Mein Projekt“ und beantworte, was du über dein Vorhaben schon weißt. '
      + 'Jede Antwort wirkt sofort, du musst nicht alle Fragen beantworten. Im Reiter „Ergebnis“ '
      + 'steht dann die Liste der Kacheln, die für dein Vorhaben sicher gelten, geordnet nach der '
      + 'Projektphase, in der sie zuerst zu klären sind. Ein Klick öffnet den Text, mit '
      + '„Frage an den Kunden“, wo es eine gibt, und dem Verweis auf die Regelung bei QAware.'),
    el('p', 'Die Adresse im Browser enthält deine Antworten und die geöffnete Kachel. Wer '
      + 'sie weitergibt, gibt die Sicht mit. Beide Exporte holen dieselbe Auswahl als '
      + 'Checkliste oder als Kontext für einen KI-Agenten. Wer einen Agenten die Karte selbst '
      + 'lesen lassen will: die Daten liegen offen als landkarte.json, das Vorgehen steht im '
      + 'README unter „Die Karte per KI-Agent abfragen“.'));

  abschnitt('Was die Karte nach dem Filtern zeigt',
    el('p', 'Kräftig gilt für dein Vorhaben sicher. Halb zurückgenommen hängt noch an einer '
      + 'Frage, die offen ist. Blass gilt nicht. „nein“ ist damit etwas anderes als eine '
      + 'offene Frage: es schließt aus. Auf den Brancheninseln entscheidet allein die Branche: '
      + 'eine Kachel dort bleibt blass, wenn deine Branche eine andere ist, auch wenn eine '
      + 'andere Antwort auf sie passt.'));

  abschnitt('Bedienung',
    el('p', 'Ziehen verschiebt die Karte, Mausrad oder die Tasten + und − zoomen, der Knopf '
      + 'mit dem Rahmen zeigt die Gesamtansicht. Die Suche findet Titel, Synonyme und Kacheltexte. Ganz '
      + 'herausgezoomt tragen nur die Inselnamen, näher heran die Bereichsnamen, noch näher '
      + 'die Kacheltitel.'));

  body.append(el('h3', 'Das Modell dahinter', 'help-part'));

  abschnitt('Drei Achsen',
    el('p', 'Jede Kachel steht an drei Stellen zugleich, und die drei Achsen sind voneinander '
      + 'unabhängig. Das ist der Kern des Modells: die Farbe sagt nichts darüber, wo eine Kachel '
      + 'liegt, und die Lage nichts über ihre Farbe.'));

  const liste = document.createElement('ul');
  liste.className = 'helplist';
  for (const dim of Object.values(d.dimensions)) {
    const li = document.createElement('li');
    const sw = el('span', '', 'swatch');
    sw.style.background = dim.color;
    li.append(sw, el('span', dim.label + ' — ' + dim.frage));
    liste.appendChild(li);
  }
  abschnitt('Die Farbe ist die Dimension',
    el('p', 'Sie sagt, um welche Art von Frage es geht.'),
    liste,
    el('p', 'Die Grenze zwischen Architektur und Betrieb verläuft an einer Testfrage: eine '
      + 'Entwurfsentscheidung gehört zur Architektur, etwas das wiederkehren und nachweisbar '
      + 'sein muss zum Betrieb. Deshalb liegt Audit Logging in der Architektur und die '
      + 'Rechte-Rezertifizierung im Betrieb.'));

  const inseln = document.createElement('ul');
  inseln.className = 'helplist';
  const zahl = {};
  for (const t of Object.values(d.tiles)) {
    const i = d.areas[t.area].island;
    zahl[i] = (zahl[i] || 0) + 1;
  }
  for (const [iid, insel] of Object.entries(d.islands)) {
    inseln.appendChild(el('li', plain(insel.label) + ', ' + zahl[iid] + ' Kacheln'));
  }
  abschnitt('Die Insel ist der fachliche Bereich',
    el('p', 'Der Kern ist branchenneutral und gilt für jedes Vorhaben mit schützenswerten '
      + 'Daten. Die Archipele enthalten nur, was durch eine Branche oder eine Technik zusätzlich '
      + 'hinzukommt. Was allgemein gilt, bleibt im Kern.'),
    inseln);

  abschnitt('Der Bereich ist die zweite Ebene',
    el('p', 'Innerhalb einer Insel gruppiert er zusammengehörende Kacheln. Auf der Karte ist er '
      + 'das gestrichelte Sechseck in der Mitte einer Gruppe und trägt dort den Namen, die '
      + 'Kacheln liegen im Ring darum.'));

  body.append(el('p', d.meta.disclaimer, 'hint'));

  state.lastFocus = document.activeElement;
  document.getElementById('overlay').hidden = false;
  document.getElementById('detail').focus();
}

/* Der Weg von der Liste zurück auf die Karte. Ohne ihn öffnete ein Klick in der Ergebnis-
   oder Trefferliste nur den Text, und wo die Kachel liegt, also Insel, Bereich und
   Nachbarschaft, blieb im Hauptweg ungenutzt. Gezoomt wird mindestens bis zur Stufe der
   Kacheltitel, zentriert im Teil der Karte, den das Panel nicht verdeckt. */
const LOCATE_SCALE = 1.3;
function locate(entry) {
  closeDetail();
  const panel = document.getElementById('project');
  const schmal = view.w < 1000;
  if (schmal && !panel.hidden) document.getElementById('btn-project').click();
  const frei = !schmal && !panel.hidden ? view.w - panel.offsetWidth - 16 : view.w;
  state.scale = Math.max(state.scale, LOCATE_SCALE);
  state.tx = frei / 2 - entry.x * state.scale;
  state.ty = view.h / 2 - entry.y * state.scale;
  applyTransform();
  // Einmal aufleuchten lassen. Die Klasse wird neu gesetzt, damit ein zweiter Klick auf
  // dieselbe Kachel die Animation wieder startet.
  entry.el.classList.remove('located');
  void entry.el.getBoundingClientRect();
  entry.el.classList.add('located');
  clearTimeout(locate.t);
  locate.t = setTimeout(() => entry.el.classList.remove('located'), 2600);
}

function closeDetail() {
  document.getElementById('overlay').hidden = true;
  if (state.openTile) { state.openTile = null; writeHash(); }
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
  // Auf schmalen Schirmen sind die Inseln so klein, dass 21px-Namen ineinanderlaufen.
  const islandPx = view.w < 600 ? 14 : 21;
  const islandFont = overview ? (islandPx / state.scale).toFixed(1) + 'px' : '30px';
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
  const treffer = document.getElementById('search-results');
  search.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    applyHighlight();
    renderSearch();
  });
  // Enter öffnet den ersten Treffer, Escape leert die Suche.
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') treffer.querySelector('.result-item')?.click();
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation();
      search.value = '';
      search.dispatchEvent(new Event('input'));
    }
  });
  // Die Liste bleibt, solange der Fokus im Suchfeld oder in der Liste ist.
  const feld = search.closest('.field');
  feld.addEventListener('focusin', renderSearch);
  feld.addEventListener('focusout', e => {
    if (!feld.contains(e.relatedTarget)) treffer.hidden = true;
  });
  document.getElementById('btn-start').onclick = () => {
    if (document.getElementById('project').hidden) document.getElementById('btn-project').click();
  };
  document.getElementById('detail-locate').onclick = () => {
    const e = state.byId[state.openTile];
    if (e) locate(e);
  };

  const panel = document.getElementById('project');
  const toggle = document.getElementById('btn-project');
  toggle.onclick = () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  document.getElementById('project-close').onclick = () => { toggle.click(); toggle.focus(); };

  const tabs = ['fragen', 'ergebnis'];
  const zeigeReiter = name => {
    for (const t of tabs) {
      const tab = document.getElementById('tab-' + t);
      const an = t === name;
      tab.setAttribute('aria-selected', String(an));
      tab.tabIndex = an ? 0 : -1;
      document.getElementById('pane-' + t).hidden = !an;
    }
    document.querySelector('#project .sheet-body').scrollTop = 0;
  };
  for (const t of tabs) {
    const tab = document.getElementById('tab-' + t);
    tab.onclick = () => zeigeReiter(t);
    // Pfeiltasten wechseln den Reiter, wie es das Tab-Muster erwartet
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = tabs[(tabs.indexOf(t) + 1) % tabs.length];
      zeigeReiter(next);
      document.getElementById('tab-' + next).focus();
    });
  }

  document.getElementById('btn-export').onclick = e => {
    state.exportKnopf = e.currentTarget; exportChecklist();
  };
  document.getElementById('btn-agent').onclick = e => {
    state.exportKnopf = e.currentTarget; exportAgentContext();
  };
  document.getElementById('btn-reset').onclick = () => {
    // Neu aufbauen, damit die neutralen Antworten wieder als gewählt erscheinen
    document.getElementById('project-fields').textContent = '';
    buildProjectPanel();
    document.getElementById('export-status').textContent = '';
    applyHighlight();
    writeHash();
  };
  document.getElementById('btn-share').onclick = e => copyLink(e.currentTarget);
  document.getElementById('detail-link').onclick = e => copyLink(e.currentTarget);

  document.getElementById('btn-help').onclick = openHelp;
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

/* ---------- Icons ---------- */

/* Wenige Icons, nur wo es ein eingeführtes Zeichen gibt: Kette für Link, Klemmbrett für die
   Checkliste, Funken für KI, Pfeil zurück für Zurücksetzen. Die Pfade folgen Lucide
   (lucide.dev, ISC-Lizenz), die Funken sind eigene. Inline statt als Bibliothek, weil die
   Seite ohne Build-Schritt aus drei Dateien besteht. Beschriftungen bleiben stehen; nur die
   Zoomknöpfe, Schließen und der Link-Knopf im Panel sind reine Icons, mit title. */
const ICONS = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'
    + '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/>'
    + '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'
    + '<path d="m9 14 2 2 4-4"/>',
  sparkles: '<path d="M11 3l1.8 4.7L17.5 9.5l-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z"/>'
    + '<path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>'
    + '<path d="M12 17h.01"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3'
    + 'M16 21h3a2 2 0 0 0 2-2v-3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8'
    + 'a2 2 0 0 1 2-2h6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pin: '<path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
};

function svgIcon(name, cls = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

// Setzt das Icon vor den Text. Bei data-icon auf einem leeren span ist das Icon allein.
function paintIcons(root = document) {
  for (const n of root.querySelectorAll('[data-icon]')) {
    if (n.querySelector(':scope > svg.icon')) continue;
    n.prepend(svgIcon(n.dataset.icon));
  }
}

// Ein Link nach draußen bekommt den kleinen Pfeil, damit man weiß, dass er die Karte verlässt.
function externalLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.append(text, svgIcon('external', 'icon icon-inline'));
  return a;
}

/* ---------- Start ---------- */

async function start() {
  paintIcons();
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
