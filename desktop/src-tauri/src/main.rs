// The Switchboard app: a window on http://127.0.0.1:4747, and the server behind it.
//
// Kept small on purpose. Everything Switchboard does lives in the Node server
// (server.js); this only:
//   - starts that server (a bundled Node, the app's files as resources) when
//     nothing answers on 4747, and starts it again if it stops;
//   - leaves alone a Switchboard that is already running (a git checkout's
//     systemd / launchd service), and just shows it;
//   - closing the window hides it (reminders and notifications keep coming);
//     Quit in the tray menu stops the server it started and exits;
//   - one copy at a time, window size remembered, start at login, updates from
//     GitHub Releases (signed; asks before restarting).
// See desktop/README.md for why it is built this way.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
const URL: &str = "http://127.0.0.1:4747/";

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

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn ours(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost")),
        _ => false,
    }
}

// Updates: at start and every six hours. Asks before restarting.
fn watch_updates(app: AppHandle) {
    std::thread::spawn(move || {
        sleep(Duration::from_secs(30));
        loop {
            let found = app.updater().ok().and_then(|u| tauri::async_runtime::block_on(u.check()).ok().flatten());
            if let Some(update) = found {
                let yes = app.dialog()
                    .message(format!("Switchboard {} is ready. Restart now to update? Sessions in tmux keep running.", update.version))
                    .title("Update Switchboard")
                    .buttons(MessageDialogButtons::OkCancelCustom("Restart now".into(), "Later".into()))
                    .blocking_show();
                if yes {
                    stop_server(&app);
                    if tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {})).is_ok() {
                        app.restart();
                    }
                    // The download failed: carry on with the server as it was.
                    app.state::<Server>().quitting.store(false, SeqCst);
                    supervise(app.clone());
                }
            }
            sleep(Duration::from_secs(6 * 3600));
        }
    });
}

fn first_run_marker(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("autostart-chosen"))
}

fn main() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            let opener2 = handle.clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Switchboard")
                .inner_size(1280.0, 860.0)
                .min_inner_size(420.0, 400.0)
                .visible(!hidden)
                .on_navigation(move |url| {
                    if ours(url) { return true; }
                    let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .on_new_window(move |url, _| {
                    let _ = opener2.opener().open_url(url.as_str(), None::<&str>);
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;

            // The splash (frontend/index.html) shows until the server answers.
            supervise(handle.clone());
            let w = window.clone();
            std::thread::spawn(move || {
                let began = Instant::now();
                while !answering() && began.elapsed() < Duration::from_secs(60) {
                    sleep(Duration::from_millis(250));
                }
                if answering() {
                    let _ = w.navigate(Url::parse(URL).unwrap());
                }
            });

            let open = MenuItem::with_id(app, "open", "Open Switchboard", true, None::<&str>)?;
            let login = CheckMenuItem::with_id(app, "login", "Start at login", true, autostart.is_enabled().unwrap_or(false), None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Switchboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &login, &quit])?;
            let login_item = login.clone();
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("Switchboard")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show(app),
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
