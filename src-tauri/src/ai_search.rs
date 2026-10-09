use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use globset::{GlobBuilder, GlobMatcher};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::app_error::AppError;
use crate::remote_files::quote_posix_shell;

const DEFAULT_PAGE_SIZE: usize = 200;
pub(crate) const FALLBACK_MARKER: &[u8] = b"MXTERM_SEARCH_NATIVE\0";

#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct SearchOptions {
    pub target: Option<String>,
    pub path: Option<String>,
    pub pattern: String,
    pub query: Option<String>,
    pub regex: bool,
    pub case_sensitive: bool,
    pub multiline: bool,
    pub context: usize,
    pub before_context: Option<usize>,
    pub after_context: Option<usize>,
    pub offset: usize,
    /// Zero explicitly requests all entries; it never limits traversal.
    pub limit: usize,
    pub head_limit: Option<usize>,
    pub output_mode: OutputMode,
    pub include_ignored: bool,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            target: None,
            path: None,
            pattern: "*".into(),
            query: None,
            regex: true,
            case_sensitive: true,
            multiline: false,
            context: 0,
            before_context: None,
            after_context: None,
            offset: 0,
            limit: DEFAULT_PAGE_SIZE,
            head_limit: None,
            output_mode: OutputMode::Content,
            include_ignored: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OutputMode {
    #[default]
    Content,
    FilesWithMatches,
    Count,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct SearchEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_match: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
}

impl SearchEntry {
    fn file(path: String, count: Option<usize>) -> Self {
        Self {
            path,
            line: None,
            column: None,
            content: None,
            is_match: None,
            count,
        }
    }
}

#[derive(Default)]
pub(crate) struct SearchData {
    pub entries: Vec<SearchEntry>,
    pub counts: BTreeMap<String, usize>,
    pub skipped_binary_files: usize,
}

#[derive(Serialize)]
pub(crate) struct SearchPage {
    pub engine: String,
    pub output_mode: OutputMode,
    pub entries: Vec<SearchEntry>,
    pub total: usize,
    pub total_matches: usize,
    pub total_files: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
    pub next_offset: Option<usize>,
    pub truncated: bool,
    pub skipped_binary_files: usize,
    pub warnings: Vec<String>,
}

impl SearchData {
    pub(crate) fn page(
        mut self,
        tool: &str,
        options: &SearchOptions,
        engine: &str,
        warnings: Vec<String>,
    ) -> SearchPage {
        self.entries
            .sort_by(|a, b| (&a.path, a.line).cmp(&(&b.path, b.line)));
        let total_files = self.counts.len();
        let total_matches = self.counts.values().sum();
        let output_mode = if tool == "glob" {
            OutputMode::FilesWithMatches
        } else {
            options.output_mode
        };
        let entries = match output_mode {
            OutputMode::Content => self.entries,
            OutputMode::FilesWithMatches => self
                .counts
                .into_keys()
                .map(|path| SearchEntry::file(path, None))
                .collect(),
            OutputMode::Count => self
                .counts
                .into_iter()
                .map(|(path, count)| SearchEntry::file(path, Some(count)))
                .collect(),
        };
        let total = entries.len();
        let end = if options.limit == 0 {
            total
        } else {
            options.offset.saturating_add(options.limit).min(total)
        };
        let has_more = end < total;
        let page = entries
            .into_iter()
            .skip(options.offset)
            .take(end.saturating_sub(options.offset))
            .collect();
        SearchPage {
            engine: engine.into(),
            output_mode,
            entries: page,
            total,
            total_matches,
            total_files,
            offset: options.offset,
            limit: options.limit,
            has_more,
            next_offset: has_more.then_some(end),
            truncated: has_more,
            skipped_binary_files: self.skipped_binary_files,
            warnings,
        }
    }
}

pub(crate) fn parse_options(tool: &str, arguments: &str) -> Result<SearchOptions, AppError> {
    let mut options: SearchOptions =
        serde_json::from_str(arguments).map_err(|error| search_error("参数无效", error))?;
    if let Some(head_limit) = options.head_limit {
        options.limit = head_limit;
    }
    validate_options(tool, &options)?;
    Ok(options)
}

fn validate_options(tool: &str, options: &SearchOptions) -> Result<(), AppError> {
    if !matches!(tool, "glob" | "grep") {
        return Err(search_error("搜索工具无效", tool));
    }
    compile_glob(&options.pattern)?;
    if tool == "grep" {
        compile_regex(options)?;
    }
    Ok(())
}

