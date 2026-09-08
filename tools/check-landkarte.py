#!/usr/bin/env python3
"""Prüft landkarte.json gegen die Regeln, die sonst erst im Browser auffallen.

    python3 tools/check-landkarte.py

Kein CI, von Hand ausführen, bevor ein neuer Bereich oder eine neue Kachel eingecheckt wird.
Die Geometrie muss zu assets/app.js passen: LATTICE und ring() sind dort identisch.
"""

import json
import pathlib
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent

LATTICE = 3          # app.js: Abstand zweier Bereichs-Mittelpunkte in Hexzellen
DRAWN_RINGS = 18     # so viele Kacheln zeichnet app.js, Ring 1 (6) plus Ring 2 (12)

# Bis zu diesem Ring kann ein Bereich wachsen, ohne dass er eine Zelle mit einem
# Nachbarn teilen kann: zwei Mittelpunkte im Abstand LATTICE brauchen r + r < LATTICE.
SAFE_RING = (LATTICE - 1) // 2
SAFE_CAPACITY = 3 * SAFE_RING * (SAFE_RING + 1)
DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]

REQUIRED = ("title", "area", "dimension", "what", "why", "triggers")


def ring(q, r, radius):
    out = []
    cq, cr = q + DIRS[4][0] * radius, r + DIRS[4][1] * radius
    for side in range(6):
        for _ in range(radius):
            out.append((cq, cr))
            cq += DIRS[side][0]
            cr += DIRS[side][1]
    return out


def hexdist(a, b):
    dq, dr = a[0] - b[0], a[1] - b[1]
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


def main(path=None):
    path = pathlib.Path(path) if path else ROOT / "landkarte.json"
    data = json.load(open(path, encoding="utf-8"))
    problems, warnings = [], []

    tiles_by_area = defaultdict(list)
    for tid, tile in data["tiles"].items():
        tiles_by_area[tile.get("area")].append(tid)

    # --- Referenzen und Pflichtfelder -------------------------------------
    for tid, tile in sorted(data["tiles"].items()):
        for field in REQUIRED:
            if not tile.get(field):
                problems.append(f"{tid}: Pflichtfeld '{field}' fehlt oder ist leer")
        if tile.get("area") not in data["areas"]:
            problems.append(f"{tid}: area '{tile.get('area')}' gibt es nicht")
        if tile.get("dimension") not in data["dimensions"]:
            problems.append(f"{tid}: dimension '{tile.get('dimension')}' gibt es nicht")
        if not tile.get("aliases"):
            warnings.append(f"{tid}: aliases ist leer, die Kachel ist nur über ihren Titel zu finden")
        if not tile.get("when"):
            warnings.append(f"{tid}: when fehlt, im Checklisten-Export erscheint dann why als Begründung")

    for aid, area in sorted(data["areas"].items()):
        if area["island"] not in data["islands"]:
            problems.append(f"Bereich {aid}: island '{area['island']}' gibt es nicht")
        if not tiles_by_area.get(aid):
            warnings.append(f"Bereich {aid}: keine Kachel, das Sechseck bleibt leer")

    if problems:
        return report(problems, warnings)

    # --- Layout ------------------------------------------------------------
    center = {}
    for aid, area in data["areas"].items():
        origin = data["islands"][area["island"]]["origin"]
        center[aid] = (origin[0] + LATTICE * area["lattice"][0],
                       origin[1] + LATTICE * area["lattice"][1])

    for aid, tids in sorted(tiles_by_area.items()):
        if len(tids) > DRAWN_RINGS:
            problems.append(f"Bereich {aid}: {len(tids)} Kacheln, gezeichnet werden nur "
                            f"{DRAWN_RINGS}. Die überzähligen fehlen auf der Karte.")

    # Belegte Zellen. Reihenfolge wie in app.js: die Einfügereihenfolge in landkarte.json.
    occupied = defaultdict(list)
    for aid, tids in tiles_by_area.items():
        slots = ring(*center[aid], 1) + ring(*center[aid], 2)
        for slot, tid in zip(slots, tids):
            occupied[slot].append((aid, tid))

    for cell, entries in sorted(occupied.items()):
        if len(entries) > 1:
            names = ", ".join(f"{tid} ({aid})" for aid, tid in entries)
            problems.append(f"Zelle {cell} ist doppelt belegt: {names}")

    doubled = {c: aid for aid, c in center.items()}
    for cell, entries in sorted(occupied.items()):
        if cell in doubled:
            problems.append(f"Zelle {cell} ist der Mittelpunkt von Bereich {doubled[cell]}, "
                            f"dort liegt aber {entries[0][1]}")

    # Der schleichende Fall: ein Bereich wächst über SAFE_CAPACITY hinaus. Dann hängt es
    # von den Nachbarn und der Reihenfolge in landkarte.json ab, ob Kacheln überlappen.
    by_island = defaultdict(list)
    for aid, area in data["areas"].items():
        by_island[area["island"]].append(aid)
    for aid, tids in sorted(tiles_by_area.items()):
        if len(tids) <= SAFE_CAPACITY:
            continue
        island = data["areas"][aid]["island"]
        nachbarn = sorted(b for b in by_island[island]
                          if b != aid and hexdist(center[aid], center[b]) <= LATTICE)
        warnings.append(
            f"Bereich {aid}: {len(tids)} Kacheln, kollisionsfrei sind bei LATTICE={LATTICE} nur "
            f"{SAFE_CAPACITY}. Ob es gut geht, hängt jetzt von den Nachbarn "
            f"({', '.join(nachbarn) or 'keine'}) und der Reihenfolge in landkarte.json ab.")

    # Inseln dürfen sich nicht berühren, sonst verschmelzen die Küstenlinien.
    def island_cells(island):
        cells = []
        for aid in by_island[island]:
            cells.append(center[aid])
            slots = ring(*center[aid], 1) + ring(*center[aid], 2)
            cells += slots[:len(tiles_by_area.get(aid, []))]
        return cells

    cells = {i: island_cells(i) for i in by_island}
    names = sorted(cells)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            d = min(hexdist(a, b) for a in cells[names[i]] for b in cells[names[j]])
            if d < 5:
                warnings.append(f"Inseln {names[i]} und {names[j]}: nur {d} Zellen Abstand, "
                                f"die Küstenlinien verschmelzen ab etwa 5.")

    return report(problems, warnings)


def report(problems, warnings):
    for w in warnings:
        print(f"Hinweis:  {w}")
    for p in problems:
        print(f"FEHLER:   {p}")
    print(f"\n{len(problems)} Fehler, {len(warnings)} Hinweise.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
