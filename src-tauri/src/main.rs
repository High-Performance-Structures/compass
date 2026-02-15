//! Compass Desktop Entry Point
//!
//! This is the main entry point for the Tauri desktop application.
//! The actual application logic lives in the lib.rs for mobile compatibility.

// Prevents additional console window on Windows in release
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    compass_lib::run()
}