fn compile_glob(pattern: &str) -> Result<GlobMatcher, AppError> {
    if pattern.is_empty() {
        return Err(search_error("文件搜索模式不能为空", "empty glob"));
    }
    // A basename glob applies at every depth; a glob with '/' is relative to the search root.
    let pattern = if pattern.contains('/') {
        pattern.to_string()
    } else {
        format!("**/{pattern}")
    };
    GlobBuilder::new(&pattern)
        .literal_separator(true)
        .backslash_escape(true)
        .build()
        .map(|glob| glob.compile_matcher())
        .map_err(|error| search_error("文件搜索模式无效", error))
}

pub(crate) fn compile_regex(options: &SearchOptions) -> Result<regex::Regex, AppError> {
    let query = options
        .query
        .as_deref()
        .ok_or_else(|| search_error("grep 缺少 query", "missing query"))?;
    if query.is_empty() {
        return Err(search_error("内容搜索表达式不能为空", "empty query"));
    }
    let pattern = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .multi_line(true)
        .crlf(true)
        .dot_matches_new_line(options.multiline)
        .build()
        .map_err(|error| search_error("内容搜索正则无效", error))
}

pub(crate) fn search_local(
    root: &Path,
    tool: &str,
    options: &SearchOptions,
    stopped: &AtomicBool,
) -> Result<SearchData, AppError> {
    validate_options(tool, options)?;
    let scope =
        crate::ai_workspace::resolve_workspace_path(root, options.path.as_deref().unwrap_or("."))?;
    let matcher = compile_glob(&options.pattern)?;
    let display_root = if scope.is_file() {
        scope.parent().unwrap_or(root)
    } else {
        scope.as_path()
    };
    let mut paths = Vec::new();
    let mut walker = WalkBuilder::new(&scope);
    walker
        .hidden(false)
        .follow_links(false)
        .parents(false)
        .git_ignore(!options.include_ignored)
        .git_global(false)
        .git_exclude(!options.include_ignored)
        .ignore(!options.include_ignored)
        .require_git(false)
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".git" | ".mxterm-agent-backups")
            )
        });
    for entry in walker.build() {
        ensure_running(stopped)?;
        let entry = entry.map_err(|error| search_error("遍历搜索目录失败", error))?;
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(display_root)
            .map_err(|error| search_error("搜索路径越界", error))?
            .to_string_lossy()
            .replace('\\', "/");
        if matcher.is_match(&relative) {
            paths.push((relative, entry.into_path()));
        }
    }
    paths.sort_by(|a, b| a.0.cmp(&b.0));
    let mut data = SearchData::default();
    let expression = if tool == "grep" {
        Some(compile_regex(options)?)
    } else {
        None
    };
    for (relative, path) in paths {
        ensure_running(stopped)?;
        if tool == "glob" {
            data.counts.insert(relative, 0);
            continue;
        }
        // Revalidate before opening; traversal must not follow workspace-external symlinks.
        // `WalkBuilder` yielded this path under the bounded search scope. Read that
        // exact path instead of resolving the display-relative name against `root`;
        // otherwise a search rooted at `workspace/src` would read the wrong file.
        let bytes = std::fs::read(path).map_err(|error| search_error("读取搜索文件失败", error))?;
        append_text_matches(
            &mut data,
            &relative,
            &bytes,
            options,
            expression.as_ref().unwrap(),
        )?;
    }
    Ok(data)
}

