use std::env;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use m_xterm_lib::mcp;
use serde_json::{json, Value};

fn main() {
    let data_dir = parse_data_dir()
        .or_else(|_| mcp::default_app_data_dir())
        .unwrap_or_else(|error| {
            eprintln!("mxterm-mcp: {}", error.message);
            std::process::exit(1);
        });

    if let Err(error) = serve(&data_dir) {
        eprintln!("mxterm-mcp: {error}");
        std::process::exit(1);
    }
}

fn parse_data_dir() -> Result<PathBuf, m_xterm_lib::app_error::AppError> {
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--data-dir" {
            let value = args.next().ok_or_else(|| {
                m_xterm_lib::app_error::AppError::new(
                    "mcp_data_dir_missing",
                    "--data-dir requires a path",
                    "--data-dir",
                    true,
                )
            })?;
            return Ok(PathBuf::from(value));
        }
    }
    Err(m_xterm_lib::app_error::AppError::new(
        "mcp_data_dir_missing",
        "data dir not provided",
        "--data-dir absent",
        true,
    ))
}

fn serve(data_dir: &Path) -> io::Result<()> {
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let stdout = io::stdout();
    let mut writer = stdout.lock();

    serve_stream(data_dir, &mut reader, &mut writer)
}

fn serve_stream(
    data_dir: &Path,
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> io::Result<()> {
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let message = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                write_message(
                    writer,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": {
                            "code": -32700,
                            "message": format!("parse error: {error}")
                        }
                    }),
                )?;
                continue;
            }
        };
        let response = handle_message(data_dir, message);
        if response.is_null() {
            continue;
        }
        write_message(writer, &response)?;
    }
    Ok(())
}

fn write_message(writer: &mut impl Write, value: &Value) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn handle_message(data_dir: &Path, message: Value) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return error(id, -32600, "invalid request", None);
    };

    match method {
        "initialize" => ok(
            id,
            json!({
                "protocolVersion": "2024-11-05",
                "serverInfo": { "name": "mxterm-mcp", "version": "0.1.0" },
                "capabilities": { "tools": {} }
            }),
        ),
        "notifications/initialized" => Value::Null,
        "tools/list" => ok(id, json!({ "tools": tool_schemas(data_dir) })),
        "tools/call" => {
            let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match tauri::async_runtime::block_on(call_tool(data_dir, name, arguments)) {
                Ok(value) => ok(
                    id,
                    json!({ "content": [{ "type": "text", "text": value.to_string() }] }),
                ),
                Err(err) => ok(
                    id,
                    json!({
                        "isError": true,
                        "content": [{ "type": "text", "text": serde_json::to_string(&err).unwrap_or_else(|_| err.message) }]
                    }),
                ),
            }
        }
        _ => error(
            id,
            -32601,
            "method not found",
            Some(json!({ "method": method })),
        ),
    }
}

fn tool_schemas(data_dir: &Path) -> Vec<Value> {
    mcp::repository_for_metadata(data_dir)
        .and_then(|repository| mcp::load_settings(&repository))
        .map(|settings| mcp::tool_schemas_for_settings(&settings))
        .unwrap_or_else(|_| mcp::tool_schemas_for_settings(&mcp::McpSettings::default()))
}

