//! Which addresses are Switchboard's own page, and which outside links may be
//! handed to the system to open (docs/REVIEW-2026-11-05.md L3, L4). No
//! dependencies, so `rustc --test src/links.rs` checks it on any computer
//! (test/desktop-links.test.js runs that when rustc is there).

/// The app's own page: the app's built-in pages, or this computer's Switchboard
/// on its own port. Another server on this computer is not it (L4).
pub fn is_ours(scheme: &str, host: Option<&str>, port: Option<u16>, our_port: u16) -> bool {
    match scheme {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => match host {
            Some("127.0.0.1" | "localhost") => port == Some(our_port),
            // Windows serves the app's own files from this name.
            Some("tauri.localhost") => true,
            _ => false,
        },
        _ => false,
    }
}

/// An outside link the system may open: web pages, mail and phone numbers. Never
/// file: (on Windows that runs a program), smb: or another app's own scheme (L3).
pub fn may_open_outside(scheme: &str) -> bool {
    matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https" | "mailto" | "tel")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn our_page_is_this_port_only() {
        assert!(is_ours("http", Some("127.0.0.1"), Some(4747), 4747));
        assert!(is_ours("http", Some("localhost"), Some(4747), 4747));
        assert!(is_ours("http", Some("tauri.localhost"), Some(80), 4747));
        assert!(is_ours("tauri", Some("localhost"), None, 4747));
        // Another server on this computer is not Switchboard: it never loads in the window, and its /app/quit quits nothing.
        assert!(!is_ours("http", Some("127.0.0.1"), Some(8080), 4747));
        assert!(!is_ours("http", Some("localhost"), Some(4801), 4747));
        assert!(!is_ours("https", Some("example.com"), Some(443), 4747));
    }

    #[test]
    fn only_web_mail_and_phone_links_go_outside() {
        for s in ["http", "https", "mailto", "tel", "HTTPS"] { assert!(may_open_outside(s), "{s}"); }
        // file: would run a program on Windows; smb: and an app's own scheme hand control elsewhere.
        for s in ["file", "smb", "javascript", "vscode", "ms-settings", "x-unknown", ""] { assert!(!may_open_outside(s), "{s}"); }
    }
}
