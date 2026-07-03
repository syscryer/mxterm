use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::app_error::AppError;
use crate::remote_exec_pool::{RemoteExecRetry, RemoteExecSessionPool};
use crate::remote_files::quote_posix_shell;
use crate::ssh_config::resolve_saved_connection;
use crate::terminal::session::ExecOutput;

const CRONTAB_BEGIN: &str = "# MXTERM-SCHEDULE-BEGIN";
const CRONTAB_END: &str = "# MXTERM-SCHEDULE-END";
const LOG_DIR: &str = ".mxterm/scheduled-tasks/logs";
const LOG_START_MARKER: &str = "__MXTERM_TASK_START__";
const LOG_END_MARKER: &str = "__MXTERM_TASK_END__";
const READ_CRONTAB_COMMAND: &str = r#"
if ! command -v crontab >/dev/null 2>&1; then
  echo "mxterm: crontab command not found" >&2
  exit 127
fi
out="${TMPDIR:-/tmp}/mxterm-crontab-$$.out"
err="${TMPDIR:-/tmp}/mxterm-crontab-$$.err"
crontab -l > "$out" 2> "$err"
rc="$?"
if [ "$rc" -eq 0 ]; then
  cat "$out"
  rm -f "$out" "$err"
  exit 0
fi
if grep -qi "no crontab" "$err" 2>/dev/null; then
  rm -f "$out" "$err"
  exit 0
fi
cat "$err" >&2
rm -f "$out" "$err"
exit "$rc"
"#;

pub type ScheduledTaskExecSessionManager = RemoteExecSessionPool;

