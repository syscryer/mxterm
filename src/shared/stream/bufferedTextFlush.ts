export type BufferedTextSchedule = (callback: () => void) => () => void;

interface BufferedTextFlushOptions {
  onFlush: (text: string) => void;
  schedule: BufferedTextSchedule;
}

export class BufferedTextFlush {
  private disposed = false;
  private readonly options: BufferedTextFlushOptions;
  private readonly pending: string[] = [];
  private scheduledCancel: (() => void) | null = null;

  constructor(options: BufferedTextFlushOptions) {
    this.options = options;
  }

  append(text: string): void {
    if (this.disposed || !text) {
      return;
    }
    this.pending.push(text);
    if (this.scheduledCancel) {
      return;
    }
    this.scheduledCancel = this.options.schedule(() => {
      this.scheduledCancel = null;
      this.flush();
    });
  }

  flush(): void {
    this.scheduledCancel?.();
    this.scheduledCancel = null;
    if (this.disposed || this.pending.length === 0) {
      return;
    }
    const text = this.pending.join("");
    this.pending.length = 0;
    this.options.onFlush(text);
  }

  discard(): void {
    this.scheduledCancel?.();
    this.scheduledCancel = null;
    this.pending.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.discard();
  }
}

export function createTimeoutTextSchedule(delayMs: number): BufferedTextSchedule {
  return (callback) => {
    const timerId = window.setTimeout(callback, delayMs);
    return () => window.clearTimeout(timerId);
  };
}
