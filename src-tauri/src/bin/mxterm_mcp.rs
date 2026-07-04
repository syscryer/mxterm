use std::collections::HashMap;
use std::env;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use m_xterm_lib::mcp;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;

const MAX_HTTP_HEADER_BYTES: usize = 64 * 1024;
const MAX_HTTP_BODY_BYTES: usize = 2 * 1024 * 1024;

fn main() {
    let config = parse_cli_config().unwrap_or_else(|error| {
        eprintln!("mxterm-mcp: {}", error.message);
        std::process::exit(1);
    });

    let result = match config.transport {
        Transport::Stdio => serve_stdio(&config.data_dir),
        Transport::Http(http) => serve_http(&config.data_dir, http),
    };
    if let Err(error) = result {
        eprintln!("mxterm-mcp: {error}");
        std::process::exit(1);
    }
}

struct CliConfig {
    data_dir: PathBuf,
    transport: Transport,
}

enum Transport {
    Stdio,
    Http(HttpConfig),
}

struct HttpConfig {
    host: String,
    port: u16,
    token_hash: String,
}

fn parse_cli_config() -> Result<CliConfig, m_xterm_lib::app_error::AppError> {
    let mut args = env::args().skip(1);
    let mut data_dir: Option<PathBuf> = None;
    let mut http_config: Option<HttpConfig> = None;
    let mut serve_http = false;
    let mut host = mcp::DEFAULT_REMOTE_HOST.to_string();
    let mut port = mcp::DEFAULT_REMOTE_PORT;
    let mut token_hash: Option<String> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "serve" => {
                serve_http = true;
            }
            "--data-dir" => {
                let value = required_arg("--data-dir", args.next())?;
                data_dir = Some(PathBuf::from(value));
            }
            "--host" => {
                host = required_arg("--host", args.next())?;
            }
            "--port" => {
                let value = required_arg("--port", args.next())?;
                port = value.parse::<u16>().map_err(|error| {
                    m_xterm_lib::app_error::AppError::new(
                        "mcp_remote_port_invalid",
                        "remote MCP port is invalid",
                        error,
                        true,
                    )
                })?;
                if port == 0 {
                    return Err(m_xterm_lib::app_error::AppError::new(
                        "mcp_remote_port_invalid",
                        "remote MCP port is invalid",
                        "port is 0",
                        true,
                    ));
                }
            }
            "--token-sha256" => {
                token_hash = Some(required_arg("--token-sha256", args.next())?);
            }
            _ => {}
        }
    }

    if serve_http {
        let token_hash = token_hash
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                m_xterm_lib::app_error::AppError::new(
                    "mcp_remote_token_missing",
                    "remote MCP token hash is required",
                    "--token-sha256 missing",
                    true,
                )
            })?;
        http_config = Some(HttpConfig {
            host: host.trim().to_string(),
            port,
            token_hash,
        });
    }

    let data_dir = data_dir
        .or_else(|| mcp::default_app_data_dir().ok())
        .ok_or_else(|| {
            m_xterm_lib::app_error::AppError::new(
                "mcp_data_dir_missing",
                "data dir not provided",
                "--data-dir absent",
                true,
            )
        })?;

    Ok(CliConfig {
        data_dir,
        transport: http_config.map_or(Transport::Stdio, Transport::Http),
    })
}

fn required_arg(
    flag: &str,
    value: Option<String>,
) -> Result<String, m_xterm_lib::app_error::AppError> {
    value.ok_or_else(|| {
        let code = if flag == "--data-dir" {
            "mcp_data_dir_missing"
        } else {
            "mcp_argument_missing"
        };
        let message = format!("{flag} requires a value");
        m_xterm_lib::app_error::AppError::new(code, &message, flag, true)
    })
}

fn serve_stdio(data_dir: &Path) -> io::Result<()> {
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
    tauri::async_runtime::block_on(handle_message_async(data_dir, message))
}

