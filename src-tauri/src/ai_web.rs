use std::net::IpAddr;
use std::time::Duration;

use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::json;
use tokio::net::lookup_host;

use crate::app_error::AppError;

const SEARCH_ENDPOINT: &str = "https://lite.duckduckgo.com/lite/";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_SEARCH_QUERY_CHARS: usize = 500;
const DEFAULT_SEARCH_RESULTS: u8 = 8;
const MAX_SEARCH_RESULTS: u8 = 10;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_FETCH_CHARS: usize = 16_000;
const MAX_FETCH_CHARS: usize = 40_000;
const MAX_FETCH_URL_CHARS: usize = 2_048;

#[derive(Debug, Deserialize)]
pub(crate) struct WebSearchArgs {
    #[serde(alias = "query")]
    pub search_query: String,
    #[serde(default)]
    pub max_results: Option<u8>,
    #[serde(default)]
    pub location: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WebFetchArgs {
    pub url: String,
    #[serde(default)]
    pub start_index: Option<usize>,
    #[serde(default)]
    pub max_chars: Option<usize>,
}

pub(crate) async fn search(arguments: &str) -> Result<String, AppError> {
    let args: WebSearchArgs = serde_json::from_str(arguments).map_err(|error| {
        AppError::new("ai_web_search_invalid", "联网搜索参数无效。", error, true)
    })?;
    let query = args.search_query.trim();
    if query.is_empty() {
        return Err(AppError::new(
            "ai_web_search_query_missing",
            "联网搜索缺少关键词。",
            "search_query is empty",
            true,
        ));
    }
    if query.chars().count() > MAX_SEARCH_QUERY_CHARS {
        return Err(AppError::new(
            "ai_web_search_query_too_long",
            "联网搜索关键词过长。",
            format!("maximum {MAX_SEARCH_QUERY_CHARS} characters"),
            true,
        ));
    }

    let mut endpoint = Url::parse(SEARCH_ENDPOINT).expect("static search endpoint is valid");
    endpoint.query_pairs_mut().append_pair("q", query);
    if let Some(location) = args
        .location
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        endpoint.query_pairs_mut().append_pair("kl", location);
    }

    let response = http_client()?
        .get(endpoint.clone())
        .send()
        .await
        .map_err(|error| network_error("ai_web_search_failed", "联网搜索失败。", error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::new(
            "ai_web_search_http",
            "联网搜索服务返回错误。",
            format!("GET {} -> {}", endpoint, status),
            true,
        ));
    }
    let body = read_limited_body(response, "ai_web_search_response_too_large").await?;
    let html = String::from_utf8_lossy(&body);
    let limit = args
        .max_results
        .unwrap_or(DEFAULT_SEARCH_RESULTS)
        .clamp(1, MAX_SEARCH_RESULTS) as usize;
    let results = parse_search_results(&html, limit);
    let payload = json!({
        "query": query,
        "source": "DuckDuckGo Lite",
        "results": results,
    });
    serde_json::to_string_pretty(&payload).map_err(|error| {
        AppError::new(
            "ai_web_search_encode_failed",
            "联网搜索结果编码失败。",
            error,
            true,
        )
    })
}

pub(crate) async fn fetch(arguments: &str) -> Result<String, AppError> {
    let args: WebFetchArgs = serde_json::from_str(arguments).map_err(|error| {
        AppError::new("ai_web_fetch_invalid", "网页读取参数无效。", error, true)
    })?;
    let url = args.url.trim();
    let parsed = validate_public_url(url)?;
    ensure_public_dns_target(&parsed).await?;
    let start_index = args.start_index.unwrap_or(0);
    let max_chars = args
        .max_chars
        .unwrap_or(DEFAULT_FETCH_CHARS)
        .clamp(200, MAX_FETCH_CHARS);
    let response = http_client()?
        .get(parsed.clone())
        .send()
        .await
        .map_err(|error| network_error("ai_web_fetch_failed", "网页读取失败。", error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::new(
            "ai_web_fetch_http",
            "网页读取服务返回错误。",
            format!("GET {} -> {}", parsed, status),
            true,
        ));
    }
    let body = read_limited_body(response, "ai_web_fetch_response_too_large").await?;
    let raw = String::from_utf8_lossy(&body);
    let text = if raw.contains("<html") || raw.contains("<HTML") {
        html_to_text(&raw)
    } else {
        raw.to_string()
    };
    let total = text.chars().count();
    let content: String = text.chars().skip(start_index).take(max_chars).collect();
    let truncated = start_index.saturating_add(content.chars().count()) < total;
    let mut output = format!("Contents of {parsed}:\n{content}");
    if truncated {
        output.push_str(&format!(
            "\n\n<error>Content truncated. Call the web_fetch tool with start_index of {} to continue.</error>",
            start_index.saturating_add(content.chars().count())
        ));
    }
    Ok(output)
}

