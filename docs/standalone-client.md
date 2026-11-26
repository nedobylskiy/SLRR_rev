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

Phones have a single full-screen webview, so the mobile client opens
`game.html?splash=1` instead: the page itself covers everything with the logo
for three seconds while the game loads underneath, then fades it out.

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

## Android (experimental test build)

The Android project is `src-tauri/gen/android` (from `tauri android init`).
The same `slrr://` provider serves the page and the game; Tauri routes the
scheme through the Android WebView, so there is no local server either.

- **Game files.** On first start `MainActivity.kt` asks for the Street Legal
  Racing Redline folder on the device (system folder picker), checks for
  `system` and `sl`, and copies it into the app's `files/game` with a progress
  dialog. The provider looks for that folder again on every request while it
  has none, so the page simply reloads when the copy is done.
- **Window.** One full-screen webview: no splash window on Android.
- **Controls.** The test build uses the touch frontend (`build:web:touch`), so
  the on-screen wheel and lever are on by default.
- **Video.** No ffmpeg on Android: FMV is skipped.

Requirements: JDK 17, Android SDK (platform 35+, build-tools, NDK) in
`%LOCALAPPDATA%\Android\Sdk`, and the Rust targets
`aarch64-linux-android` (plus armv7/x86_64 for other devices).

```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.21.102-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME
dk.0.16248370"
npx tauri android build --debug --apk --target aarch64 --config src-tauri/tauri.touch.conf.json
```

On Windows without Developer Mode the Tauri CLI cannot create the symbolic
link to the Rust library and stops after compiling it. Then copy the library
and let Gradle finish without rebuilding Rust:

```powershell
Copy-Item src-tauri\target\aarch64-linux-android\debug\libslrr_standalone_lib.so src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\
cd src-tauri\gen\android; .\gradlew.bat assembleArm64Debug -x rustBuildArm64Debug
```

The APK is `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`
(debug-signed, unstripped). Open questions: WebGL 2 performance on phones,
and memory for multi-gigabyte installations.

## GitHub Actions builds

`.github/workflows/standalone.yml` builds both clients on every push to
`main`, on `standalone-v*` tags, and on demand (Actions → Standalone client
builds → Run workflow). Each run's Artifacts hold `slrr-standalone-windows-x64`
(the exe) and `slrr-standalone-android-arm64` (a signed release APK with the
touch frontend). A push to `main` also recreates the `latest` prerelease with
`slrr-standalone-windows-x64.exe` and `slrr-standalone-android-arm64.apk`, so
`releases/download/latest/<file>` always serves the newest build; a
`standalone-v*` tag publishes a regular release. Linux runners have no symlink
problem, so the Android job runs the normal `tauri android build`.

The APK is signed with the keystore in the secrets `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
Without them it uses a new throwaway key each run, and Android refuses to
update an installed app signed with another key. To keep updating an APK
built locally, store `~/.android/debug.keystore` (password `android`, alias
`androiddebugkey`) in those secrets, for example with `gh secret set
ANDROID_KEYSTORE_BASE64 < base64-of-the-file`.

## Icon

`src-tauri/icons/app-icon.png` (1024×1024, transparent rounded square) is the
source of every platform icon in `src-tauri/icons/`. After changing it,
regenerate them and rebuild:

```powershell
npx tauri icon src-tauri/icons/app-icon.png -o src-tauri/icons
```

Cargo may keep the old Windows icon resource; `cargo clean -p slrr-standalone`
in `src-tauri` forces it to be embedded again.

## Touch driving controls (experimental)

`src/render/touch-driving.ts` draws on-screen driving controls over the game
frame while a car is being driven (not in menus, where they would cover OSD
buttons):

- a steering wheel on the left: turn it with a finger up to ±150° for full
  lock; released, it springs back to centre;
- a throttle/brake lever on the right, one analog axis like an aircraft
  throttle: push forward for gas, pull back to brake, proportionally, with a
  small dead zone at the centre; released, it springs back to neutral.

Each widget follows its own finger, so both work at once; a mouse works too.
Their axes are merged into the Java driving input: the held wheel replaces
steering, the lever adds to the pedals, and the keyboard keeps working.

Two fingers on the game picture (outside the widgets) move the chase camera
(`src/render/touch-camera.ts`, wired in the viewer's drive loop): drag both
to orbit around the car, pinch to zoom out and spread to zoom in (0.6× to
2.5× of the script's distance). This works on any touch screen, flag or not;
the cockpit view is not affected.

They are off by default. `npm run build:web:touch` (`vite build --mode
touch`, or `SLRR_TOUCH=1`) turns them on by default, and
`npm run standalone:debug:touch` builds the client that way. At runtime
`?touch=1` turns them on in any build and `?touch=0` turns them off, e.g.
`http://127.0.0.1:5174/game.html?touch=1`.
