//! Compass Desktop - Tauri v2 Backend
//!
//! Provides native desktop support for Compass construction project management
//! with SQLite database, sync capabilities, and cross-platform compatibility.

mod commands;
mod error;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

pub use error::{AppError, Result};

/// Application state shared across all commands
pub struct AppState {
    pub db_path: std::sync::Mutex<Option<String>>,
    pub sync_status: std::sync::Mutex<SyncStatus>,
}

/// Current sync status with remote server
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct SyncStatus {
    pub last_sync: Option<String>,
    pub pending_changes: u64,
    pub is_syncing: bool,
    pub error: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            db_path: std::sync::Mutex::new(None),
            sync_status: std::sync::Mutex::new(SyncStatus::default()),
        }
    }
}

/// Initialize the Tauri application
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Apply Linux/Wayland/NVIDIA compatibility fixes before anything else
    #[cfg(target_os = "linux")]
    {
        let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        let is_wayland = session_type == "wayland";

        // Check for NVIDIA driver via /proc/driver/nvidia
        let has_nvidia = std::path::Path::new("/proc/driver/nvidia").exists();

        if is_wayland && has_nvidia {
            // NVIDIA explicit sync disable - better performance on newer drivers (545+)
            // Only set if user hasn't already configured it
            if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
                std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
            }
            // Note: We don't set WEBKIT_DISABLE_DMABUF_RENDERER here because it forces
            // software rendering which is very slow. If explicit sync doesn't work,
            // users can manually set: WEBKIT_DISABLE_DMABUF_RENDERER=1 bun tauri:dev
        }
    }

    let migrations = vec![
        Migration {
            version: 1,
            description: "Initial schema",
            sql: include_str!("../migrations/initial.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:compass.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // Database commands
            commands::database::db_query,
            commands::database::db_execute,
            commands::database::db_init,
            // Sync commands
            commands::sync::get_sync_status,
            commands::sync::trigger_sync,
            commands::sync::cancel_sync,
            // Platform commands
            commands::platform::get_platform_info,
            commands::platform::get_display_server,
        ])
        .setup(|app| {
            // Get the main window
            let window = app.get_webview_window("main").expect("no main window");

            // Log startup info
            #[cfg(debug_assertions)]
            {
                println!("Compass Desktop starting up...");
                println!("Platform: {}", std::env::consts::OS);
            }

            // On Wayland, disable decorations since the compositor handles window chrome
            #[cfg(target_os = "linux")]
            {
                let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
                let is_wayland = session_type == "wayland";

                if is_wayland {
                    #[cfg(debug_assertions)]
                    println!("Wayland detected - disabling CSD decorations");

                    // Set decorations to false for Wayland
                    let _ = window.set_decorations(false);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
