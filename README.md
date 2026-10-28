<p align="center">
  <img src="apps/web/src/assets/icons/icon-1024.png" width="128" height="128" alt="meddl" />
</p>

<h1 align="center">meddl</h1>

<p align="center">IPTV-Player für Windows, macOS, Linux und den Browser.</p>

---

**meddl** spielt IPTV-Quellen ab, die du selbst mitbringst: M3U/M3U8-Playlists,
Xtream-Codes-Zugänge und Stalker/Ministra-Portale – mit TV-Guide (EPG),
Filmen und Serien, Favoriten und Download-Manager.

> meddl liefert **keine** Sender, Playlists oder Abos. Alle Inhalte stammen
> aus Quellen, die Nutzer selbst einrichten.

## Funktionen

- **Quellen:** M3U/M3U8 per Datei oder URL (mit Auto-Aktualisierung), Xtream Codes, Stalker/Ministra, eigener User-Agent pro Playlist
- **Live-TV & EPG:** XMLTV-TV-Guide mit Zeitleiste und Mehrkanal-Raster, Catch-up/Timeshift *(Desktop)*
- **Filme & Serien:** Detailseiten mit Staffeln, Weiterschauen, „Neu hinzugefügt“, Download-Manager *(Desktop)*
- **Wiedergabe:** eingebauter HTML5-Player (HLS.js/Video.js), externe Player (MPV, VLC), eingebettetes MPV *(experimentell, Desktop)*, Radio-Player
- **Organisation:** Favoriten, Verlauf, globale Suche, Befehlspalette (`Strg+K`)
- **Plattform:** Desktop-App (Electron), installierbare Web-App (PWA), Docker-Selbsthosting, 19 Sprachen, helles und dunkles Design

## Download

Installer für Windows (und später weitere Systeme) gibt es unter
[Releases](https://github.com/kjubix2201-netizen/meddl/releases).
Die Desktop-App aktualisiert sich über diese Releases selbst.

## Selbst gehostete Web-Version

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

Danach läuft meddl unter <http://localhost:4333>. Details:
[`docker/README.md`](docker/README.md).

### Ton bei Dolby / DTS (FFmpeg)

Browser spielen Dolby Digital und DTS ohne Ton ab. Ist auf dem Rechner mit
dem meddl-Server [FFmpeg](https://ffmpeg.org/) installiert, wandelt der
Server den Ton solcher Streams automatisch in AAC um (Bild unverändert).
Windows: `winget install Gyan.FFmpeg`, danach den Server neu starten. Ein
anderer Pfad lässt sich mit `MEDDL_FFMPEG` / `MEDDL_FFPROBE` setzen.

## Entwicklung

Voraussetzungen: Node.js 22 (siehe `.nvmrc`) und pnpm über Corepack.

```bash
nvm install && nvm use
corepack enable
pnpm install
pnpm run serve:backend    # Desktop-App (Electron) + Angular-Dev-Server auf :4200
pnpm run serve:frontend   # nur die Web-Oberfläche
```

Builds:

```bash
pnpm run build:frontend   # Web-App nach dist/apps/web
pnpm run build:backend    # Electron-Backend
```

Windows-Installer und Web-Build entstehen automatisch per GitHub Actions
(`.github/workflows/build.yml`). Ein Release wird durch einen
Git-Tag `vX.Y.Z` ausgelöst.

Weitere Entwickler-Doku: [`AGENTS.md`](AGENTS.md) und [`docs/`](docs).

## Lizenz und Herkunft

meddl basiert auf [IPTVnator](https://github.com/4gray/iptvnator) von 4gray
und steht wie das Original unter der [MIT-Lizenz](LICENSE.md). meddl ist ein
eigenständiges Projekt und nicht mit IPTVnator verbunden – siehe
[NOTICE.md](NOTICE.md).
