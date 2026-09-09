# Arbeitskontext für diese Landkarte

## Was das ist und was es nicht ist

Eine Landkarte zur Orientierung in Projekten mit besonders schützenswerten Daten. Ziel ist
Einordnen, Beurteilen lernen und Kompetenz aufbauen.

Es ist ausdrücklich **kein** Framework, kein Prozess und keine Standardisierung. Es soll auch kein
Regal an Artefakten werden, also keine Terraform-Blueprints, Code-Bibliotheken oder Templates
hinter den Kacheln. Diese Idee wurde nach Feedback verworfen, weil ein wartungspflichtiges
Artefakt hinter jeder Kachel zur Bauruine wird. Wenn ein Vorschlag in diese Richtung geht,
widersprich.

Das Repo ist öffentlich. Es enthält deshalb keine Kundennamen, keine Projektdetails und keine
echten ADRs aus Projekten. Interne War Stories bleiben im Miro-Board und in Vorträgen.

Kein Rechtsrat. Regulatorik veraltet, bei Fristen und Anwendbarkeit auf die Quelle verweisen statt
etwas zu behaupten.

## Die drei Achsen

Jede Kachel wird von drei unabhängigen Achsen eingeordnet. Das ist der Kern des Modells und der
Unterschied zur T-Landkarte, wo Insel, Kategorie und Farbe dasselbe sind.

**Dimension** bestimmt die Farbe:

1. Klassifizierung, welche Daten habe ich
2. Regulatorik, was gilt dafür
3. Architektur, wie baue ich es sicher
4. Betrieb und Nachweise, wie halte ich es sicher und weise es nach
5. Methodik und Quellen, wie gehe ich vor und wo lese ich nach

Die Grenze zwischen 3 und 4 verläuft an einer Testfrage: Entwurfsentscheidung gehört zu 3, etwas
das wiederkehren und nachweisbar sein muss gehört zu 4. Deshalb liegt Audit Logging in 3 und die
Rechte-Rezertifizierung in 4. Rechtliche Pflichten liegen immer in 2, der Prozess dazu in 4, siehe
Meldepflicht nach Art. 33 gegenüber Incident Response.

Dimension 5 ist übergreifend, nicht gleichrangig. Sie liegt als Insel-Bereich auf der Karte, weil
ein Ring um alles zu teuer war, ist in der Legende aber als Vorgehensfrage formuliert.

**Insel** ist der fachliche Bereich. Der Kern ist branchenneutral, Archipele enthalten nur
Domänenspezifisches. Was allgemein gilt, bleibt im Kern und wird von dort referenziert, statt im
Archipel gedoppelt zu werden.

**Bereich** ist die zweite Ebene innerhalb einer Insel.

## Regeln für Kacheln

Eine Kachel steht für einen Begriff, den jemand tatsächlich nachschlagen würde. Varianten gehören
in den Text. Aus Access Control, RBAC, ABAC und Need-to-Know wurde deshalb eine Kachel.

Keine Gruppen-Kacheln, die eine Liste verstecken. Die Hierarchie steckt in `area`, nicht in
Ober- und Unterkacheln. Die Karte bleibt bei zwei Ebenen, Tiefe kommt in den Kacheltext.

`aliases` immer füllen, das ist der Grund, warum jemand eine Kachel auch mit einem anderen Wort
findet.

`what` und `why` sind Pflicht, `when` beschreibt den konkreten Auslöser und ist das Feld, das im
Checklisten-Export als Begründung erscheint.

## Abgrenzung zur T-Landkarte

https://github.com/qa-thomas-kothmayr/t-landkarte deckt allgemeines Engineering-Handwerk ab,
einschließlich einer Insel Security und Compliance mit Threat Modeling, Verschlüsselung, Secret
Management, IAM und Auditability.

Diese Karte deckt nur ab, was durch schützenswerte Daten spezifisch wird. Bei Überschneidung wird
über das Feld `tlandkarte` dorthin verwiesen und der eigene Text kurz gehalten. Generische
Architekturthemen wie Resilienz, Separation of Concerns oder Defense in Depth wurden bewusst nicht
aufgenommen.

