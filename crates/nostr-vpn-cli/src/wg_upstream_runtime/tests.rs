#[cfg(test)]
mod tests {
    use super::*;
    static PENDING_CLEANUP_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    include!("tests_windows_route_ownership.rs");
    include!("tests_windows_route_parsing.rs");
    include!("tests_windows_cleanup_roots.rs");
    #[cfg(target_os = "macos")]
    include!("tests_macos_route_ownership.rs");
}
