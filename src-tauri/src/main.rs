// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if app_lib::is_mcp_launch() {
        if let Err(error) = app_lib::run_mcp() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    app_lib::run();
}
