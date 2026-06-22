use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::app_error::AppError;

pub const COMMAND_TEXT_MAX_LENGTH: usize = 4000;
pub const COMMAND_HISTORY_DEFAULT_LIMIT: u16 = 50;
pub const COMMAND_HISTORY_MAX_LIMIT: u16 = 200;
pub const COMMAND_SNIPPET_DEFAULT_GROUP: &str = "";
const COMMAND_SNIPPET_LEGACY_UNGROUPED: &str = "未分组";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandHistorySource {
    CommandSender,
    TerminalInput,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandHistoryScopeKind {
    SshConnection,
    LocalProfile,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub struct CommandHistoryScope {
    pub scope_kind: CommandHistoryScopeKind,
    pub scope_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommandSnippetInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub command: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CommandSnippetIdRequest {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CommandHistoryListRequest {
    #[serde(default)]
    pub limit: Option<u16>,
    #[serde(default)]
    pub scope: Option<CommandHistoryScope>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CommandHistoryRecordRequest {
    pub command: String,
    #[serde(default = "default_command_history_source")]
    pub source: CommandHistorySource,
    #[serde(default)]
    pub target_count: u32,
    #[serde(default = "default_append_enter")]
    pub append_enter: bool,
    #[serde(default)]
    pub scopes: Vec<CommandHistoryScope>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CommandHistoryIdRequest {
    pub id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct CommandSnippet {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub group: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub use_count: u32,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct CommandHistoryEntry {
    pub id: String,
    pub command: String,
    pub source: CommandHistorySource,
    pub target_count: u32,
    pub append_enter: bool,
    pub use_count: u32,
    pub last_used_at: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedCommandSnippetInput {
    pub id: Option<String>,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub group: String,
    pub tags: Vec<String>,
    pub favorite: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedCommandHistoryRecord {
    pub command: String,
    pub source: CommandHistorySource,
    pub target_count: u32,
    pub append_enter: bool,
    pub scopes: Vec<CommandHistoryScope>,
}

pub fn validate_command_snippet_input(
    input: CommandSnippetInput,
) -> Result<ValidatedCommandSnippetInput, AppError> {
    let title = trim_required(
        input.title.as_deref().unwrap_or_default(),
        "command_snippet_title_missing",
        "请填写命令片段标题。",
        "title is empty",
    )?;
    let command = validate_command_text(
        &input.command,
        "command_snippet_command_missing",
        "请填写命令内容。",
        "command_snippet_too_long",
    )?;
    Ok(ValidatedCommandSnippetInput {
        id: normalized_optional_id(input.id.as_deref()),
        title,
        command,
        description: trim_optional(input.description.as_deref()),
        group: normalize_command_snippet_group(input.group.as_deref()),
        tags: normalize_tags(input.tags),
        favorite: input.favorite,
    })
}

pub fn validate_command_history_record(
    request: CommandHistoryRecordRequest,
) -> Result<ValidatedCommandHistoryRecord, AppError> {
    let command = validate_command_text(
        &request.command,
        "command_history_command_missing",
        "命令历史内容为空。",
        "command_history_too_long",
    )?;
    Ok(ValidatedCommandHistoryRecord {
        command,
        source: request.source,
        target_count: request.target_count,
        append_enter: request.append_enter,
        scopes: normalize_command_history_scopes(request.scopes)?,
    })
}

pub fn normalize_command_history_limit(limit: Option<u16>) -> u16 {
    limit
        .unwrap_or(COMMAND_HISTORY_DEFAULT_LIMIT)
        .clamp(1, COMMAND_HISTORY_MAX_LIMIT)
}

fn default_command_history_source() -> CommandHistorySource {
    CommandHistorySource::CommandSender
}

fn default_append_enter() -> bool {
    true
}

pub fn normalize_command_snippet_group(value: Option<&str>) -> String {
    match trim_optional(value) {
        Some(group) if group == COMMAND_SNIPPET_LEGACY_UNGROUPED => {
            COMMAND_SNIPPET_DEFAULT_GROUP.to_string()
        }
        Some(group) => group,
        None => COMMAND_SNIPPET_DEFAULT_GROUP.to_string(),
    }
}

fn validate_command_text(
    value: &str,
    missing_code: &str,
    missing_message: &str,
    too_long_code: &str,
) -> Result<String, AppError> {
    let command = trim_required(value, missing_code, missing_message, "command is empty")?;
    if command.chars().count() > COMMAND_TEXT_MAX_LENGTH {
        return Err(AppError::new(
            too_long_code,
            "命令内容过长。",
            format!("length exceeds {COMMAND_TEXT_MAX_LENGTH}"),
            true,
        ));
    }
    Ok(command)
}

fn trim_required(
    value: &str,
    code: &str,
    message: &str,
    raw_message: &str,
) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(code, message, raw_message, true));
    }
    Ok(trimmed.to_string())
}

fn trim_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn normalized_optional_id(value: Option<&str>) -> Option<String> {
    trim_optional(value)
}

fn normalize_command_history_scopes(
    scopes: Vec<CommandHistoryScope>,
) -> Result<Vec<CommandHistoryScope>, AppError> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for scope in scopes {
        let scope_id = trim_required(
            &scope.scope_id,
            "command_history_scope_invalid",
            "命令历史范围无效。",
            "scope id is empty",
        )?;
        let dedupe_key = (scope.scope_kind.clone(), scope_id.clone());
        if seen.insert(dedupe_key) {
            normalized.push(CommandHistoryScope {
                scope_kind: scope.scope_kind,
                scope_id,
            });
        }
    }
    Ok(normalized)
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_lowercase()) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_validation_trims_fields_and_dedupes_tags() {
        let validated = validate_command_snippet_input(CommandSnippetInput {
            id: Some(" snippet-001 ".to_string()),
            title: Some(" 常用磁盘 ".to_string()),
            command: " df -h ".to_string(),
            description: Some(" 查看磁盘 ".to_string()),
            group: Some(" 巡检 ".to_string()),
            tags: vec![
                " Linux ".to_string(),
                "linux".to_string(),
                " 运维 ".to_string(),
                " ".to_string(),
            ],
            favorite: true,
        })
        .unwrap();

        assert_eq!(validated.id.as_deref(), Some("snippet-001"));
        assert_eq!(validated.title, "常用磁盘");
        assert_eq!(validated.command, "df -h");
        assert_eq!(validated.description.as_deref(), Some("查看磁盘"));
        assert_eq!(validated.group, "巡检");
        assert_eq!(validated.tags, vec!["Linux", "运维"]);
        assert!(validated.favorite);
    }

    #[test]
    fn snippet_validation_defaults_blank_group_to_root() {
        let validated = validate_command_snippet_input(CommandSnippetInput {
            id: None,
            title: Some("磁盘".to_string()),
            command: "df -h".to_string(),
            description: None,
            group: Some(" ".to_string()),
            tags: Vec::new(),
            favorite: false,
        })
        .unwrap();

        assert_eq!(validated.group, COMMAND_SNIPPET_DEFAULT_GROUP);
        assert!(validated.group.is_empty());
    }

    #[test]
    fn snippet_validation_rejects_missing_title_or_command() {
        let missing_title = validate_command_snippet_input(CommandSnippetInput {
            id: None,
            title: Some(" ".to_string()),
            command: "df -h".to_string(),
            description: None,
            group: None,
            tags: Vec::new(),
            favorite: false,
        })
        .unwrap_err();
        let missing_command = validate_command_snippet_input(CommandSnippetInput {
            id: None,
            title: Some("磁盘".to_string()),
            command: " ".to_string(),
            description: None,
            group: None,
            tags: Vec::new(),
            favorite: false,
        })
        .unwrap_err();

        assert_eq!(missing_title.code, "command_snippet_title_missing");
        assert_eq!(missing_command.code, "command_snippet_command_missing");
    }

    #[test]
    fn history_record_validation_defaults_and_trims_command() {
        let validated = validate_command_history_record(CommandHistoryRecordRequest {
            command: " uptime ".to_string(),
            source: CommandHistorySource::CommandSender,
            target_count: 3,
            append_enter: true,
            scopes: vec![
                CommandHistoryScope {
                    scope_kind: CommandHistoryScopeKind::SshConnection,
                    scope_id: " ssh-001 ".to_string(),
                },
                CommandHistoryScope {
                    scope_kind: CommandHistoryScopeKind::SshConnection,
                    scope_id: "ssh-001".to_string(),
                },
            ],
        })
        .unwrap();

        assert_eq!(validated.command, "uptime");
        assert_eq!(validated.source, CommandHistorySource::CommandSender);
        assert_eq!(validated.target_count, 3);
        assert!(validated.append_enter);
        assert_eq!(validated.scopes.len(), 1);
        assert_eq!(validated.scopes[0].scope_id, "ssh-001");
    }

    #[test]
    fn history_limit_is_clamped() {
        assert_eq!(normalize_command_history_limit(None), 50);
        assert_eq!(normalize_command_history_limit(Some(0)), 1);
        assert_eq!(normalize_command_history_limit(Some(500)), 200);
    }
}
