use portable_pty::{CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::path::Path;

use crate::app_error::AppError;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalTerminalProfile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub platform: String,
    pub source: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub icon: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub detected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalTerminalProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub platform: String,
    pub source: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub icon: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub detected: bool,
}

#[derive(Clone, Debug, Default)]
pub struct LocalTerminalProfileQuery {
    pub platform: Option<String>,
    pub hidden_profile_ids: Vec<String>,
}

pub fn list_local_terminal_profiles(
    query: LocalTerminalProfileQuery,
) -> Result<Vec<LocalTerminalProfile>, AppError> {
    let requested_platform = normalize_platform_filter(query.platform.as_deref());
    let current_platform = current_platform();
    let should_include_current = requested_platform
        .as_deref()
        .map(|platform| platform == "all" || platform == current_platform)
        .unwrap_or(true);

    let mut profiles = if should_include_current {
        detect_current_platform_profiles()?
    } else {
        Vec::new()
    };

    let hidden_ids = query
        .hidden_profile_ids
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<BTreeSet<_>>();

    profiles.retain(|profile| !hidden_ids.contains(&profile.id));
    profiles.sort_by(|left, right| {
        profile_rank(left)
            .cmp(&profile_rank(right))
            .then(left.name.cmp(&right.name))
            .then(left.id.cmp(&right.id))
    });
    Ok(profiles)
}

pub fn build_command(profile: &LocalTerminalProfile, cwd: Option<&str>) -> CommandBuilder {
    let mut command = CommandBuilder::new(profile.command.as_str());
    command.args(profile.args.iter().map(|arg| arg.as_str()));
    for (key, value) in &profile.env {
        command.env(key, value);
    }

    if let Some(target_cwd) = cwd
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            profile
                .cwd
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
    {
        command.cwd(target_cwd);
    }

    command
}

pub fn default_profile_id(profiles: &[LocalTerminalProfile]) -> Option<String> {
    profiles
        .iter()
        .min_by_key(|profile| profile_rank(profile))
        .map(|profile| profile.id.clone())
}

pub fn build_pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn detect_current_platform_profiles() -> Result<Vec<LocalTerminalProfile>, AppError> {
    #[cfg(windows)]
    {
        detect_windows_profiles()
    }

    #[cfg(target_os = "macos")]
    {
        Ok(detect_unix_profiles("macos"))
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Ok(detect_unix_profiles("linux"))
    }
}

#[cfg(windows)]
fn detect_windows_profiles() -> Result<Vec<LocalTerminalProfile>, AppError> {
    let mut profiles = Vec::new();

    if let Some(command) = find_windows_command(&["pwsh.exe", "pwsh"]) {
        profiles.push(build_profile(
            "pwsh",
            "PowerShell 7",
            "powershell_core",
            "windows",
            command,
            vec!["-NoLogo".to_string(), "-NoProfile".to_string()],
            "terminal-powershell",
        ));
    }

    if let Some(command) = find_windows_command(&["powershell.exe"]) {
        profiles.push(build_profile(
            "powershell",
            "Windows PowerShell",
            "powershell",
            "windows",
            command,
            vec!["-NoLogo".to_string(), "-NoProfile".to_string()],
            "terminal-powershell",
        ));
    }

    if let Some(command) = find_windows_command(&["cmd.exe"]) {
        profiles.push(build_profile(
            "cmd",
            "命令提示符",
            "cmd",
            "windows",
            command,
            Vec::new(),
            "terminal-cmd",
        ));
    }

    if let Some(command) = find_windows_command(&["git-bash.exe", "bash.exe"]) {
        profiles.push(build_profile(
            "git_bash",
            "Git Bash",
            "git_bash",
            "windows",
            command,
            vec!["--login".to_string(), "-i".to_string()],
            "terminal-git-bash",
        ));
    }

    let wsl_distributions = detect_wsl_distributions()?;
    if !wsl_distributions.is_empty() {
        let wsl_command =
            find_windows_command(&["wsl.exe"]).unwrap_or_else(|| "wsl.exe".to_string());
        for distro in wsl_distributions {
            let distro_id = sanitize_profile_token(&distro);
            profiles.push(build_profile(
                &format!("wsl-{distro_id}"),
                &format!("WSL · {distro}"),
                "wsl",
                "windows",
                wsl_command.clone(),
                vec!["-d".to_string(), distro.clone()],
                "terminal-wsl",
            ));
        }
    }

    Ok(profiles)
}

#[cfg(windows)]
fn find_windows_command(candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .find_map(|candidate| find_windows_command_single(candidate))
}