## Layout

Das Layout wird zur Laufzeit aus den Daten berechnet, in `landkarte.json` stehen keine Koordinaten.
Eine Insel hat einen Ursprung im axialen Hexraster, ein Bereich sitzt auf einem groben Raster mit
Abstand `LATTICE` darin, die Kacheln legen sich in Ringen um ihr Bereichs-Sechseck.

`LATTICE` steht auf 3, und daraus folgt die wichtigste Regel: **ein Bereich fasst sechs Kacheln.**
Bei Abstand 3 reicht ein Bereich genau einen Ring weit. Die siebte Kachel landet im zweiten Ring,
und deren Zelle ist die Ring-1-Zelle des Nachbarn. Ob dort tatsächlich zwei Kacheln übereinander
liegen, hängt von der Reihenfolge in `landkarte.json` ab, fällt also nicht zuverlässig auf. Wer
mehr als sechs Kacheln braucht, teilt den Bereich, statt `LATTICE` zu erhöhen. Genau deshalb wurde
`Gesetze & Verordnungen` mit 14 Kacheln in Datenschutzrecht, Pflichten aus der DSGVO, Übermittlung
und Drittland sowie Sicherheits- und Geheimnisschutzrecht aufgeteilt.

Der Abstand war vorher 4 und passte nicht zum Inhalt: fast alle Bereiche haben drei bis fünf
Kacheln und belegten damit nur Ring 1, während das Raster Platz für Ring 2 freihielt. Zwischen den
Bereichen standen dadurch zwei leere Zellen, und der Kern wirkte als Ansammlung von Klecksen statt
als eine Insel. Kein Küstenfaktor konnte das reparieren, weil ein kleiner Faktor Kanäle offen lässt
und ein großer alles zur merkmalslosen Platte verschmilzt.

Die Küstenlinie entsteht daraus, dass unter jeder belegten Zelle ein vergrößertes Sechseck in
Sandfarbe liegt und diese verschmelzen. Die Faktoren stehen in `assets/app.js` in `build`, 2.15 für die
Küste und 3.0 für das Flachwasser. Die Küste behält bei 2.15 ihre Lappen, lässt im Kern aber drei
kleine Lücken zwischen Bereichen offen. Das Flachwasser reicht mit 3.0 darunter hinweg, damit
erscheinen die Lücken als Seen und nicht als Ozeanflecken im Land. Das ist so gewollt, nicht
übersehen.

Die Dimensionsfarben bilden im Kern zusammenhängende Regionen: Klassifizierung im Westen,
Regulatorik im Norden, Betrieb im Nordosten, Architektur in der Mitte und im Süden, Methodik im
Osten. Das ergibt sich aus den `lattice`-Positionen der Bereiche und muss beim Ergänzen erhalten
bleiben. Ein neuer Bereich gehört an eine Position, die an die eigene Farbregion angrenzt.

`fit()` reserviert den Rand in Bildschirmpixeln und nicht in Nutzereinheiten, weil die Inselnamen
in der Übersicht eine feste Bildschirmgröße haben und über `state.bounds` hinausragen. Sonst
schneidet der Rand die Namen der Randinseln ab.

## Beschriftung und Zoomstufen

Es gibt drei Stufen, und beide Schwellen sind abgeleitet und nicht geschätzt.

Unter `AREA_LABELS_ABOVE`, also 0.5, tragen nur die Inselnamen. Die Bereichsnamen behalten in der
Übersicht eine feste Bildschirmgröße von 15px, ihre längste Zeile ist nach dem Umbruch 15 Zeichen
und damit rund 117px breit. Zwei Bereichs-Mittelpunkte liegen 239 Nutzereinheiten auseinander,
117 durch 239 ergibt 0.49. Darunter überschreiben sich die Bereichsnamen gegenseitig.

Zwischen 0.5 und `OVERVIEW_BELOW`, also 0.9, tragen die Bereichsnamen. Darüber die Kacheltitel:
bei 0.9 sind sie 9.2px groß in einem 83px breiten Sechseck, darunter passt der Text nicht mehr
hinein.

