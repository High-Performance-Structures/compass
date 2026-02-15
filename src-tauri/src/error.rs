//! Error types for the Compass desktop application

use serde::Serialize;
use thiserror::Error;

/// Main application error type
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Sync error: {0}")]
    Sync(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Platform error: {0}")]
    Platform(String),

    #[error("Lock error: {0}")]
    Lock(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