#[cfg(windows)]
fn find_windows_command_single(command: &str) -> Option<String> {
    let path = env::var_os("PATH");
    let extensions = env::var_os("PATHEXT")
        .map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![".EXE".to_string(), ".BAT".to_string(), ".CMD".to_string()]);

    if let Some(path) = path {
        for dir in env::split_paths(&path) {
            let direct = dir.join(command);
            if direct.exists() {
                return Some(direct.to_string_lossy().to_string());
            }

            let has_extension = Path::new(command).extension().is_some();
            if has_extension {
                continue;
            }

            for extension in &extensions {
                let candidate = dir.join(format!("{command}{extension}"));
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }

    windows_fallback_command(command)
}

#[cfg(windows)]
fn windows_fallback_command(command: &str) -> Option<String> {
    let windows_root = env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let fallback = match command.to_ascii_lowercase().as_str() {
        "powershell.exe" => Some(format!(
            "{windows_root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        )),
        "cmd.exe" => Some(format!("{windows_root}\\System32\\cmd.exe")),
        "wsl.exe" => Some(format!("{windows_root}\\System32\\wsl.exe")),
        _ => None,
    }?;

    if Path::new(&fallback).exists() {
        Some(fallback)
    } else {
        None
    }
}

#[cfg(windows)]
fn detect_wsl_distributions() -> Result<Vec<String>, AppError> {
    let Some(wsl_command) = find_windows_command(&["wsl.exe"]) else {
        return Ok(Vec::new());
    };

    let output = std::process::Command::new(wsl_command)
        .args(["-l", "-q"])
        .output()
        .map_err(|error| {
            AppError::new(
                "local_terminal_profile_detect_failed",
                "WSL 发行版探测失败。",
                error,
                true,
            )
        })?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    Ok(parse_wsl_distributions_stdout(&output.stdout))
}

#[cfg(windows)]
fn parse_wsl_distributions_stdout(stdout: &[u8]) -> Vec<String> {
    decode_wsl_distributions_stdout(stdout)
        .lines()
        .map(|line| line.trim_matches(|ch: char| ch.is_whitespace() || ch == '\0'))
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect()
}

#[cfg(windows)]
fn decode_wsl_distributions_stdout(stdout: &[u8]) -> String {
    if stdout.is_empty() {
        return String::new();
    }

    if stdout.len() >= 2 {
        let bom = u16::from_le_bytes([stdout[0], stdout[1]]);
        if bom == 0xFEFF {
            return decode_utf16_bytes(&stdout[2..], true);
        }
        if bom == 0xFFFE {
            return decode_utf16_bytes(&stdout[2..], false);
        }
    }

    if looks_like_utf16(stdout, true) {
        return decode_utf16_bytes(stdout, true);
    }
    if looks_like_utf16(stdout, false) {
        return decode_utf16_bytes(stdout, false);
    }

    String::from_utf8_lossy(stdout).replace('\0', "")
}

#[cfg(windows)]
fn decode_utf16_bytes(bytes: &[u8], little_endian: bool) -> String {
    let units = bytes
        .chunks_exact(2)
        .map(|chunk| {
            if little_endian {
                u16::from_le_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], chunk[1]])
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&units)
}

#[cfg(windows)]
fn looks_like_utf16(bytes: &[u8], little_endian: bool) -> bool {
    let mut pairs = 0_usize;
    let mut zeroes = 0_usize;
    for chunk in bytes.chunks_exact(2) {
        pairs += 1;
        let marker = if little_endian { chunk[1] } else { chunk[0] };
        if marker == 0 {
            zeroes += 1;
        }
    }

    pairs > 0 && zeroes * 2 >= pairs
}

#[cfg(any(unix, target_os = "macos"))]
fn detect_unix_profiles(platform: &str) -> Vec<LocalTerminalProfile> {
    let mut profiles = Vec::new();

    if let Some(shell) = env::var_os("SHELL")
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.trim().is_empty())
    {
        let shell_path = shell.trim().to_string();
        let shell_name = Path::new(&shell_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("shell")
            .to_ascii_lowercase();
        profiles.push(build_profile(
            &format!("login-{shell_name}"),
            &format!("登录 Shell ({shell_name})"),
            &shell_name,
            platform,
            shell_path,
            Vec::new(),
            "terminal-shell",
        ));
    }

    for (id, name, kind, command, icon) in [
        (
            "pwsh",
            "PowerShell 7",
            "pwsh",
            "pwsh",
            "terminal-powershell",
        ),
        ("zsh", "zsh", "zsh", "zsh", "terminal-zsh"),
        ("bash", "bash", "bash", "bash", "terminal-bash"),
        ("fish", "fish", "fish", "fish", "terminal-fish"),
    ] {
        if command_exists(command) {
            profiles.push(build_profile(
                id,
                name,
                kind,
                platform,
                command.to_string(),
                Vec::new(),
                icon,
            ));
        }
    }

    dedupe_profiles(profiles)
}

fn build_profile(
    id: &str,
    name: &str,
    kind: &str,
    platform: &str,
    command: String,
    args: Vec<String>,
    icon: &str,
) -> LocalTerminalProfile {
    LocalTerminalProfile {
        id: id.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        platform: platform.to_string(),
        source: "detected".to_string(),
        command,
        args,
        cwd: None,
        env: BTreeMap::new(),
        icon: icon.to_string(),
        hidden: false,
        detected: true,
    }
}

#[cfg(any(unix, target_os = "macos"))]
fn dedupe_profiles(profiles: Vec<LocalTerminalProfile>) -> Vec<LocalTerminalProfile> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::new();
    for profile in profiles {
        let key = format!(
            "{}|{}|{}",
            profile.kind,
            profile.command,
            profile.args.join("\u{1f}")
        );
        if seen.insert(key) {
            deduped.push(profile);
        }
    }
    deduped
}

fn profile_rank(profile: &LocalTerminalProfile) -> (u8, String, String) {
    let priority = match profile.kind.as_str() {
        "powershell_core" | "pwsh" => 0,
        "powershell" => 1,
        "cmd" => 2,
        "wsl" => 3,
        "git_bash" => 4,
        "bash" => 5,
        "zsh" => 6,
        "fish" => 7,
        _ => 20,
    };

    (priority, profile.kind.clone(), profile.name.clone())
}

fn normalize_platform_filter(platform: Option<&str>) -> Option<String> {
    platform
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn current_platform() -> &'static str {
    #[cfg(windows)]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "linux"
    }
}

