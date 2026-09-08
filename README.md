# Landkarte: Umgang mit besonders schützenswerten Daten

Eine hexagonale Landkarte zur Orientierung in Projekten, in denen besonders schützenswerte Daten
verarbeitet werden. Sie soll einordnen helfen, nicht standardisieren: wenn es etwas gibt, das man
kennen sollte, ist es gut, wenn es auf der Karte steht.

Das Ziel ist Orientierung und Wissensaufbau, kein Prozess und kein Framework.

**Kein Rechtsrat.** Verbindliche Aussagen kommen von Datenschutzbeauftragten, Legal und den
zuständigen Aufsichtsbehörden. Regulatorik veraltet, Stand und Fristen bitte an der Quelle prüfen.

Inspiriert von und gedacht als Ergänzung zur
[T-Landkarte](https://qa-thomas-kothmayr.github.io/t-landkarte/), die allgemeine
Engineering-Kompetenzen abdeckt. Wo sich Themen überschneiden, verweist diese Karte dorthin,
statt sie zu doppeln.

## Bedienung

- Ziehen verschiebt die Karte von jeder Stelle aus, auch von einer Kachel, Mausrad zoomt, `+` und `-` ebenfalls
- Drei Zoomstufen: ganz herausgezoomt die Inselnamen, dann die Bereichsnamen, dann die Kacheltitel
- Klick oder Enter auf eine Kachel öffnet die Details
- Die Suche findet Titel, Synonyme und Kacheltexte
- „Mein Projekt“ hebt die Kacheln hervor, die für ein Vorhaben zu klären sind, und exportiert sie als Markdown-Checkliste

## Lokal starten

```
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen. Alternativ `standalone.html` direkt im Browser öffnen,
das ist eine generierte Einzeldatei mit eingebetteten Daten. Sobald die Seite über GitHub Pages
erreichbar ist, können `standalone.html` und `tools/build-standalone.py` weg.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `landkarte.json` | die Daten, einzige Quelle der Wahrheit |
| `index.html` | die Seite |
| `assets/app.js`, `assets/style.css` | der Viewer |
| `tools/check-landkarte.py` | prüft die Daten, von Hand laufen lassen |
| `tools/build-standalone.py` | erzeugt `standalone.html` |
| `standalone.html` | generiert, nur zum Anschauen ohne Webserver |

`index.html` und `landkarte.json` liegen absichtlich im Wurzelverzeichnis: GitHub Pages liefert
von dort aus, und der Pfad zu den Daten ist Teil der Schnittstelle, siehe „Für Agenten". Der
Viewer holt `landkarte.json` relativ zum Dokument, nicht relativ zum Skript.

## Datenmodell

Drei unabhängige Achsen ordnen jede Kachel ein.

**Dimension** bestimmt die Farbe und beantwortet eine Frage: welche Daten habe ich, was gilt dafür,
wie baue ich es sicher, wie halte ich es sicher und weise es nach, wie gehe ich vor.
Die Grenze zwischen Architektur und Betrieb verläuft an der Frage, ob es eine Entwurfsentscheidung
ist oder etwas, das wiederkehren und nachweisbar sein muss.

**Insel** ist der fachliche Bereich. Der Kern ist branchenneutral, die Archipele enthalten nur
Domänenspezifisches. Was allgemein gilt, bleibt im Kern und wird von dort referenziert.

**Bereich** ist die zweite Ebene innerhalb einer Insel und gruppiert zusammengehörende Kacheln.

```json
"pseudonymisierung": {
  "title": "Pseudonymisierung",
  "area": "maskierung",
  "dimension": "architektur",
  "triggers": ["pb:ja"],
  "aliases": ["pseudonymization", "Ersetzen von Kennungen"],
  "what": "...",
  "why": "...",
  "when": "...",
  "tlandkarte": "Verschlüsselung"
}
```

`triggers` steuert den Projektfilter, mehrere Tags wirken als Oder-Verknüpfung. `immer` heißt, dass
die Kachel in jedem Projekt mit schützenswerten Daten zu klären ist. `aliases` ist für die Suche da
und der Grund, warum jemand die Kachel auch findet, wenn er ein anderes Wort benutzt.

## Kacheln ergänzen

Eine Kachel steht für einen Begriff, den jemand tatsächlich nachschlagen würde. Varianten gehören
in den Text, nicht in eigene Kacheln, sonst wird die Karte unlesbar.

1. Eintrag in `tiles` ergänzen, `area` und `dimension` müssen zu vorhandenen Einträgen passen
2. Neue Bereiche brauchen einen Eintrag in `areas` mit `island` und `lattice`
3. `python3 tools/check-landkarte.py` laufen lassen
4. `python3 tools/build-standalone.py` laufen lassen, wenn `standalone.html` aktuell bleiben soll

Das Layout wird aus den Daten berechnet und steht nicht in der JSON. `lattice` ist die Position
eines Bereichs im groben Raster seiner Insel, die Kacheln ordnen sich in Ringen um den Bereich an.

**Ein Bereich fasst sechs Kacheln.** Die Bereichs-Mittelpunkte liegen drei Hexzellen auseinander,
damit reicht ein Bereich genau einen Ring weit. Ein siebter Eintrag landet im zweiten Ring, und
dessen Zelle ist die Ring-1-Zelle des Nachbarn. Ob dabei wirklich zwei Kacheln übereinander
liegen, hängt von der Reihenfolge in `landkarte.json` ab, fällt also nicht zuverlässig auf.
`tools/check-landkarte.py` prüft genau das, zusammen mit Pflichtfeldern, Referenzen und
Insel-Abständen.
Wer mehr als sechs Kacheln in einem Bereich braucht, teilt den Bereich.

## Für Agenten

`landkarte.json` liegt öffentlich im Repository und ist ohne Umweg lesbar. Der übliche Weg für ein
Projekt-Repo ist ein Verweis in der `CLAUDE.md`, welche Datenklassen vorkommen und welche Kacheln
deshalb gelten. Die exportierte Checkliste aus „Mein Projekt“ eignet sich als Ausgangspunkt.

## Offene Punkte

- Automotive fehlt noch. Mit nur TISAX wäre der Archipel irreführend, sinnvoll wird er mit ISO/SAE 21434, UNECE R155 und R156 sowie Fahrzeug- und Telemetriedaten.
- Beziehungen zwischen Kacheln sind noch nicht modelliert. Nachbarschaft trägt Bedeutung, ist aber bewusst nicht maschinenlesbar, solange nicht klar ist, wofür sie gebraucht wird.
- Der Reifegrad der Kacheln ist unterschiedlich. Ein Feld für Stand und Verantwortliche kommt dazu, sobald mehrere Personen pflegen.

## Lizenz und Weiterverwendung

Code und Inhalte sind getrennt lizenziert, weil die Kacheltexte der eigentliche Wert sind.

| Teil | Lizenz |
| --- | --- |
| Viewer und Werkzeuge: `index.html`, `assets/`, `tools/` | MIT, siehe `LICENSE` |
| Inhalte: `landkarte.json` | CC BY 4.0, siehe `LICENSE-DATA` |

Wer die Kacheltexte weiterverwendet, nennt die Quelle. Damit bleibt Übernahme in eigene
Wissenssammlungen möglich, ohne dass die Herkunft verloren geht.
