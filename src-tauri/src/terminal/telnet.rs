use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::app_error::AppError;

pub const SE: u8 = 240;
pub const SB: u8 = 250;
pub const WILL: u8 = 251;
pub const WONT: u8 = 252;
pub const DO: u8 = 253;
pub const DONT: u8 = 254;
pub const IAC: u8 = 255;
pub const ECHO: u8 = 1;
pub const SUPPRESS_GO_AHEAD: u8 = 3;
pub const NAWS: u8 = 31;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelnetEnterMode {
    Cr,
    Lf,
    CrLf,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelnetBackspaceMode {
    Del,
    CtrlH,
}

#[derive(Debug, Deserialize)]
pub struct TelnetTerminalOpenRequest {
    #[serde(default)]
    pub request_id: Option<String>,
    pub host: String,
    #[serde(default = "default_telnet_port")]
    pub port: u16,
    #[serde(default)]
    pub enter_mode: Option<TelnetEnterMode>,
    #[serde(default)]
    pub backspace_mode: Option<TelnetBackspaceMode>,
}

#[derive(Clone, Debug)]
pub struct TelnetSessionConfig {
    pub request_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub enter_mode: TelnetEnterMode,
    pub backspace_mode: TelnetBackspaceMode,
}

pub struct TelnetTerminalSession {
    pub id: String,
    commands: mpsc::UnboundedSender<TelnetCommand>,
}

pub struct OpenTelnetSession {
    pub session: std::sync::Arc<TelnetTerminalSession>,
    pub request_id: Option<String>,
    pub reader: mpsc::UnboundedReceiver<Vec<u8>>,
}

enum TelnetCommand {
    Write(String),
    Resize(u16, u16),
    Close,
}

enum ParserState {
    Data,
    Iac,
    Command(u8),
    Subnegotiation,
    SubnegotiationIac,
}

pub struct TelnetProtocolParser {
    cols: u16,
    rows: u16,
    state: ParserState,
}

impl TelnetTerminalSession {
    pub async fn open(request: TelnetTerminalOpenRequest) -> Result<OpenTelnetSession, AppError> {
        let config = validate_telnet_open_request(request)?;
        let stream = TcpStream::connect((config.host.as_str(), config.port))
            .await
            .map_err(|error| {
                AppError::new("telnet_connect_failed", "Telnet 连接失败。", error, true)
            })?;
        let (mut socket_reader, mut socket_writer) = stream.into_split();
        let (command_tx, mut command_rx) = mpsc::unbounded_channel::<TelnetCommand>();
        let (output_tx, output_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let session = std::sync::Arc::new(TelnetTerminalSession {
            id: Uuid::new_v4().to_string(),
            commands: command_tx,
        });
        let request_id = config.request_id.clone();

        tauri::async_runtime::spawn(async move {
            let mut parser = TelnetProtocolParser::new(80, 24);
            let mut buffer = vec![0_u8; 8192];

            loop {
                tokio::select! {
                    read = socket_reader.read(&mut buffer) => {
                        match read {
                            Ok(0) => break,
                            Ok(size) => {
                                let mut output = Vec::new();
                                let mut replies = Vec::new();
                                parser.feed(&buffer[..size], &mut output, &mut replies);
                                if !replies.is_empty() && socket_writer.write_all(&replies).await.is_err() {
                                    break;
                                }
                                if !output.is_empty() && output_tx.send(output).is_err() {
                                    break;
                                }
                            }
                            Err(error) => {
                                let _ = output_tx.send(format!("\r\n{}\r\n", error).into_bytes());
                                break;
                            }
                        }
                    }
                    command = command_rx.recv() => {
                        match command {
                            Some(TelnetCommand::Write(data)) => {
                                let bytes = transform_telnet_input(&data, &config);
                                if socket_writer.write_all(&bytes).await.is_err() {
                                    break;
                                }
                            }
                            Some(TelnetCommand::Resize(cols, rows)) => {
                                parser.set_size(cols, rows);
                                if socket_writer.write_all(&build_naws_payload(cols, rows)).await.is_err() {
                                    break;
                                }
                            }
                            Some(TelnetCommand::Close) | None => {
                                let _ = socket_writer.shutdown().await;
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(OpenTelnetSession {
            session,
            request_id,
            reader: output_rx,
        })
    }

    pub async fn write(&self, data: String) -> Result<(), AppError> {
        self.commands
            .send(TelnetCommand::Write(data))
            .map_err(|_| telnet_closed_error("telnet_write_failed", "Telnet 输入发送失败。"))
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.commands
            .send(TelnetCommand::Resize(cols, rows))
            .map_err(|_| telnet_closed_error("telnet_resize_failed", "Telnet 尺寸同步失败。"))
    }

    pub async fn close(&self) -> Result<(), AppError> {
        self.commands
            .send(TelnetCommand::Close)
            .map_err(|_| telnet_closed_error("telnet_close_failed", "Telnet 会话已关闭。"))
    }
}

impl TelnetProtocolParser {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            cols,
            rows,
            state: ParserState::Data,
        }
    }

    pub fn set_size(&mut self, cols: u16, rows: u16) {
        self.cols = cols;
        self.rows = rows;
    }

    pub fn feed(&mut self, input: &[u8], output: &mut Vec<u8>, replies: &mut Vec<u8>) {
        for byte in input {
            match self.state {
                ParserState::Data => {
                    if *byte == IAC {
                        self.state = ParserState::Iac;
                    } else {
                        output.push(*byte);
                    }
                }
                ParserState::Iac => match *byte {
                    IAC => {
                        output.push(IAC);
                        self.state = ParserState::Data;
                    }
                    WILL | WONT | DO | DONT => {
                        self.state = ParserState::Command(*byte);
                    }
                    SB => {
                        self.state = ParserState::Subnegotiation;
                    }
                    _ => {
                        self.state = ParserState::Data;
                    }
                },
                ParserState::Command(command) => {
                    self.handle_command(command, *byte, replies);
                    self.state = ParserState::Data;
                }
                ParserState::Subnegotiation => {
                    if *byte == IAC {
                        self.state = ParserState::SubnegotiationIac;
                    }
                }
                ParserState::SubnegotiationIac => {
                    self.state = if *byte == SE {
                        ParserState::Data
                    } else {
                        ParserState::Subnegotiation
                    };
                }
            }
        }
    }

    fn handle_command(&self, command: u8, option: u8, replies: &mut Vec<u8>) {
        match command {
            WILL => {
                if matches!(option, ECHO | SUPPRESS_GO_AHEAD) {
                    replies.extend_from_slice(&[IAC, DO, option]);
                } else {
                    replies.extend_from_slice(&[IAC, DONT, option]);
                }
            }
            DO => {
                if option == NAWS {
                    replies.extend_from_slice(&[IAC, WILL, NAWS]);
                    replies.extend_from_slice(&build_naws_payload(self.cols, self.rows));
                } else if option == SUPPRESS_GO_AHEAD {
                    replies.extend_from_slice(&[IAC, WILL, option]);
                } else {
                    replies.extend_from_slice(&[IAC, WONT, option]);
                }
            }
            WONT | DONT => {}
            _ => {}
        }
    }
}

pub fn validate_telnet_open_request(
    request: TelnetTerminalOpenRequest,
) -> Result<TelnetSessionConfig, AppError> {
    let host = request.host.trim().to_string();
    if host.is_empty() {
        return Err(AppError::new(
            "telnet_host_missing",
            "请填写 Telnet 主机。",
            "host is empty",
            true,
        ));
    }

    if request.port == 0 {
        return Err(AppError::new(
            "telnet_port_invalid",
            "Telnet 端口无效。",
            "port is 0",
            true,
        ));
    }

    Ok(TelnetSessionConfig {
        request_id: sanitize_request_id(request.request_id),
        host,
        port: request.port,
        enter_mode: request.enter_mode.unwrap_or(TelnetEnterMode::CrLf),
        backspace_mode: request.backspace_mode.unwrap_or(TelnetBackspaceMode::Del),
    })
}

pub fn transform_telnet_input(data: &str, config: &TelnetSessionConfig) -> Vec<u8> {
    let mut output = Vec::with_capacity(data.len());
    let bytes = data.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                write_enter(&mut output, config.enter_mode);
                if bytes.get(index + 1).copied() == Some(b'\n') {
                    index += 1;
                }
            }
            b'\n' => write_enter(&mut output, config.enter_mode),
            0x7f if config.backspace_mode == TelnetBackspaceMode::CtrlH => output.push(0x08),
            byte => output.push(byte),
        }
        index += 1;
    }
    output
}

pub fn build_naws_payload(cols: u16, rows: u16) -> Vec<u8> {
    let mut payload = vec![IAC, SB, NAWS];
    push_escaped_u16(&mut payload, cols);
    push_escaped_u16(&mut payload, rows);
    payload.extend_from_slice(&[IAC, SE]);
    payload
}

fn push_escaped_u16(payload: &mut Vec<u8>, value: u16) {
    for byte in value.to_be_bytes() {
        payload.push(byte);
        if byte == IAC {
            payload.push(IAC);
        }
    }
}

fn write_enter(output: &mut Vec<u8>, enter_mode: TelnetEnterMode) {
    match enter_mode {
        TelnetEnterMode::Cr => output.push(b'\r'),
        TelnetEnterMode::Lf => output.push(b'\n'),
        TelnetEnterMode::CrLf => output.extend_from_slice(b"\r\n"),
    }
}

fn sanitize_request_id(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn telnet_closed_error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, "telnet command channel closed", true)
}

fn default_telnet_port() -> u16 {
    23
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_input_uses_configured_enter_and_backspace_modes() {
        let config = TelnetSessionConfig {
            backspace_mode: TelnetBackspaceMode::CtrlH,
            enter_mode: TelnetEnterMode::CrLf,
            host: "127.0.0.1".to_string(),
            request_id: None,
            port: 23,
        };

        assert_eq!(
            transform_telnet_input("show\x7f version\r", &config),
            b"show\x08 version\r\n"
        );
    }

    #[test]
    fn parser_filters_iac_negotiation_and_replies_to_echo_sga_and_naws() {
        let mut parser = TelnetProtocolParser::new(100, 40);
        let mut output = Vec::new();
        let mut replies = Vec::new();

        parser.feed(
            &[
                b'H',
                b'i',
                IAC,
                WILL,
                ECHO,
                IAC,
                WILL,
                SUPPRESS_GO_AHEAD,
                IAC,
                DO,
                NAWS,
                b'!',
            ],
            &mut output,
            &mut replies,
        );

        assert_eq!(output, b"Hi!");
        assert_eq!(
            replies,
            vec![
                IAC,
                DO,
                ECHO,
                IAC,
                DO,
                SUPPRESS_GO_AHEAD,
                IAC,
                WILL,
                NAWS,
                IAC,
                SB,
                NAWS,
                0,
                100,
                0,
                40,
                IAC,
                SE,
            ],
        );
    }

    #[test]
    fn naws_payload_escapes_iac_bytes() {
        let payload = build_naws_payload(255, 24);

        assert_eq!(payload, vec![IAC, SB, NAWS, 0, IAC, IAC, 0, 24, IAC, SE],);
    }
}
