#!/usr/bin/env python3
"""Ruft jede Adresse aus `quellen` ab und meldet, welche nicht mehr antworten.

Von Hand laufen lassen, etwa vor einer Durchsicht der Regulatorik:

    python3 tools/check-quellen.py

Das Skript prüft nur, ob eine Adresse erreichbar ist, nicht ob der Kacheltext noch zur
Quelle passt. Dafür ist `stand` da. Einige Stellen beantworten automatische Abrufe mit einer
Prüfseite oder sperren sie, darunter EUR-Lex; das wird als "nicht prüfbar" gemeldet und ist
kein Fehler. Die EU-Rechtsakte lassen sich stattdessen über die CELEX-Nummer beim Amt für
Veröffentlichungen prüfen, siehe CLAUDE.md.
"""
import json
import pathlib
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT = "Mozilla/5.0 (link-check)"
NICHT_PRUEFBAR = {202, 401, 403, 429}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception as err:  # Zeitüberschreitung, DNS, TLS
        return str(err)


def main():
    data = json.load(open(ROOT / "landkarte.json", encoding="utf-8"))
    uses = {}
    for tid, tile in data["tiles"].items():
        for ref in tile.get("quellen", []):
            uses.setdefault(ref["url"], []).append(tid)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(zip(uses, pool.map(fetch, uses)))

    tot, offen = [], []
    for url, status in sorted(results.items()):
        if status == 200:
            continue
        (offen if status in NICHT_PRUEFBAR else tot).append((url, status))

    for url, status in offen:
        print(f"nicht prüfbar ({status}): {url}")
    for url, status in tot:
        print(f"FEHLER ({status}): {url}\n          in: {', '.join(uses[url])}")
    print(f"\n{len(results)} Adressen, {len(tot)} Fehler, {len(offen)} nicht prüfbar.")
    return 1 if tot else 0


if __name__ == "__main__":
    sys.exit(main())
