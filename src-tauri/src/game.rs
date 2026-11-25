//! In-process replacement for the Vite dev server's `/api/game/*` middleware
//! (`vite.config.ts`, `local-slrr-assets`). The page keeps requesting the same
//! URLs; the webview hands them to this provider through the `slrr://` scheme,
//! so no TCP listener exists.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::http::{header, Response, StatusCode};

const AUDIO_TYPES: &[(&str, &str)] = &[("mp3", "audio/mpeg"), ("ogg", "audio/ogg"), ("wav", "audio/wav")];
const ALLOWED: &[&str] = &[
    "rpk", "rdb", "scx", "scy", "bon", "skl", "matrixdata", "class", "java", "cfg", "tex", "ptx", "dds", "png", "jpg",
    "jpeg", "tga", "bmp", "trc", "walk", "rest", "mp3", "ogg", "wav",
];
/// Same ceiling as the dev server's browser import limit.
const MAX_FILE: u64 = 128 * 1024 * 1024;
const MAX_VIDEO: usize = 32 * 1024 * 1024;

#[derive(Serialize)]
struct IndexEntry {
    path: String,
    size: u64,
}

pub struct GameProvider {
    root: Mutex<Option<PathBuf>>,
    /// Checked again on each request while no root is known: on Android the
    /// installation is copied into app storage after the page has loaded.
    later: Vec<PathBuf>,
    index: OnceLock<Result<Vec<u8>, String>>,
    videos: Mutex<HashMap<String, Arc<OnceLock<Result<Vec<u8>, String>>>>>,
}

type Reply = Response<Vec<u8>>;

fn reply(status: StatusCode, content_type: &str, body: Vec<u8>) -> Reply {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap()
}

fn text(status: StatusCode, message: impl Into<String>) -> Reply {
    reply(status, "text/plain; charset=utf-8", message.into().into_bytes())
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Files the page may read: original asset types, saves and the executable (version probe).
fn readable(relative: &str, path: &Path) -> bool {
    let lower = relative.to_ascii_lowercase();
    ALLOWED.contains(&extension(path).as_str()) || lower.starts_with("save/") || lower == "streetlegal_redline.exe"
}

fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    query?.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (key == name).then(|| percent_decode_str(&value.replace('+', " ")).decode_utf8_lossy().into_owned())
    })
}

impl GameProvider {
    pub fn new(root: Option<PathBuf>, later: Vec<PathBuf>) -> Self {
        Self { root: Mutex::new(root), later, index: OnceLock::new(), videos: Mutex::new(HashMap::new()) }
    }

    pub fn root(&self) -> Option<PathBuf> {
        let mut root = self.root.lock().unwrap();
        if root.is_none() {
            *root = self.later.iter().find(|dir| is_game_root(dir)).cloned();
        }
        root.clone()
    }

    /// `path` is the URL path after `/api/game`.
    pub fn handle(&self, path: &str, query: Option<&str>, range: Option<&str>) -> Reply {
        let Some(root) = self.root() else {
            return text(StatusCode::NOT_FOUND, "No game folder selected");
        };
        let root = root.as_path();
        let result = match path {
            "/index" => self.index(root),
            "/file" => self.file(root, &query_param(query, "path").unwrap_or_default(), range),
            "/video" => self.video(root, &query_param(query, "path").unwrap_or_default()),
            "/menu-video" => {
                let hd = "data/Fmv/background_motion_HD.avi";
                self.video(root, if root.join(hd).is_file() { hd } else { "data/Fmv/background_motion.avi" })
            }
            _ => return text(StatusCode::NOT_FOUND, ""),
        };
        result.unwrap_or_else(|error| text(StatusCode::BAD_REQUEST, error))
    }

    fn index(&self, root: &Path) -> Result<Reply, String> {
        let json = self.index.get_or_init(|| {
            let mut files = Vec::new();
            walk(root, &mut files).map_err(|e| e.to_string())?;
            let mut entries: Vec<IndexEntry> = files
                .into_iter()
                .filter_map(|file| {
                    let relative = file.strip_prefix(root).ok()?.to_string_lossy().replace('\\', "/");
                    let size = if readable(&relative, &file) { fs::metadata(&file).map(|m| m.len()).unwrap_or(0) } else { 0 };
                    Some(IndexEntry { path: relative, size })
                })
                .collect();
            entries.sort_by(|a, b| a.path.cmp(&b.path));
            serde_json::to_vec(&entries).map_err(|e| e.to_string())
        });
        json.clone().map(|body| reply(StatusCode::OK, "application/json", body))
    }

