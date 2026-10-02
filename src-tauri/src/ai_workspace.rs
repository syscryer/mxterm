use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tempfile::NamedTempFile;

use crate::app_error::AppError;
const MAX_SEARCH_RESULTS: usize = 200;
pub(crate) const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct WorkspaceFileSnapshot {
    pub path: String,
    pub size: u64,
    pub mtime_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct WorkspaceReadResult {
    pub path: String,
    pub content: String,
    pub snapshot: WorkspaceFileSnapshot,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct WorkspaceSearchResult {
    pub path: String,
    pub line: usize,
    pub content: String,
}

pub(crate) fn validate_workspace_root(path: &str) -> Result<PathBuf, AppError> {
    let root = PathBuf::from(path.trim());
    if root.as_os_str().is_empty() {
        return Err(workspace_error(
            "ai_workspace_missing",
            "本地 Agent 需要先选择工作目录。",
        ));
    }
    let root = root.canonicalize().map_err(|error| {
        workspace_detail_error("ai_workspace_unavailable", "本地工作目录不可用。", error)
    })?;
    if !root.is_dir() {
        return Err(workspace_error(
            "ai_workspace_not_directory",
            "本地 Agent 工作区必须是目录。",
        ));
    }
    Ok(root)
}

pub(crate) fn resolve_workspace_path(root: &Path, requested: &str) -> Result<PathBuf, AppError> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err(workspace_error(
            "ai_workspace_path_missing",
            "文件路径不能为空。",
        ));
    }
    let candidate = {
        let path = PathBuf::from(requested);
        if path.is_absolute() {
            path
        } else {
            root.join(path)
        }
    };
    let resolved = if fs::symlink_metadata(&candidate).is_ok() {
        candidate.canonicalize().map_err(|error| {
            workspace_detail_error("ai_workspace_path_invalid", "文件路径无法解析。", error)
        })?
    } else {
        let mut missing = Vec::new();
        let mut cursor = candidate.as_path();
        while fs::symlink_metadata(cursor).is_err() {
            let name = cursor
                .file_name()
                .ok_or_else(|| workspace_error("ai_workspace_path_invalid", "文件名不能为空。"))?;
            missing.push(name.to_os_string());
            cursor = cursor.parent().ok_or_else(|| {
                workspace_error("ai_workspace_path_invalid", "文件所在目录无法解析。")
            })?;
        }
        let mut resolved = cursor.canonicalize().map_err(|error| {
            workspace_detail_error("ai_workspace_path_invalid", "文件所在目录无法解析。", error)
        })?;
        for name in missing.iter().rev() {
            resolved.push(name);
        }
        resolved
    };
    if !path_is_within(root, &resolved) {
        return Err(workspace_error(
            "ai_workspace_path_forbidden",
            "路径必须位于用户授权的工作目录内。",
        ));
    }
    Ok(resolved)
}

pub(crate) fn read_local_file(
    root: &Path,
    requested: &str,
    max_chars: usize,
) -> Result<WorkspaceReadResult, AppError> {
    let path = resolve_workspace_path(root, requested)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        workspace_detail_error("ai_workspace_read_failed", "读取文件元数据失败。", error)
    })?;
    if !metadata.is_file() {
        return Err(workspace_error(
            "ai_workspace_not_file",
            "目标路径不是文件。",
        ));
    }
    if metadata.len() > MAX_SEARCH_FILE_BYTES {
        return Err(workspace_error(
            "ai_workspace_file_too_large",
            "文件超过 Agent 单文件读取上限。",
        ));
    }
    let bytes = fs::read(&path).map_err(|error| {
        workspace_detail_error("ai_workspace_read_failed", "读取文件失败。", error)
    })?;
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(workspace_error(
            "ai_workspace_binary_file",
            "二进制文件不能直接交给编码 Agent 编辑。",
        ));
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| workspace_error("ai_workspace_not_utf8", "文件不是 UTF-8 文本。"))?;
    let (content, truncated) = tail_chars(&content, max_chars);
    Ok(WorkspaceReadResult {
        path: display_path(root, &path),
        content,
        snapshot: snapshot(&path, &metadata),
        truncated,
    })
}

