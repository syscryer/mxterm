#[cfg(test)]
use base64::engine::{general_purpose::STANDARD, Engine as _};
use reqwest::header::{HeaderName, CONTENT_TYPE};
use reqwest::{Client, Method, StatusCode, Url};

use crate::app_error::AppError;

pub const DEFAULT_MANIFEST_MAX_BYTES: usize = 512 * 1024;
pub const DEFAULT_DATA_MAX_BYTES: usize = 64 * 1024 * 1024;
pub const DEFAULT_SECRETS_MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WebDavStatus {
    pub code: u16,
}

impl WebDavStatus {
    pub fn new(code: u16) -> Self {
        Self { code }
    }

    fn is_collection_success(self) -> bool {
        matches!(self.code, 200 | 201 | 204 | 207)
    }

    fn needs_existing_collection_check(self) -> bool {
        matches!(self.code, 405 | 409)
    }
}

#[allow(async_fn_in_trait)]
pub trait WebDavTransport {
    async fn propfind(&self, path_segments: &[String], depth: u8)
        -> Result<WebDavStatus, AppError>;
    async fn mkcol(&self, path_segments: &[String]) -> Result<WebDavStatus, AppError>;
    async fn put(
        &self,
        path_segments: &[String],
        bytes: Vec<u8>,
        content_type: &str,
    ) -> Result<WebDavStatus, AppError>;
    async fn get(
        &self,
        path_segments: &[String],
        max_bytes: usize,
    ) -> Result<Option<Vec<u8>>, AppError>;
}

#[derive(Clone)]
pub struct WebDavClient {
    base_url: Url,
    client: Client,
    password: Option<String>,
    username: Option<String>,
}

impl WebDavClient {
    pub fn new(
        base_url: &str,
        username: Option<String>,
        password: Option<String>,
    ) -> Result<Self, AppError> {
        let mut base_url = Url::parse(base_url.trim()).map_err(|error| {
            AppError::new(
                "webdav_settings_invalid",
                "WebDAV 服务地址无效。",
                error,
                true,
            )
        })?;
        if !matches!(base_url.scheme(), "http" | "https") {
            return Err(AppError::new(
                "webdav_settings_invalid",
                "WebDAV 服务地址必须是 http 或 https。",
                redact_url(base_url.as_str()),
                true,
            ));
        }
        base_url.set_query(None);
        base_url.set_fragment(None);
        Ok(Self {
            base_url,
            client: Client::new(),
            password: trim_optional_owned(password),
            username: trim_optional_owned(username),
        })
    }

    fn url_for_segments(&self, path_segments: &[String]) -> Result<Url, AppError> {
        let mut url = self.base_url.clone();
        let prefix = url.path().trim_end_matches('/');
        let encoded_path =
            join_encoded_path(&path_segments.iter().map(String::as_str).collect::<Vec<_>>());
        let path = match (prefix.is_empty() || prefix == "/", encoded_path.is_empty()) {
            (true, true) => "/".to_string(),
            (true, false) => format!("/{encoded_path}"),
            (false, true) => prefix.to_string(),
            (false, false) => format!("{prefix}/{encoded_path}"),
        };
        url.set_path(&path);
        Ok(url)
    }

    async fn send_status(
        &self,
        method: Method,
        path_segments: &[String],
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
        depth: Option<u8>,
    ) -> Result<WebDavStatus, AppError> {
        let url = self.url_for_segments(path_segments)?;
        let method_label = method.as_str().to_string();
        let mut request = self.client.request(method, url.clone());
        if let Some(username) = self
            .username
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            request = request.basic_auth(username, self.password.as_deref());
        }
        if let Some(depth) = depth {
            request = request.header(HeaderName::from_static("depth"), depth.to_string());
        }
        if let Some(content_type) = content_type {
            request = request.header(CONTENT_TYPE, content_type);
        }
        if let Some(body) = body {
            request = request.body(body);
        }

        let response = request.send().await.map_err(|error| {
            AppError::new(
                "webdav_connection_failed",
                "WebDAV 连接失败。",
                format!("{method_label} {}: {error}", redact_url(url.as_str())),
                true,
            )
        })?;
        Ok(WebDavStatus::new(response.status().as_u16()))
    }

    async fn send_get(
        &self,
        path_segments: &[String],
        max_bytes: usize,
    ) -> Result<Option<Vec<u8>>, AppError> {
        let url = self.url_for_segments(path_segments)?;
        let mut request = self.client.get(url.clone());
        if let Some(username) = self
            .username
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            request = request.basic_auth(username, self.password.as_deref());
        }
        let mut response = request.send().await.map_err(|error| {
            AppError::new(
                "webdav_connection_failed",
                "WebDAV 连接失败。",
                format!("GET {}: {error}", redact_url(url.as_str())),
                true,
            )
        })?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(webdav_http_status(
                "GET",
                url.as_str(),
                response.status().as_u16(),
            ));
        }

        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            AppError::new(
                "webdav_connection_failed",
                "WebDAV 响应读取失败。",
                format!("GET {}: {error}", redact_url(url.as_str())),
                true,
            )
        })? {
            append_limited_body(&mut bytes, chunk.as_ref(), max_bytes)?;
        }
        Ok(Some(bytes))
    }
}

