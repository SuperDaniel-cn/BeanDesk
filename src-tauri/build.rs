fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "start_saved_fava",
            "stop_saved_fava",
            "fava_host",
            "init_ledger",
            "system_locales",
            "load_backup_settings",
            "save_backup_settings",
            "backup_status",
            "backup_now",
            "backup_export",
            "backup_set_key",
            "backup_restore",
            "backup_test_s3",
            "backup_open_workdir",
        ]),
    ))
    .expect("failed to run build script");
}
