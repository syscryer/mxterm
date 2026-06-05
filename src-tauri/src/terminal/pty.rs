use crate::app_error::AppError;

pub fn validate_size(cols: u16, rows: u16) -> Result<(), AppError> {
    if cols == 0 || rows == 0 {
        return Err(AppError::new(
            "terminal_size_invalid",
            "终端尺寸无效。",
            format!("cols={cols}, rows={rows}"),
            true,
        ));
    }

    Ok(())
}