#[derive(Debug, Deserialize)]
pub struct ScheduledTaskConnectionRequest {
    pub connection_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ScheduledTaskIdRequest {
    pub connection_id: String,
    pub task_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ScheduledTaskSetEnabledRequest {
    pub connection_id: String,
    pub task_id: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct ScheduledTaskSaveRequest {
    pub connection_id: String,
    pub task: ScheduledTaskInput,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ScheduledTaskInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub cron: String,
    pub command: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ScheduledTaskSummary {
    pub id: String,
    pub name: String,
    pub cron: String,
    pub command: String,
    pub enabled: bool,
    pub updated_at: String,
    pub last_run: Option<ScheduledTaskLogEntry>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ScheduledTaskLogEntry {
    pub started_at: Option<String>,
    pub exit_code: Option<i32>,
    pub status: String,
    pub output_preview: String,
}

#[derive(Debug, Serialize)]
pub struct ScheduledTaskActionResult {
    pub ok: bool,
    pub message: String,
    pub output: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ScheduledTaskRecord {
    id: String,
    name: String,
    cron: String,
    command: String,
    enabled: bool,
    updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CrontabSegment {
    Raw(Vec<String>),
    Task(ScheduledTaskRecord),
}

pub async fn list_tasks(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    request: ScheduledTaskConnectionRequest,
) -> Result<Vec<ScheduledTaskSummary>, AppError> {
    let connection_id = require_value(
        &request.connection_id,
        "scheduled_task_connection_missing",
        "请选择活动连接。",
    )?;
    let document = load_document(app, manager, connection_id).await?;
    summaries_with_logs(app, manager, connection_id, document.task_records()).await
}

pub async fn save_task(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    request: ScheduledTaskSaveRequest,
) -> Result<ScheduledTaskSummary, AppError> {
    let connection_id = require_value(
        &request.connection_id,
        "scheduled_task_connection_missing",
        "请选择活动连接。",
    )?;
    let mut document = load_document(app, manager, connection_id).await?;
    let record = normalize_task_input(request.task)?;
    let saved_id = record.id.clone();
    document.upsert(record);
    install_document(app, manager, connection_id, &document).await?;
    let saved = document
        .find_task(&saved_id)
        .ok_or_else(|| task_missing_error("saved task disappeared"))?;
    summary_with_log(app, manager, connection_id, saved).await
}

pub async fn delete_task(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    request: ScheduledTaskIdRequest,
) -> Result<ScheduledTaskActionResult, AppError> {
    let connection_id = require_value(
        &request.connection_id,
        "scheduled_task_connection_missing",
        "请选择活动连接。",
    )?;
    let task_id = normalize_task_id(&request.task_id)?;
    let mut document = load_document(app, manager, connection_id).await?;
    if !document.remove(&task_id) {
        return Err(task_missing_error("task not found"));
    }
    install_document(app, manager, connection_id, &document).await?;
    Ok(ScheduledTaskActionResult {
        ok: true,
        message: "定时任务已删除。".to_string(),
        output: None,
    })
}

pub async fn set_task_enabled(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    request: ScheduledTaskSetEnabledRequest,
) -> Result<ScheduledTaskSummary, AppError> {
    let connection_id = require_value(
        &request.connection_id,
        "scheduled_task_connection_missing",
        "请选择活动连接。",
    )?;
    let task_id = normalize_task_id(&request.task_id)?;
    let mut document = load_document(app, manager, connection_id).await?;
    let updated_at = now_timestamp()?;
    let Some(record) = document.find_task_mut(&task_id) else {
        return Err(task_missing_error("task not found"));
    };
    record.enabled = request.enabled;
    record.updated_at = updated_at;
    install_document(app, manager, connection_id, &document).await?;
    let saved = document
        .find_task(&task_id)
        .ok_or_else(|| task_missing_error("updated task disappeared"))?;
    summary_with_log(app, manager, connection_id, saved).await
}

pub async fn run_task_now(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    request: ScheduledTaskIdRequest,
) -> Result<ScheduledTaskActionResult, AppError> {
    let connection_id = require_value(
        &request.connection_id,
        "scheduled_task_connection_missing",
        "请选择活动连接。",
    )?;
    let task_id = normalize_task_id(&request.task_id)?;
    let document = load_document(app, manager, connection_id).await?;
    let record = document
        .find_task(&task_id)
        .ok_or_else(|| task_missing_error("task not found"))?;
    let output = exec_scheduled_command(
        app,
        manager,
        connection_id,
        &build_run_command(record),
        RemoteExecRetry::None,
    )
    .await?;
    let ok = output.exit_status == Some(0);
    let last_run = read_task_log(app, manager, connection_id, &record.id).await?;
    let output_preview = last_run
        .as_ref()
        .map(|entry| entry.output_preview.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let text = output_text(&output);
            (!text.trim().is_empty()).then_some(text)
        });

    Ok(ScheduledTaskActionResult {
        ok,
        message: if ok {
            "定时任务已手动执行。"
        } else {
            "定时任务执行失败，请查看最近记录。"
        }
        .to_string(),
        output: output_preview,
    })
}

async fn load_document(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    connection_id: &str,
) -> Result<CrontabDocument, AppError> {
    let output = exec_scheduled_command(
        app,
        manager,
        connection_id,
        READ_CRONTAB_COMMAND,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    ensure_remote_success(
        &output,
        "scheduled_task_crontab_read_failed",
        "远端 crontab 读取失败。",
    )?;
    parse_crontab(&String::from_utf8_lossy(&output.stdout))
}

async fn install_document(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    connection_id: &str,
    document: &CrontabDocument,
) -> Result<(), AppError> {
    let content = document.render();
    let output = exec_scheduled_command(
        app,
        manager,
        connection_id,
        &install_crontab_command(&content),
        RemoteExecRetry::None,
    )
    .await?;
    ensure_remote_success(
        &output,
        "scheduled_task_crontab_write_failed",
        "远端 crontab 写入失败。",
    )
}

async fn summaries_with_logs(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    connection_id: &str,
    records: Vec<&ScheduledTaskRecord>,
) -> Result<Vec<ScheduledTaskSummary>, AppError> {
    let mut summaries = Vec::with_capacity(records.len());
    for record in records {
        summaries.push(summary_with_log(app, manager, connection_id, record).await?);
    }
    Ok(summaries)
}

async fn summary_with_log(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    connection_id: &str,
    record: &ScheduledTaskRecord,
) -> Result<ScheduledTaskSummary, AppError> {
    let last_run = read_task_log(app, manager, connection_id, &record.id).await?;
    Ok(record.to_summary(last_run))
}

async fn read_task_log(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    connection_id: &str,
    task_id: &str,
) -> Result<Option<ScheduledTaskLogEntry>, AppError> {
    let command = format!(
        "log_file=\"$HOME/{}/{}.log\"; if [ -f \"$log_file\" ]; then tail -n 80 -- \"$log_file\"; fi",
        LOG_DIR, task_id
    );
    let output = exec_scheduled_command(
        app,
        manager,
        connection_id,
        &command,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    if output.exit_status != Some(0) {
        return Ok(None);
    }
    Ok(parse_log_tail(&String::from_utf8_lossy(&output.stdout)))
}

async fn exec_scheduled_command(
    app: &AppHandle,
    manager: &ScheduledTaskExecSessionManager,
    connection_id: &str,
    command: &str,
    retry: RemoteExecRetry,
) -> Result<ExecOutput, AppError> {
    let connection_id = require_value(
        connection_id,
        "scheduled_task_connection_missing",
        "请选择活动连接。",
    )?;
    let config = resolve_saved_connection(app, connection_id, None)?;
    manager.exec(app, &config, command, retry).await
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct CrontabDocument {
    segments: Vec<CrontabSegment>,
}

impl CrontabDocument {
    fn task_records(&self) -> Vec<&ScheduledTaskRecord> {
        self.segments
            .iter()
            .filter_map(|segment| match segment {
                CrontabSegment::Task(record) => Some(record),
                CrontabSegment::Raw(_) => None,
            })
            .collect()
    }

    fn find_task(&self, task_id: &str) -> Option<&ScheduledTaskRecord> {
        self.segments.iter().find_map(|segment| match segment {
            CrontabSegment::Task(record) if record.id == task_id => Some(record),
            _ => None,
        })
    }

    fn find_task_mut(&mut self, task_id: &str) -> Option<&mut ScheduledTaskRecord> {
        self.segments.iter_mut().find_map(|segment| match segment {
            CrontabSegment::Task(record) if record.id == task_id => Some(record),
            _ => None,
        })
    }

    fn upsert(&mut self, record: ScheduledTaskRecord) {
        if let Some(existing) = self.find_task_mut(&record.id) {
            *existing = record;
            return;
        }
        self.segments.push(CrontabSegment::Task(record));
    }

    fn remove(&mut self, task_id: &str) -> bool {
        let original_len = self.segments.len();
        self.segments.retain(|segment| match segment {
            CrontabSegment::Task(record) => record.id != task_id,
            CrontabSegment::Raw(_) => true,
        });
        self.segments.len() != original_len
    }

    fn render(&self) -> String {
        let mut lines = Vec::new();
        for segment in &self.segments {
            match segment {
                CrontabSegment::Raw(raw_lines) => lines.extend(raw_lines.iter().cloned()),
                CrontabSegment::Task(record) => lines.extend(record.render_block()),
            }
        }
        trim_outer_blank_lines(&mut lines);
        if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        }
    }
}

impl ScheduledTaskRecord {
    fn to_summary(&self, last_run: Option<ScheduledTaskLogEntry>) -> ScheduledTaskSummary {
        ScheduledTaskSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            cron: self.cron.clone(),
            command: self.command.clone(),
            enabled: self.enabled,
            updated_at: self.updated_at.clone(),
            last_run,
        }
    }

    fn render_block(&self) -> Vec<String> {
        let mut lines = vec![
            CRONTAB_BEGIN.to_string(),
            format!("# id={}", self.id),
            format!("# name={}", encode_metadata(&self.name)),
            format!("# cron={}", encode_metadata(&self.cron)),
            format!("# command={}", encode_metadata(&self.command)),
            format!("# enabled={}", self.enabled),
            format!("# updated_at={}", self.updated_at),
        ];
        let run_command = build_run_command(self);
        if self.enabled {
            lines.push(format!(
                "{} {}",
                self.cron,
                escape_crontab_percent(&run_command)
            ));
        } else {
            lines.push(format!(
                "# disabled: {} {}",
                self.cron,
                escape_crontab_percent(&run_command)
            ));
        }
        lines.push(CRONTAB_END.to_string());
        lines
    }
}

fn parse_crontab(text: &str) -> Result<CrontabDocument, AppError> {
    let mut document = CrontabDocument::default();
    let mut raw_lines = Vec::new();
    let mut iter = text.lines().enumerate().peekable();

    while let Some((index, line)) = iter.next() {
        let line = line.trim_end_matches('\r').to_string();
        if line.trim() != CRONTAB_BEGIN {
            raw_lines.push(line);
            continue;
        }

        if !raw_lines.is_empty() {
            document.segments.push(CrontabSegment::Raw(raw_lines));
            raw_lines = Vec::new();
        }

        let mut block = vec![line];
        let mut closed = false;
        for (_, block_line) in iter.by_ref() {
            let block_line = block_line.trim_end_matches('\r').to_string();
            closed = block_line.trim() == CRONTAB_END;
            block.push(block_line);
            if closed {
                break;
            }
        }

        if !closed {
            return Err(invalid_block_error(index + 1, "missing MXTERM-SCHEDULE-END"));
        }
        document
            .segments
            .push(CrontabSegment::Task(parse_task_block(&block, index + 1)?));
    }

    if !raw_lines.is_empty() {
        document.segments.push(CrontabSegment::Raw(raw_lines));
    }
    Ok(document)
}

fn parse_task_block(
    block: &[String],
    start_line: usize,
) -> Result<ScheduledTaskRecord, AppError> {
    let mut id = None;
    let mut name = None;
    let mut cron = None;
    let mut command = None;
    let mut enabled = None;
    let mut updated_at = None;

    for line in block.iter().skip(1).take(block.len().saturating_sub(2)) {
        let trimmed = line.trim();
        let Some(metadata) = trimmed.strip_prefix("# ") else {
            continue;
        };
        let Some((key, value)) = metadata.split_once('=') else {
            continue;
        };
        match key.trim() {
            "id" => id = Some(normalize_task_id(value.trim())?),
            "name" => name = Some(decode_metadata(value.trim(), start_line, "name")?),
            "cron" => {
                let decoded = decode_metadata(value.trim(), start_line, "cron")?;
                cron = Some(validate_cron(&decoded)?.to_string());
            }
            "command" => command = Some(decode_metadata(value.trim(), start_line, "command")?),
            "enabled" => enabled = Some(parse_enabled(value.trim(), start_line)?),
            "updated_at" => {
                updated_at = Some(require_value(
                    value,
                    "scheduled_task_crontab_invalid",
                    "定时任务管理块格式无效。",
                )?
                .to_string())
            }
            _ => {}
        }
    }

    let record = ScheduledTaskRecord {
        id: id.ok_or_else(|| invalid_block_error(start_line, "missing id"))?,
        name: require_decoded_value(name, start_line, "name")?,
        cron: require_decoded_value(cron, start_line, "cron")?,
        command: require_decoded_value(command, start_line, "command")?,
        enabled: enabled.ok_or_else(|| invalid_block_error(start_line, "missing enabled"))?,
        updated_at: updated_at.ok_or_else(|| invalid_block_error(start_line, "missing updated_at"))?,
    };
    validate_command(&record.command)?;
    Ok(record)
}

fn normalize_task_input(input: ScheduledTaskInput) -> Result<ScheduledTaskRecord, AppError> {
    let id = match input.id.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => normalize_task_id(value)?,
        None => uuid::Uuid::new_v4().to_string(),
    };
    let name = require_value(
        &input.name,
        "scheduled_task_name_missing",
        "请输入任务名称。",
    )?
    .to_string();
    let cron = validate_cron(&input.cron)?.to_string();
    let command = require_value(
        &input.command,
        "scheduled_task_command_missing",
        "请输入要执行的命令。",
    )?
    .to_string();
    validate_command(&command)?;
    Ok(ScheduledTaskRecord {
        id,
        name,
        cron,
        command,
        enabled: input.enabled,
        updated_at: now_timestamp()?,
    })
}

fn validate_cron(value: &str) -> Result<&str, AppError> {
    let value = require_value(
        value,
        "scheduled_task_cron_missing",
        "请输入 cron 表达式。",
    )?;
    if value.contains('\n') || value.contains('\r') || value.contains('\0') {
        return Err(AppError::new(
            "scheduled_task_cron_invalid",
            "cron 表达式格式无效。",
            "cron contains control characters",
            true,
        ));
    }
    if value.starts_with('@') {
        return match value {
            "@hourly" | "@daily" | "@weekly" | "@monthly" | "@reboot" => Ok(value),
            _ => Err(AppError::new(
                "scheduled_task_cron_invalid",
                "仅支持 @hourly、@daily、@weekly、@monthly、@reboot 或 5 段 cron 表达式。",
                value,
                true,
            )),
        };
    }
    let fields = value.split_whitespace().collect::<Vec<_>>();
    if fields.len() != 5 {
        return Err(AppError::new(
            "scheduled_task_cron_invalid",
            "cron 表达式需要 5 段时间字段。",
            value,
            true,
        ));
    }
    Ok(value)
}

fn validate_command(value: &str) -> Result<(), AppError> {
    if value.contains('\0') {
        return Err(AppError::new(
            "scheduled_task_command_invalid",
            "命令内容包含无效字符。",
            "command contains NUL",
            true,
        ));
    }
    Ok(())
}

fn normalize_task_id(value: &str) -> Result<String, AppError> {
    let value = require_value(
        value,
        "scheduled_task_id_missing",
        "定时任务标识缺失。",
    )?;
    if value.len() > 96
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(AppError::new(
            "scheduled_task_id_invalid",
            "定时任务标识无效。",
            value,
            true,
        ));
    }
    Ok(value.to_string())
}

fn build_run_command(record: &ScheduledTaskRecord) -> String {
    let command_b64 = STANDARD.encode(record.command.as_bytes());
    let inner = format!(
        "mxterm_log_dir=\"$HOME/{LOG_DIR}\"; mkdir -p \"$mxterm_log_dir\"; \
         mxterm_log_file=\"$mxterm_log_dir/$MXTERM_TASK_ID.log\"; \
         {{ printf '{LOG_START_MARKER} %s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)\"; \
         mxterm_decode='base64 -d'; \
         printf '' | base64 -d >/dev/null 2>&1 || mxterm_decode='base64 -D'; \
         if ! mxterm_cmd=\"$(printf %s \"$MXTERM_CMD_B64\" | $mxterm_decode)\"; then \
           echo 'mxterm: command decode failed'; exit 127; \
         fi; \
         /bin/sh -lc \"$mxterm_cmd\"; mxterm_rc=$?; \
         printf '{LOG_END_MARKER} %s exit=%s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)\" \"$mxterm_rc\"; \
         exit \"$mxterm_rc\"; }} >> \"$mxterm_log_file\" 2>&1"
    );
    format!(
        "MXTERM_TASK_ID={} MXTERM_CMD_B64={} /bin/sh -lc {}",
        quote_posix_shell(&record.id),
        quote_posix_shell(&command_b64),
        quote_posix_shell(&inner)
    )
}

fn install_crontab_command(content: &str) -> String {
    let encoded = STANDARD.encode(content.as_bytes());
    format!(
        r#"if ! command -v crontab >/dev/null 2>&1; then
  echo "mxterm: crontab command not found" >&2
  exit 127
fi
if ! command -v base64 >/dev/null 2>&1; then
  echo "mxterm: base64 command not found" >&2
  exit 127
fi
tmp="${{TMPDIR:-/tmp}}/mxterm-crontab-$$.tmp"
trap 'rm -f "$tmp"' EXIT
decoder="base64 -d"
printf '' | base64 -d >/dev/null 2>&1 || decoder="base64 -D"
$decoder > "$tmp" <<'MXTERM_CRONTAB'
{encoded}
MXTERM_CRONTAB
crontab "$tmp"
"#
    )
}

fn parse_log_tail(text: &str) -> Option<ScheduledTaskLogEntry> {
    let lines = text
        .lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect::<Vec<_>>();
    if lines.iter().all(|line| line.trim().is_empty()) {
        return None;
    }

    let mut start_index = None;
    let mut started_at = None;
    let mut end_index = None;
    let mut exit_code = None;

    for (index, line) in lines.iter().enumerate() {
        if let Some(rest) = line.strip_prefix(LOG_START_MARKER) {
            start_index = Some(index);
            started_at = Some(rest.trim().to_string()).filter(|value| !value.is_empty());
            end_index = None;
            exit_code = None;
            continue;
        }
        if let Some(rest) = line.strip_prefix(LOG_END_MARKER) {
            end_index = Some(index);
            exit_code = parse_exit_code(rest);
        }
    }

    let preview_lines = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            if line.starts_with(LOG_START_MARKER) || line.starts_with(LOG_END_MARKER) {
                return None;
            }
            if let Some(start) = start_index {
                if index <= start || end_index.is_some_and(|end| index >= end) {
                    return None;
                }
            }
            Some(line.as_str())
        })
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    let preview = if preview_lines.is_empty() {
        lines
            .iter()
            .rev()
            .filter(|line| {
                let line = line.trim();
                !line.is_empty()
                    && !line.starts_with(LOG_START_MARKER)
                    && !line.starts_with(LOG_END_MARKER)
            })
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        preview_lines.join("\n")
    };

    let status = match (start_index, end_index, exit_code) {
        (Some(_), None, _) => "running",
        (_, Some(_), Some(0)) => "success",
        (_, Some(_), Some(_)) => "failed",
        (_, Some(_), None) => "unknown",
        _ => "unknown",
    };

    Some(ScheduledTaskLogEntry {
        started_at,
        exit_code,
        status: status.to_string(),
        output_preview: truncate_text(preview.trim(), 1600),
    })
}

fn parse_exit_code(value: &str) -> Option<i32> {
    value
        .split_whitespace()
        .find_map(|part| part.strip_prefix("exit="))
        .and_then(|value| value.parse::<i32>().ok())
}

fn parse_enabled(value: &str, start_line: usize) -> Result<bool, AppError> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(invalid_block_error(start_line, "invalid enabled")),
    }
}

fn require_decoded_value(
    value: Option<String>,
    start_line: usize,
    key: &str,
) -> Result<String, AppError> {
    let value = value.ok_or_else(|| invalid_block_error(start_line, format!("missing {key}")))?;
    if value.trim().is_empty() {
        return Err(invalid_block_error(start_line, format!("blank {key}")));
    }
    Ok(value)
}

fn encode_metadata(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(value.as_bytes())
}

fn decode_metadata(value: &str, start_line: usize, key: &str) -> Result<String, AppError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|error| invalid_block_error(start_line, format!("{key} base64: {error}")))?;
    String::from_utf8(bytes)
        .map_err(|error| invalid_block_error(start_line, format!("{key} utf8: {error}")))
}