fn http_client() -> Result<Client, AppError> {
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent("mXterm-AI-Agent/0.1")
        .build()
        .map_err(|error| {
            AppError::new(
                "ai_web_client_init_failed",
                "联网工具初始化失败。",
                error,
                true,
            )
        })
}

async fn read_limited_body(
    response: reqwest::Response,
    too_large_code: &str,
) -> Result<Vec<u8>, AppError> {
    let bytes = response.bytes().await.map_err(|error| {
        network_error("ai_web_response_read_failed", "联网响应读取失败。", error)
    })?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::new(
            too_large_code,
            "联网响应过大，已停止读取。",
            format!("response bytes={} limit={MAX_RESPONSE_BYTES}", bytes.len()),
            true,
        ));
    }
    Ok(bytes.to_vec())
}

fn network_error(code: &str, message: &str, error: reqwest::Error) -> AppError {
    AppError::new(code, message, error, true)
}

fn validate_public_url(value: &str) -> Result<Url, AppError> {
    if value.chars().count() > MAX_FETCH_URL_CHARS {
        return Err(AppError::new(
            "ai_web_fetch_url_too_long",
            "网页地址过长。",
            format!("maximum {MAX_FETCH_URL_CHARS} characters"),
            true,
        ));
    }
    let parsed = Url::parse(value).map_err(|error| {
        AppError::new("ai_web_fetch_url_invalid", "网页地址无效。", error, true)
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::new(
            "ai_web_fetch_scheme_invalid",
            "网页读取只支持 HTTP 或 HTTPS 地址。",
            parsed.scheme(),
            true,
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::new(
            "ai_web_fetch_credentials_unsupported",
            "网页读取地址不能携带用户名或密码。",
            "userinfo in URL is not allowed",
            true,
        ));
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".local")
        || host.ends_with(".localhost")
    {
        return Err(AppError::new(
            "ai_web_fetch_private_target",
            "网页读取不允许访问本机或内网地址。",
            host,
            true,
        ));
    }
    if host.parse::<IpAddr>().is_ok_and(is_private_ip) {
        return Err(AppError::new(
            "ai_web_fetch_private_target",
            "网页读取不允许访问本机或内网地址。",
            host,
            true,
        ));
    }
    Ok(parsed)
}

async fn ensure_public_dns_target(url: &Url) -> Result<(), AppError> {
    let Some(host) = url.host_str() else {
        return Err(AppError::new(
            "ai_web_fetch_private_target",
            "网页读取不允许访问本机或内网地址。",
            "host is missing",
            true,
        ));
    };
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = lookup_host((host, port)).await.map_err(|error| {
        AppError::new("ai_web_fetch_dns_failed", "网页地址解析失败。", error, true)
    })?;
    let mut found = false;
    for address in addresses {
        found = true;
        if is_private_ip(address.ip()) {
            return Err(AppError::new(
                "ai_web_fetch_private_target",
                "网页读取不允许访问本机或内网地址。",
                address.ip(),
                true,
            ));
        }
    }
    if !found {
        return Err(AppError::new(
            "ai_web_fetch_dns_failed",
            "网页地址没有可用的公网地址。",
            host,
            true,
        ));
    }
    Ok(())
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_unspecified()
        }
        IpAddr::V6(value) => {
            let first = value.segments()[0];
            value.is_loopback()
                || value.is_unspecified()
                || value.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
        }
    }
}

