fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "start_saved_fava",
            "stop_saved_fava",
            "fava_host",
            "fava_installed",
            "system_locales",
        ]),
    ))
    .expect("failed to run build script");
}
