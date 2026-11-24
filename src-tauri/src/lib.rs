//! Standalone client: the system webview loads the built page from the
//! `slrr://` scheme, and the same scheme serves the game installation through
//! [`game::GameProvider`]. Nothing listens on a network port, which also holds
//! on Android, where Tauri routes custom schemes through the WebView client.

mod game;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use game::{is_game_root, GameProvider};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SCHEME: &str = "slrr";
/// The dev server's default (tools/game-files.ts).
const DEFAULT_ROOT: &str = "C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline";

/// Windows (WebView2) and Android expose custom schemes as `http://<scheme>.localhost`.
fn page_url(page: &str) -> String {
    if cfg!(any(windows, target_os = "android")) {
        format!("http://slrr.localhost/{page}")
    } else {
        format!("slrr://localhost/{page}")
    }
}

/// How long the logo stays up at minimum once painted; the game window also waits for its page to load.
const SPLASH_MIN: Duration = Duration::from_secs(3);
/// Never keep the game window hidden longer than this, even if its load event is missed.
const SPLASH_MAX: Duration = Duration::from_secs(15);

fn saved_root_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("game-root.txt"))
}

/// A folder given explicitly: `--game <dir>` / `--game=<dir>`, else SLRR_GAME_ROOT.
fn requested_game_root() -> Option<(PathBuf, &'static str)> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--game=") {
            return Some((value.into(), "--game"));
        } else if arg == "--game" {
            return args.next().map(|value| (value.into(), "--game"));
        }
    }
    std::env::var_os("SLRR_GAME_ROOT").map(|value| (value.into(), "SLRR_GAME_ROOT"))
}

/// An explicitly requested folder must be valid: a wrong one is reported and
/// the player is asked for the right one, rather than silently using another
/// installation. Otherwise the last chosen folder, then the Steam default; if
/// neither is an installation, ask too.
fn locate_game_root(app: &AppHandle) -> Option<PathBuf> {
    if let Some((dir, source)) = requested_game_root() {
        if is_game_root(&dir) {
            return Some(dir);
        }
        let problem = if dir.is_dir() { "is not a Street Legal Racing Redline installation" } else { "does not exist" };
        return pick_game_root(app, &format!("The game folder given by {source}\n{}\n{problem}.", dir.display()));
    }
    let saved = saved_root_file(app)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .map(|text| PathBuf::from(text.trim()))
        .filter(|dir| !dir.as_os_str().is_empty());
    if let Some(dir) = saved.as_ref().filter(|dir| is_game_root(dir)) {
        return Some(dir.clone());
    }
    let fallback = if cfg!(target_os = "android") {
        // Copy the installation into the app's own storage (no picker on Android yet).
        app.path().app_data_dir().ok().map(|dir| dir.join("game"))
    } else {
        Some(PathBuf::from(DEFAULT_ROOT))
    };
    if let Some(dir) = fallback.filter(|dir| is_game_root(dir)) {
        return Some(dir);
    }
    let reason = match saved {
        Some(dir) => format!("The previously selected game folder\n{}\nis no longer a Street Legal Racing Redline installation.", dir.display()),
        None => "Street Legal Racing Redline was not found.".to_string(),
    };
    pick_game_root(app, &reason)
}

