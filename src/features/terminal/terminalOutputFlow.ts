export type TerminalOutputSchedule = (callback: () => void) => () => void;

interface TerminalOutputQueueOptions {
  maxBatchChars: number;
  onBatch?: (batch: string) => void;
  onError?: (error: unknown) => void;
  schedule: TerminalOutputSchedule;
  write: (data: string, onParsed: () => void) => void;
}

export class TerminalOutputQueue {
  private readonly chunks: string[] = [];
  private readonly options: TerminalOutputQueueOptions;
  private chunkIndex = 0;
  private disposed = false;
  private pendingChars = 0;
  private scheduledCancel: (() => void) | null = null;
  private writing = false;

  constructor(options: TerminalOutputQueueOptions) {
    this.options = options;
    if (!Number.isInteger(options.maxBatchChars) || options.maxBatchChars < 2) {
      throw new Error("maxBatchChars must be an integer of at least 2");
    }
  }

  enqueue(data: string): void {
    if (this.disposed || !data) {
      return;
    }
    this.chunks.push(data);
    this.pendingChars += data.length;
    this.scheduleNext();
  }

  clear(): void {
    this.scheduledCancel?.();
    this.scheduledCancel = null;
    this.chunks.length = 0;
    this.chunkIndex = 0;
    this.pendingChars = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  getPendingChars(): number {
    return this.pendingChars;
  }

  private scheduleNext(): void {
    if (
      this.disposed ||
      this.writing ||
      this.pendingChars === 0 ||
      this.scheduledCancel
    ) {
      return;
    }
    this.scheduledCancel = this.options.schedule(() => {
      this.scheduledCancel = null;
      this.flushNext();
    });
  }

  private flushNext(): void {
    if (this.disposed || this.writing || this.pendingChars === 0) {
      return;
    }

    const batch = this.takeBatch();
    this.writing = true;
    let completed = false;
    const onParsed = () => {
      if (completed) {
        return;
      }
      completed = true;
      this.writing = false;
      this.scheduleNext();
    };

    try {
      this.options.write(batch, onParsed);
      this.options.onBatch?.(batch);
    } catch (error) {
      completed = true;
      this.writing = false;
      this.disposed = true;
      this.clear();
      this.options.onError?.(error);
    }
  }

  private takeBatch(): string {
    const parts: string[] = [];
    let remaining = this.options.maxBatchChars;

    while (remaining > 0 && this.chunkIndex < this.chunks.length) {
      const chunk = this.chunks[this.chunkIndex] ?? "";
      if (chunk.length <= remaining) {
        parts.push(chunk);
        remaining -= chunk.length;
        this.chunkIndex += 1;
        continue;
      }

      let take = remaining;
      if (splitsSurrogatePair(chunk, take)) {
        take -= 1;
      }
      if (take === 0) {
        break;
      }
      parts.push(chunk.slice(0, take));
      this.chunks[this.chunkIndex] = chunk.slice(take);
      remaining -= take;
    }

    const batch = parts.join("");
    this.pendingChars -= batch.length;
    if (this.chunkIndex === this.chunks.length) {
      this.chunks.length = 0;
      this.chunkIndex = 0;
    } else if (this.chunkIndex >= 64) {
      this.chunks.splice(0, this.chunkIndex);
      this.chunkIndex = 0;
    }
    return batch;
  }
}

function splitsSurrogatePair(value: string, index: number): boolean {
  if (index <= 0 || index >= value.length) {
    return false;
  }
  const left = value.charCodeAt(index - 1);
  const right = value.charCodeAt(index);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

export function createTerminalOutputSchedule(maxWaitMs: number): TerminalOutputSchedule {
  return (callback) => {
    let active = true;
    const run = () => {
      if (!active) {
        return;
      }
      active = false;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
      callback();
    };
    const frameId = window.requestAnimationFrame(run);
    const timerId = window.setTimeout(run, maxWaitMs);
    return () => {
      if (!active) {
        return;
      }
      active = false;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  };
}
