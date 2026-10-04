fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "start_saved_fava",
            "stop_saved_fava",
            "fava_host",
            "init_ledger",
            "system_locales",
        ]),
    ))
    .expect("failed to run build script");
}