impl WebDavTransport for WebDavClient {
    async fn propfind(
        &self,
        path_segments: &[String],
        depth: u8,
    ) -> Result<WebDavStatus, AppError> {
        let method = Method::from_bytes(b"PROPFIND").map_err(|error| {
            AppError::new(
                "webdav_connection_failed",
                "WebDAV 请求方法初始化失败。",
                error,
                true,
            )
        })?;
        self.send_status(method, path_segments, None, None, Some(depth))
            .await
    }

    async fn mkcol(&self, path_segments: &[String]) -> Result<WebDavStatus, AppError> {
        let method = Method::from_bytes(b"MKCOL").map_err(|error| {
            AppError::new(
                "webdav_connection_failed",
                "WebDAV 请求方法初始化失败。",
                error,
                true,
            )
        })?;
        self.send_status(method, path_segments, None, None, None)
            .await
    }

    async fn put(
        &self,
        path_segments: &[String],
        bytes: Vec<u8>,
        content_type: &str,
    ) -> Result<WebDavStatus, AppError> {
        let status = self
            .send_status(
                Method::PUT,
                path_segments,
                Some(bytes),
                Some(content_type),
                None,
            )
            .await?;
        if matches!(status.code, 200 | 201 | 204) {
            Ok(status)
        } else {
            let url = self.url_for_segments(path_segments)?;
            Err(webdav_http_status("PUT", url.as_str(), status.code))
        }
    }

    async fn get(
        &self,
        path_segments: &[String],
        max_bytes: usize,
    ) -> Result<Option<Vec<u8>>, AppError> {
        self.send_get(path_segments, max_bytes).await
    }
}

pub fn join_encoded_path(segments: &[&str]) -> String {
    normalize_path_segments(segments)
        .iter()
        .map(|segment| percent_encode_segment(segment))
        .collect::<Vec<_>>()
        .join("/")
}