pub(crate) fn append_text_matches(
    data: &mut SearchData,
    path: &str,
    bytes: &[u8],
    options: &SearchOptions,
    expression: &regex::Regex,
) -> Result<(), AppError> {
    if bytes.contains(&0) {
        data.skipped_binary_files += 1;
        return Ok(());
    }
    let text = String::from_utf8_lossy(bytes);
    let lines = text.split_inclusive('\n').collect::<Vec<_>>();
    if lines.is_empty() {
        return Ok(());
    }
    let mut starts = Vec::with_capacity(lines.len());
    let mut position = 0usize;
    for line in &lines {
        starts.push(position);
        position += line.len();
    }
    let mut matches = BTreeMap::<usize, usize>::new();
    let mut count = 0usize;
    if options.multiline {
        for found in expression.find_iter(&text) {
            count += 1;
            let first = starts
                .partition_point(|offset| *offset <= found.start())
                .saturating_sub(1);
            let last = starts
                .partition_point(|offset| {
                    *offset <= found.end().saturating_sub(1).max(found.start())
                })
                .saturating_sub(1);
            for index in first..=last {
                matches.entry(index).or_insert(if index == first {
                    found.start().saturating_sub(starts[index]) + 1
                } else {
                    1
                });
            }
        }
    } else {
        for (index, line) in lines.iter().enumerate() {
            let line = line.trim_end_matches('\n').trim_end_matches('\r');
            for found in expression.find_iter(line) {
                count += 1;
                matches.entry(index).or_insert(found.start() + 1);
            }
        }
    }
    if count == 0 {
        return Ok(());
    }
    data.counts.insert(path.into(), count);
    if options.output_mode != OutputMode::Content {
        return Ok(());
    }
    let before = options.before_context.unwrap_or(options.context);
    let after = options.after_context.unwrap_or(options.context);
    let mut visible = BTreeSet::new();
    for index in matches.keys() {
        visible.extend(
            index.saturating_sub(before)
                ..=index
                    .saturating_add(after)
                    .min(lines.len().saturating_sub(1)),
        );
    }
    for index in visible {
        data.entries.push(SearchEntry {
            path: path.into(),
            line: Some(index + 1),
            column: matches.get(&index).copied(),
            content: Some(
                lines[index]
                    .trim_end_matches('\n')
                    .trim_end_matches('\r')
                    .into(),
            ),
            is_match: Some(matches.contains_key(&index)),
            count: None,
        });
    }
    Ok(())
}

pub(crate) fn ensure_running(stopped: &AtomicBool) -> Result<(), AppError> {
    if stopped.load(Ordering::SeqCst) {
        Err(search_error("搜索已停止", "cancelled"))
    } else {
        Ok(())
    }
}

pub(crate) fn search_error(message: &str, detail: impl ToString) -> AppError {
    let detail = detail.to_string();
    AppError::new(
        "ai_workspace_search_failed",
        &format!("{message}：{detail}"),
        detail,
        true,
    )
}

/// The fallback lists files only. The caller applies this module's exact glob and
/// regex engine to those files, avoiding grep dialect changes when rg is absent.
pub(crate) fn remote_command(
    root: &str,
    tool: &str,
    options: &SearchOptions,
) -> Result<String, AppError> {
    validate_options(tool, options)?;
    let requested = crate::ai_workspace::resolve_remote_workspace_path(
        Some(root),
        options.path.as_deref().unwrap_or("."),
    )?;
    let mut command = format!(
        "scope=$(realpath -- {}) || exit 2\nif [ -d \"$scope\" ]; then cd -- \"$scope\" || exit 2; input=.; else cd -- \"$(dirname -- \"$scope\")\" || exit 2; input=\"./$(basename -- \"$scope\")\"; fi\nif command -v rg >/dev/null 2>&1; then rg --hidden --color never --no-config --no-ignore-parent --no-ignore-global --no-require-git --encoding utf-8 --crlf --glob '!**/.git/**' --glob '!**/.mxterm-agent-backups/**' --glob {} ",
        quote_posix_shell(&requested), quote_posix_shell(&options.pattern)
    );
    if options.include_ignored {
        command.push_str("--no-ignore ");
    }
    if tool == "glob" {
        command.push_str("--files --null ");
    } else {
        command.push_str("--json ");
        if !options.regex {
            command.push_str("--fixed-strings ");
        }
        command.push_str(if options.case_sensitive {
            "--case-sensitive "
        } else {
            "--ignore-case "
        });
        if options.multiline {
            command.push_str("--multiline --multiline-dotall ");
        }
        command.push_str(&format!(
            "--before-context {} --after-context {} -e {} ",
            options.before_context.unwrap_or(options.context),
            options.after_context.unwrap_or(options.context),
            quote_posix_shell(options.query.as_deref().unwrap_or_default())
        ));
    }
    command.push_str("-- \"$input\"\nstatus=$?\n[ \"$status\" -eq 1 ] && exit 0\nexit \"$status\"\nelse printf 'MXTERM_SEARCH_NATIVE\\0%s\\0' \"$PWD\"\nfind \"$input\" -type d \\( -name .git -o -name .mxterm-agent-backups \\) -prune -o -type f -print0\nfi");
    Ok(command)
}

pub(crate) fn remote_read_command(base: &str, relative: &str) -> String {
    format!(
        "file=$(realpath -- {}) || exit 2\ncat -- \"$file\"",
        quote_posix_shell(&format!("{base}/{relative}"))
    )
}

