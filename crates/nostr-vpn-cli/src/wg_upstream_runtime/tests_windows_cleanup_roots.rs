#[cfg(target_os = "windows")]
#[test]
fn cleanup_accepts_absent_roots_but_rejects_existing_unsafe_ancestors() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("nvpn-cleanup-roots-{nonce}"));
    std::fs::create_dir(&root).expect("owned fixture root");
    let app = root.join("app");
    let config = app.join("wireguard");
    ensure_windows_native_wireguard_config_root_is_safe(&config)
        .expect("absent root is already clean");
    assert!(!app.exists(), "cleanup must not create missing roots");

    std::fs::write(&app, b"foreign file").expect("non-directory ancestor");
    assert!(
        ensure_windows_native_wireguard_config_root_is_safe(&config)
            .expect_err("existing non-directory cannot count as absent")
            .to_string()
            .contains("not a directory")
    );
    assert_eq!(std::fs::read(&app).unwrap(), b"foreign file");
    std::fs::remove_file(&app).unwrap();

    let target = root.join("foreign");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep"), b"foreign contents").unwrap();
    // Directory junction creation does not require developer mode or symlink privileges.
    let junction = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&app)
        .arg(&target)
        .output()
        .expect("create owned fixture junction");
    assert!(
        junction.status.success(),
        "{}",
        String::from_utf8_lossy(&junction.stderr)
    );
    assert!(
        ensure_windows_native_wireguard_config_root_is_safe(&config)
            .expect_err("reparse ancestor must not count as an absent child")
            .to_string()
            .contains("reparse point")
    );
    assert_eq!(
        std::fs::read(target.join("keep")).unwrap(),
        b"foreign contents"
    );
    std::fs::remove_dir(&app).expect("remove only fixture junction");
    std::fs::remove_dir_all(&root).expect("remove owned fixture");
}