fn escape_crontab_percent(value: &str) -> String {
    value.replace('%', "\\%")
}

fn trim_outer_blank_lines(lines: &mut Vec<String>) {
    while lines.first().is_some_and(|line| line.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
}

fn ensure_remote_success(output: &ExecOutput, code: &str, message: &str) -> Result<(), AppError> {
    if output.exit_status == Some(0) {
        return Ok(());
    }

    let detail = output_detail(output);
    let normalized = detail.to_lowercase();
    if normalized.contains("crontab command not found")
        || normalized.contains("crontab: not found")
        || normalized.contains("command not found: crontab")
    {
        return Err(AppError::new(
            "scheduled_task_crontab_unavailable",
            "远端未安装 crontab，或当前用户不能访问 crontab。",
            detail,
            true,
        ));
    }
    if normalized.contains("base64 command not found")
        || normalized.contains("base64: not found")
        || normalized.contains("command not found: base64")
    {
        return Err(AppError::new(
            "scheduled_task_base64_unavailable",
            "远端缺少 base64 命令，无法写入定时任务。",
            detail,
            true,
        ));
    }

    Err(AppError::new(code, message, detail, true))
}

fn output_detail(output: &ExecOutput) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    format!("exit status {:?}", output.exit_status)
}

fn output_text(output: &ExecOutput) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout,
        (true, false) => stderr,
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