pub(crate) fn check_remote_output(
    output: &crate::terminal::session::ExecOutput,
) -> Result<(), AppError> {
    if output.exit_status == Some(0) {
        return Ok(());
    }
    Err(search_error(
        "远程搜索失败",
        format!(
            "exit_status={:?}\n{}",
            output.exit_status,
            String::from_utf8_lossy(&output.stderr)
        ),
    ))
}

pub(crate) fn parse_remote_files(
    bytes: &[u8],
    options: &SearchOptions,
) -> Result<Vec<String>, AppError> {
    let matcher = compile_glob(&options.pattern)?;
    bytes
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| {
            String::from_utf8(path.to_vec())
                .map_err(|error| search_error("搜索路径不是 UTF-8", error))
        })
        .filter_map(|path| match path {
            Ok(path) => {
                let path = path.strip_prefix("./").unwrap_or(&path).to_string();
                matcher.is_match(&path).then_some(Ok(path))
            }
            Err(error) => Some(Err(error)),
        })
        .collect()
}

pub(crate) fn parse_rg_json(bytes: &[u8]) -> Result<SearchData, AppError> {
    let mut data = SearchData::default();
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let event: Value = serde_json::from_slice(line)
            .map_err(|error| search_error("搜索事件解析失败", error))?;
        let body = &event["data"];
        match event["type"].as_str() {
            Some("match" | "context") => {
                let path = rg_text(&body["path"])?;
                let path = path.strip_prefix("./").unwrap_or(&path).to_string();
                let content = rg_text(&body["lines"])?;
                let start = body["line_number"]
                    .as_u64()
                    .ok_or_else(|| search_error("搜索事件缺少行号", line.len()))?
                    as usize;
                let submatches = body["submatches"].as_array().cloned().unwrap_or_default();
                let is_match = event["type"] == "match";
                if is_match {
                    *data.counts.entry(path.clone()).or_default() += 1;
                }
                let mut offset = 0usize;
                for (index, line) in content.split_inclusive('\n').enumerate() {
                    let end = offset + line.len();
                    let column = if is_match {
                        submatches
                            .iter()
                            .filter_map(|found| {
                                let first = found["start"].as_u64()? as usize;
                                let last = found["end"].as_u64()? as usize;
                                (first < end && last >= offset)
                                    .then_some(first.saturating_sub(offset) + 1)
                            })
                            .min()
                    } else {
                        None
                    };
                    data.entries.push(SearchEntry {
                        path: path.clone(),
                        line: Some(start + index),
                        column,
                        content: Some(line.trim_end_matches('\n').trim_end_matches('\r').into()),
                        is_match: Some(is_match),
                        count: None,
                    });
                    offset = end;
                }
            }
            Some("end") => {}
            Some("begin" | "summary") => {}
            _ => return Err(search_error("搜索事件类型无效", event["type"].to_string())),
        }
    }
    Ok(data)
}

