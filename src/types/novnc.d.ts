declare module "@novnc/novnc" {
  export interface RfbCredentials {
    username?: string;
    password?: string;
    target?: string;
  }

  export interface RfbOptions {
    credentials?: RfbCredentials;
    shared?: boolean;
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export interface RfbDisconnectDetail {
    clean: boolean;
  }

  export interface RfbSecurityFailureDetail {
    status: number;
    reason: string;
  }

  export interface RfbDesktopNameDetail {
    name: string;
  }

  export interface RfbClipboardDetail {
    text: string;
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RfbOptions);

    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    qualityLevel: number;
    compressionLevel: number;
    background: string;

    disconnect(): void;
    focus(): void;
    sendCredentials(credentials: RfbCredentials): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;

    addEventListener(type: "connect", listener: (event: Event) => void): void;
    addEventListener(
      type: "disconnect",
      listener: (event: CustomEvent<RfbDisconnectDetail>) => void,
    ): void;
    addEventListener(type: "credentialsrequired", listener: (event: Event) => void): void;
    addEventListener(
      type: "securityfailure",
      listener: (event: CustomEvent<RfbSecurityFailureDetail>) => void,
    ): void;
    addEventListener(
      type: "desktopname",
      listener: (event: CustomEvent<RfbDesktopNameDetail>) => void,
    ): void;
    addEventListener(
      type: "clipboard",
      listener: (event: CustomEvent<RfbClipboardDetail>) => void,
    ): void;
  }
}