Die Bereichsnamen liegen in `layer-area-labels` **über** `layer-tiles`, sonst verdecken die
Kacheln genau die Namen, für die die Kacheltitel ausgeblendet werden. Die gestrichelten
Bereichsringe bleiben in `layer-areas` unter den Kacheln. Die Namen tragen eine Kontur in
Sandfarbe, damit sie sich von der Kachelfarbe darunter lösen.

`--font-map` in `assets/style.css` hält die Kartenschrift an einer Stelle. Eine klassische
Textserife, keine Display-Schrift: die Namen stehen klein und müssen lesbar bleiben. Wer sie
tauscht, ändert diese Variable und den Schriftlink in `index.html`.

## Belebtes Wasser

`layer-sea` liegt als unterste Ebene im `#viewport` und trägt Wellenstriche und Schiffe. Zwei
Eigenschaften sind dabei nicht verhandelbar: die Ebene liegt **unter** der Küste, damit Deko
niemals Inhalt verdeckt, und sie ist `pointer-events: none`, damit sie Klick und Ziehen nicht
abfängt.

Die Streuung ist **gesät** und nicht echt zufällig, `SEA_SEED`. Sonst wandert die Deko bei jedem
Laden, und das wirkt unruhig. Jede Wellenmarke
wird verworfen, wenn sie näher als `SEA_MARGIN` an einer belegten Zelle liegt; das Flachwasser
reicht bis 3.0, die Marken bleiben also im offenen Wasser. Dichte über `WAVE_STEP` und `WAVE_KEEP`.

Das Wellenfeld `state.sea` ist deutlich größer als `state.bounds`. Der Grund steckt in `fit()`:
dort bestimmt die Höhe die Skalierung, waagerecht sieht man deshalb immer über die Karte hinaus.
Auf 3440x1440 sind das 7047 Nutzereinheiten Breite bei 2866 Kartenbreite. `SEA_PAD_X` und
`SEA_PAD_Y` decken jedes Fenster bis 3440 Breite ab, auf noch breiteren kann am linken und
rechten Rand blanker Ozean auftauchen. Innerhalb von `bounds` gilt `WAVE_KEEP`, außerhalb das
dünnere `WAVE_KEEP_OUTER`.

Dazu gehören zwei Grenzen. `zoomAt` klemmt nach außen bei `state.minScale`, und das ist die
Skalierung der Gesamtansicht, die `fit()` setzt: weiter heraus gibt es nichts zu sehen. Und
`clampPan` hält den sichtbaren Bereich im Wellenfeld, ist das Fenster auf einer Achse breiter als
das Feld, wird dort zentriert. Ohne diese beiden Grenzen landet man auf blankem Ozean.

Die Schiffskurse werden zur Laufzeit aus den Inselmitten berechnet, nicht hinterlegt: der Endpunkt
wird aus der Inselmitte heraus geschoben, bis er im Wasser liegt, dann wird ein leichter Bogen
gesucht, dessen Abtastpunkte alle im Wasser liegen. Findet sich keiner, fährt dort kein Schiff.
Damit bleiben die Kurse gültig, wenn sich Insel-Ursprünge ändern. Alle Schiffe fahren mit
`SHIP_SPEED`, die Fahrtdauer folgt aus der Kurslänge, es gibt also keine Laufzeit von Hand.

**Kein `rotate="auto"` an der Fahrt.** Dessen Winkel folgt der Pfadtangente und nicht der
Fahrtrichtung. Das Schiff ist von der Seite gezeichnet, auf einem westlichen Kurs stünde der Mast
damit nach unten, und auf einer Rückfahrt über denselben Kurs führe es rückwärts. Es bleibt
deshalb immer aufrecht, und die Richtung zeigt eine Spiegelung der inneren Gruppe, so wie Schiffe
auf gezeichneten Karten gehalten werden. Aus demselben Grund fährt es nur in eine Richtung; den
Sprung am Kursende verdeckt ein Ein- und Ausblenden, das über `dur` und `begin` an derselben
Zeitachse hängt und damit synchron ist. Die Deckkraft steht als Attribut am Element, denn eine
CSS-Regel würde die Animation überschreiben. Welche Richtung ein Schiff fährt, wird gesät
ausgelost und nicht aus der Lage der Insel abgeleitet: "jede zweite umgekehrt" traf genau die
westlichen Inseln, dann fuhren alle vier nach Osten.

