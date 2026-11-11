# PMI Wissensnavigator PWA V023 – öffentliches App-Shell-Paket

Dieser Ordner enthält **ausschließlich öffentliche Anwendungsdateien**. Nach dem Entpacken kommen die Dateien **direkt ins Repository-Hauptverzeichnis**, nicht in einen Unterordner. Die PWA kann über GitHub Pages bereitgestellt werden.

**Nicht hochladen:** Interne PMI-ZIPs, FAQ-Datenpakete, Menü-/Prozessregister, V023-Komplettimport und Browser-Backups. Diese liegen außerhalb dieses Deploy-Ordners und werden über die lokale Importfunktion auf dem Gerät gelesen und in IndexedDB gespeichert.

## Import
1. Nach dem Update GitHub Pages im Browser öffnen und bei älteren gecachten Ständen die Seite aktualisieren.
2. `PMI_NAVIGATOR_KOMPLETTIMPORT_V023.json` aus `../DATEN/` **lokal im Browser** importieren (nicht auf GitHub hochladen).
3. Bereits vorhandene individuelle VV4-/FAQ-Änderungen vorher mit der bisherigen App exportieren; ein Komplettimport ersetzt den aktiven lokalen Wissensbestand.
4. Neue Menüs (147 statisch ermittelte Kandidaten) und Prozesse (3 redaktionelle Entwürfe) über die zusätzlichen Ansichten durchsuchen.
5. Über „Gesamtsicherung“ den lokalen Bestand inklusive Menüs/Prozessen regelmäßig sichern.

Auch ein getrennter Import ist möglich: zuerst `PMI_VIEWER_DATENPAKET_V023.json`, dann `PMI_NAVIGATOR_ERWEITERUNG_V023.json`.

**Prüfstand:** JavaScript-Syntax und statische Verträge geprüft. Echte Browser-/Offline-/Touch-Abnahme in dieser Umgebung wegen Administratorrichtlinie noch offen. Keine Live-ERP-Aktionen oder freigegebenen DocWiki-Links.