/// 按行返回文件内容的一个视图。底层读取仍然使用完整内容，只有完整读取的结果
/// 才会被工作区状态标记为可编辑，避免模型用半个文件覆盖原文件。
pub(crate) fn slice_text_lines(
    content: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> (String, bool, usize) {
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    let start = offset.unwrap_or(1).max(1).saturating_sub(1);
    let end = limit
        .map(|value| start.saturating_add(value.max(1)))
        .unwrap_or(total)
        .min(total);
    let partial = start > 0 || end < total;
    let value = if start >= total {
        String::new()
    } else {
        lines[start..end].join("\n")
    };
    (value, partial, total)
}

pub(crate) fn search_local_files(root: &Path, pattern: &str) -> Result<Vec<String>, AppError> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err(workspace_error(
            "ai_workspace_pattern_missing",
            "文件搜索模式不能为空。",
        ));
    }
    let mut matches = Vec::new();
    let mut visited = 0;
    collect_files(root, root, pattern, &mut matches, &mut visited, 0)?;
    Ok(matches)
}

pub(crate) fn search_local_content(
    root: &Path,
    query: &str,
    pattern: Option<&str>,
) -> Result<Vec<WorkspaceSearchResult>, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(workspace_error(
            "ai_workspace_query_missing",
            "内容搜索关键字不能为空。",
        ));
    }
    let paths = search_local_files(root, pattern.unwrap_or("*"))?;
    let mut results = Vec::new();
    let needle = query.to_lowercase();
    for relative in paths {
        if results.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        let path = resolve_workspace_path(root, &relative)?;
        let metadata = fs::metadata(&path).map_err(|error| {
            workspace_detail_error(
                "ai_workspace_search_failed",
                "读取搜索文件元数据失败。",
                error,
            )
        })?;
        if metadata.len() > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        let bytes = fs::read(&path).map_err(|error| {
            workspace_detail_error("ai_workspace_search_failed", "读取搜索文件失败。", error)
        })?;
        if bytes.iter().take(8192).any(|byte| *byte == 0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                results.push(WorkspaceSearchResult {
                    path: relative.clone(),
                    line: index + 1,
                    content: line.chars().take(500).collect(),
                });
                if results.len() >= MAX_SEARCH_RESULTS {
                    break;
                }
            }
        }
    }
    Ok(results)
}

pub(crate) fn preview_patch(
    root: &Path,
    requested: &str,
    old_string: &str,
    new_string: &str,
) -> Result<(String, String), AppError> {
    let path = resolve_workspace_path(root, requested)?;
    let current = if path.exists() {
        read_local_file(root, requested, MAX_SEARCH_FILE_BYTES as usize)?.content
    } else {
        String::new()
    };
    let (_, diff) = build_patch(
        &current,
        display_path(root, &path).as_str(),
        old_string,
        new_string,
    )?;
    let display = display_path(root, &path);
    Ok((display, diff))
}

pub(crate) fn apply_patch(
    root: &Path,
    requested: &str,
    old_string: &str,
    new_string: &str,
) -> Result<(String, String), AppError> {
    let path = resolve_workspace_path(root, requested)?;
    let current = if path.exists() {
        let result = read_local_file(root, requested, MAX_SEARCH_FILE_BYTES as usize)?;
        result.content
    } else {
        String::new()
    };
    let display = display_path(root, &path);
    let (updated, diff) = build_patch(&current, &display, old_string, new_string)?;

    if path.exists() {
        let backup = PathBuf::from(format!("{}.mxterm.bak", path.to_string_lossy()));
        fs::copy(&path, &backup).map_err(|error| {
            workspace_detail_error("ai_workspace_backup_failed", "创建文件备份失败。", error)
        })?;
    } else if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            workspace_detail_error("ai_workspace_write_failed", "创建文件目录失败。", error)
        })?;
    }

    let parent = path
        .parent()
        .ok_or_else(|| workspace_error("ai_workspace_write_failed", "无法确定文件所在目录。"))?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
        workspace_detail_error("ai_workspace_write_failed", "创建临时文件失败。", error)
    })?;
    temporary.write_all(updated.as_bytes()).map_err(|error| {
        workspace_detail_error("ai_workspace_write_failed", "写入临时文件失败。", error)
    })?;
    temporary.flush().map_err(|error| {
        workspace_detail_error("ai_workspace_write_failed", "刷新临时文件失败。", error)
    })?;
    temporary.persist(&path).map_err(|error| {
        workspace_detail_error("ai_workspace_write_failed", "保存文件失败。", error.error)
    })?;
    Ok((display, diff))
}

