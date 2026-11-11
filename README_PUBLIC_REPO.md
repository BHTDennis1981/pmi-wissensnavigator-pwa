# PMI Wissensnavigator PWA V025 – öffentliches App-Shell-Paket

Dieser Ordner enthält **ausschließlich öffentliche Anwendungsdateien**. Nach dem Entpacken kommen die Dateien **direkt ins Repository-Hauptverzeichnis**, nicht in einen Unterordner. Die PWA kann über GitHub Pages bereitgestellt werden.

**Nicht hochladen:** Interne PMI-ZIPs, FAQ-Datenpakete, Menü-/Prozessregister, V025-Komplettimport und Browser-Backups. Diese liegen außerhalb dieses Deploy-Ordners und werden über die lokale Importfunktion auf dem Gerät gelesen und in IndexedDB gespeichert.

## Import
1. Nach dem Update GitHub Pages im Browser öffnen und bei älteren gecachten Ständen die Seite aktualisieren.
2. `PMI_NAVIGATOR_KOMPLETTIMPORT_V025.json` aus `../DATEN/` **lokal im Browser** importieren (nicht auf GitHub hochladen).
3. Bereits vorhandene individuelle VV4-/FAQ-Änderungen vorher mit der bisherigen App exportieren; ein Komplettimport ersetzt den aktiven lokalen Wissensbestand.
4. Neue Menüs (147 statisch ermittelte Kandidaten) und Prozesse (3 redaktionelle Entwürfe) über die zusätzlichen Ansichten durchsuchen.
5. Über „Gesamtsicherung“ den lokalen Bestand inklusive Menüs/Prozessen regelmäßig sichern.

Auch ein getrennter Import ist möglich: zuerst `PMI_VIEWER_DATENPAKET_V025.json`, dann `PMI_NAVIGATOR_ERWEITERUNG_V025.json`.

**Prüfstand:** JavaScript-Syntax und statische Verträge geprüft. Echte Browser-/Offline-/Touch-Abnahme in dieser Umgebung wegen Administratorrichtlinie noch offen. Keine Live-ERP-Aktionen oder freigegebenen DocWiki-Links.


V025: Das obere Werkzeugmenü ist in allen Ausrichtungen über „Menü“ erreichbar. Die untere Mobilnavigation kann gewischt oder per Pfeiltaste verschoben werden. Der Graph bietet Wissensnetz, Prozessschritte, freies Netz sowie gerichtete LR-/UD-Layouts. Die Anwendungsdaten bleiben lokal und werden nicht im Repository mitgeliefert.


**V025 neu:** Wissensnetz optional nach vorhandenen VV4-Knotentypen gruppieren (Gruppen öffnen/zurück). Teilprozess per Layout „Swimlanes (Programme)“ als horizontal scrollbar angeordnete, aus FAQ-Verweisen abgeleitete Programmspuren anzeigen. Keine Runtime-/Rollen-/End-to-End-Abnahme. In Swimlanes nicht wirksame Standard-Graphfunktionen werden ausgeblendet.

**Bei bereits vorhandenen V024-Daten:** Ein erneuter Import ist für diese rein darstellungsbezogene Aktualisierung nicht erforderlich. Vor der Bereitstellung trotzdem Gesamtsicherung exportieren.