Die Kurse selbst sind unsichtbar. Eine sichtbare Linie zwischen zwei Inseln würde als modellierte
Beziehung gelesen, und Beziehungen sind hier bewusst nicht modelliert.

Die Wellen bewegen sich nicht, die Bewegung tragen allein die Schiffe. Der Grund ist nicht
Geschmack, sondern die Zeichenlast, siehe unten. Bei `prefers-reduced-motion` bleiben auch die
Schiffe stehen; sie müssen dafür in `buildSea` ohne `animateMotion` gebaut werden, weil SMIL
nicht auf CSS hört, und liegen dann auf der Kursmitte.

Ein Fehler in `buildSea` bricht `build` ab, und der Aufruf steht nicht in einem try. Wer dort
etwas ändert, führt den Aufbau danach aus, sonst bleibt die Karte im Fehlerfall stumm leer.

## Warum das Zoomen flüssig bleibt

Beim Zoomen mit dem Trackpad kommen mehr Ereignisse als es Bilder gibt, und unter
`#viewport` hängen rund 1200 Elemente, die bei jeder Änderung der Transformation neu
gezeichnet werden. Sieben Dinge hatten daran gedreht, alle sieben sind behoben und dürfen
nicht zurückkommen:

`.area-label` hatte einen Übergang auf `font-size`. Die Größe ist aber eine Funktion der
Skalierung und wird beim Zoomen bei jedem Rad-Ereignis neu gesetzt. Der Übergang startete
dann jedes Mal eine neue Interpolation, die Beschriftung hing sichtbar hinter dem Zoom her,
und der Text musste dabei je Bild neu umbrochen werden. Auf `font-size` gehört hier kein
Übergang.

`clampPan` las `clientWidth` und der Rad-Empfänger `getBoundingClientRect`, jeweils direkt
vor dem Schreiben der Transformation. Das erzwingt bei jedem Ereignis ein Layout. Die Maße
stehen jetzt in `view` und werden nur in `measure()` geholt, das `fit()` aufruft.

Die Wellen trugen jede eine eigene CSS-Animation. Bei gut 360 Strichen sind das 360
Deckkräfte je Bild.

Der Versuch, das zu retten, indem die Animation an acht Gruppen wanderte, war schlimmer.
Eine Gruppe mit `opacity` unter 1 muss der Browser in einen eigenen Puffer zeichnen, und
die Marken einer Gruppe lagen über das ganze Wellenfeld gestreut. Der Puffer war damit
7466 x 3763 Einheiten groß, bei Skalierung 2.6 rund 19400 x 9780 Pixel, achtmal. Das liegt
über den üblichen Texturgrenzen, der Browser verwirft die Ebene und baut sie neu, und dabei
blitzt der Inselhintergrund weg. **Keine Gruppe über dem Wellenfeld darf eine Deckkraft
unter 1 tragen.** Die Wellen stehen jetzt still und liegen flach in `layer-sea`, ihre
Deckkraft sitzt als `stroke-opacity` am einzelnen Strich. Wer einen Schimmer möchte,
animiert `stroke-opacity` an einer kleinen Teilmenge der Striche.

`vector-effect: non-scaling-stroke` hielt die Striche am Schirm gleich dick, erzwingt aber
je Element eine neue Strichgeometrie, sobald sich die Transformation ändert. Bei 360
Strichen heißt das 360 Neuberechnungen je Zoomschritt. Die Strichbreite steht jetzt in
Nutzereinheiten und ist für das untere Ende des Zoombereichs gewählt.