fn rg_text(value: &Value) -> Result<String, AppError> {
    if let Some(text) = value["text"].as_str() {
        return Ok(text.to_string());
    }
    if let Some(bytes) = value["bytes"].as_str() {
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(bytes)
            .map_err(|error| search_error("搜索内容解码失败", error))?;
        return Ok(String::from_utf8_lossy(&decoded).into_owned());
    }
    Err(search_error("搜索事件缺少文本", value.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grep_options(query: &str) -> SearchOptions {
        SearchOptions {
            query: Some(query.to_owned()),
            regex: true,
            case_sensitive: false,
            context: 1,
            limit: 1,
            ..SearchOptions::default()
        }
    }

    #[test]
    fn local_search_resolves_nested_scope_and_paginates_context() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let source = directory.path().join("src");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("main.rs"), "before\nFoo error\nafter\n").unwrap();
        std::fs::write(source.join("ignored.txt"), "Foo error\n").unwrap();

        let options = grep_options(r"foo\s+error");
        let stopped = AtomicBool::new(false);
        let scoped_options = SearchOptions {
            path: Some("src".into()),
            pattern: "*.rs".into(),
            ..options.clone()
        };
        let data = search_local(&root, "grep", &scoped_options, &stopped).unwrap();
        let page = data.page("grep", &options, "local", Vec::new());

        assert_eq!(page.total_matches, 1);
        assert_eq!(page.total_files, 1);
        assert_eq!(page.entries[0].path, "main.rs");
        assert!(page.has_more);
        assert_eq!(page.next_offset, Some(1));
    }

    #[test]
    fn glob_matches_recursive_files_without_traversal_cap() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let nested = directory.path().join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("one.rs"), "fn main() {}\n").unwrap();
        std::fs::write(nested.join("two.txt"), "text\n").unwrap();

        let options = SearchOptions {
            pattern: "**/*.rs".into(),
            limit: 0,
            ..SearchOptions::default()
        };
        let stopped = AtomicBool::new(false);
        let data = search_local(&root, "glob", &options, &stopped).unwrap();
        let page = data.page("glob", &options, "local", Vec::new());

        assert_eq!(page.total_files, 1);
        assert_eq!(page.entries[0].path, "a/b/one.rs");
    }

    #[test]
    fn local_search_can_use_absolute_and_parent_paths_outside_cwd() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("project");
        let outside = directory.path().join("sibling");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("one.rs"), "external match\n").unwrap();
        let stopped = AtomicBool::new(false);
        let options = SearchOptions {
            path: Some(outside.to_string_lossy().into_owned()),
            pattern: "**/*.rs".into(),
            ..SearchOptions::default()
        };
        let glob = search_local(&root, "glob", &options, &stopped).unwrap();
        assert_eq!(
            glob.page("glob", &options, "local", Vec::new()).entries[0].path,
            "one.rs"
        );
        let options = SearchOptions {
            path: Some("../sibling".into()),
            query: Some("external match".into()),
            ..options
        };
        let grep = search_local(&root, "grep", &options, &stopped).unwrap();
        assert_eq!(
            grep.page("grep", &options, "local", Vec::new())
                .total_matches,
            1
        );
    }

    #[test]
    fn rg_json_counts_match_events_for_count_modes() {
        let events = [
            serde_json::json!({"type":"begin","data":{"path":{"text":"./main.rs"}}}),
            serde_json::json!({"type":"match","data":{"path":{"text":"./main.rs"},"lines":{"text":"Foo error\n"},"line_number":2,"submatches":[{"start":0,"end":9}]}}),
            serde_json::json!({"type":"end","data":{"stats":{"matches":1}}}),
            serde_json::json!({"type":"summary","data":{}}),
        ];
        let bytes = events
            .iter()
            .map(|event| serde_json::to_vec(event).unwrap())
            .collect::<Vec<_>>()
            .join(&b'\n');
        let data = parse_rg_json(&bytes).unwrap();
        let options = SearchOptions {
            output_mode: OutputMode::Count,
            ..SearchOptions::default()
        };
        let page = data.page("grep", &options, "rg", Vec::new());

        assert_eq!(page.total_matches, 1);
        assert_eq!(page.entries[0].count, Some(1));
    }

    #[test]
    fn invalid_regex_is_rejected_before_search() {
        let options = grep_options("[");
        assert!(compile_regex(&options).is_err());
    }

    #[test]
    fn remote_command_preserves_search_semantics() {
        let options = SearchOptions {
            pattern: "**/*.rs".into(),
            query: Some("foo.*bar".into()),
            case_sensitive: false,
            multiline: true,
            before_context: Some(2),
            after_context: Some(3),
            ..SearchOptions::default()
        };
        let command = remote_command("/srv/app", "grep", &options).unwrap();

        assert!(command.contains("--json"));
        assert!(command.contains("--ignore-case"));
        assert!(command.contains("--multiline --multiline-dotall"));
        assert!(command.contains("--before-context 2 --after-context 3"));
        assert!(command.contains("/srv/app"));
    }

    #[test]
    fn remote_search_and_fallback_read_do_not_depend_on_default_cwd() {
        let options = SearchOptions {
            path: Some("/var/log/service".into()),
            query: Some("error".into()),
            ..SearchOptions::default()
        };
        for tool in ["glob", "grep"] {
            let command = remote_command("/missing/default/cwd", tool, &options).unwrap();
            assert!(command.contains("realpath -- '/var/log/service'"));
            assert!(!command.contains("/missing/default/cwd"));
            assert!(!command.contains("outside workspace"));
        }
        let read = remote_read_command("/var/log/service", "one's.log");
        assert!(read.contains("one'\\''s.log"));
        assert!(!read.contains("root="));
        let options = SearchOptions {
            path: Some("../sibling".into()),
            ..options
        };
        assert!(remote_command("/srv/project", "glob", &options)
            .unwrap()
            .contains("'/srv/project/../sibling'"));
    }
}
