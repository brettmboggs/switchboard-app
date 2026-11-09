// The Switchboard app: a window on http://127.0.0.1:4747, and the server behind it.
//
// Kept small on purpose. Everything Switchboard does lives in the Node server
// (server.js); this only:
//   - starts that server (a bundled Node, the app's files as resources) when
//     nothing answers on 4747, and starts it again if it stops;
//   - leaves alone a Switchboard that is already running (a git checkout's
//     systemd / launchd service), and just shows it;
//   - closing the window hides it (reminders and notifications keep coming);
//     Quit in the tray menu, or Ctrl+Q in the window, stops the server it
//     started and exits (the page asks for /app/quit; see public/js/keys.js);
//   - one copy at a time, window size remembered, start at login, updates from
//     GitHub Releases (signed), offered on the page's Update ready button.
// See desktop/README.md for why it is built this way.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod links;

use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const PORT: u16 = 4747;
// The page opened in the window: ?app=quit tells it this app quits on Ctrl+Q.
const APP_URL: &str = "http://127.0.0.1:4747/?app=quit";

#[derive(Default)]
struct Server {
    child: Mutex<Option<Child>>,
    quitting: AtomicBool,
}

fn answering() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn start_server(app: &AppHandle) -> std::io::Result<Child> {
    let exe = std::env::current_exe()?;
    let node = exe.with_file_name(if cfg!(windows) { "switchboard-node.exe" } else { "switchboard-node" });
    let root = app.path().resource_dir().map_err(std::io::Error::other)?.join("server");
    let logs = app.path().app_log_dir().map_err(std::io::Error::other)?;
    fs::create_dir_all(&logs)?;
    let log_file = logs.join("server.log");
    if fs::metadata(&log_file).map(|m| m.len() > 5_000_000).unwrap_or(false) {
        let _ = fs::rename(&log_file, logs.join("server.old.log"));
    }
    let log = OpenOptions::new().create(true).append(true).open(&log_file)?;
    let mut cmd = Command::new(node);
    cmd.args(["--disable-warning=ExperimentalWarning", "bin/desktop.mjs"])
        .current_dir(&root)
        .env("SWITCHBOARD_DESKTOP", "1")
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}

// Keeps a Switchboard answering on 4747, like bin/run.mjs: exit 75 restarts at
// once, a crash waits a little longer each time. If someone else's Switchboard
// was answering and goes quiet, it gets 15 seconds to come back (a service
// restarting after its own update) before this starts one.
fn supervise(app: AppHandle) {
    std::thread::spawn(move || {
        let state = app.state::<Server>();
        let mut fails: u32 = 0;
        let mut seen_other = false;
        loop {
            if state.quitting.load(SeqCst) {
                return;
            }
            if answering() {
                seen_other = true;
                sleep(Duration::from_secs(3));
                continue;
            }
            if seen_other {
                seen_other = false;
                let quiet = Instant::now();
                while quiet.elapsed() < Duration::from_secs(15) && !answering() {
                    sleep(Duration::from_secs(1));
                }
                continue;
            }
            let began = Instant::now();
            let code = match start_server(&app) {
                Ok(child) => {
                    *state.child.lock().unwrap() = Some(child);
                    loop {
                        sleep(Duration::from_millis(500));
                        let mut guard = state.child.lock().unwrap();
                        let Some(child) = guard.as_mut() else { break None };
                        match child.try_wait() {
                            Ok(None) => {}
                            Ok(Some(status)) => { *guard = None; break status.code(); }
                            Err(_) => { *guard = None; break None; }
                        }
                    }
                }
                Err(e) => { eprintln!("Could not start the Switchboard server: {e}"); None }
            };
            if state.quitting.load(SeqCst) {
                return;
            }
            if code == Some(75) { fails = 0; continue; }
            // 76: removed from this computer (lib/uninstall.js): stay stopped.
            if code == Some(76) { return; }
            fails = if began.elapsed() > Duration::from_secs(60) { 0 } else { fails + 1 };
            sleep(Duration::from_secs((2 * fails as u64).min(30)));
        }
    });
}

