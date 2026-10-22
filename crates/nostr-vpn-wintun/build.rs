use sha2::{Digest, Sha256};
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let source = find_wintun_dll().unwrap_or_else(|error| panic!("{error}"));

    println!("cargo:rerun-if-changed={}", source.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let profile = env::var("PROFILE").expect("PROFILE");
    let Some(target_dir) = out_dir
        .ancestors()
        .find(|path| path.file_name() == Some(OsStr::new(&profile)))
        .map(Path::to_path_buf)
    else {
        println!("cargo:warning=failed to derive target profile dir from OUT_DIR");
        return;
    };

    let target_dll = target_dir.join("wintun.dll");
    let already_current = files_identical(&source, &target_dll).unwrap_or(false);
    if !already_current {
        fs::copy(&source, &target_dll).unwrap_or_else(|error| {
            panic!(
                "failed to copy wintun.dll from {} to {}: {error}",
                source.display(),
                target_dll.display()
            )
        });
    }

    println!(
        "cargo:rustc-env=NOSTR_VPN_WINTUN_DLL_SOURCE={}",
        target_dll.display()
    );
}

fn files_identical(left: &Path, right: &Path) -> io::Result<bool> {
    if fs::metadata(left)?.len() != fs::metadata(right)?.len() {
        return Ok(false);
    }
    Ok(fs::read(left)? == fs::read(right)?)
}

fn find_wintun_dll() -> Result<PathBuf, String> {
    let arch_dir = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86") => "x86",
        Ok("x86_64") => "amd64",
        Ok("arm") => "arm",
        Ok("aarch64") => "arm64",
        Ok(other) => return Err(format!("unsupported windows arch {other}")),
        Err(error) => return Err(error.to_string()),
    };

    let cargo_home = env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(default_cargo_home)
        .ok_or_else(|| "unable to resolve cargo home".to_string())?;
    let registry_src = cargo_home.join("registry").join("src");
    let registries = fs::read_dir(&registry_src).map_err(|error| {
        format!(
            "failed to read cargo registry source root {}: {error}",
            registry_src.display()
        )
    })?;

    // Digests from the Cargo.lock-authenticated wintun 0.5.1 crate. Never
    // select a similarly named crate or a different cached dependency version.
    let expected = match arch_dir {
        "amd64" => "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce",
        "x86" => "d694fa46ab4cfebcb2632d094c7aa97278eef2f8052438621766d863ae98a931",
        "arm" => "daad267411ecdc70a0535e274d2c3e9da3d0084bdac7662cb8424dd4a031b4d9",
        "arm64" => "f7ba89005544be9d85231a9e0d5f23b2d15b3311667e2dad0debd344918a3f80",
        _ => unreachable!(),
    };
    for registry in registries {
        let registry = registry.map_err(|error| error.to_string())?;
        let packages = fs::read_dir(registry.path()).map_err(|error| error.to_string())?;
        for package in packages {
            let package = package.map_err(|error| error.to_string())?;
            let name = package.file_name();
            if name != OsStr::new("wintun-0.5.1") {
                continue;
            }

            let candidate = package
                .path()
                .join("wintun")
                .join("bin")
                .join(arch_dir)
                .join("wintun.dll");
            if candidate.is_file() {
                let bytes = fs::read(&candidate).map_err(|error| error.to_string())?;
                if format!("{:x}", Sha256::digest(&bytes)) != expected {
                    return Err("wintun 0.5.1 DLL does not match its reviewed content hash".into());
                }
                return Ok(candidate);
            }
        }
    }

    Err(format!(
        "wintun.dll for architecture {arch_dir} not found under {}",
        registry_src.display()
    ))
}

fn default_cargo_home() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .map(|home| home.join(".cargo"))
}