async fn call_tool(
    data_dir: &Path,
    name: &str,
    arguments: Value,
) -> Result<Value, m_xterm_lib::app_error::AppError> {
    mcp::reject_plaintext_credential_args(&arguments)?;
    let metadata_repository = mcp::repository_for_metadata(data_dir)?;
    let settings = mcp::load_settings(&metadata_repository)?;

    match name {
        "get_mxterm_mcp_status" => {
            let summary = if settings.enabled && settings.expose_connections {
                mcp::connection_summary(&metadata_repository, &settings).ok()
            } else {
                None
            };
            Ok(json!({
                "status": mcp::status(&settings),
                "settings": mcp::settings_as_map(&settings),
                "summary": summary,
            }))
        }
        "list_connections" => {
            mcp::ensure_connections_enabled(&settings)?;
            let connections =
                mcp::exposed_connections(&settings, metadata_repository.connection_list()?)
                    .into_iter()
                    .map(mcp::redacted_connection)
                    .collect::<Vec<_>>();
            Ok(json!({ "connections": connections }))
        }
        "search_connections" => {
            mcp::ensure_connections_enabled(&settings)?;
            let query = mcp::value_get_str(&arguments, "query")?;
            let connections =
                mcp::exposed_connections(&settings, metadata_repository.connection_list()?)
                    .into_iter()
                    .map(mcp::redacted_connection)
                    .filter(|connection| mcp::search_matches(connection, query))
                    .collect::<Vec<_>>();
            Ok(json!({ "connections": connections }))
        }
        "get_connection" => {
            mcp::ensure_connections_enabled(&settings)?;
            let connection_id = mcp::value_get_str(&arguments, "connection_id")?;
            let connection = metadata_repository
                .connection_get(connection_id)?
                .filter(|connection| mcp::connection_is_exposed(&settings, &connection.id))
                .map(mcp::redacted_connection)
                .ok_or_else(|| {
                    m_xterm_lib::app_error::AppError::new(
                        "connection_missing",
                        "连接不存在。",
                        format!("connection_id={connection_id}"),
                        false,
                    )
                })?;
            Ok(json!({ "connection": connection }))
        }
        "test_connection" => {
            mcp::test_connection(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                &settings,
            )
            .await
        }
        "execute_command" => Ok(json!(
            mcp::execute_command(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                mcp::value_get_str(&arguments, "command")?,
                mcp::value_get_u64(&arguments, "timeout_seconds"),
                mcp::value_get_usize(&arguments, "max_output_bytes"),
                mcp::value_get_bool(&arguments, "confirm_dangerous"),
                &settings,
            )
            .await?
        )),
        "server_monitor" => Ok(json!(
            mcp::server_monitor(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                &settings,
            )
            .await?
        )),
        "upload_file" => Ok(json!(
            mcp::upload_file(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                Path::new(mcp::value_get_str(&arguments, "local_path")?),
                mcp::value_get_str(&arguments, "remote_path")?,
                &settings,
            )
            .await?
        )),
        "download_file" => Ok(json!(
            mcp::download_file(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                mcp::value_get_str(&arguments, "remote_path")?,
                Path::new(mcp::value_get_str(&arguments, "local_path")?),
                &settings,
            )
            .await?
        )),
        "upload_directory" => Ok(json!(
            mcp::upload_directory(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                Path::new(mcp::value_get_str(&arguments, "local_path")?),
                mcp::value_get_str(&arguments, "remote_path")?,
                &settings,
            )
            .await?
        )),
        "download_directory" => Ok(json!(
            mcp::download_directory(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                mcp::value_get_str(&arguments, "remote_path")?,
                Path::new(mcp::value_get_str(&arguments, "local_path")?),
                &settings,
            )
            .await?
        )),
        "execute_script" => Ok(json!(
            mcp::execute_script(
                data_dir,
                mcp::value_get_str(&arguments, "connection_id")?,
                Path::new(mcp::value_get_str(&arguments, "script_path")?),
                arguments.get("interpreter").and_then(Value::as_str),
                arguments.get("args").and_then(Value::as_str),
                mcp::value_get_u64(&arguments, "timeout_seconds"),
                mcp::value_get_usize(&arguments, "max_output_bytes"),
                &settings,
            )
            .await?
        )),
        _ => Err(m_xterm_lib::app_error::AppError::new(
            "mcp_tool_unknown",
            "未知 MCP 工具。",
            name,
            false,
        )),
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error(id: Value, code: i64, message: &str, data: Option<Value>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message,
            "data": data,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn initialize_message(id: u64) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "probe", "version": "1" }
            }
        })
        .to_string()
    }

    #[test]
    fn stdio_initialize_uses_ndjson() {
        let input = format!("{}\n", initialize_message(1));
        let mut reader = BufReader::new(input.as_bytes());
        let mut output = Vec::new();

        serve_stream(Path::new("."), &mut reader, &mut output).unwrap();

        let text = String::from_utf8(output).unwrap();
        assert!(text.ends_with('\n'));
        assert!(!text.contains("Content-Length"));

        let response = serde_json::from_str::<Value>(text.trim()).unwrap();
        assert_eq!(response["id"], json!(1));
        assert_eq!(response["result"]["serverInfo"]["name"], "mxterm-mcp");
    }

    #[test]
    fn malformed_json_returns_parse_error_and_keeps_reading() {
        let input = format!("not-json\n{}\n", initialize_message(2));
        let mut reader = BufReader::new(input.as_bytes());
        let mut output = Vec::new();

        serve_stream(Path::new("."), &mut reader, &mut output).unwrap();

        let lines = String::from_utf8(output).unwrap();
        let responses = lines.lines().collect::<Vec<_>>();
        assert_eq!(responses.len(), 2);

        let parse_error = serde_json::from_str::<Value>(responses[0]).unwrap();
        assert_eq!(parse_error["error"]["code"], json!(-32700));

        let initialize = serde_json::from_str::<Value>(responses[1]).unwrap();
        assert_eq!(initialize["id"], json!(2));
        assert_eq!(initialize["result"]["serverInfo"]["name"], "mxterm-mcp");
    }
}
