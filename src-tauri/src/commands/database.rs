//! Database commands for SQLite operations
//!
//! Provides query and execute commands that interface with the local SQLite
//! database for offline-first data storage.

use serde_json::Value;
use tauri::{Manager, State};

use crate::error::{AppError, Result};

/// Initialize the local SQLite database with schema
#[tauri::command]
pub async fn db_init(
    app: tauri::AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<String> {
    // Get the app data directory
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Platform(e.to_string()))?;

    // Ensure the directory exists
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("compass.db");
    let db_path_str = db_path.to_string_lossy().to_string();

    // Store the path in state
    {
        let mut path_guard = state
            .db_path
            .lock()
            .map_err(|e| AppError::Lock(e.to_string()))?;
        *path_guard = Some(db_path_str.clone());
    }

    // Migrations are handled automatically by tauri-plugin-sql Builder in lib.rs
    // This command returns the database path for frontend reference
    Ok(db_path_str)
}

/// Execute a SELECT query and return results as JSON
///
/// Note: This uses the frontend SQL plugin via invoke.
/// The actual database operations are handled by tauri-plugin-sql.
#[tauri::command]
pub async fn db_query(
    sql: String,
    params: Vec<Value>,
    app: tauri::AppHandle,
) -> Result<Vec<Value>> {
    // Use the SQL plugin's built-in JavaScript API from frontend instead
    // This is a placeholder for direct Rust-side queries
    let _ = (app, sql, params);
    Err(AppError::InvalidInput(
        "Use @tauri-apps/plugin-sql from frontend instead".into(),
    ))
}

/// Execute an INSERT, UPDATE, or DELETE statement
///
/// Note: This uses the frontend SQL plugin via invoke.
/// The actual database operations are handled by tauri-plugin-sql.
#[tauri::command]
pub async fn db_execute(
    sql: String,
    params: Vec<Value>,
    app: tauri::AppHandle,
) -> Result<u64> {
    // Use the SQL plugin's built-in JavaScript API from frontend instead
    // This is a placeholder for direct Rust-side queries
    let _ = (app, sql, params);
    Err(AppError::InvalidInput(
        "Use @tauri-apps/plugin-sql from frontend instead".into(),
    ))
}
