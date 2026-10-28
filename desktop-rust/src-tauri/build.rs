#[path = "build/runtime_icon.rs"]
mod runtime_icon;

fn main() {
    for key in ["VEYMUX_PREVIEW_UPDATE_ENDPOINT", "VEYMUX_PREVIEW_UPDATE_PUBLIC_KEY", "VEYMUX_DESKTOP_CHANNEL", "VEYMUX_STABLE_UPDATE_ENDPOINT", "VEYMUX_STABLE_UPDATE_PUBLIC_KEY"] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    if std::env::var_os("CARGO_FEATURE_DESKTOP").is_some() {
        println!("cargo:rerun-if-changed=../assets/veymux-macos-icon.png");
        println!("cargo:rerun-if-changed=build/runtime_icon.rs");
        runtime_icon::generate(
            std::path::Path::new("../assets/veymux-macos-icon.png"),
            std::path::Path::new(".runtime-icons/icon.png"),
        )
        .expect("Preview runtime icon must be decoded RGBA8 before Tauri codegen");
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
            println!("cargo:rerun-if-changed=native/desktop.m");
            println!("cargo:rerun-if-changed=native/window_chrome.h");
            println!("cargo:rustc-link-lib=proc");
            cc::Build::new()
                .file("native/desktop.m")
                .flag("-fobjc-arc")
                .flag("-fblocks")
                .flag("-mmacosx-version-min=14.0")
                .compile("veymux_preview_desktop");
            for framework in [
                "AppKit",
                "UserNotifications",
                "UniformTypeIdentifiers",
                "ImageIO",
                "CoreGraphics",
                "CoreText",
            ] {
                println!("cargo:rustc-link-lib=framework={framework}");
            }
        }
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .app_manifest(tauri_build::AppManifest::new().commands(&["preview_dispatch"])),
        )
        .expect("Preview build configuration");
    }
}
