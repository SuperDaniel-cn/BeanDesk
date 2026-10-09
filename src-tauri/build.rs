fn main() {
    // Frozen engine is gitignored. cargo test still walks bundle.resources.
    let engine = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("binaries")
        .join("engine");
    if !engine.exists() {
        std::fs::create_dir_all(&engine).expect("placeholder engine dir");
    }

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "start_saved_fava",
            "stop_saved_fava",
            "fava_host",
            "init_ledger",
            "inspect_ledger",
            "upgrade_ledger",
            "list_ledger_packs",
            "start_if_enabled",
            "read_user_text_file",
            "mcp_host_config",
            "system_locales",
            "load_backup_settings",
            "save_backup_settings",
            "backup_status",
            "backup_now",
            "backup_set_key",
            "backup_restore",
            "backup_snapshots",
            "backup_test_s3",
            "backup_open_workdir",
            "open_url",
            "policy_status",
            "policy_approve",
            "policy_revert",
            "policy_switch_locale",
            "policy_follow_workdir",
        ]),
    ))
    .expect("failed to run build script");
}