fn collect_files(
    root: &Path,
    directory: &Path,
    pattern: &str,
    matches: &mut Vec<String>,
    visited: &mut usize,
    depth: usize,
) -> Result<(), AppError> {
    if matches.len() >= MAX_SEARCH_RESULTS {
        return Ok(());
    }
    let entries = fs::read_dir(directory).map_err(|error| {
        workspace_detail_error("ai_workspace_search_failed", "读取目录失败。", error)
    })?;
    for entry in entries {
        *visited += 1;
        if *visited > 20_000 || depth > 32 {
            return Err(workspace_error(
                "ai_workspace_search_limit",
                "搜索超过遍历上限，请缩小工作目录。",
            ));
        }
        if matches.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        let entry = entry.map_err(|error| {
            workspace_detail_error("ai_workspace_search_failed", "读取目录项失败。", error)
        })?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if should_skip_directory(&name) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| {
            workspace_detail_error("ai_workspace_search_failed", "读取目录项类型失败。", error)
        })?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path().canonicalize().map_err(|error| {
            workspace_detail_error("ai_workspace_search_failed", "解析搜索路径失败。", error)
        })?;
        if !path.starts_with(root) {
            continue;
        }
        if file_type.is_dir() {
            collect_files(root, &path, pattern, matches, visited, depth + 1)?;
        } else if file_type.is_file() {
            let relative = display_path(root, &path);
            if glob_match(pattern, &relative) || glob_match(pattern, &name) {
                matches.push(relative);
            }
        }
    }
    Ok(())
}

pub(crate) fn build_patch(
    current: &str,
    display_path: &str,
    old_string: &str,
    new_string: &str,
) -> Result<(String, String), AppError> {
    build_patch_with_options(current, display_path, old_string, new_string, false)
}

