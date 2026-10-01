use crate::{
    ai_assistant::AiToolCallRecord, app_error::AppError, storage_repository::StorageRepository,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

fn db_error(e: impl ToString) -> AppError {
    AppError::new(
        "ai_audit_failed",
        "保存或读取 AI 审计记录失败。",
        e.to_string(),
        true,
    )
}

fn redact_audit_text(value: &str) -> String {
    let lower = value.to_lowercase();
    if [
        "password",
        "passwd",
        "token",
        "secret",
        "api_key",
        "api-key",
        "private key",
        "authorization",
        "bearer",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return "REDACTED".into();
    }
    value.chars().take(2_000).collect()
}

pub(crate) fn append(
    app: &AppHandle,
    session: &str,
    message: &str,
    record: &AiToolCallRecord,
) -> Result<(), AppError> {
    let mut value = serde_json::to_value(record).map_err(db_error)?;
    // Source files, terminal output and diffs can contain secrets. Audit metadata records
    // digests rather than copying their contents into a second persistent store.
    value["output"] = serde_json::Value::Null;
    value["error"] = record
        .error
        .as_deref()
        .map(redact_audit_text)
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null);
    if let Some(command) = &record.command {
        value["command_sha256"] = serde_json::json!(Sha256::digest(command.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>());
        let lower = command.to_lowercase();
        if [
            "password",
            "passwd",
            "token",
            "secret",
            "api_key",
            "api-key",
            "private key",
            "authorization",
            "bearer",
            "-p ",
        ]
        .iter()
        .any(|v| lower.contains(v))
        {
            value["command"] = serde_json::json!("REDACTED");
        }
    }
    let repository = StorageRepository::open_app(app)?;
    repository.sqlite_connection().execute(
        "INSERT INTO ai_audit_events(session_id,message_id,tool_call_id,created_at_ms,event_json) VALUES(?1,?2,?3,?4,?5)",
        params![session, message, record.id, crate::ai_agent::now_millis().to_string(), value.to_string()],
    ).map_err(db_error)?;
    Ok(())
}

#[derive(Deserialize)]
pub struct AuditListRequest {
    pub session_id: String,
    #[serde(default)]
    pub before_id: Option<i64>,
}
#[derive(Serialize)]
pub struct AuditEvent {
    pub id: i64,
    pub created_at_ms: String,
    pub event: serde_json::Value,
}
#[tauri::command]
pub fn ai_audit_list(
    app: AppHandle,
    request: AuditListRequest,
) -> Result<Vec<AuditEvent>, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    let mut statement=repository.sqlite_connection().prepare("SELECT id,created_at_ms,event_json FROM ai_audit_events WHERE session_id=?1 AND id<?2 ORDER BY id DESC LIMIT 200").map_err(db_error)?;
    let rows = statement
        .query_map(
            params![request.session_id, request.before_id.unwrap_or(i64::MAX)],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(db_error)?;
    rows.map(|r| {
        let (id, created_at_ms, json) = r.map_err(db_error)?;
        Ok(AuditEvent {
            id,
            created_at_ms,
            event: serde_json::from_str(&json).map_err(db_error)?,
        })
    })
    .collect()
}