Die Zahl der Striche selbst zählt, weil jeder Pfad bei jedem Zoomschritt mitgezeichnet
wird. `WAVE_KEEP` und `WAVE_KEEP_OUTER` sind deshalb keine reine Geschmacksfrage.

`applyTransform` lief bei jedem Ereignis. Zoomen und Verschieben gehen jetzt über
`scheduleTransform`, das auf ein Bild bündelt. Das Flag wird **vor** dem Anmelden gesetzt,
sonst käme die Zuweisung erst nach dem Callback zurück und bliebe hängen.

Die Schriftvariablen wurden bei jedem Ereignis geschrieben, auch beim Verschieben, wo sich
die Skalierung gar nicht ändert. Sie werden jetzt nur bei echter Änderung geschrieben.

Dazu wertet der Rad-Empfänger `deltaMode` aus. Ohne das zoomt ein Mausrad, das drei Zeilen
meldet, so gut wie nicht, während ein Trackpad in Pixelschritten zappelt. `WHEEL_MAX`
begrenzt den Betrag je Ereignis, damit eine schnelle Wischbewegung nicht springt.

## Zeilenumbruch in den Beschriftungen

Der Umbruch steckt in `wrap` und `labelFor` in `assets/app.js`. Vier Dinge machen ihn aus, und
alle vier hatten einen sichtbaren Grund:

**Gemessen wird Breite, nicht Zeichenzahl.** `EM` hält grobe Vorschussbreiten in em. Zeichen zu
zählen war zu ungenau: "Zusammenarbeit" mit 14 Zeichen ist schmaler als "Schulungsnachweise" mit
18. Ein Limit in Zeichen ließ deshalb entweder Platz liegen oder lief aus dem Sechseck heraus.
Die Limits sind damit die tatsächliche Geometrie, `TILE_EM` aus der Sechseckbreite und `AREA_EM`
aus dem Bereichsabstand.

**Gebrochen wird an vorhandenen Bindestrichen.** "Architektur-Prinzipien" bricht hinter dem
Bindestrich, statt mitten im zweiten Wort getrennt zu werden, und hinter einen Bindestrich kommt
nie ein zweiter Trennstrich.

**Zeilen werden ausgeglichen, nicht von links vollgefüllt.** Vollfüllen ergab Zeilen wie nur "&"
hinter einer randvollen ersten Zeile. Gesucht ist die kleinste Zeilenzahl, die passt, und darin
die kleinste mögliche längste Zeile.

**Die enge Variante vermeidet Trennungen.** Ein Titel, der in normaler Größe getrennt werden
müsste, wird lieber eine Spur kleiner gesetzt. Das brachte die Zahl der getrennten Kacheltitel
von 55 auf 16.

Was übrig bleibt, sind lange deutsche Zusammensetzungen. Der Notschnitt geht so weit nach rechts
wie die Breite zulässt und lässt mindestens `MIN_FRAG` Zeichen stehen; bei Zusammensetzungen
trifft das die Wortgrenze oft, aber nicht immer. **Wer einen Umbruch erzwingen will, setzt in
`landkarte.json` ein weiches Trennzeichen an die Stelle**, als JSON-Escape `\u00ad` geschrieben,
damit es im Quelltext sichtbar bleibt. Es erscheint nur, wenn dort wirklich umbrochen wird.
`plain()` entfernt es überall sonst: in der Suche würde es sonst mitten im Wort die
Übereinstimmung verhindern, und im Checklisten-Export landete ein unsichtbares Zeichen in der
Datei.

## Der Projektfilter

Die Fragen stehen in `landkarte.json` unter `filters`, und `initFilters`, `activeTags` und
`filterActive` lesen sie von dort. **Eine neue Frage ist eine reine Datenänderung.** Vorher stand
jede Frage an vier Stellen im Code, und drei davon vergisst man beim Ergänzen.

Zwei Regeln zu den Triggern, die aus einer Prüfung der Daten hervorgingen:

**`immer` heißt immer.** DSGVO, Auftragsverarbeitung und Art.-32-Maßnahmen trugen `immer` und
nannten im eigenen `when` die Bedingung, dass es um personenbezogene Daten geht. Ein Projekt mit
nur Geschäftsgeheimnissen bekam damit drei Kacheln vorgesetzt, die für es nicht gelten. Wer eine
Kachel auf `immer` setzt, liest ihr `when` daneben.

Zwei Kacheln behalten `immer` mit Absicht: NIS-2 und der Cyber Resilience Act gelten nicht
überall, aber ob sie gelten, muss jedes Projekt beantworten. Ihr `when` sagt das ausdrücklich.
Ich habe versucht, diese Regel im Prüfskript zu automatisieren, über Signalwörter wie „wenn" und
„sobald" im `when`. Das Ergebnis waren fünf Treffer und kein einziger Fehler; die Prüfung ist
deshalb nicht im Skript, sondern hier. Eine Prüfung, die nur Fehlalarme liefert, macht die
echten Hinweise unsichtbar.

**Ein Trigger reicht selten.** Die Datenart-Optionen zeigten fast nur auf die Kachel, die die
Datenart benennt: „Analytische Daten" wählte genau eine von damals 124 Kacheln aus. Eine Kachel
gehört an jede Eigenschaft, wegen der man sie klären muss.

## Trennhinweise in den Titeln

Lange deutsche Zusammensetzungen brauchen im Titel ein weiches Trennzeichen an der Wortgrenze,
sonst schneidet der Umbruch nach Breite und trifft die Fuge nur zufällig. Vorher stand auf der
Karte `Geschäftsgehei-mnisse`, `Auftragsverarbe-itung` und `Schlüsselverwa-ltung`.

**Zugesichert ist: jeder Trennstrich sitzt an einer in den Daten markierten Stelle.** Die
Zusicherung liegt im JS-Test und nicht im Prüfskript, weil nur dort die echte Umbruchlogik läuft;
eine Nachbildung in Python wäre auseinandergelaufen. Wer eine Kachel mit einem langen Wort
ergänzt, sieht sie anschlagen und legt die Fuge selbst fest.

Diese Zusicherung ist scharf formuliert, weil eine weichere zwei echte Fehler durchgelassen hat.
Die erste Fassung zählte nur, ob ein Titel überhaupt getrennt wurde, und wertete jeden Titel mit
Hinweis als in Ordnung. Beide Fehler landeten den Strich trotzdem mitten im Wort:

`pieceEm` misst ein Stück, das auf ein weiches Trennzeichen endet, unterschiedlich: am Zeilenende
mit Trennstrich, mitten in der Zeile ohne. Vorher zählte das unsichtbare Zeichen als normal
breit. „Zahlungsdienste" plus Hinweis kam damit auf 8.14 em gegen ein Limit von 8.04 und wurde zu
`Zahlungsdie-nsterecht`. **Das unsichtbare Zeichen hat Breite null**, `EM[SHY] = 0`.

`pack` zählt in `hart`, wie oft gegen den Text geschnitten wurde, und `labelFor` entscheidet
danach. Vorher entschied nur, ob überhaupt ein Trennstrich vorkam, und dann verlor die enge
Variante gegen die normale, obwohl sie an der Fuge brach und die normale mitten im Wort:
`Feinabstimm-ungsdaten` statt `Feinabstimmungs-daten`.

Gefunden habe ich den ersten Fehler im gerenderten Bild, nicht im Test. Wer hier etwas ändert,
sieht sich eine Insel als Bild an und liest nicht nur die Zusicherungen.

## Zugriff durch KI-Agenten

Das ist ein erwarteter Hauptfall, nicht ein Nebenweg: jemand gibt der KI den ganzen oder den
gefilterten Kontext, damit sie die Punkte mitdenkt. Zwei Dinge folgen daraus.

`meta.quelle` in `landkarte.json` hält die öffentliche Adresse der Datei. Sie ist damit Teil der
Schnittstelle und keine Beigabe, denn der Agenten-Kontext gibt sie mit, damit ein Modell bei
Bedarf nachladen kann. Wer die Datei umbenennt oder verschiebt, ändert eine Schnittstelle.