fn stop_server(app: &AppHandle) {
    let state = app.state::<Server>();
    state.quitting.store(true, SeqCst);
    let child = state.child.lock().unwrap().take();
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

// Linux: the window is a Chrome (or Edge, Chromium, Brave) app window when one
// is installed, because WebKitGTK, the built-in web engine, lags badly with
// NVIDIA's driver: typing trails a letter and scrolling stutters (Nov 5 2026).
// The app still runs the server, the tray, start at login and updates; only the
// window comes from the browser. SWITCHBOARD_WEBVIEW=1 keeps the built-in one.
#[cfg(target_os = "linux")]
fn browser() -> Option<&'static std::path::Path> {
    static FOUND: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
    FOUND.get_or_init(|| {
        if std::env::var_os("SWITCHBOARD_WEBVIEW").is_some() { return None; }
        let path = std::env::var_os("PATH")?;
        ["google-chrome", "google-chrome-stable", "microsoft-edge", "chromium", "chromium-browser", "brave-browser"]
            .iter()
            .flat_map(|b| std::env::split_paths(&path).map(move |d| d.join(b)))
            .find(|p| p.is_file())
    }).as_deref()
}
#[cfg(not(target_os = "linux"))]
fn browser() -> Option<&'static std::path::Path> { None }

// Brings the browser's Switchboard window forward, or opens one.
fn show_in_browser(b: &std::path::Path) {
    let found = Command::new("wmctrl").arg("-l").output().ok().and_then(|o| {
        String::from_utf8_lossy(&o.stdout).lines()
            .find(|l| l.trim_end().ends_with(" Switchboard") || l.contains(") Switchboard"))
            .and_then(|l| l.split_whitespace().next().map(str::to_string))
    });
    if let Some(id) = found {
        if Command::new("wmctrl").args(["-i", "-a", &id]).status().map(|s| s.success()).unwrap_or(false) { return; }
    }
    // Waited on in the background, so the browser's launcher never lingers as a zombie.
    if let Ok(mut c) = Command::new(b).arg(format!("--app=http://127.0.0.1:{PORT}/")).spawn() {
        std::thread::spawn(move || { let _ = c.wait(); });
    }
}

// Switchboard in the person's own browser: its Chrome window on Linux when there
// is one, otherwise the default browser. For a window that lags, or for the
// browser's saved passwords (public/js/slowwin.js, Settings, General).
fn open_in_browser(app: &AppHandle) {
    if let Some(b) = browser() { show_in_browser(b); return; }
    let _ = app.opener().open_url(format!("http://127.0.0.1:{PORT}/"), None::<&str>);
    if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }
}

fn show(app: &AppHandle) {
    if let Some(b) = browser() { show_in_browser(b); return; }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn ours(url: &Url) -> bool {
    links::is_ours(url.scheme(), url.host_str(), url.port_or_known_default(), PORT)
}

// Updates. The app asks GitHub Releases at start, every 30 minutes, and when the
// page's Check for updates is clicked, and tells the server what it found every
// few seconds (POST /api/app/update; lib/update.js). The page then shows its
// Update ready button; the click (or automatic updates, when the server says it
// is safe) comes back in the answer, and the app downloads, installs and restarts.
// If the server answering is not this app's (a git checkout's own service), it
// does not take reports, and the app asks with a dialog instead, once per version.
fn report(available: Option<&str>, error: Option<&str>) -> Option<serde_json::Value> {
    use std::io::{Read, Write};
    let body = serde_json::json!({ "available": available, "error": error }).to_string();
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let mut conn = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).ok()?;
    let _ = conn.set_read_timeout(Some(Duration::from_secs(10)));
    let req = format!(
        "POST /api/app/update HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nX-Switchboard: 1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    conn.write_all(req.as_bytes()).ok()?;
    let mut out = String::new();
    conn.read_to_string(&mut out).ok()?;
    if !out.starts_with("HTTP/1.1 200") { return None; }
    let rest = &out[out.find("\r\n\r\n")? + 4..];
    let json = &rest[rest.find('{')?..=rest.rfind('}')?];
    serde_json::from_str(json).ok()
}

fn install(app: &AppHandle, update: &tauri_plugin_updater::Update) -> Result<(), String> {
    // Download first, while Switchboard keeps running; only then stop the server and swap.
    let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).map_err(|e| e.to_string())?;
    stop_server(app);
    match update.install(bytes) {
        Ok(()) => { app.restart(); }
        Err(e) => {
            // Could not swap: carry on with the server as it was.
            app.state::<Server>().quitting.store(false, SeqCst);
            supervise(app.clone());
            Err(e.to_string())
        }
    }
}

