//! One-way import of the previous product's private data directories.
use std::{fs, io, path::Path};
const PREVIOUS: &str = "termdock";

fn move_once(from: &Path, to: &Path) -> io::Result<()> {
    if !from.exists() || to.exists() { return Ok(()); }
    if let Some(parent) = to.parent() { fs::create_dir_all(parent)?; }
    match fs::rename(from, to) {
        Err(error) if error.kind() == io::ErrorKind::NotFound && to.exists() => Ok(()),
        result => result,
    }
}

pub fn migrate(home: &Path, native_root: &Path) -> io::Result<()> {
    let old = home.join(format!(".{PREVIOUS}"));
    let new = home.join(".veymux");
    move_once(&old, &new)?;
    for suffix in ["-local.pem", "-local-key.pem"] {
        move_once(&new.join("certs").join(format!("{PREVIOUS}{suffix}")),
            &new.join("certs").join(format!("veymux{suffix}")))?;
    }
    for name in ["server.json", "supervisor.json", "desktop.json"] {
        let file = new.join(name);
        if !file.is_file() { continue; }
        let text = fs::read_to_string(&file)?;
        let updated = text.replace(old.to_string_lossy().as_ref(), new.to_string_lossy().as_ref())
            .replace(&format!("{PREVIOUS}-local"), "veymux-local");
        if text != updated {
            let temporary = file.with_extension(format!("{}.migration", std::process::id()));
            fs::write(&temporary, updated)?;
            fs::set_permissions(&temporary, fs::metadata(&file)?.permissions())?;
            fs::rename(temporary, file)?;
        }
    }
    for suffix in ["", ".preview"] {
        move_once(&native_root.join(format!("com.jovines.{PREVIOUS}{suffix}")),
            &native_root.join(format!("com.jovines.veymux{suffix}")))?;
    }
    move_once(&native_root.join("Termdock"), &native_root.join("Veymux"))?;
    // WKWebView device credentials live outside the application support folder.
    for container in ["WebKit", "Caches"] {
        let root = home.join("Library").join(container);
        for suffix in ["", ".preview"] {
            move_once(&root.join(format!("com.jovines.{PREVIOUS}{suffix}")),
                &root.join(format!("com.jovines.veymux{suffix}")))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn moves_identity_and_native_profiles_without_overwriting_a_new_install() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join(format!(".{PREVIOUS}"));
        fs::create_dir_all(old.join("federation")).unwrap();
        fs::write(old.join("federation/identity.key"), b"private-key").unwrap();
        let native = dir.path().join("Library/Application Support");
        let old_native = native.join(format!("com.jovines.{PREVIOUS}"));
        fs::create_dir_all(&old_native).unwrap();
        fs::write(old_native.join("connections.json"), b"connections").unwrap();
        migrate(dir.path(), &native).unwrap();
        assert!(!old.exists());
        assert_eq!(fs::read(dir.path().join(".veymux/federation/identity.key")).unwrap(), b"private-key");
        assert_eq!(fs::read(native.join("com.jovines.veymux/connections.json")).unwrap(), b"connections");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("important"), b"keep").unwrap();
        migrate(dir.path(), &native).unwrap();
        assert_eq!(fs::read(old.join("important")).unwrap(), b"keep");
    }
}
