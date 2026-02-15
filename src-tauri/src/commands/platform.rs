//! Platform detection commands
//!
//! Provides information about the current platform, including display server
//! detection for Linux (X11 vs Wayland).

use std::env;

use crate::error::Result;

/// Platform information returned to the frontend
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub family: String,
    pub display_server: Option<DisplayServer>,
    pub is_desktop: bool,
    pub is_mobile: bool,
}

/// Display server type for Linux systems
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayServer {
    X11,
    Wayland,
    Unknown,
}

/// Get comprehensive platform information
#[tauri::command]
pub fn get_platform_info() -> Result<PlatformInfo> {
    let os = env::consts::OS.to_string();
    let arch = env::consts::ARCH.to_string();
    let family = env::consts::FAMILY.to_string();

    let display_server = if os == "linux" {
        Some(get_display_server())
    } else {
        None
    };

    Ok(PlatformInfo {
        os,
        arch,
        family,
        display_server,
        is_desktop: true,
        is_mobile: false,
    })
}

/// Get the display server type (Linux only)
#[tauri::command]
pub fn get_display_server() -> DisplayServer {
    // Check WAYLAND_DISPLAY first (most reliable)
    if env::var("WAYLAND_DISPLAY").is_ok() {
        return DisplayServer::Wayland;
    }

    // Check XDG_SESSION_TYPE
    if let Ok(session_type) = env::var("XDG_SESSION_TYPE") {
        match session_type.to_lowercase().as_str() {
            "wayland" => return DisplayServer::Wayland,
            "x11" | "x" => return DisplayServer::X11,
            _ => {}
        }
    }

    // Check DISPLAY (indicates X11)
    if env::var("DISPLAY").is_ok() {
        return DisplayServer::X11;
    }

    // Check for Wayland-specific environment variables
    if env::var("WAYLAND_SOCKET").is_ok() {
        return DisplayServer::Wayland;
    }

    DisplayServer::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_info_serialization() {
        let info = PlatformInfo {
            os: "linux".to_string(),
            arch: "x86_64".to_string(),
            family: "unix".to_string(),
            display_server: Some(DisplayServer::Wayland),
            is_desktop: true,
            is_mobile: false,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("wayland"));
    }
}