pub fn normalize_path_segments(segments: &[&str]) -> Vec<String> {
    segments
        .iter()
        .flat_map(|segment| {
            segment
                .trim()
                .replace('\\', "/")
                .split('/')
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .map(|segment| segment.trim().to_string())
        .filter(|segment| !segment.is_empty())
        .collect()
}

pub fn redact_url(value: &str) -> String {
    let Ok(mut url) = Url::parse(value) else {
        return value.to_string();
    };

    if !url.username().is_empty() {
        let _ = url.set_username("***");
    }
    if url.password().is_some() {
        let _ = url.set_password(Some("***"));
    }
    let pairs = url
        .query_pairs()
        .map(|(key, _)| (key.into_owned(), "***".to_string()))
        .collect::<Vec<_>>();
    if !pairs.is_empty() {
        url.set_query(None);
        url.query_pairs_mut().extend_pairs(
            pairs
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        );
    }
    url.to_string()
}

#[cfg(test)]
pub fn basic_auth_header(username: Option<&str>, password: Option<&str>) -> Option<String> {
    let username = username.map(str::trim).filter(|value| !value.is_empty())?;
    let password = password.unwrap_or_default();
    Some(format!(
        "Basic {}",
        STANDARD.encode(format!("{username}:{password}"))
    ))
}

#[cfg(test)]
pub fn limited_body_from_chunks(chunks: &[&[u8]], max_bytes: usize) -> Result<Vec<u8>, AppError> {
    let mut output = Vec::new();
    for chunk in chunks {
        append_limited_body(&mut output, chunk, max_bytes)?;
    }
    Ok(output)
}

pub async fn ensure_collection<T: WebDavTransport>(
    transport: &T,
    path_segments: &[String],
) -> Result<(), AppError> {
    for index in 1..=path_segments.len() {
        let current = path_segments[..index].to_vec();
        let status = transport.mkcol(&current).await?;
        if status.is_collection_success() && !status.needs_existing_collection_check() {
            continue;
        }
        if status.needs_existing_collection_check() {
            let existing = transport.propfind(&current, 0).await?;
            if existing.is_collection_success() {
                continue;
            }
        }
        return Err(AppError::new(
            "webdav_http_status",
            "WebDAV 目录创建失败。",
            format!("MKCOL {} returned {}", current.join("/"), status.code),
            true,
        ));
    }
    Ok(())
}

fn append_limited_body(
    output: &mut Vec<u8>,
    chunk: &[u8],
    max_bytes: usize,
) -> Result<(), AppError> {
    if output.len().saturating_add(chunk.len()) > max_bytes {
        return Err(AppError::new(
            "webdav_response_too_large",
            "WebDAV 响应过大，已停止读取。",
            format!("max_bytes={max_bytes}"),
            true,
        ));
    }
    output.extend_from_slice(chunk);
    Ok(())
}

fn percent_encode_segment(segment: &str) -> String {
    let mut output = String::new();
    for byte in segment.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                output.push(*byte as char);
            }
            byte => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

fn trim_optional_owned(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn webdav_http_status(method: &str, url: &str, status: u16) -> AppError {
    AppError::new(
        "webdav_http_status",
        "WebDAV 服务返回异常状态。",
        format!("{method} {} returned {status}", redact_url(url)),
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::{
        basic_auth_header, ensure_collection, join_encoded_path, limited_body_from_chunks,
        redact_url, WebDavStatus, WebDavTransport,
    };
    use crate::app_error::AppError;

    #[test]
    fn path_segments_are_encoded_without_duplicate_slashes() {
        let path = join_encoded_path(&[" /mxterm sync/生产 ", "v1", "default", "manifest.json"]);

        assert_eq!(
            path,
            "mxterm%20sync/%E7%94%9F%E4%BA%A7/v1/default/manifest.json"
        );
    }

    #[test]
    fn redacted_url_hides_user_password_and_query_values() {
        let redacted = redact_url("https://alice:secret@example.com/sync?token=abc&empty=");

        assert_eq!(
            redacted,
            "https://***:***@example.com/sync?token=***&empty=***"
        );
        assert!(!redacted.contains("alice"));
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("abc"));
    }

    #[test]
    fn basic_auth_is_only_added_when_username_exists() {
        assert!(basic_auth_header(Some("alice"), Some("secret")).is_some());
        assert_eq!(basic_auth_header(Some("  "), Some("secret")), None);
        assert_eq!(basic_auth_header(None, Some("secret")), None);
    }

    #[test]
    fn mkcol_conflict_verifies_collection_with_propfind() {
        let transport = RecordingTransport::new(409, 207);
        let path = vec![
            "mxterm-sync".to_string(),
            "v1".to_string(),
            "default".to_string(),
        ];

        tauri::async_runtime::block_on(ensure_collection(&transport, &path)).unwrap();

        assert_eq!(
            transport.operations(),
            vec![
                "MKCOL mxterm-sync",
                "PROPFIND mxterm-sync depth=0",
                "MKCOL mxterm-sync/v1",
                "PROPFIND mxterm-sync/v1 depth=0",
                "MKCOL mxterm-sync/v1/default",
                "PROPFIND mxterm-sync/v1/default depth=0",
            ]
        );
    }

    #[test]
    fn oversized_response_returns_webdav_response_too_large() {
        let error =
            limited_body_from_chunks(&[b"123".as_slice(), b"456".as_slice()], 5).unwrap_err();

        assert_eq!(error.code, "webdav_response_too_large");
    }

    struct RecordingTransport {
        mkcol_status: u16,
        operations: Mutex<Vec<String>>,
        propfind_status: u16,
    }

    impl RecordingTransport {
        fn new(mkcol_status: u16, propfind_status: u16) -> Self {
            Self {
                mkcol_status,
                operations: Mutex::new(Vec::new()),
                propfind_status,
            }
        }

        fn operations(&self) -> Vec<String> {
            self.operations.lock().unwrap().clone()
        }

        fn push(&self, operation: String) {
            self.operations.lock().unwrap().push(operation);
        }
    }

    impl WebDavTransport for RecordingTransport {
        async fn propfind(
            &self,
            path_segments: &[String],
            depth: u8,
        ) -> Result<WebDavStatus, AppError> {
            self.push(format!(
                "PROPFIND {} depth={depth}",
                path_segments.join("/")
            ));
            Ok(WebDavStatus::new(self.propfind_status))
        }

        async fn mkcol(&self, path_segments: &[String]) -> Result<WebDavStatus, AppError> {
            self.push(format!("MKCOL {}", path_segments.join("/")));
            Ok(WebDavStatus::new(self.mkcol_status))
        }

        async fn put(
            &self,
            path_segments: &[String],
            _bytes: Vec<u8>,
            _content_type: &str,
        ) -> Result<WebDavStatus, AppError> {
            self.push(format!("PUT {}", path_segments.join("/")));
            Ok(WebDavStatus::new(201))
        }

        async fn get(
            &self,
            path_segments: &[String],
            _max_bytes: usize,
        ) -> Result<Option<Vec<u8>>, AppError> {
            self.push(format!("GET {}", path_segments.join("/")));
            Ok(None)
        }
    }
}
