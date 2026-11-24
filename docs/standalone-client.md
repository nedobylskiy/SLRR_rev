# Standalone client (Tauri 2, experimental)

A desktop executable that runs the same web build without a dev server or any
local HTTP port. It lives in `src-tauri/`.

## How it works

- **Shell:** Tauri 2 with the operating system's webview. Nothing is bundled
  from Chromium: Windows uses WebView2 (Edge, Chromium-based), macOS uses
  WKWebView (WebKit), Linux uses WebKitGTK, Android uses the system WebView.
- **Page:** `npm run build:web` (Vite) writes `dist/`. Tauri embeds `dist/` in
  the executable at compile time.
- **Resource provider:** the window opens `slrr://localhost/game.html` (the player page)
  (`http://slrr.localhost/` on Windows and Android). Tauri hands every
  request on that scheme to `serve()` in `src-tauri/src/lib.rs`:
  - `/api/game/*` goes to `GameProvider` (`src-tauri/src/game.rs`). It is a
    port of the Vite middleware in `vite.config.ts`: `/index` (file catalog),
    `/file?path=` (with byte ranges for `<audio>` music), `/video` and
    `/menu-video` (AVI FMV transcoded to WebM by ffmpeg, cached in memory).
  - Any other path is the embedded page asset.

  The page code is unchanged: it still requests `/api/game/...` on its own
  origin, and the webview answers in-process. Paths are confined to the game
  root, with the same file-type allow-list as the dev server.
- **Saves:** unchanged. The page keeps careers in IndexedDB for the
  `slrr.localhost` origin, in the webview's profile directory.

## Game folder

A folder counts as an installation when it has `system/` and `sl/`.

- A folder given explicitly (`--game <dir>`, `--game=<dir>`, or
  `SLRR_GAME_ROOT`, the same variable as the dev server) must be valid. If it
  does not exist or is not an installation, a dialog says so and asks for the
  right folder; another installation is never used silently.
- Otherwise the last picked folder is used, then the Steam default. If neither
  is an installation, the same dialog explains why and asks.
- The folder picker repeats until a valid folder is chosen (a folder inside the
  installation, such as its `sl`, is accepted as its parent) or the player
  cancels. After a cancel the window opens without a game folder and the page
  offers "Open game folder".
- The picked folder is remembered in the app config directory
  (`%APPDATA%\dev.slrr.standalone\game-root.txt` on Windows).

## Splash

After the game folder is settled, `splash.html` shows the project logo
(`docs/media/slrr-rev-logo.png`) in a transparent, borderless, always-on-top
window. The game window loads hidden meanwhile and replaces the splash once the
logo has been on screen for three seconds and `game.html` has loaded (at most fifteen
seconds in total).

## Video

Original FMV is AVI, which no webview decodes. The provider looks for ffmpeg in
`SLRR_FFMPEG`, next to the executable, in the checkout's
`node_modules/ffmpeg-static`, then in `PATH`. Without ffmpeg, videos are
skipped (the page already treats a failed video as closed).

## Build and run

```powershell
npm run standalone:debug
.\src-tauri\target\debug\slrr-standalone.exe --game "C:\Games\Street Legal Racing - Redline221"
```

`npm run standalone:build` makes an optimized `src-tauri/target/release/`
executable. Bundling (installers) is disabled in `tauri.conf.json`.
Requirements: Rust (stable-msvc), MSVC Build Tools, the WebView2 runtime.

## Android (next step, not built yet)

Tauri 2 routes custom schemes through `WebViewClient.shouldInterceptRequest`
on Android, so the same `slrr://` provider works there with no local server.
What remains:

- `npx tauri android init` (needs Android SDK/NDK, JDK 17, Rust Android targets).
- Game files: the provider currently expects a filesystem directory. On
  Android it looks in `<app data>/game`. A first-run import (Storage Access
  Framework folder pick, copying into app storage) is still to be written;
  reading straight from a SAF `content://` tree would need a Kotlin plugin.
- ffmpeg is not available there; FMV would need a different decoder or
  pre-converted WebM files.
- The Android System WebView is Chromium-based; WebGL 2 performance on the
  target devices is the main open question.

## Icon

`src-tauri/icons/app-icon.png` (1024×1024, transparent rounded square) is the
source of every platform icon in `src-tauri/icons/`. After changing it,
regenerate them and rebuild:

```powershell
npx tauri icon src-tauri/icons/app-icon.png -o src-tauri/icons
```

Cargo may keep the old Windows icon resource; `cargo clean -p slrr-standalone`
in `src-tauri` forces it to be embedded again.
