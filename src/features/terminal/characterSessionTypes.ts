export type CharacterSessionKind = "telnet" | "serial";

export type TelnetEnterMode = "cr" | "lf" | "crlf";
export type CharacterBackspaceMode = "del" | "ctrl_h";

export interface TelnetTerminalOpenRequest {
  request_id?: string;
  host: string;
  port: number;
  enter_mode?: TelnetEnterMode;
  backspace_mode?: CharacterBackspaceMode;
}

export type SerialDataBits = "five" | "six" | "seven" | "eight";
export type SerialParity = "none" | "odd" | "even";
export type SerialStopBits = "one" | "two";
export type SerialFlowControl = "none" | "software" | "hardware";

export interface SerialPortEntry {
  port_name: string;
  port_type: string;
  description?: string | null;
}

export interface SerialTerminalOpenRequest {
  request_id?: string;
  port_name: string;
  baud_rate?: number;
  data_bits?: SerialDataBits;
  parity?: SerialParity;
  stop_bits?: SerialStopBits;
  flow_control?: SerialFlowControl;
  backspace_mode?: CharacterBackspaceMode;
}