fn watch_updates(app: AppHandle) {
    std::thread::spawn(move || {
        sleep(Duration::from_secs(20));
        let mut found: Option<tauri_plugin_updater::Update> = None;
        let mut error: Option<String> = None;
        let mut last_check: Option<Instant> = None;
        let mut check_now = true;
        let mut asked_for: Option<String> = None;
        let mut misses = 0u32;
        loop {
            if check_now || last_check.map_or(true, |t| t.elapsed() > Duration::from_secs(30 * 60)) {
                check_now = false;
                last_check = Some(Instant::now());
                match app.updater().map_err(|e| e.to_string()).and_then(|u| tauri::async_runtime::block_on(u.check()).map_err(|e| e.to_string())) {
                    Ok(u) => { found = u; error = None; }
                    Err(e) => { error = Some(e); }
                }
            }
            let version = found.as_ref().map(|u| u.version.clone());
            match report(version.as_deref(), error.as_deref()) {
                Some(answer) => {
                    misses = 0;
                    if answer["check"].as_bool() == Some(true) { check_now = true; continue; }
                    if answer["install"].as_bool() == Some(true) {
                        if let Some(u) = found.as_ref() {
                            if let Err(e) = install(&app, u) { error = Some(format!("the update did not install ({e})")); }
                        }
                    }
                }
                None => {
                    // Not this app's server (it answers, but never takes a report): ask the old way, once per version.
                    misses = if answering() { misses + 1 } else { 0 };
                    if let (Some(u), true) = (found.as_ref(), misses >= 6) {
                        if asked_for.as_deref() != Some(u.version.as_str()) {
                            asked_for = Some(u.version.clone());
                            let yes = app.dialog()
                                .message(format!("Switchboard {} is ready. Restart now to update? Sessions in tmux keep running.", u.version))
                                .title("Update Switchboard")
                                .buttons(MessageDialogButtons::OkCancelCustom("Restart now".into(), "Later".into()))
                                .blocking_show();
                            if yes { let _ = install(&app, u); }
                        }
                    }
                }
            }
            sleep(Duration::from_secs(5));
        }
    });
}

// Remove Switchboard, in the app: the server has already taken its hooks and
// tools out of the coding agents. Turn off start at login, stop the server,
// delete the data folder (and the app's own window and login notes) if asked,
// and quit. The app itself goes to the Trash by hand.
fn finish_removal(app: &AppHandle, data: bool) {
    let _ = app.autolaunch().disable();
    stop_server(app);
    if data {
        let dir = std::env::var_os("SWITCHBOARD_DATA").map(PathBuf::from)
            .or_else(|| app.path().home_dir().ok().map(|h| h.join(".local").join("share").join("switchboard")));
        if let Some(dir) = dir { let _ = fs::remove_dir_all(dir); }
        if let Ok(dir) = app.path().app_config_dir() { let _ = fs::remove_dir_all(dir); }
    }
    app.exit(0);
}

fn first_run_marker(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("autostart-chosen"))
}