pub(crate) fn build_patch_with_options(
    current: &str,
    display_path: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<(String, String), AppError> {
    if old_string.is_empty() {
        if current.is_empty() {
            return Ok((
                new_string.to_string(),
                simple_diff(display_path, current, new_string),
            ));
        }
        return Err(workspace_error(
            "ai_workspace_patch_invalid",
            "已有文件的补丁必须提供旧内容。",
        ));
    }
    let count = current.matches(old_string).count();
    if count == 0 {
        return Err(AppError::new(
            "ai_workspace_patch_not_found",
            "补丁旧内容在文件中不存在。",
            "matches=0",
            true,
        ));
    }
    if count > 1 && !replace_all {
        return Err(AppError::new(
            "ai_workspace_patch_not_unique",
            "补丁旧内容必须唯一匹配；如需全部替换请设置 replace_all。",
            format!("matches={count}"),
            true,
        ));
    }
    let updated = if replace_all {
        current.replace(old_string, new_string)
    } else {
        current.replacen(old_string, new_string, 1)
    };
    if updated.len() > MAX_SEARCH_FILE_BYTES as usize || updated == current {
        return Err(workspace_error(
            "ai_workspace_patch_invalid",
            "修改为空或文件超过 2 MiB。",
        ));
    }
    Ok((
        updated.clone(),
        simple_diff(display_path, current, &updated),
    ))
}

pub(crate) fn simple_diff(path: &str, before: &str, after: &str) -> String {
    let old_lines = diff_lines(before);
    let new_lines = diff_lines(after);
    let mut prefix = 0;
    while prefix < old_lines.len()
        && prefix < new_lines.len()
        && old_lines[prefix] == new_lines[prefix]
    {
        prefix += 1;
    }
    let mut old_end = old_lines.len();
    let mut new_end = new_lines.len();
    while old_end > prefix && new_end > prefix && old_lines[old_end - 1] == new_lines[new_end - 1] {
        old_end -= 1;
        new_end -= 1;
    }

    const CONTEXT: usize = 3;
    let old_start = prefix.saturating_sub(CONTEXT);
    let new_start = old_start;
    let old_context_end = (old_end + CONTEXT).min(old_lines.len());
    let new_context_end = (new_end + CONTEXT).min(new_lines.len());
    let mut diff = format!(
        "--- {path}\n+++ {path}\n@@ -{},{} +{},{} @@\n",
        old_start + 1,
        old_context_end.saturating_sub(old_start),
        new_start + 1,
        new_context_end.saturating_sub(new_start),
    );
    for line in &old_lines[old_start..prefix.min(old_context_end)] {
        diff.push(' ');
        diff.push_str(line);
        diff.push('\n');
    }
    for line in &old_lines[prefix..old_end] {
        diff.push('-');
        diff.push_str(line);
        diff.push('\n');
    }
    for line in &new_lines[prefix..new_end] {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    for line in &old_lines[old_end.min(old_lines.len())..old_context_end.min(old_lines.len())] {
        diff.push(' ');
        diff.push_str(line);
        diff.push('\n');
    }
    diff
}

fn diff_lines(value: &str) -> Vec<String> {
    let mut lines: Vec<String> = value.split('\n').map(ToString::to_string).collect();
    if value.ends_with('\n') {
        lines.pop();
    }
    lines
}

fn snapshot(path: &Path, metadata: &std::fs::Metadata) -> WorkspaceFileSnapshot {
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    WorkspaceFileSnapshot {
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        mtime_ms,
    }
}

fn display_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub(crate) fn normalize_workspace_path(root: &Path, requested: &str) -> Result<String, AppError> {
    let path = resolve_workspace_path(root, requested)?;
    Ok(display_path(root, &path))
}

fn path_is_within(root: &Path, path: &Path) -> bool {
    path.starts_with(root)
}

fn should_skip_directory(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".mxterm-agent-backups"
    )
}

fn glob_match(pattern: &str, value: &str) -> bool {
    let (p, t) = (pattern.as_bytes(), value.as_bytes());
    let (mut i, mut j, mut star, mut retry) = (0, 0, None, 0);
    while j < t.len() {
        if i < p.len() && (p[i] == b'?' || p[i] == t[j]) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == b'*' {
            star = Some(i);
            i += 1;
            retry = j;
        } else if let Some(s) = star {
            retry += 1;
            j = retry;
            i = s + 1;
        } else {
            return false;
        }
    }
    while i < p.len() && p[i] == b'*' {
        i += 1;
    }
    i == p.len()
}

fn glob_match_bytes(pattern: &[u8], value: &[u8]) -> bool {
    if pattern.is_empty() {
        return value.is_empty();
    }
    if pattern[0] == b'*' {
        return glob_match_bytes(&pattern[1..], value)
            || (!value.is_empty() && glob_match_bytes(pattern, &value[1..]));
    }
    !value.is_empty()
        && (pattern[0] == b'?' || pattern[0].eq_ignore_ascii_case(&value[0]))
        && glob_match_bytes(&pattern[1..], &value[1..])
}

fn tail_chars(value: &str, max_chars: usize) -> (String, bool) {
    let total = value.chars().count();
    if total <= max_chars {
        return (value.to_string(), false);
    }
    (value.chars().take(max_chars).collect(), true)
}

fn workspace_error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, message, true)
}

fn workspace_detail_error(code: &str, message: &str, detail: impl ToString) -> AppError {
    AppError::new(code, message, detail, true)
}

pub(crate) fn read_version(root: &Path, requested: &str) -> Result<Option<String>, AppError> {
    let path = resolve_workspace_path(root, requested)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(
        read_local_file(root, requested, MAX_SEARCH_FILE_BYTES as usize)?.content,
    ))
}

