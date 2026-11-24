//! Standalone client: the system webview loads the built page from the
//! `slrr://` scheme, and the same scheme serves the game installation through
//! [`game::GameProvider`]. Nothing listens on a network port, which also holds
//! on Android, where Tauri routes custom schemes through the WebView client.

mod game;

use std::path::PathBuf;

use game::{is_game_root, GameProvider};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SCHEME: &str = "slrr";
/// The dev server's default (tools/game-files.ts).
const DEFAULT_ROOT: &str = "C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline";

/// Windows (WebView2) and Android expose custom schemes as `http://<scheme>.localhost`.
fn start_url() -> &'static str {
    if cfg!(any(windows, target_os = "android")) {
        "http://slrr.localhost/game.html"
    } else {
        "slrr://localhost/game.html"
    }
}

fn saved_root_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("game-root.txt"))
}

/// `--game <dir>` / `--game=<dir>`, then SLRR_GAME_ROOT (as the dev server),
/// then the last chosen folder, the Steam default, and finally a folder picker.
fn locate_game_root(app: &AppHandle) -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);
    let mut candidates: Vec<PathBuf> = Vec::new();
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--game=") {
            candidates.push(value.into());
        } else if arg == "--game" {
            candidates.extend(args.next().map(PathBuf::from));
        }
    }
    candidates.extend(std::env::var_os("SLRR_GAME_ROOT").map(PathBuf::from));
    if let Some(saved) = saved_root_file(app).and_then(|file| std::fs::read_to_string(file).ok()) {
        candidates.push(saved.trim().into());
    }
    if cfg!(target_os = "android") {
        // Copy the installation into the app's own storage (no picker on Android yet).
        candidates.extend(app.path().app_data_dir().ok().map(|dir| dir.join("game")));
    } else {
        candidates.push(DEFAULT_ROOT.into());
    }
    if let Some(found) = candidates.into_iter().find(|dir| is_game_root(dir)) {
        return Some(found);
    }
    pick_game_root(app)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_game_root(app: &AppHandle) -> Option<PathBuf> {
    let chosen = rfd::FileDialog::new().set_title("Select the Street Legal Racing Redline folder").pick_folder()?;
    if !is_game_root(&chosen) {
        rfd::MessageDialog::new()
            .set_title("SLRR Standalone")
            .set_description("This folder has no SLRR installation (system and sl folders).")
            .show();
        return None;
    }
    if let Some(file) = saved_root_file(app) {
        let _ = file.parent().map(std::fs::create_dir_all);
        let _ = std::fs::write(file, chosen.to_string_lossy().as_bytes());
    }
    Some(chosen)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn pick_game_root(_: &AppHandle) -> Option<PathBuf> {
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
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(start_url().parse()?))
                .title(title)
                .inner_size(1600.0, 900.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the SLRR standalone client");
}