// Linux: the page is drawn by WebKitGTK, which has two known faults on common
// setups (Nov 5 2026). With the IBus input method (Mint, Ubuntu) it holds back
// the last key typed until the next one; with NVIDIA's driver its DMA-BUF
// renderer redraws slowly and burns CPU. Both are turned off here unless the
// person has set them: SWITCHBOARD_KEEP_IBUS=1 keeps IBus (for typing Chinese,
// Japanese or Korean), and WEBKIT_DISABLE_DMABUF_RENDERER=0 keeps the renderer.
#[cfg(target_os = "linux")]
fn linux_webview_fixes() {
    use std::env;
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    let ibus = env::var("GTK_IM_MODULE").map(|v| v == "ibus").unwrap_or(false);
    if ibus && env::var_os("SWITCHBOARD_KEEP_IBUS").is_none() {
        env::set_var("GTK_IM_MODULE", "gtk-im-context-simple");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    linux_webview_fixes();
    let hidden = std::env::args().any(|a| a == "--hidden");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // Not its link-click script: the page is a remote page with no rights to call
        // the app, so that script failed ("open_url not allowed by ACL") and links
        // never opened. on_navigation and on_new_window below open them instead.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_autostart::Builder::new().args(["--hidden"]).build())
        .manage(Server::default())
        .setup(move |app| {
            let handle = app.handle().clone();

            // Starts at login: turned on at the first run, then left to the tray menu's tick.
            let autostart = app.autolaunch();
            if let Some(marker) = first_run_marker(&handle) {
                if !marker.exists() {
                    let _ = autostart.enable();
                    let _ = fs::write(&marker, "on");
                }
            }

            let opener = handle.clone();
            let quitter = handle.clone();
            let opener2 = handle.clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Switchboard")
                .inner_size(1280.0, 860.0)
                .min_inner_size(420.0, 400.0)
                .visible(!hidden && browser().is_none())
                .on_navigation(move |url| {
                    // Ctrl+Q on the page: the same as Quit in the tray.
                    if ours(url) && url.path() == "/app/quit" { stop_server(&quitter); quitter.exit(0); return false; }
                    // Remove Switchboard's last step (public/js/remove.js, lib/uninstall.js).
                    if ours(url) && url.path() == "/app/remove" { finish_removal(&quitter, url.query() == Some("data=1")); return false; }
                    if ours(url) && url.path() == "/app/browser" { open_in_browser(&quitter); return false; }
                    if ours(url) { return true; }
                    if links::may_open_outside(url.scheme()) { let _ = opener.opener().open_url(url.as_str(), None::<&str>); }
                    false
                })
                .on_new_window(move |url, _| {
                    if links::may_open_outside(url.scheme()) { let _ = opener2.opener().open_url(url.as_str(), None::<&str>); }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;

            // Linux: WebKitGTK keeps the microphone off and turns down every
            // request for it without asking, so talk to type could never start.
            // Switched on for Switchboard's own page only, and for sound only.
            #[cfg(target_os = "linux")]
            let _ = window.with_webview(|wv| {
                use webkit2gtk::{glib::prelude::*, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt};
                let view = wv.inner();
                if let Some(settings) = WebViewExt::settings(&view) {
                    settings.set_enable_media_stream(true);
                    settings.set_enable_webrtc(false);
                }
                view.connect_permission_request(|view, request| {
                    let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else { return false };
                    let ours = view.uri().map(|u| u.starts_with("http://127.0.0.1:4747/")).unwrap_or(false);
                    if ours && media.is_for_audio_device() && !media.is_for_video_device() { request.allow(); } else { request.deny(); }
                    true
                });
            });

            // The splash (frontend/index.html) shows until the server answers.
            supervise(handle.clone());
            let w = window.clone();
            std::thread::spawn(move || {
                let began = Instant::now();
                while !answering() && began.elapsed() < Duration::from_secs(60) {
                    sleep(Duration::from_millis(250));
                }
                if answering() {
                    // With a browser window the built-in one stays hidden and never loads the page.
                    match browser() {
                        Some(b) => { if !hidden { show_in_browser(b); } }
                        None => { let _ = w.navigate(Url::parse(APP_URL).unwrap()); }
                    }
                }
            });

            let open = MenuItem::with_id(app, "open", "Open Switchboard", true, None::<&str>)?;
            let in_browser = MenuItem::with_id(app, "browser", "Open in browser", true, None::<&str>)?;
            let login = CheckMenuItem::with_id(app, "login", "Start at login", true, autostart.is_enabled().unwrap_or(false), None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Switchboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &in_browser, &login, &quit])?;
            let login_item = login.clone();
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("Switchboard")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show(app),
                    "browser" => open_in_browser(app),
                    "login" => {
                        let al = app.autolaunch();
                        let on = al.is_enabled().unwrap_or(false);
                        let _ = if on { al.disable() } else { al.enable() };
                        let _ = login_item.set_checked(al.is_enabled().unwrap_or(!on));
                    }
                    "quit" => { stop_server(app); app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;

            watch_updates(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Switchboard");

    app.run(|app, event| match event {
        RunEvent::Exit => stop_server(app),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show(app),
        _ => {}
    });
}
