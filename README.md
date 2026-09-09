# Landkarte: Umgang mit besonders schützenswerten Daten

**https://qaware.github.io/schuetzenswerte-daten-landkarte/**

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
- Weiter heraus als die Gesamtansicht geht nicht, und die Karte lässt sich nicht aus dem Bild schieben
- Klick oder Enter auf eine Kachel öffnet die Details
- „Hilfe“ erklärt die drei Achsen: was die Farben, die Inseln und die Bereiche bedeuten
- Die Suche findet Titel, Synonyme und Kacheltexte
- „Mein Projekt“ hebt die Kacheln hervor, die für ein Vorhaben zu klären sind, und gibt sie als Markdown heraus: als Checkliste für Menschen oder als Kontext für einen KI-Agenten, siehe unten

## Lokal starten

```
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen. Ein Webserver ist nötig, weil der Viewer
`landkarte.json` per `fetch` holt.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `landkarte.json` | die Daten, einzige Quelle der Wahrheit |
| `index.html` | die Seite |
| `assets/app.js`, `assets/style.css` | der Viewer |
| | darin `layer-sea`: Wellen und Schiffe, gesät gestreut, unter der Küste und ohne Ereignisse |
| `tools/check-landkarte.py` | prüft die Daten, von Hand laufen lassen |

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

Die Fragen im Projektfilter stehen selbst in `filters`, und der Viewer liest sie von dort. Eine
neue Frage ist deshalb eine reine Datenänderung, ohne Eingriff in den Code.

`triggers` steuert den Projektfilter, mehrere Tags wirken als Oder-Verknüpfung. `immer` heißt, dass
die Kachel in jedem Projekt mit schützenswerten Daten zu klären ist. `aliases` ist für die Suche da
und der Grund, warum jemand die Kachel auch findet, wenn er ein anderes Wort benutzt.

In `meta` steht neben Titel und Disclaimer die Adresse `quelle`, unter der die Datei öffentlich
liegt. Sie ist Teil der Schnittstelle: der Agenten-Kontext gibt sie mit, damit ein Modell bei
Bedarf die vollständigen Daten nachladen kann.

## Kacheln ergänzen

Eine Kachel steht für einen Begriff, den jemand tatsächlich nachschlagen würde. Varianten gehören
in den Text, nicht in eigene Kacheln, sonst wird die Karte unlesbar.

1. Eintrag in `tiles` ergänzen, `area` und `dimension` müssen zu vorhandenen Einträgen passen
2. Neue Bereiche brauchen einen Eintrag in `areas` mit `island` und `lattice`
3. `python3 tools/check-landkarte.py` laufen lassen
4. Die Kachel auf der Karte ansehen. Bricht der Titel mitten im Wort, ein weiches
   Trennzeichen `\u00ad` an die Wortgrenze setzen, etwa `Geschäfts\u00adgeheimnisse`

Zwei Regeln, die sich nicht prüfen lassen und deshalb hier stehen:

**`immer` heißt immer.** Eine Kachel mit diesem Trigger erscheint in jedem Projekt. Wenn ihr
`when` eine Bedingung nennt, ist entweder der Trigger falsch oder der Text. Das war bei DSGVO,
Auftragsverarbeitung und Art. 32 der Fall: sie trugen `immer` und schrieben daneben, dass sie
personenbezogene Daten voraussetzen. Ein Projekt ohne Personenbezug bekam sie trotzdem.

**Ein Trigger reicht selten.** Eine Kachel gehört an jede Projekteigenschaft, wegen der man sie
klären muss, nicht nur an die eine, die sie benennt. Die Option „Analytische Daten" wählte lange
genau eine Kachel aus, nämlich die, die so hieß; sinnvoll sind auch Anonymisierung,
Pseudonymisierung, Data Masking und Testdaten.

Das Layout wird aus den Daten berechnet und steht nicht in der JSON. `lattice` ist die Position
eines Bereichs im groben Raster seiner Insel, die Kacheln ordnen sich in Ringen um den Bereich an.

**Ein Bereich fasst sechs Kacheln.** Die Bereichs-Mittelpunkte liegen drei Hexzellen auseinander,
damit reicht ein Bereich genau einen Ring weit. Ein siebter Eintrag landet im zweiten Ring, und
dessen Zelle ist die Ring-1-Zelle des Nachbarn. Ob dabei wirklich zwei Kacheln übereinander
liegen, hängt von der Reihenfolge in `landkarte.json` ab, fällt also nicht zuverlässig auf.
`tools/check-landkarte.py` prüft genau das, zusammen mit Pflichtfeldern, Referenzen und
Insel-Abständen.
Wer mehr als sechs Kacheln in einem Bereich braucht, teilt den Bereich.

## Die Karte per KI-Agent abfragen

Die Karte ist bewusst eine einzelne offene Datei, damit ein Agent sie ohne Umweg lesen kann.
Es gibt zwei Wege, und sie unterscheiden sich darin, wer filtert.

### Den Agenten selbst lesen lassen

Die Daten liegen ohne Anmeldung unter einer stabilen Adresse:

```
https://qaware.github.io/schuetzenswerte-daten-landkarte/landkarte.json
```

Rund 110 KB, geschätzt 27.000 Token. Das ist für ein Modell verdaulich, für ein einzelnes
Vorhaben aber mehr als nötig; gefiltert bleiben typisch 10.000 bis 15.000 Token übrig.

**Das Datenmodell in drei Sätzen.** `tiles` enthält die Kacheln, jede mit `title`, `what`, `why`
und `when`. `when` ist der Auslöser und damit der Satz, der als Begründung taugt, warum eine
Kachel für ein Vorhaben gilt. `dimension` und `area` ordnen sie ein, `area` verweist über `island`
auf Kern oder Archipel.

**Die Filterregel in einer Zeile.** Eine Kachel ist relevant, wenn ihr `triggers` den Wert
`immer` enthält oder eine Eigenschaft des Vorhabens. Welche Eigenschaften es gibt, steht in
`filters` in derselben Datei, der Agent braucht also keine weitere Quelle.

**Für die `CLAUDE.md` eines Projekt-Repos**, die Tags an das Vorhaben angepasst:

```
Bei Fragen zu Datenschutz, Datensicherheit und Regulatorik in diesem Projekt:
lies https://qaware.github.io/schuetzenswerte-daten-landkarte/landkarte.json und
berücksichtige die Kacheln, deren "triggers" den Wert "immer" enthalten oder eines
von: branche:automotive, pb:ja, cloud:hyperscaler.
Das Feld "when" sagt, warum eine Kachel hier gilt, "why" warum sie wichtig ist.
Die Karte ist eine Orientierung, kein Rechtsrat und keine Vollständigkeitszusage;
bei Fristen und Anwendbarkeit auf die Quelle verweisen statt etwas zu behaupten.
```

### Den Kontext fertig mitnehmen

Wer nicht möchte, dass der Agent selbst filtert: unter „Mein Projekt“ das Vorhaben beantworten
und **Als Agenten-Kontext kopieren** drücken. In der Zwischenablage liegt dann Markdown mit den
ausgewählten Kacheln samt `what`, `why` und `when`, gruppiert nach Dimension, mit Quellenangabe
und Disclaimer im Kopf. Für ein typisches Vorhaben sind das etwa 12.000 Token.

Der Unterschied zur Schaltfläche daneben: **Als Checkliste kopieren** gibt nur Titel und
Begründung als Aufgabenliste für Menschen, der Agenten-Kontext gibt die Texte mit.

Beide Schaltflächen legen den Inhalt in die Zwischenablage und laden nur dann eine Datei
herunter, wenn das Kopieren nicht möglich ist, etwa weil die Seite nicht über HTTPS läuft.

## Reifegrad der Archipele

Der Kern ist ausgearbeitet. Bei den Archipelen ist die Tiefe unterschiedlich, und das ist keine
Aussage über die Wichtigkeit der Branche, sondern über den Stand der Arbeit:

| Archipel | Kacheln | Stand |
| --- | --- | --- |
| Automotive | 22 | ausgearbeitet, vier Bereiche |
| KI | 15 | ausgearbeitet, vier Bereiche |
| Finanzdienstleistungen | 14 | ausgearbeitet, vier Bereiche, Bank und Versicherung getrennt filterbar |
| MedTech | 8 | tragfähig, Regulatorik Deutschland vollständig |
| Public Sector | 8 | tragfähig, Datenarten noch dünn |

Bei den Finanzdienstleistungen sind Bank und Versicherung **eine Insel mit zwei
Branchenoptionen**. Fünf der vierzehn Kacheln gelten für beide, drei nur für Banken und sechs
nur für Versicherer. Zwei getrennte Inseln hätten die gemeinsamen Kacheln gedoppelt, eine
gemeinsame Option hätte einem Versicherer Bankgeheimnis und PSD2 vorgesetzt.

## Offene Punkte

- Der Data Act und der Zugang zu Reparatur- und Wartungsinformationen fehlen noch. Beides ist horizontales Recht und gehört in den Kern, nicht in den Automotive-Archipel, auch wenn Automotive dort der Paradefall ist.
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