/// Explain why, then let the player choose the installation folder until a
/// valid one is chosen or they cancel (the page then offers "Open game folder").
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_game_root(app: &AppHandle, reason: &str) -> Option<PathBuf> {
    use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
    let ask = |text: String| {
        MessageDialog::new()
            .set_title("SLRR Standalone")
            .set_level(MessageLevel::Warning)
            .set_description(text)
            // Native dialogs show localized OK/Cancel; custom labels are not reliable.
            .set_buttons(MessageButtons::OkCancel)
            .show()
    };
    let mut prompt = format!("{reason}\n\nPress OK to choose the folder where the game is installed (it contains the system and sl folders).");
    loop {
        if !matches!(ask(prompt), MessageDialogResult::Ok | MessageDialogResult::Yes) {
            return None;
        }
        let chosen = rfd::FileDialog::new().set_title("Select the Street Legal Racing Redline folder").pick_folder()?;
        // Picking a folder inside the installation (e.g. its sl folder) is close enough.
        if let Some(root) = chosen.ancestors().take(2).find(|dir| is_game_root(dir)) {
            if let Some(file) = saved_root_file(app) {
                let _ = file.parent().map(std::fs::create_dir_all);
                let _ = std::fs::write(file, root.to_string_lossy().as_bytes());
            }
            return Some(root.to_path_buf());
        }
        prompt = format!("{}\nhas no system and sl folders, so it is not a Street Legal Racing Redline installation.\n\nChoose another folder.", chosen.display());
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn pick_game_root(_: &AppHandle, _: &str) -> Option<PathBuf> {
    None
}

fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let path = percent_encoding::percent_decode_str(uri.path()).decode_utf8_lossy().into_owned();
    if let Some(api) = path.strip_prefix("/api/game") {
        let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
        return app.state::<GameProvider>().handle(api, uri.query(), range);
    }
    // The built page (vite build -> dist), embedded in the executable.
    let asset_path = match path.trim_start_matches('/') {
        "" => "index.html".to_string(),
        other => other.to_string(),
    };
    match app.asset_resolver().get(asset_path) {
        Some(asset) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, asset.mime_type)
            .body(asset.bytes)
            .unwrap(),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            // File reads and video transcodes must not block the webview thread.
            std::thread::spawn(move || responder.respond(serve(&app, &request)));
        })
        .setup(|app| {
            let root = locate_game_root(app.handle());
            app.manage(GameProvider::new(root));
            let title = match app.state::<GameProvider>().root() {
                Some(root) => format!("SLRR Standalone - {}", root.display()),
                None => "SLRR Standalone - no game folder".to_string(),
            };
            // Splash: the project logo in a transparent, borderless window. The game window loads hidden behind it and
            // replaces it once the logo has been on screen for SPLASH_MIN and game.html has loaded.
            let started = Instant::now();
            // The webview paints the logo only once splash.html has loaded; count from then.
            let splash_ready: Arc<Mutex<Option<Instant>>> = Arc::default();
            let splash_mark = splash_ready.clone();
            let splash = WebviewWindowBuilder::new(app, "splash", WebviewUrl::CustomProtocol(page_url("splash.html").parse()?))
                .title("SLRR REV")
                // docs/media/slrr-rev-logo.png is 1403x1121 with transparency.
                .inner_size(600.0, 480.0)
                .center()
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .focused(false)
                .on_page_load(move |_, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        splash_mark.lock().unwrap().get_or_insert_with(Instant::now);
                    }
                })
                .build()?;
            let loaded = Arc::new(AtomicBool::new(false));
            let page_loaded = loaded.clone();
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(page_url("game.html").parse()?))
                .title(title)
                .inner_size(1600.0, 900.0)
                .center()
                .visible(false)
                .on_page_load(move |_, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        page_loaded.store(true, Ordering::Release);
                    }
                })
                .build()?;
            std::thread::spawn(move || {
                loop {
                    let logo_done = splash_ready.lock().unwrap().is_some_and(|at| at.elapsed() >= SPLASH_MIN);
                    if logo_done && loaded.load(Ordering::Acquire) || started.elapsed() >= SPLASH_MAX {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                let _ = main.show();
                // WebView2 can keep the bounds it had while the window was hidden, leaving
                // part of the window blank. A 1 px resize round trip makes it re-read them.
                if let Ok(size) = main.inner_size() {
                    let _ = main.set_size(tauri::PhysicalSize::new(size.width + 1, size.height));
                    let _ = main.set_size(size);
                }
                let _ = main.set_focus();
                let _ = splash.close();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the SLRR standalone client");
}