#[cfg(any(unix, target_os = "macos"))]
fn command_exists(command: &str) -> bool {
    if Path::new(command).exists() {
        return true;
    }

    env::var_os("PATH")
        .map(|path| env::split_paths(&path).any(|dir| dir.join(command).exists()))
        .unwrap_or(false)
}

fn sanitize_profile_token(value: &str) -> String {
    let token = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();

    let trimmed = token.trim_matches('-');
    if trimmed.is_empty() {
        "profile".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_prefers_powershell_core() {
        let profiles = vec![
            LocalTerminalProfile {
                id: "cmd".into(),
                name: "命令提示符".into(),
                kind: "cmd".into(),
                platform: "windows".into(),
                source: "detected".into(),
                command: "cmd.exe".into(),
                args: Vec::new(),
                cwd: None,
                env: BTreeMap::new(),
                icon: "terminal-cmd".into(),
                hidden: false,
                detected: true,
            },
            LocalTerminalProfile {
                id: "pwsh".into(),
                name: "PowerShell 7".into(),
                kind: "powershell_core".into(),
                platform: "windows".into(),
                source: "detected".into(),
                command: "pwsh.exe".into(),
                args: Vec::new(),
                cwd: None,
                env: BTreeMap::new(),
                icon: "terminal-powershell".into(),
                hidden: false,
                detected: true,
            },
        ];

        assert_eq!(default_profile_id(&profiles), Some("pwsh".to_string()));
    }

    #[test]
    fn build_command_prefers_explicit_cwd() {
        let profile = LocalTerminalProfile {
            id: "pwsh".into(),
            name: "PowerShell 7".into(),
            kind: "powershell_core".into(),
            platform: "windows".into(),
            source: "detected".into(),
            command: "pwsh.exe".into(),
            args: vec!["-NoLogo".into(), "-NoProfile".into()],
            cwd: Some("C:\\Users\\demo".into()),
            env: BTreeMap::new(),
            icon: "terminal-powershell".into(),
            hidden: false,
            detected: true,
        };

        let command = build_command(&profile, Some("D:\\repo"));
        let debug_text = format!("{command:?}");

        assert!(debug_text.contains("D:\\repo"));
    }

    #[cfg(windows)]
    #[test]
    fn parse_wsl_distributions_accepts_utf16le_without_bom() {
        let stdout = "Ubuntu\r\ndocker-desktop\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();

        assert_eq!(
            parse_wsl_distributions_stdout(&stdout),
            vec!["Ubuntu".to_string(), "docker-desktop".to_string()]
        );
    }

    #[cfg(windows)]
    #[test]
    fn parse_wsl_distributions_accepts_utf8() {
        assert_eq!(
            parse_wsl_distributions_stdout(b"Ubuntu\r\ndocker-desktop\r\n"),
            vec!["Ubuntu".to_string(), "docker-desktop".to_string()]
        );
    }
}