fn require_value<'a>(value: &'a str, code: &str, message: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::new(code, message, "value is empty", true));
    }
    Ok(value)
}

fn invalid_block_error(line: usize, detail: impl ToString) -> AppError {
    AppError::new(
        "scheduled_task_crontab_invalid",
        "定时任务管理块格式无效，已停止写回以避免破坏 crontab。",
        format!("line {line}: {}", detail.to_string()),
        true,
    )
}

fn task_missing_error(raw_message: impl ToString) -> AppError {
    AppError::new(
        "scheduled_task_missing",
        "定时任务不存在或已被删除。",
        raw_message,
        true,
    )
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for ch in value.chars().take(max_chars) {
        output.push(ch);
    }
    if value.chars().count() > max_chars {
        output.push_str("\n...");
    }
    output
}

fn now_timestamp() -> Result<String, AppError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            AppError::new("scheduled_task_clock_invalid", "系统时间异常。", error, false)
        })?;
    Ok(duration.as_secs().to_string())
}

fn default_enabled() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{
        build_run_command, escape_crontab_percent, parse_crontab, parse_log_tail,
        validate_cron, CrontabSegment, ScheduledTaskRecord, CRONTAB_BEGIN, CRONTAB_END,
    };

    fn sample_record(id: &str) -> ScheduledTaskRecord {
        ScheduledTaskRecord {
            id: id.to_string(),
            name: "备份任务".to_string(),
            cron: "*/5 * * * *".to_string(),
            command: "echo 'hello'\nprintf done".to_string(),
            enabled: true,
            updated_at: "123456".to_string(),
        }
    }

    #[test]
    fn cron_validation_accepts_five_fields_and_known_macros() {
        assert!(validate_cron("*/5 * * * *").is_ok());
        assert!(validate_cron("@daily").is_ok());
        assert!(validate_cron("@yearly").is_err());
        assert!(validate_cron("* * * *").is_err());
        assert!(validate_cron("* * * * * echo nope").is_err());
    }

    #[test]
    fn crontab_parse_preserves_raw_lines_and_managed_tasks() {
        let record = sample_record("task-1");
        let block = record.render_block().join("\n");
        let input = format!("SHELL=/bin/sh\n\n{block}\n\n0 1 * * * echo user\n");

        let document = parse_crontab(&input).expect("crontab should parse");

        assert_eq!(document.task_records().len(), 1);
        assert_eq!(document.task_records()[0].name, "备份任务");
        assert_eq!(document.task_records()[0].command, "echo 'hello'\nprintf done");
        assert!(matches!(document.segments.first(), Some(CrontabSegment::Raw(_))));
        let rendered = document.render();
        assert!(rendered.contains("SHELL=/bin/sh"));
        assert!(rendered.contains("0 1 * * * echo user"));
        assert!(rendered.contains(CRONTAB_BEGIN));
        assert!(rendered.contains(CRONTAB_END));
    }

    #[test]
    fn malformed_managed_block_is_rejected() {
        let input = format!("{CRONTAB_BEGIN}\n# id=task-1\n");

        let error = parse_crontab(&input).expect_err("missing end must fail");

        assert_eq!(error.code, "scheduled_task_crontab_invalid");
    }

    #[test]
    fn render_disabled_task_keeps_metadata_without_active_cron_line() {
        let mut record = sample_record("task-1");
        record.enabled = false;

        let block = record.render_block().join("\n");

        assert!(block.contains("# enabled=false"));
        assert!(block.contains("# disabled: */5 * * * *"));
        assert!(!block.lines().any(|line| line.starts_with("*/5 * * * * MXTERM_TASK_ID=")));
    }

    #[test]
    fn run_command_hides_raw_user_command_and_escapes_for_crontab() {
        let record = sample_record("task-1");

        let command = build_run_command(&record);
        let cron_command = escape_crontab_percent(&command);

        assert!(!command.contains("echo 'hello'"));
        assert!(command.contains("MXTERM_CMD_B64="));
        assert!(cron_command.contains("+\\%Y-\\%m-\\%dT\\%H:\\%M:\\%SZ"));
    }

    #[test]
    fn log_tail_extracts_latest_run_summary() {
        let log = "\
old line
__MXTERM_TASK_START__ 2026-07-04T01:00:00Z
first output
__MXTERM_TASK_END__ 2026-07-04T01:00:01Z exit=0
__MXTERM_TASK_START__ 2026-07-04T02:00:00Z
second output
more output
__MXTERM_TASK_END__ 2026-07-04T02:00:03Z exit=2
";

        let entry = parse_log_tail(log).expect("log should parse");

        assert_eq!(entry.started_at.as_deref(), Some("2026-07-04T02:00:00Z"));
        assert_eq!(entry.exit_code, Some(2));
        assert_eq!(entry.status, "failed");
        assert_eq!(entry.output_preview, "second output\nmore output");
    }

    #[test]
    fn log_tail_marks_run_without_end_as_running() {
        let log = "\
__MXTERM_TASK_START__ 2026-07-04T02:00:00Z
still running
";

        let entry = parse_log_tail(log).expect("log should parse");

        assert_eq!(entry.status, "running");
        assert_eq!(entry.exit_code, None);
        assert_eq!(entry.output_preview, "still running");
    }
}