    /// Resolve a requested relative path, rejecting anything outside the game root.
    fn safe_path(&self, root: &Path, requested: &str) -> Result<PathBuf, String> {
        let base = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let target = fs::canonicalize(base.join(requested.replace('\\', "/"))).map_err(|e| format!("{requested}: {e}"))?;
        if !target.starts_with(&base) {
            return Err("Path outside game root".into());
        }
        Ok(target)
    }

    fn file(&self, root: &Path, requested: &str, range: Option<&str>) -> Result<Reply, String> {
        let file = self.safe_path(root, requested)?;
        let base = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let relative = file.strip_prefix(&base).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        if !readable(&relative, &file) {
            return Ok(text(StatusCode::FORBIDDEN, format!("Unsupported game asset type: .{}", extension(&file))));
        }
        let size = fs::metadata(&file).map_err(|e| e.to_string())?.len();
        if let Some((_, audio)) = AUDIO_TYPES.iter().find(|(ext, _)| *ext == extension(&file)) {
            return self.audio(&file, size, audio, range);
        }
        if size > MAX_FILE {
            return Err("File exceeds 128 MiB browser import limit".into());
        }
        Ok(reply(StatusCode::OK, "application/octet-stream", fs::read(&file).map_err(|e| e.to_string())?))
    }

    /// `<audio>` streams music with Range requests, like the dev server.
    fn audio(&self, file: &Path, size: u64, content_type: &str, range: Option<&str>) -> Result<Reply, String> {
        let (mut start, mut end, partial) = (0u64, size.saturating_sub(1), range.is_some());
        if let Some(range) = range {
            let spec = range.strip_prefix("bytes=").ok_or("Invalid range")?;
            let (first, last) = spec.split_once('-').ok_or("Invalid range")?;
            start = first.parse().map_err(|_| "Invalid range")?;
            if !last.is_empty() {
                end = end.min(last.parse().map_err(|_| "Invalid range")?);
            }
            if start >= size || end < start {
                return Ok(Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                    .body(Vec::new())
                    .unwrap());
            }
        }
        let mut body = vec![0u8; (end - start + 1) as usize];
        let mut handle = fs::File::open(file).map_err(|e| e.to_string())?;
        handle.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        handle.read_exact(&mut body).map_err(|e| e.to_string())?;
        let mut response = Response::builder()
            .status(if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
            .header(header::CONTENT_TYPE, content_type)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "no-store");
        if partial {
            response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
        }
        Ok(response.body(body).unwrap())
    }

    /// Original FMV is AVI, which webviews cannot decode. Transcode once to WebM
    /// with an ffmpeg next to the executable, in PATH, or given by SLRR_FFMPEG.
    fn video(&self, root: &Path, requested: &str) -> Result<Reply, String> {
        let source = self.safe_path(root, requested)?;
        if !matches!(extension(&source).as_str(), "avi" | "mp4" | "webm") {
            return Err("Unsupported video source".into());
        }
        let key = source.to_string_lossy().into_owned();
        let slot = self.videos.lock().unwrap().entry(key).or_default().clone();
        let result = slot.get_or_init(|| transcode(&source)).clone();
        if result.is_err() {
            // Allow a retry, e.g. after ffmpeg is installed.
            self.videos.lock().unwrap().remove(&source.to_string_lossy().into_owned());
        }
        result.map(|body| reply(StatusCode::OK, "video/webm", body))
    }
}

fn walk(dir: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            walk(&entry.path(), files)?;
        } else if kind.is_file() {
            files.push(entry.path());
        }
    }
    Ok(())
}

fn ffmpeg() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("SLRR_FFMPEG").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(path);
    }
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let beside = std::env::current_exe().ok()?.parent()?.join(name);
    if beside.is_file() {
        return Some(beside);
    }
    // Development checkout: the dev server's own ffmpeg-static binary.
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../node_modules/ffmpeg-static").join(name);
    if dev.is_file() {
        return Some(dev);
    }
    std::env::var_os("PATH")?.to_str()?.split(if cfg!(windows) { ';' } else { ':' })
        .map(|dir| Path::new(dir).join(name))
        .find(|p| p.is_file())
}

fn transcode(source: &Path) -> Result<Vec<u8>, String> {
    let binary = ffmpeg().ok_or("FFmpeg unavailable")?;
    let mut command = Command::new(binary);
    command
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .args(["-vf", "fps=15,scale=1280:720", "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "950k", "-f", "webm", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("Video conversion failed ({})", output.status));
    }
    if output.stdout.len() > MAX_VIDEO {
        return Err("Converted video exceeds 32 MiB".into());
    }
    Ok(output.stdout)
}

/// Looks like an SLRR installation (the folders the engine boots from).
pub fn is_game_root(dir: &Path) -> bool {
    dir.join("system").is_dir() && dir.join("sl").is_dir()
}