fn parse_search_results(html: &str, limit: usize) -> Vec<serde_json::Value> {
    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut cursor = 0;
    while results.len() < limit {
        let Some(class_offset) = html[cursor..]
            .find("class=\"result-link\"")
            .or_else(|| html[cursor..].find("class='result-link'"))
        else {
            break;
        };
        let class_start = cursor + class_offset;
        let anchor_start = html[..class_start].rfind("<a").unwrap_or(class_start);
        let Some(tag_end_offset) = html[class_start..].find('>') else {
            break;
        };
        let tag_end = class_start + tag_end_offset;
        let tag = &html[anchor_start..=tag_end];
        let Some(raw_href) = extract_attribute(tag, "href") else {
            cursor = tag_end.saturating_add(1);
            continue;
        };
        let title_start = tag_end.saturating_add(1);
        let Some(title_end_offset) = html[title_start..].find("</a>") else {
            break;
        };
        let title_end = title_start + title_end_offset;
        let title = clean_html_text(&html[title_start..title_end]);
        let url = normalize_result_url(&raw_href);
        let (snippet, next_cursor) = find_result_snippet(html, title_end);
        cursor = next_cursor.max(title_end.saturating_add(4));
        if title.is_empty() || url.is_empty() || results.iter().any(|item| item["url"] == url) {
            continue;
        }
        results.push(json!({
            "rank": results.len() + 1,
            "title": title,
            "url": url,
            "snippet": snippet,
        }));
    }
    results
}

fn extract_attribute(tag: &str, name: &str) -> Option<String> {
    for quote in ['\"', '\''] {
        let marker = format!("{name}={quote}");
        let Some(marker_start) = tag.find(&marker) else {
            continue;
        };
        let start = marker_start + marker.len();
        let end = tag[start..].find(quote)? + start;
        return Some(tag[start..end].to_string());
    }
    None
}

fn normalize_result_url(raw: &str) -> String {
    let href = if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_string()
    };
    if let Ok(parsed) = Url::parse(&href) {
        if let Some(target) = parsed
            .query_pairs()
            .find(|(key, _)| key == "uddg")
            .map(|(_, value)| value.into_owned())
        {
            return target;
        }
    }
    href
}

fn find_result_snippet(html: &str, start: usize) -> (String, usize) {
    let Some(offset) = html[start..].find("result-snippet") else {
        return (String::new(), start);
    };
    let marker_start = start + offset;
    let content_start = html[marker_start..]
        .find('>')
        .map(|value| marker_start + value + 1)
        .unwrap_or(marker_start);
    let end_td = html[content_start..]
        .find("</td>")
        .map(|value| content_start + value);
    let end_div = html[content_start..]
        .find("</div>")
        .map(|value| content_start + value);
    let content_end = [end_td, end_div]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(content_start);
    (
        clean_html_text(&html[content_start..content_end]),
        content_end,
    )
}

fn clean_html_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    decode_html_entities(&text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn html_to_text(value: &str) -> String {
    let value = remove_html_blocks(value, "script");
    let value = remove_html_blocks(&value, "style");
    let value = remove_html_blocks(&value, "noscript");
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for ch in value.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let tag_name = tag
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or_default();
                if matches!(
                    tag_name,
                    "br" | "p" | "div" | "li" | "h1" | "h2" | "h3" | "tr"
                ) {
                    text.push('\n');
                }
            }
            _ if in_tag => tag.push(ch),
            _ => text.push(ch),
        }
    }
    decode_html_entities(&text)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn remove_html_blocks(value: &str, tag_name: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let open = format!("<{tag_name}");
    let close = format!("</{tag_name}>");
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    while let Some(open_offset) = lower[cursor..].find(&open) {
        let open_start = cursor + open_offset;
        output.push_str(&value[cursor..open_start]);
        let Some(close_offset) = lower[open_start..].find(&close) else {
            return output;
        };
        cursor = open_start + close_offset + close.len();
    }
    output.push_str(&value[cursor..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lite_search_results_and_decodes_redirect_url() {
        let html = r#"
            <a rel='nofollow' class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=1'>Example &amp; Docs</a>
            <td class='result-snippet'>A <b>useful</b> snippet.</td>
        "#;
        let results = parse_search_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["title"], "Example & Docs");
        assert_eq!(results[0]["url"], "https://example.com/docs");
        assert_eq!(results[0]["snippet"], "A useful snippet.");
    }

    #[test]
    fn blocks_private_web_targets() {
        assert!(validate_public_url("http://127.0.0.1:8080").is_err());
        assert!(validate_public_url("http://10.0.0.5").is_err());
        assert!(validate_public_url("https://example.com").is_ok());
    }

    #[test]
    fn converts_html_to_compact_text() {
        assert_eq!(
            html_to_text("<script>ignore()</script><h1>Hello</h1><p>World &amp; all</p>"),
            "Hello\nWorld & all"
        );
    }
}
