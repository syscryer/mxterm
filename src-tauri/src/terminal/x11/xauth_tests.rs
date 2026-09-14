use super::*;

#[cfg(windows)]
fn authority_with(values: &[(&str, &str)]) -> Result<AuthorityFile, AppError> {
    AuthorityFile::windows(|key| {
        values
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| (*value).into())
    })
}

#[test]
#[cfg(windows)]
fn windows_default_is_absolute_and_respects_explicit_authority_and_home() {
    for (variables, expected, source) in [
        (
            vec![
                ("USERPROFILE", r"C:\Users\test"),
                ("HOMEPATH", r"\Users\test"),
            ],
            r"C:\Users\test\.Xauthority",
            "USERPROFILE",
        ),
        (
            vec![("HOME", r"E:\X11 Home"), ("USERPROFILE", r"C:\Users\test")],
            r"E:\X11 Home\.Xauthority",
            "HOME",
        ),
        (
            vec![
                ("XAUTHORITY", r"F:\X11\custom.auth"),
                ("HOME", "/c/Users/test"),
            ],
            r"F:\X11\custom.auth",
            "XAUTHORITY",
        ),
        (
            vec![("XAUTHORITY", r"relative\custom.auth")],
            r"relative\custom.auth",
            "XAUTHORITY",
        ),
        (
            vec![
                ("XAUTHORITY", ""),
                ("HOME", ""),
                ("USERPROFILE", r"C:\Users\test"),
            ],
            r"C:\Users\test\.Xauthority",
            "USERPROFILE",
        ),
    ] {
        let authority = authority_with(&variables).unwrap();
        assert_eq!(authority.path.unwrap(), PathBuf::from(expected));
        assert_eq!(authority.source, source);
    }
}

#[test]
#[cfg(windows)]
fn windows_invalid_home_never_silently_uses_a_different_authority() {
    for home in [r"\Users\test", r"C:Users\test", "/c/Users/test", "relative"] {
        let failure = authority_with(&[("HOME", home), ("USERPROFILE", r"C:\Users\test")])
            .err()
            .unwrap();
        assert_eq!(failure.code, "x11_authority_path_invalid");
        assert!(failure.raw_message.contains("HOME"));
    }
    assert_eq!(
        authority_with(&[]).err().unwrap().code,
        "x11_authority_path_invalid"
    );
}

#[test]
fn temporary_authority_overrides_environment_without_changing_global_state() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("authority");
    let before = std::env::var_os("XAUTHORITY");
    let authority = AuthorityFile::resolve(Some(&file)).unwrap();
    assert_eq!(authority.path.as_deref(), Some(file.as_path()));
    assert_eq!(std::env::var_os("XAUTHORITY"), before);
}

#[test]
fn xauth_diagnostics_preserve_failure_class_status_and_path_without_echoing_secrets() {
    let authority = AuthorityFile {
        path: Some(PathBuf::from("test-authority")),
        environment_path: None,
        source: "test",
    };
    for (stderr, code, reason) in [
        (
            "error in locking authority file",
            "x11_authority_lock_failed",
            "error locking authority file",
        ),
        (
            "timeout in locking authority file",
            "x11_authority_lock_failed",
            "error locking authority file",
        ),
        (
            "unable to open authority file",
            "x11_authority_access_failed",
            "unable to access authority file",
        ),
        (
            "couldn't query Security extension",
            "x11_security_unavailable",
            "SECURITY extension",
        ),
        (
            "could not query SECURITY extension",
            "x11_security_unavailable",
            "SECURITY extension",
        ),
        (
            "unable to open display",
            "x11_xauth_display_failed",
            "unable to open display",
        ),
        (
            "couldn't generate authorization",
            "x11_untrusted_failed",
            "generate authorization",
        ),
        (
            "could not generate authorization",
            "x11_untrusted_failed",
            "generate authorization",
        ),
        (
            "unknown problem",
            "x11_xauth_failed",
            "unrecognized stderr omitted",
        ),
    ] {
        let output = format!("xauth: {stderr}\nadd :0 MIT-MAGIC-COOKIE-1 0123456789abcdef0123456789abcdef\nCookie: split-secret-value\x1b[31m");
        let failure = execution_error("exit code: 1", output.as_bytes(), &authority);
        assert_eq!(failure.code, code);
        assert!(failure.raw_message.contains(reason));
        assert!(failure.raw_message.contains("exit code: 1"));
        assert!(failure.raw_message.contains("test-authority"));
        assert!(!failure.raw_message.contains("012345"));
        assert!(!failure.raw_message.contains("split-secret"));
        assert!(!failure.raw_message.contains('\x1b'));
    }
    let failure = execution_error("exit code: 2", b"", &authority);
    assert_eq!(failure.code, "x11_xauth_failed");
}

#[test]
fn diagnostic_path_is_bounded_and_cannot_inject_terminal_controls() {
    let path = PathBuf::from(format!("a\x1b\n{}", "文".repeat(2000)));
    let text = safe_path_text(&path);
    assert_eq!(text.chars().count(), 512);
    assert!(!text.chars().any(char::is_control));
}
