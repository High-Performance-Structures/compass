//! Sync commands for offline-first data synchronization
//!
//! Manages synchronization between local SQLite and remote server.

use std::sync::Arc;
use tauri::{Emitter, State};

use crate::error::{AppError, Result};
use crate::SyncStatus;

/// Get the current sync status
#[tauri::command]
pub async fn get_sync_status(state: State<'_, crate::AppState>) -> Result<SyncStatus> {
    let status = state
        .sync_status
        .lock()
        .map_err(|e| AppError::Lock(e.to_string()))?;

    Ok(status.clone())
}

/// Trigger a sync with the remote server
#[tauri::command]
pub async fn trigger_sync(
    api_base: String,
    state: State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<SyncStatus> {
    // Update status to indicate syncing
    {
        let mut status = state
            .sync_status
            .lock()
            .map_err(|e| AppError::Lock(e.to_string()))?;
        status.is_syncing = true;
        status.error = None;
    }

    // Emit sync started event
    let _ = app.emit("sync-started", ());

    // Get a clone of the current status to pass to background task
    let current_status = {
        let status = state
            .sync_status
            .lock()
            .map_err(|e| AppError::Lock(e.to_string()))?;
        status.clone()
    };

    // Create an Arc<Mutex> for the background task to update status
    let status_mutex = Arc::new(std::sync::Mutex::new(current_status));
    let app_handle = app.clone();
    let api_url = api_base.clone();

    tokio::spawn(async move {
        match perform_sync(&api_url, &status_mutex).await {
            Ok(_) => {
                let _ = app_handle.emit("sync-complete", ());
            }
            Err(e) => {
                let _ = app_handle.emit("sync-error", e.to_string());
            }
        }
    });

    get_sync_status(state).await
}

/// Cancel an ongoing sync operation
#[tauri::command]
pub async fn cancel_sync(state: State<'_, crate::AppState>) -> Result<SyncStatus> {
    let mut status = state
        .sync_status
        .lock()
        .map_err(|e| AppError::Lock(e.to_string()))?;

    status.is_syncing = false;
    status.error = Some("Sync cancelled by user".into());

    Ok(status.clone())
}

/// Internal sync implementation
async fn perform_sync(
    _api_base: &str,
    status_mutex: &Arc<std::sync::Mutex<SyncStatus>>,
) -> Result<()> {
    // TODO: Implement actual sync logic
    // 1. Get pending changes from local DB
    // 2. Push changes to server
    // 3. Pull remote changes
    // 4. Resolve conflicts
    // 5. Update sync metadata

    // Simulate sync delay for now
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Update status on completion
    if let Ok(mut status) = status_mutex.lock() {
        status.is_syncing = false;
        status.last_sync = Some(chrono::Utc::now().to_rfc3339());
    }

    Ok(())
}

/// Sync metadata table structure
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncMetadata {
    pub table_name: String,
    pub last_sync_at: Option<String>,
    pub sync_version: i64,
    pub pending_count: i64,
}