async fn handle_message_async(data_dir: &Path, message: Value) -> Value {
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
            match call_tool(data_dir, name, arguments).await {
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

#[derive(Clone)]
struct HttpState {
    data_dir: PathBuf,
    token_hash: String,
    sse_sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<String>>>>,
}

struct HttpRequest {
    method: String,
    path: String,
    query: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn serve_http(data_dir: &Path, config: HttpConfig) -> io::Result<()> {
    let state = HttpState {
        data_dir: data_dir.to_path_buf(),
        token_hash: config.token_hash,
        sse_sessions: Arc::new(Mutex::new(HashMap::new())),
    };
    tauri::async_runtime::block_on(serve_http_async(config.host, config.port, state))
}

async fn serve_http_async(host: String, port: u16, state: HttpState) -> io::Result<()> {
    let listener = TcpListener::bind((host.as_str(), port)).await?;
    loop {
        let (stream, _) = listener.accept().await?;
        let connection_state = state.clone();
        tauri::async_runtime::spawn(async move {
            let _ = handle_http_connection(stream, connection_state).await;
        });
    }
}

async fn handle_http_connection(mut stream: TcpStream, state: HttpState) -> io::Result<()> {
    let Some(request) = read_http_request(&mut stream).await? else {
        return Ok(());
    };

    if request.method == "OPTIONS" {
        return write_http_response(
            &mut stream,
            204,
            "No Content",
            "text/plain",
            Vec::new(),
            cors_headers(&request),
        )
        .await;
    }

    if !origin_allowed(&request) {
        return write_http_response(
            &mut stream,
            403,
            "Forbidden",
            "application/json",
            json!({ "error": "origin forbidden" })
                .to_string()
                .into_bytes(),
            cors_headers(&request),
        )
        .await;
    }

    if !request_authorized(&request, &state.token_hash) {
        return write_http_response(
            &mut stream,
            401,
            "Unauthorized",
            "application/json",
            json!({ "error": "unauthorized" }).to_string().into_bytes(),
            cors_headers(&request),
        )
        .await;
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => {
            write_http_response(
                &mut stream,
                200,
                "OK",
                "application/json",
                json!({ "ok": true, "transport": "mcp-http" })
                    .to_string()
                    .into_bytes(),
                cors_headers(&request),
            )
            .await
        }
        ("POST", "/mcp") => handle_streamable_http_post(&mut stream, request, state).await,
        ("GET", "/mcp") => handle_streamable_http_sse(&mut stream, &request).await,
        ("GET", "/sse") => handle_legacy_sse(&mut stream, &request, state).await,
        ("POST", "/messages") => handle_legacy_message(&mut stream, request, state).await,
        _ => {
            write_http_response(
                &mut stream,
                404,
                "Not Found",
                "application/json",
                json!({ "error": "not found" }).to_string().into_bytes(),
                cors_headers(&request),
            )
            .await
        }
    }
}

async fn handle_streamable_http_post(
    stream: &mut TcpStream,
    request: HttpRequest,
    state: HttpState,
) -> io::Result<()> {
    let message = match serde_json::from_slice::<Value>(&request.body) {
        Ok(value) => value,
        Err(parse_error) => {
            return write_http_response(
                stream,
                400,
                "Bad Request",
                "application/json",
                error(
                    Value::Null,
                    -32700,
                    &format!("parse error: {parse_error}"),
                    None,
                )
                .to_string()
                .into_bytes(),
                cors_headers(&request),
            )
            .await;
        }
    };
    let initialize = message
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| method == "initialize");
    let response = handle_message_async(&state.data_dir, message).await;
    if response.is_null() {
        return write_http_response(
            stream,
            202,
            "Accepted",
            "text/plain",
            Vec::new(),
            cors_headers(&request),
        )
        .await;
    }
    let mut headers = cors_headers(&request);
    if initialize {
        headers.push((
            "MCP-Session-Id".to_string(),
            uuid::Uuid::new_v4().to_string(),
        ));
    }
    write_http_response(
        stream,
        200,
        "OK",
        "application/json",
        response.to_string().into_bytes(),
        headers,
    )
    .await
}

async fn handle_streamable_http_sse(
    stream: &mut TcpStream,
    request: &HttpRequest,
) -> io::Result<()> {
    write_sse_headers(stream, cors_headers(request)).await?;
    stream.write_all(b"event: ready\ndata: {}\n\n").await?;
    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;
        if stream.write_all(b": ping\n\n").await.is_err() {
            break;
        }
        let _ = stream.flush().await;
    }
    Ok(())
}

async fn handle_legacy_sse(
    stream: &mut TcpStream,
    request: &HttpRequest,
    state: HttpState,
) -> io::Result<()> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    {
        let mut sessions = state
            .sse_sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        sessions.insert(session_id.clone(), tx);
    }

    write_sse_headers(stream, cors_headers(request)).await?;
    let endpoint = format!("/messages?session_id={session_id}");
    write_sse_event(stream, "endpoint", &endpoint).await?;

    loop {
        match timeout(Duration::from_secs(15), rx.recv()).await {
            Ok(Some(message)) => {
                if write_sse_event(stream, "message", &message).await.is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => {
                if stream.write_all(b": ping\n\n").await.is_err() {
                    break;
                }
                let _ = stream.flush().await;
            }
        }
    }

    let mut sessions = state
        .sse_sessions
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    sessions.remove(&session_id);
    Ok(())
}

async fn handle_legacy_message(
    stream: &mut TcpStream,
    request: HttpRequest,
    state: HttpState,
) -> io::Result<()> {
    let Some(session_id) = query_param(&request.query, "session_id") else {
        return write_http_response(
            stream,
            400,
            "Bad Request",
            "application/json",
            json!({ "error": "session_id missing" })
                .to_string()
                .into_bytes(),
            cors_headers(&request),
        )
        .await;
    };
    let sender = {
        let sessions = state
            .sse_sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        sessions.get(&session_id).cloned()
    };
    let Some(sender) = sender else {
        return write_http_response(
            stream,
            404,
            "Not Found",
            "application/json",
            json!({ "error": "session not found" })
                .to_string()
                .into_bytes(),
            cors_headers(&request),
        )
        .await;
    };

    let message = match serde_json::from_slice::<Value>(&request.body) {
        Ok(value) => value,
        Err(parse_error) => {
            return write_http_response(
                stream,
                400,
                "Bad Request",
                "application/json",
                error(
                    Value::Null,
                    -32700,
                    &format!("parse error: {parse_error}"),
                    None,
                )
                .to_string()
                .into_bytes(),
                cors_headers(&request),
            )
            .await;
        }
    };
    let response = handle_message_async(&state.data_dir, message).await;
    if !response.is_null() {
        let _ = sender.send(response.to_string());
    }
    write_http_response(
        stream,
        202,
        "Accepted",
        "text/plain",
        Vec::new(),
        cors_headers(&request),
    )
    .await
}

async fn read_http_request(stream: &mut TcpStream) -> io::Result<Option<HttpRequest>> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return if buffer.is_empty() {
                Ok(None)
            } else {
                invalid_data("incomplete http request")
            };
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_HTTP_HEADER_BYTES {
            return invalid_data("http header too large");
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let header_text = String::from_utf8(buffer[..header_end].to_vec())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid http header"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing method"))?
        .to_string();
    let target = request_parts
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing target"))?;
    let (path, query) = split_target(target);
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_HTTP_BODY_BYTES {
        return invalid_data("http body too large");
    }
    let body_start = header_end + 4;
    let mut body = buffer[body_start..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return invalid_data("incomplete http body");
        }
        body.extend_from_slice(&chunk[..read]);
        if body.len() > MAX_HTTP_BODY_BYTES {
            return invalid_data("http body too large");
        }
    }
    body.truncate(content_length);

    Ok(Some(HttpRequest {
        method,
        path,
        query,
        headers,
        body,
    }))
}

