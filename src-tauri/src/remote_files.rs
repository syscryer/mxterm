use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteFileKind {
    Directory,
    File,
    Symlink,
    Other,
}

impl RemoteFileKind {
    #[cfg(test)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Directory => "directory",
            Self::File => "file",
            Self::Symlink => "symlink",
            Self::Other => "other",
        }
    }

    fn rank(&self) -> u8 {
        match self {
            Self::Directory => 0,
            Self::Symlink => 1,
            Self::File => 2,
            Self::Other => 3,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: RemoteFileKind,
}

pub fn quote_posix_shell(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn parse_remote_list_output(output: &[u8]) -> Vec<RemoteFileEntry> {
    let mut entries = Vec::new();
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();

    for chunk in fields.chunks(3) {
        let [kind, path, name] = chunk else {
            continue;
        };

        entries.push(RemoteFileEntry {
            name: String::from_utf8_lossy(name).to_string(),
            path: String::from_utf8_lossy(path).to_string(),
            kind: find_kind(kind.first().copied()),
        });
    }

    entries.sort_by(compare_remote_entries);
    entries
}

pub fn build_remote_list_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    format!(
        "dir={quoted_path}; \
         if [ ! -d \"$dir\" ]; then printf '%s\\n' \"not a directory: $dir\" >&2; exit 2; fi; \
         case \"$dir\" in /) prefix= ;; *) prefix=$dir ;; esac; \
         for entry in \"$prefix\"/* \"$prefix\"/.[!.]* \"$prefix\"/..?*; do \
           [ -e \"$entry\" ] || [ -L \"$entry\" ] || continue; \
           name=${{entry##*/}}; \
           if [ -L \"$entry\" ]; then kind=l; \
           elif [ -d \"$entry\" ]; then kind=d; \
           elif [ -f \"$entry\" ]; then kind=f; \
           else kind=o; fi; \
           printf '%s\\000%s\\000%s\\000' \"$kind\" \"$entry\" \"$name\"; \
         done"
    )
}

fn find_kind(kind: Option<u8>) -> RemoteFileKind {
    match kind {
        Some(b'd') => RemoteFileKind::Directory,
        Some(b'f') => RemoteFileKind::File,
        Some(b'l') => RemoteFileKind::Symlink,
        _ => RemoteFileKind::Other,
    }
}

fn compare_remote_entries(left: &RemoteFileEntry, right: &RemoteFileEntry) -> std::cmp::Ordering {
    left.kind
        .rank()
        .cmp(&right.kind.rank())
        .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        .then_with(|| left.name.cmp(&right.name))
}

#[cfg(test)]
mod tests {
    use super::{build_remote_list_command, parse_remote_list_output, quote_posix_shell};

    #[test]
    fn quote_posix_shell_wraps_paths_and_escapes_single_quotes() {
        assert_eq!(quote_posix_shell("/opt/app"), "'/opt/app'");
        assert_eq!(
            quote_posix_shell("/srv/app's data"),
            "'/srv/app'\\''s data'"
        );
        assert_eq!(quote_posix_shell(""), "''");
    }

    #[test]
    fn parse_remote_list_output_maps_types_and_sorts_directories_first() {
        let output = b"f\0/opt/app/app.log\0app.log\0d\0/opt/app/logs\0logs\0l\0/opt/app/current\0current\0o\0/opt/app/socket\0socket\0";

        let entries = parse_remote_list_output(output);

        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].name, "logs");
        assert_eq!(entries[0].kind.as_str(), "directory");
        assert_eq!(entries[1].name, "current");
        assert_eq!(entries[1].kind.as_str(), "symlink");
        assert_eq!(entries[2].name, "app.log");
        assert_eq!(entries[2].kind.as_str(), "file");
        assert_eq!(entries[3].name, "socket");
        assert_eq!(entries[3].kind.as_str(), "other");
    }

    #[test]
    fn parse_remote_list_output_ignores_malformed_trailing_chunks() {
        let output = b"d\0/root/logs\0logs\0f\0/root/app.log\0";

        let entries = parse_remote_list_output(output);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "logs");
    }

    #[test]
    fn build_remote_list_command_uses_posix_shell_globs_not_find_printf() {
        let command = build_remote_list_command("/srv/app's data");

        assert!(command.contains("dir='/srv/app'\\''s data'"));
        assert!(!command.contains("-printf"));
        assert!(command.contains("printf '%s\\000%s\\000%s\\000'"));
        assert!(command.contains("\"$prefix\"/.[!.]*"));
    }
}