pub(crate) fn write_version(
    root: &Path,
    requested: &str,
    before: Option<&str>,
    after: &str,
    backups: &Path,
) -> Result<String, AppError> {
    if after.len() > MAX_SEARCH_FILE_BYTES as usize {
        return Err(workspace_error(
            "ai_workspace_file_too_large",
            "文件超过 2 MiB。",
        ));
    }
    let path = resolve_workspace_path(root, requested)?;
    if read_version(root, requested)?.as_deref() != before {
        return Err(workspace_error(
            "ai_workspace_conflict",
            "文件已经变化，请重新读取并生成 diff。",
        ));
    }
    fs::create_dir_all(backups).map_err(|e| {
        workspace_detail_error("ai_workspace_backup_failed", "创建备份目录失败。", e)
    })?;
    let id = uuid::Uuid::new_v4().to_string();
    if let Some(content) = before {
        let mut backup = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(backups.join(&id))
            .map_err(|e| {
                workspace_detail_error("ai_workspace_backup_failed", "创建备份失败。", e)
            })?;
        backup
            .write_all(content.as_bytes())
            .and_then(|_| backup.sync_all())
            .map_err(|e| {
                workspace_detail_error("ai_workspace_backup_failed", "保存备份失败。", e)
            })?;
    }
    let content_to_write = if before.is_some()
        && before.is_some_and(|value| value.contains("\r\n"))
        && !after.contains("\r\n")
    {
        after.replace('\n', "\r\n")
    } else {
        after.to_string()
    };
    let parent = path
        .parent()
        .ok_or_else(|| workspace_error("ai_workspace_path_invalid", "文件所在目录无法解析。"))?;
    fs::create_dir_all(parent).map_err(|e| {
        workspace_detail_error("ai_workspace_write_failed", "创建文件目录失败。", e)
    })?;
    let mut temp = NamedTempFile::new_in(parent).map_err(|e| {
        workspace_detail_error("ai_workspace_write_failed", "创建临时文件失败。", e)
    })?;
    temp.write_all(content_to_write.as_bytes())
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| {
            workspace_detail_error("ai_workspace_write_failed", "写入临时文件失败。", e)
        })?;
    if before.is_some() {
        temp.as_file()
            .set_permissions(
                fs::metadata(&path)
                    .map_err(|e| {
                        workspace_detail_error("ai_workspace_write_failed", "读取权限失败。", e)
                    })?
                    .permissions(),
            )
            .map_err(|e| {
                workspace_detail_error("ai_workspace_write_failed", "保持权限失败。", e)
            })?;
    }
    if resolve_workspace_path(root, requested)? != path
        || read_version(root, requested)?.as_deref() != before
    {
        return Err(workspace_error(
            "ai_workspace_conflict",
            "审批期间文件或路径发生变化。",
        ));
    }
    if before.is_some() {
        temp.persist(&path)
    } else {
        temp.persist_noclobber(&path)
    }
    .map_err(|e| workspace_detail_error("ai_workspace_write_failed", "替换文件失败。", e.error))?;
    Ok(id)
}

pub(crate) fn restore_version(
    root: &Path,
    requested: &str,
    expected_current: &str,
    original: &str,
    backups: &Path,
) -> Result<String, AppError> {
    write_version(root, requested, Some(expected_current), original, backups)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escape() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        assert!(resolve_workspace_path(&r, "../escape").is_err());
    }

    #[test]
    fn resolves_new_file_below_missing_parent_inside_workspace() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        let resolved = resolve_workspace_path(&r, "new/nested/file.txt").unwrap();
        assert!(resolved.starts_with(&r));
        assert!(resolved.ends_with("new/nested/file.txt"));
    }
    #[test]
    fn checks_full_version_and_keeps_backup() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        let b = tempfile::tempdir().unwrap();
        fs::write(r.join("a"), "old").unwrap();
        assert!(write_version(&r, "a", Some("stale"), "new", b.path()).is_err());
        let id = write_version(&r, "a", Some("old"), "new", b.path()).unwrap();
        assert_eq!(fs::read_to_string(b.path().join(id)).unwrap(), "old");
        assert_eq!(fs::read_to_string(r.join("a")).unwrap(), "new");
    }
    #[test]
    fn diff_has_line_markers() {
        assert!(simple_diff("a", "a\nb\n", "c\nd\n").contains("-a\n-b\n+c\n+d\n"));
    }

    #[test]
    fn diff_keeps_context_instead_of_replacing_whole_file() {
        let diff = simple_diff(
            "a",
            "one\ntwo\nthree\nfour\n",
            "one\nchanged\nthree\nfour\n",
        );
        assert!(diff.contains(" one\n"));
        assert!(diff.contains("-two\n+changed\n"));
        assert!(diff.contains(" three\n"));
        assert!(!diff.contains("-one\n"));
    }

    #[test]
    fn replace_all_requires_explicit_option() {
        assert!(build_patch("x x", "a", "x", "y").is_err());
        let (updated, _) = build_patch_with_options("x x", "a", "x", "y", true).unwrap();
        assert_eq!(updated, "y y");
    }

    #[test]
    fn slices_lines_and_reports_partial_view() {
        let (value, partial, total) = slice_text_lines("a\nb\nc\nd", Some(2), Some(2));
        assert_eq!(value, "b\nc");
        assert!(partial);
        assert_eq!(total, 4);
    }
}