fn invalid_data<T>(message: &'static str) -> io::Result<T> {
    Err(io::Error::new(io::ErrorKind::InvalidData, message))
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn split_target(target: &str) -> (String, String) {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    (path.to_string(), query.to_string())
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        (name == key).then(|| value.to_string())
    })
}

fn request_authorized(request: &HttpRequest, token_hash: &str) -> bool {
    request_token(request)
        .as_deref()
        .is_some_and(|token| mcp::verify_remote_token(token, token_hash))
}

fn request_token(request: &HttpRequest) -> Option<String> {
    if let Some(header) = request.headers.get("authorization") {
        let trimmed = header.trim();
        if let Some(token) = trimmed.strip_prefix("Bearer ") {
            return Some(token.trim().to_string());
        }
        if let Some(token) = trimmed.strip_prefix("bearer ") {
            return Some(token.trim().to_string());
        }
    }
    request
        .headers
        .get("x-mxterm-mcp-token")
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

fn origin_allowed(request: &HttpRequest) -> bool {
    let Some(origin) = request.headers.get("origin") else {
        return true;
    };
    let Some(origin_host) = authority_host(origin_authority(origin)) else {
        return false;
    };
    if is_loopback_host(origin_host) {
        return true;
    }
    let Some(host) = request.headers.get("host") else {
        return false;
    };
    authority_host(host).is_some_and(|host| host.eq_ignore_ascii_case(origin_host))
}

fn origin_authority(origin: &str) -> &str {
    let without_scheme = origin
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(origin);
    without_scheme.split('/').next().unwrap_or(without_scheme)
}

fn authority_host(authority: &str) -> Option<&str> {
    let value = authority.trim().trim_start_matches('[');
    let value = value.trim_end_matches(']');
    value.split(':').next().filter(|host| !host.is_empty())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn cors_headers(request: &HttpRequest) -> Vec<(String, String)> {
    let allow_origin = request
        .headers
        .get("origin")
        .filter(|_| origin_allowed(request))
        .cloned()
        .unwrap_or_else(|| "*".to_string());
    vec![
        ("Access-Control-Allow-Origin".to_string(), allow_origin),
        (
            "Access-Control-Allow-Headers".to_string(),
            "Authorization, Content-Type, X-MXterm-MCP-Token, MCP-Session-Id".to_string(),
        ),
        (
            "Access-Control-Allow-Methods".to_string(),
            "GET, POST, OPTIONS".to_string(),
        ),
    ]
}

async fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: Vec<u8>,
    extra_headers: Vec<(String, String)>,
) -> io::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in extra_headers {
        response.push_str(&format!("{name}: {value}\r\n"));
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.flush().await
}

async fn write_sse_headers(
    stream: &mut TcpStream,
    extra_headers: Vec<(String, String)>,
) -> io::Result<()> {
    let mut response = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n".to_string();
    for (name, value) in extra_headers {
        response.push_str(&format!("{name}: {value}\r\n"));
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await
}

async fn write_sse_event(stream: &mut TcpStream, event: &str, data: &str) -> io::Result<()> {
    stream
        .write_all(format!("event: {event}\ndata: {data}\n\n").as_bytes())
        .await?;
    stream.flush().await
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
                .filter(mcp::connection_is_supported)
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

    #[test]
    fn http_auth_accepts_bearer_and_custom_token_header() {
        let token = "mx_remote_token";
        let token_hash = mcp::hash_remote_token(token);
        let mut bearer_headers = HashMap::new();
        bearer_headers.insert("authorization".to_string(), format!("Bearer {token}"));
        let bearer_request = HttpRequest {
            method: "POST".to_string(),
            path: "/mcp".to_string(),
            query: String::new(),
            headers: bearer_headers,
            body: Vec::new(),
        };
        assert!(request_authorized(&bearer_request, &token_hash));

        let mut custom_headers = HashMap::new();
        custom_headers.insert("x-mxterm-mcp-token".to_string(), token.to_string());
        let custom_request = HttpRequest {
            method: "POST".to_string(),
            path: "/mcp".to_string(),
            query: String::new(),
            headers: custom_headers,
            body: Vec::new(),
        };
        assert!(request_authorized(&custom_request, &token_hash));
    }

    #[test]
    fn http_auth_rejects_missing_or_wrong_token() {
        let token_hash = mcp::hash_remote_token("mx_remote_token");
        let missing_request = HttpRequest {
            method: "POST".to_string(),
            path: "/mcp".to_string(),
            query: String::new(),
            headers: HashMap::new(),
            body: Vec::new(),
        };
        assert!(!request_authorized(&missing_request, &token_hash));

        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), "Bearer wrong".to_string());
        let wrong_request = HttpRequest {
            method: "POST".to_string(),
            path: "/mcp".to_string(),
            query: String::new(),
            headers,
            body: Vec::new(),
        };
        assert!(!request_authorized(&wrong_request, &token_hash));
    }
}
