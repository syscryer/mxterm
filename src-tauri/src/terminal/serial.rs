use serde::{Deserialize, Serialize};
use serialport::{SerialPort, SerialPortInfo, SerialPortType};
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use uuid::Uuid;

use crate::app_error::AppError;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SerialBackspaceMode {
    Del,
    CtrlH,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SerialDataBits {
    Five,
    Six,
    Seven,
    Eight,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SerialParity {
    None,
    Odd,
    Even,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SerialStopBits {
    One,
    Two,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SerialFlowControl {
    None,
    Software,
    Hardware,
}

#[derive(Debug, Deserialize)]
pub struct SerialTerminalOpenRequest {
    #[serde(default)]
    pub request_id: Option<String>,
    pub port_name: String,
    #[serde(default)]
    pub baud_rate: Option<u32>,
    #[serde(default)]
    pub data_bits: Option<SerialDataBits>,
    #[serde(default)]
    pub parity: Option<SerialParity>,
    #[serde(default)]
    pub stop_bits: Option<SerialStopBits>,
    #[serde(default)]
    pub flow_control: Option<SerialFlowControl>,
    #[serde(default)]
    pub backspace_mode: Option<SerialBackspaceMode>,
}

#[derive(Clone, Debug)]
pub struct SerialSessionConfig {
    pub request_id: Option<String>,
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: SerialDataBits,
    pub parity: SerialParity,
    pub stop_bits: SerialStopBits,
    pub flow_control: SerialFlowControl,
    pub backspace_mode: SerialBackspaceMode,
}

#[derive(Clone, Debug, Serialize)]
pub struct SerialPortEntry {
    pub port_name: String,
    pub port_type: String,
    pub description: Option<String>,
}

pub struct SerialTerminalSession {
    pub id: String,
    backspace_mode: SerialBackspaceMode,
    closed: Arc<AtomicBool>,
    writer: Mutex<Box<dyn SerialPort>>,
}

pub struct OpenSerialSession {
    pub session: Arc<SerialTerminalSession>,
    pub request_id: Option<String>,
    pub reader: Box<dyn SerialPort>,
}

impl SerialTerminalSession {
    pub fn open(request: SerialTerminalOpenRequest) -> Result<OpenSerialSession, AppError> {
        let config = validate_serial_open_request(&request)?;
        let mut builder = serialport::new(&config.port_name, config.baud_rate);
        builder = builder
            .timeout(Duration::from_millis(100))
            .data_bits(to_serialport_data_bits(config.data_bits))
            .parity(to_serialport_parity(config.parity))
            .stop_bits(to_serialport_stop_bits(config.stop_bits))
            .flow_control(to_serialport_flow_control(config.flow_control));
        let port = builder
            .open()
            .map_err(|error| AppError::new("serial_open_failed", "串口打开失败。", error, true))?;
        let reader = port.try_clone().map_err(|error| {
            AppError::new("serial_reader_failed", "串口读取器创建失败。", error, true)
        })?;
        let session = Arc::new(SerialTerminalSession {
            id: Uuid::new_v4().to_string(),
            backspace_mode: config.backspace_mode,
            closed: Arc::new(AtomicBool::new(false)),
            writer: Mutex::new(port),
        });

        Ok(OpenSerialSession {
            session,
            request_id: config.request_id,
            reader,
        })
    }

    pub async fn write(&self, data: String) -> Result<(), AppError> {
        let bytes = transform_serial_input(&data, self.backspace_mode);
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| serial_state_error("serial_write_failed", "串口内部状态异常。"))?;
        writer.write_all(&bytes).map_err(|error| {
            AppError::new("serial_write_failed", "串口输入发送失败。", error, true)
        })?;
        writer.flush().map_err(|error| {
            AppError::new("serial_write_failed", "串口输入刷新失败。", error, true)
        })
    }

    pub async fn resize(&self, _cols: u16, _rows: u16) -> Result<(), AppError> {
        Ok(())
    }

    pub async fn close(&self) -> Result<(), AppError> {
        self.closed.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }
}

pub fn list_serial_ports() -> Result<Vec<SerialPortEntry>, AppError> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(serial_port_entry).collect())
        .map_err(|error| AppError::new("serial_list_failed", "串口列表读取失败。", error, true))
}

pub fn validate_serial_open_request(
    request: &SerialTerminalOpenRequest,
) -> Result<SerialSessionConfig, AppError> {
    let port_name = request.port_name.trim().to_string();
    if port_name.is_empty() {
        return Err(AppError::new(
            "serial_port_missing",
            "请选择串口。",
            "port_name is empty",
            true,
        ));
    }

    let baud_rate = request.baud_rate.unwrap_or(9600);
    if baud_rate == 0 {
        return Err(AppError::new(
            "serial_baud_rate_invalid",
            "串口波特率无效。",
            "baud_rate is 0",
            true,
        ));
    }

    Ok(SerialSessionConfig {
        request_id: sanitize_request_id(request.request_id.clone()),
        port_name,
        baud_rate,
        data_bits: request.data_bits.unwrap_or(SerialDataBits::Eight),
        parity: request.parity.unwrap_or(SerialParity::None),
        stop_bits: request.stop_bits.unwrap_or(SerialStopBits::One),
        flow_control: request.flow_control.unwrap_or(SerialFlowControl::None),
        backspace_mode: request.backspace_mode.unwrap_or(SerialBackspaceMode::Del),
    })
}

pub fn transform_serial_input(data: &str, backspace_mode: SerialBackspaceMode) -> Vec<u8> {
    data.as_bytes()
        .iter()
        .map(|byte| {
            if *byte == 0x7f && backspace_mode == SerialBackspaceMode::CtrlH {
                0x08
            } else {
                *byte
            }
        })
        .collect()
}

fn serial_port_entry(info: SerialPortInfo) -> SerialPortEntry {
    let (port_type, description) = match info.port_type {
        SerialPortType::UsbPort(usb) => {
            let description = usb
                .product
                .or(usb.manufacturer)
                .or_else(|| Some(format!("USB {:04x}:{:04x}", usb.vid, usb.pid)));
            ("usb".to_string(), description)
        }
        SerialPortType::BluetoothPort => ("bluetooth".to_string(), Some("Bluetooth".to_string())),
        SerialPortType::PciPort => ("pci".to_string(), Some("PCI".to_string())),
        SerialPortType::Unknown => ("unknown".to_string(), None),
    };

    SerialPortEntry {
        port_name: info.port_name,
        port_type,
        description,
    }
}

fn to_serialport_data_bits(value: SerialDataBits) -> serialport::DataBits {
    match value {
        SerialDataBits::Five => serialport::DataBits::Five,
        SerialDataBits::Six => serialport::DataBits::Six,
        SerialDataBits::Seven => serialport::DataBits::Seven,
        SerialDataBits::Eight => serialport::DataBits::Eight,
    }
}

fn to_serialport_parity(value: SerialParity) -> serialport::Parity {
    match value {
        SerialParity::None => serialport::Parity::None,
        SerialParity::Odd => serialport::Parity::Odd,
        SerialParity::Even => serialport::Parity::Even,
    }
}

fn to_serialport_stop_bits(value: SerialStopBits) -> serialport::StopBits {
    match value {
        SerialStopBits::One => serialport::StopBits::One,
        SerialStopBits::Two => serialport::StopBits::Two,
    }
}

fn to_serialport_flow_control(value: SerialFlowControl) -> serialport::FlowControl {
    match value {
        SerialFlowControl::None => serialport::FlowControl::None,
        SerialFlowControl::Software => serialport::FlowControl::Software,
        SerialFlowControl::Hardware => serialport::FlowControl::Hardware,
    }
}

fn sanitize_request_id(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn serial_state_error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, "serial state lock failed", true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serial_config_defaults_to_common_8n1_without_flow_control() {
        let request = SerialTerminalOpenRequest {
            backspace_mode: None,
            baud_rate: None,
            data_bits: None,
            flow_control: None,
            parity: None,
            port_name: "COM3".to_string(),
            request_id: None,
            stop_bits: None,
        };

        let config = validate_serial_open_request(&request).expect("default serial config");

        assert_eq!(config.port_name, "COM3");
        assert_eq!(config.baud_rate, 9600);
        assert_eq!(config.data_bits, SerialDataBits::Eight);
        assert_eq!(config.parity, SerialParity::None);
        assert_eq!(config.stop_bits, SerialStopBits::One);
        assert_eq!(config.flow_control, SerialFlowControl::None);
        assert_eq!(config.backspace_mode, SerialBackspaceMode::Del);
    }

    #[test]
    fn serial_config_rejects_invalid_baud_rate() {
        let request = SerialTerminalOpenRequest {
            backspace_mode: None,
            baud_rate: Some(0),
            data_bits: None,
            flow_control: None,
            parity: None,
            port_name: "COM3".to_string(),
            request_id: None,
            stop_bits: None,
        };

        let error = validate_serial_open_request(&request).unwrap_err();

        assert_eq!(error.code, "serial_baud_rate_invalid");
    }

    #[test]
    fn serial_input_can_map_delete_to_ctrl_h() {
        assert_eq!(
            transform_serial_input("abc\x7f", SerialBackspaceMode::CtrlH),
            b"abc\x08",
        );
    }
}
