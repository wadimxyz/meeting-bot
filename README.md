# Meeting Notes — eigener Meeting-Assistent

Ein lokal betreibbarer MVP auf Basis des MIT-lizenzierten [ScreenApp Meeting Bot](https://github.com/screenappai/meeting-bot). Der Bot tritt Google Meet als sichtbarer Gast **„Meeting Notes · Aufnahme“** bei, zeichnet seine eigene Meeting-Ansicht mit eingehendem Ton auf und erstellt danach ein deutsches Transkript, Aufgaben-Kandidaten und Screenshots mit Zeitstempeln.

Keine Recall-/ScreenApp-Konten, keine externen Transkriptions-APIs, kein Cloud-Speicher. Die Meet-Verbindung selbst läuft selbstverständlich über Google. Der MVP läuft als Einzelplatz-Anwendung auf `127.0.0.1`.

## Enthalten

- Oberfläche zum Beitreten, Beenden, Importieren, Abspielen, Auswerten und Löschen.
- Eigener Chrome-Kontext ohne persönliche Browser-Cookies; physische Kamera und Mikrofon für Meet explizit gesperrt. Keine Sprachausgabe oder Chat-Nachrichten.
- Aufnahme in fortlaufenden Blöcken; Anzeige gespeicherter Bytes und des letzten erkannten Audiosignals.
- Prüfung auf Tonspur und messbares Audiosignal. Kein vorgetäuschtes Transkript bei stummem Video.
- Lokales **whisper.cpp** für Deutsch; Markdown, SRT und JSON mit Zeitstempeln.
- Aufgaben als überprüfbare Originalzitate, regelbasiert ausgewählt. Keine erfundenen Verantwortlichen, Termine oder Beschlüsse.
- Bis zu 24 Video-Frames passend zu visuellen Hinweisen wie „Logo“, „Dark Mode“, „hier“ oder „Screenshot“. Mindestabstand acht Sekunden. Auswahl erfolgt nach der Aufnahme anhand des Transkripts, ohne Bildverständnis.
- Lokale Persistenz, Wiederaufnahme einer fehlgeschlagenen Auswertung, klare Fehler bei abgebrochenen Läufen.
- Import von WebM, MP4, MOV, MKV, WAV, MP3, M4A und FLAC; standardmäßig bis 2 GiB.

## Start auf macOS (auch Intel)

Voraussetzungen: Node.js 22 oder 24, Google Chrome, FFmpeg mit `ffprobe`, `whisper-cli` und ein mehrsprachiges whisper.cpp-Modell. Für Linux benötigt Chrome zusätzlich eine grafische Sitzung oder einen eigenen Xvfb-Display. Docker ist für diesen MVP nicht erforderlich.

```bash
npm ci --ignore-scripts
npm run assistant:build

# Falls FFmpeg und whisper.cpp noch nicht installiert sind:
brew install ffmpeg whisper-cpp

# Bereits vorhandenes mehrsprachiges GGML-Modell verwenden:
WHISPER_MODEL=/absoluter/pfad/ggml-base.bin npm run assistant:start
```

Oberfläche: **http://127.0.0.1:4317**

Modelle und Download-Anleitung: [whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/master/models). `base` ist ein schneller Einstieg, `small` liefert normalerweise bessere Erkennung bei höherem Rechenaufwand. Kein `.en`-Modell für deutsche Meetings verwenden. Das Modell muss vor dem Start vorhanden sein; es wird nicht automatisch heruntergeladen.

Auf dem Entwicklungsrechner wurde mit Node 24, Chrome und dem vorhandenen Modell unter `/Users/wadim/.cache/codex-whisper-models/ggml-base.bin` geprüft. Dieser Pfad ist kein im Code hinterlegter Standard.

## Benutzung

1. Beteiligte über die Aufnahme informieren und ihre Zustimmung in der Oberfläche bestätigen.
2. Titel und Google-Meet-Link eingeben, dann **Bot beitreten lassen** wählen.
3. Den sichtbaren Gast im Meeting zulassen. Das Chrome-Fenster des Bots geöffnet lassen. Der MVP benötigt Meetings, die Gäste ohne Google-Anmeldung zulassen.
4. Die Anzeige **Nimmt auf** sowie den Zeitpunkt des letzten Audiosignals prüfen. Bildschirmfreigaben müssen in der Ansicht des Bots sichtbar sein, damit sie im Video erscheinen.
5. **Aufnahme beenden** drücken. Danach werden Video, Transkript, Aufgaben und Screenshots aufbereitet. Automatisches Ende bei erkanntem Meeting-Ende oder nach dem Zeitlimit; wenn andere Teilnehmer nur einzeln gehen, manuell beenden.
6. Zeitstempel im Transkript und in Aufgaben/Screenshots springen zum passenden Videomoment. Exporte stehen direkt unter dem Player.

Eine vorhandene Aufnahme kann stattdessen über **Aufnahme auswählen** importiert werden. Ein Video ohne Ton bleibt erhalten und wird mit einer Fehlermeldung angezeigt. Ein späterer Modellwechsel wird nach Neustart und **Erneut auswerten** verwendet.

## Speicherung und Grenzen

Alles liegt standardmäßig in `meeting-data/<meeting-id>/`:

```text
meeting.json       Status und abgeleitete Ergebnisse
capture.webm       ursprüngliche Aufnahmeblöcke bei Meet-Aufnahmen
recording.webm     suchbare Aufnahme; bei Importen Originalformat
audio.wav         Mono-Ton für Whisper
transcript.json    unveränderte Whisper-Ausgabe
transcript.srt     Untertitel
transcript.md      lesbares Transkript
notes.md           Aufgaben-Zitate und verknüpfte Bilder
tasks.json        Aufgaben-Kandidaten mit Sekundenangaben
screenshot-*.jpg   Bildbelege
```

Für einen vollständigen Export einschließlich eingebetteter Bilder den gesamten Meeting-Ordner kopieren. **Löschen** entfernt die Sitzung mitsamt ihren lokalen Dateien endgültig.

- Ein aktiver Bot, Import oder Auswertung gleichzeitig. Keine Cloud-Orchestrierung oder Kalenderanbindung.
- Nur Google Meet ist im neuen MVP freigegeben. Zoom/Teams bleiben im unveränderten Upstream-Modus, sind nicht an diese Oberfläche angeschlossen.
- Keine Echtzeit-Transkription, Sprechererkennung oder LLM-Zusammenfassung. Aufgaben und Screenshots sind Vorschläge zur Prüfung.
- Der Bot sieht die gerenderte Meeting-Ansicht, keinen isolierten Präsentations-Stream. Layout, Pop-ups und Qualität beeinflussen Screenshots.
- Browser-Automatisierung hängt von der Meet-Oberfläche und den Gastzugangsregeln ab. Ein echter Google-Meet-Beitritt wurde im Rahmen dieses MVP noch nicht mit einem Gastgeber geprüft. Lokale Chrome-Aufnahme und Auswertung werden separat getestet.
- Bei Browser-Absturz oder hartem Prozessende können letzte Aufnahmeblöcke fehlen. Ein `capture.webm`-Fragment bleibt auf der Platte; nur vollständige Aufnahmen werden automatisch ausgewertet. Die Sperrdatei verhindert parallele Server im selben Datenordner.
- Loopback, Origin-/Host-Prüfung und ein erforderlicher Anfrageheader schützen die lokale Oberfläche. Es gibt keine Benutzerkonten oder Mehrbenutzer-Isolation. Nicht unverändert über Reverse Proxy ins Internet stellen.
- Vorhandene Upstream-Cloudintegrationen sind im `assistant`-Modus abgeschaltet. Die ursprünglichen Start-/Docker-Kommandos verwenden weiterhin die Upstream-Architektur, siehe [README.upstream.md](README.upstream.md).

## Konfiguration

Umgebungsvariablen beim Start setzen; keine Konfigurationsdatei notwendig.

| Variable | Bedeutung / Standard |
|---|---|
| `WHISPER_MODEL` | Erforderlicher absoluter Pfad zum mehrsprachigen GGML-Modell |
| `WHISPER_BIN` | `whisper-cli` |
| `FFMPEG_BIN` / `FFPROBE_BIN` | `ffmpeg` / `ffprobe` |
| `CHROME_PATH` | macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; Linux: `/usr/bin/google-chrome` |
| `ASSISTANT_PORT` | `4317`; bindet ausschließlich an `127.0.0.1` |
| `ASSISTANT_DATA_DIR` | `meeting-data` relativ zum Projekt |
| `ASSISTANT_MAX_MINUTES` | `180`; maximal `360` |
| `ASSISTANT_MAX_UPLOAD_MB` | `2048`; maximal `10240` |

## Entwicklung und Tests

```bash
npm run assistant:check
npm run assistant:test

# Zusätzlich echte Chrome-Tabaufnahme (lokales Testsignal, kein fremdes Meeting):
ASSISTANT_BROWSER_TEST=1 npm run assistant:test

# Zusätzlich kompletter UI-Import mit echter deutscher Spracherkennung:
WHISPER_MODEL=/pfad/ggml-base.bin \
ASSISTANT_FIXTURE=/pfad/zur/deutschen-testaufnahme.mp4 \
npm run assistant:test
```

Der optionale UI-Test erwartet eine Aufnahme mit diesen Aussagen: „Wir müssen das falsche Logo ändern. Hier ist der Hintergrund im Dark Mode noch weiß. Das sollten wir korrigieren. Bitte den Registrierungsprozess prüfen und die Tarifauswahl vorher anzeigen.“ Er prüft drei Aufgaben, ein Bild, Downloads, mobile Darstellung und Löschung. Tests verwenden separate lokale Datenordner; keine echten Meeting-Teilnehmer.

Neue Implementierung: `src/assistant/` und `web/assistant/`. Der Fork erweitert den vorhandenen `GoogleMeetBot` über eine überschreibbare Aufnahme-Methode. Die ursprüngliche Beitrittslogik bleibt erhalten. Upstream-Basis: `1447ed3`.

Die vom Upstream geerbte Docker-Publish-Pipeline ist auf das Upstream-Repository begrenzt. Der Fork publiziert dadurch nicht versehentlich Images oder Tags. Seine eigene CI baut und testet ohne Veröffentlichung.

## Lizenz

MIT; siehe [LICENSE](LICENSE). Die ursprünglichen Copyright-Hinweise und die Upstream-Dokumentation bleiben erhalten.
