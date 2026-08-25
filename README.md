# Modern Warships 3D

Ein browserbasiertes 3D-Seegefecht: sechs Kriegsschiffe mit echten Waffensystemen,
Wellengang, Inseln und KI-Flotten. Läuft komplett offline — kein Build, kein CDN,
keine Assets. Three.js liegt im Repo, alle Schiffe, Effekte und Sounds werden zur
Laufzeit prozedural erzeugt.

![Klassen](https://img.shields.io/badge/Schiffe-6-blue) ![Waffen](https://img.shields.io/badge/Waffensysteme-14-orange)

## Starten

```bash
npm start
```

Der mitgelieferte Server (Node, ohne Abhängigkeiten) liefert das Spiel aus **und**
betreibt die Mehrspieler-Räume. Dann `http://localhost:8080` öffnen, Schiff wählen,
**EINZELGEFECHT** oder **MEHRSPIELER-RAUM**. Beim ersten Klick ins Bild fängt die
Maus die Kamera ein (Pointer Lock), **Esc** gibt sie wieder frei und pausiert.

## Mehrspieler: Mensch gegen Mensch

Zwei Flotten — **Blau gegen Rot** — im selben Raum:

1. **MEHRSPIELER-RAUM** öffnen, Namen eintragen, **RAUM ERSTELLEN**.
2. Den vierstelligen **Raum-Code** an die Mitspieler geben (Button *KOPIEREN*).
3. Alle anderen tragen den Code ein und drücken **RAUM BEITRETEN**.
4. Team und Schiff lassen sich in der Lobby jederzeit wechseln; der Host startet
   mit **AUSLAUFEN**.

* Leere Plätze füllen **Bots** auf, damit jede Flotte drei Schiffe hat.
* Alle Clients erzeugen aus demselben Raum-Seed dieselbe Karte.
* Jeder Client simuliert nur sein eigenes Schiff (der Host zusätzlich die Bots),
  broadcastet 15-mal pro Sekunde seinen Zustand und wird zwischendurch
  interpoliert. Treffer meldet der Schütze, angewendet werden sie beim Getroffenen —
  so kann niemand die eigenen Trefferpunkte verfälschen.
* Wer versenkt wird, wechselt in den **Zuschauermodus**; die Runde endet, wenn eine
  Flotte vollständig auf dem Meeresgrund liegt.

Server auf einem anderen Rechner: `PORT=8080 node server/server.js` starten und die
Adresse dieses Rechners im Browser öffnen.

## Steuerung

| Taste | Funktion |
|---|---|
| `W` / `S` | Schub vor / zurück |
| `A` / `D` | Ruder backbord / steuerbord |
| Maus | Kamera und Zielen |
| Linke Maustaste | aktive Waffe feuern |
| Rechte Maustaste / `Shift` | Zieloptik (Zoom, halbierte Streuung) |
| `E` | Raketen / Torpedos |
| `Q` | Nahbereichswaffe (CIWS / Deckgeschütz) |
| `1` `2` `3` | Waffe wählen |
| `T` | Ziel anvisieren / nächstes Ziel |
| `F` oder `Leertaste` | Spezialfähigkeit |
| `R` | Nachladen |
| `C` / Mausrad | Kameraabstand |
| `G` | Grafikqualität (Hoch / Mittel / Niedrig) |
| `Esc` / `P` | Pause |

## Die sechs Schiffe

| Schiff | Klasse | Bewaffnung | Spezial |
|---|---|---|---|
| **RS Grosa** | Schwerer Schlachtkreuzer | 3× 130-mm-Zwillingstürme, Kalibr-Marschflugkörper, CIWS | Sperrfeuer (doppelte Feuerrate) |
| **USS Vector** | Stealth-Zerstörer | Railgun (durchschlägt Ziele), Lenkflugkörper, CIWS | Tarnkappe (unsichtbar für Radar & KI) |
| **HMS Sentinel** | Aegis-Raketenzerstörer | 127-mm-Schnellfeuer, 8er-VLS-Schwarmsalve, 2× CIWS | Schadenskontrolle (Reparatur) |
| **FNS Vipera** | Schnellangriffs-Korvette | 76-mm-Autokanone, Torpedorohre, CIWS | Nachbrenner (+55 % Tempo) |
| **CVN Leviathan** | Flugzeugträger | Kampfdrohnen-Staffel, Sea-Sparrow, 3× Phalanx | Schutzschirm (−55 % Schaden) |
| **K-431 Nerpa** | Angriffs-U-Boot | 650-mm-Schwertorpedos, Marschflugkörper, Deckgeschütz | Tauchgang (immun gegen Kanonen) |

## Zielen und Schießen

* Der Kreis am Fadenkreuz ist die **Trefferellipse**: so weit streut die aktive
  Waffe auf dieser Entfernung. Rot gestrichelt heißt außer Reichweite.
* Darunter stehen **Entfernung und Flugzeit** — bei 3 s Flugzeit fährt ein
  Zerstörer rund 60 m weit, entsprechend musst du vorhalten.
* Mit einem Ziel (`T`) rechnet die Feuerleitung den **Vorhaltepunkt** aus und
  zeigt ihn als gestrichelten Kreis; die Türme zielen automatisch dorthin.
* Die **Zieloptik** (rechte Maustaste halten) zoomt heran und halbiert die Streuung.
* Treffer quittieren Fadenkreuz-Blitz und **Schadenszahlen**; Salven lassen die
  Kamera zurückschlagen.
* Die Türme sind **seegangsstabilisiert**: die Zielrechnung erfolgt in Weltkoordinaten
  und wird in den Rumpfrahmen zurückgedreht, damit Rollen und Stampfen die Lösung
  nicht verfälschen.

## Gefechtsregeln

* Im Einzelgefecht kämpfst du mit **zwei KI-Begleitschiffen** gegen eine gegnerische Flotte.
* Welle 1 startet mit drei Gegnern; jede weitere Welle bringt einen Gegner mehr
  (bis fünf) sowie mehr Panzerung und bessere Zielgenauigkeit.
* Zwischen den Wellen: 35 % Reparatur, volle Munition, Punktebonus.
* **CIWS schießt selbstständig** anfliegende Raketen und Drohnen ab — Torpedos
  laufen zu tief dafür. Eine große Salve sättigt die Abwehr: nicht alles wird abgefangen.
* Kanonen schießen ballistisch mit Vorhaltepunkt (gestrichelter Kreis), die Türme
  sind seegangsstabilisiert. Torpedos und Raketen brauchen ein Ziel (`T`).
* Der rote Ring markiert die Gefechtsgrenze — außerhalb nimmt dein Schiff Schaden.

## Technik

* **Wasser** — **Gerstner-Wellen**: die Wasserteilchen laufen auf Kreisbahnen, dadurch
  spitze Kämme und flache Täler statt Sinus-Hügel. Dieselbe Wellentabelle
  (`src/math.js`) treibt CPU-seitig den Auftrieb aller Schiffe und erzeugt das GLSL
  für die Oberfläche, damit Physik und Optik nicht auseinanderlaufen können. Dazu
  **echte planare Spiegelung** (die Szene wird ein zweites Mal aus der an der
  Wasserfläche gespiegelten Kamera gerendert, mit schiefer Near-Plane), Fresnel-Mischung,
  Sonnenglitzer, Streulicht in den Kämmen, Gischt an den Wellenkämmen, **Kelvin-Kielwasser
  hinter jedem Schiff** und Brandung an den Stränden.
* **Grafik** — HDR-Renderpfad mit ACES-Tonemapping, Unreal-Bloom, Sonnenschatten,
  IBL-Umgebungsreflexionen aus dem Himmels-Shader, Wolken und Entfernungsnebel.
* **Schiffe** — vollständig prozedural gebaut (`src/shipMesh.js`): gelofteter Rumpf
  aus dem Wasserlinien-Umriss, Aufbauten je Klasse, drehbare Türme mit Rohrelevation,
  VLS-Zellen, Torpedorohre, rotierende Radarantennen.
* **Waffen** — ballistische Granaten, durchschlagende Railgun-Geschosse, Raketen mit
  Boost-, Marsch- und Endanflugphase, Torpedos knapp unter der Oberfläche,
  Kamikaze-Drohnen und Flak zur Raketenabwehr.
* **Effekte** — zwei GPU-Partikelsysteme (additiv und alpha) in je einem Draw-Call:
  Explosionen, Rauch, Funken, Kielwasser, Bugschaum, Blasen, Mündungsfeuer.
* **Sound** — komplett per WebAudio synthetisiert, keine Audiodateien.

### Projektstruktur

```
index.html          Menü + HUD-Markup
styles.css          HUD- und Menü-Design
src/main.js         Einstieg, Spielschleife, Pause
src/game.js         Szene, Wellenlogik, Schaden, Kamera, Zielerfassung
src/ship.js         Schiffsphysik, Auftrieb, Feuerleitung, Spezialfähigkeiten
src/ships.js        Die sechs Schiffsdefinitionen
src/weapons.js      Waffenkatalog
src/projectiles.js  Flugbahnen, Zielsuche, Trefferabfrage
src/shipMesh.js     Prozedurale Schiffsmodelle
src/ocean.js        Ozean-Material und Wellen-Shader
src/world.js        Himmel, Licht, Wolken, Inseln, Arena
src/effects.js      Partikel, Explosionen, Ringe
src/ai.js           Gegner- und Begleitschiff-KI
src/render.js       Renderpfad, Bloom, Qualitätsstufen
src/hud.js          Schiffswahl, HUD, Radar, Marker, Zielhilfen
src/audio.js        Synthetisierte Soundeffekte
src/net.js          WebSocket-Client
src/lobby.js        Mehrspieler-Lobby (Raum, Teams, Schiffswahl)
server/server.js    Statischer Server + WebSocket-Räume (ohne Abhängigkeiten)
vendor/             Three.js r160 (MIT) + Postprocessing-Module
```

## Lizenz

MIT. Three.js in `vendor/` steht unter der MIT-Lizenz der three.js-Autoren.