`exportAgentContext` benutzt `matching()`, dieselbe Auswahl wie die Karte und der
Checklisten-Export. **Die Filterregel darf es nur einmal geben.** Ein zweites Werkzeug, das
denselben Filter nachbildet, war die verworfene Variante: es hätte still auseinanderlaufen können.
Wer den Kontext ohne Browser braucht, liest `landkarte.json` und wendet die Regel selbst an; sie
steht dafür im README in einer Zeile.

`plain()` läuft über jeden Text, der in den Export geht, sonst landen die weichen Trennzeichen aus
den Daten im Prompt.

## Bedienung

`#map` trägt `user-select: none`. Die Karte enthält Text, und beim Ziehen mit der Maus würde
der Browser ihn sonst markieren, was den Zug unterbricht. Die Regel gilt nur für die Karte, in
den Panels und in der Detailkarte bleibt Text auswählbar.

Verschieben geht von jeder Stelle aus, auch von einer Kachel. Als Ziehen gilt es erst ab
`DRAG_SLOP`, und erst dann übernimmt die Karte den Zeiger. Darunter bleibt es ein Klick und öffnet
die Kachel. Ohne diese Unterscheidung war die Karte an jeder Kachel unbeweglich, ohne dass sich
dafür etwas geöffnet hätte.

**Vor jedem Commit an den Daten `python3 tools/check-landkarte.py` laufen lassen.** Es prüft
Pflichtfelder, Referenzen, die Sechs-Kachel-Grenze, doppelt belegte Zellen und Insel-Abstände.
Die Geometrie im Skript muss zu `assets/app.js` passen, `LATTICE` steht an beiden Stellen.

## Struktur

`index.html` und `landkarte.json` bleiben im Wurzelverzeichnis, weil Pages von dort ausliefert und
der Datenpfad Teil der Schnittstelle für andere Repos ist. Der Viewer liegt in `assets`, die
Werkzeuge in `tools`. Kein `src`-Verzeichnis und kein Build-Schritt, die Seite besteht aus drei
ausgelieferten Dateien und liegt unter
https://qaware.github.io/schuetzenswerte-daten-landkarte/ auf GitHub Pages, aus `main` und dem
Wurzelverzeichnis.

Es gab einmal ein generiertes `standalone.html` samt Bauskript, damit die Karte ohne Webserver
anzusehen war. Beides ist mit dem Livegang entfernt worden. Ein generiertes Abbild im Repo
veraltet still, und genau das war passiert: nach der Layout-Änderung stand dort noch die alte
Karte. Wer so etwas wieder braucht, baut es außerhalb des Repos.

Der Zweig `window.LANDKARTE_DATA` in `start()` stammt aus diesem Bau, ist aber kein Rest. Er ist
die Naht, über die sich `app.js` ohne Browser prüfen lässt: Daten hineingeben, Aufbau laufen
lassen, Ergebnis auslesen. Bitte stehen lassen.

## Offen und bewusst nicht gebaut

Beziehungen zwischen Kacheln, also `requires` oder `mitigates`. Nachbarschaft trägt Bedeutung,
wird aber erst modelliert, wenn klar ist, wofür.

Das echte Auflösen eines Bereichs-Sechsecks in seine Kacheln beim Hineinzoomen. Aktuell blenden
nur die Beschriftungen um. Mit berechneten Koordinaten ist der Schritt nachträglich möglich.

Der Data Act und der Zugang zu Reparatur- und Wartungsinformationen fehlen noch. Beides ist
horizontales Recht und gehört deshalb in den Kern, nicht in den Automotive-Archipel, auch wenn
Automotive dort der Paradefall ist. Im Kern hat `Sicherheits- & Geheimnisschutzrecht` Platz dafür.

Reifegrad und Verantwortliche pro Kachel, sobald mehrere Personen pflegen.

## Ton

Keine Werbephrasen und keine Catchy Titles, das war explizites Feedback. Sachlich formulieren,
Kachelnamen nüchtern halten.
