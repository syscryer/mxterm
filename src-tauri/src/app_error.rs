use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub raw_message: String,
    pub recoverable: bool,
}

impl AppError {
    pub fn new(code: &str, message: &str, raw_message: impl ToString, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            raw_message: raw_message.to_string(),
            recoverable,
        }
    }
}
