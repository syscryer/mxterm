import assert from "node:assert/strict";
import test from "node:test";

import { BufferedTextFlush } from "../src/shared/stream/bufferedTextFlush.ts";
import { TerminalOutputQueue } from "../src/features/terminal/terminalOutputFlow.ts";

function createManualScheduler() {
  const callbacks = [];
  return {
    runNext() {
      const entry = callbacks.shift();
      assert.ok(entry, "expected a scheduled callback");
      if (!entry.cancelled) {
        entry.callback();
      }
    },
    schedule(callback) {
      const entry = { callback, cancelled: false };
      callbacks.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    size() {
      return callbacks.filter((entry) => !entry.cancelled).length;
    },
  };
}

test("terminal output queue preserves 10,000 chunks with one write in flight", () => {
  const scheduler = createManualScheduler();
  const writes = [];
  const callbacks = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const queue = new TerminalOutputQueue({
    maxBatchChars: 1024,
    schedule: scheduler.schedule,
    write(data, onParsed) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      writes.push(data);
      callbacks.push(() => {
        inFlight -= 1;
        onParsed();
      });
    },
  });
  const input = Array.from({ length: 10_000 }, (_, index) => `${index}:日志\n`);
  input.forEach((chunk) => queue.enqueue(chunk));

  while (queue.getPendingChars() > 0 || callbacks.length > 0 || scheduler.size() > 0) {
    if (scheduler.size() > 0) {
      scheduler.runNext();
    }
    callbacks.shift()?.();
  }

  assert.equal(writes.join(""), input.join(""));
  assert.ok(writes.every((batch) => batch.length <= 1024));
  assert.equal(maxInFlight, 1);
});

test("terminal output queue waits for the parser callback and clears pending data", () => {
  const scheduler = createManualScheduler();
  const writes = [];
  const callbacks = [];
  const queue = new TerminalOutputQueue({
    maxBatchChars: 4,
    schedule: scheduler.schedule,
    write(data, onParsed) {
      writes.push(data);
      callbacks.push(onParsed);
    },
  });

  queue.enqueue("abcdefgh");
  scheduler.runNext();
  assert.deepEqual(writes, ["abcd"]);
  assert.equal(scheduler.size(), 0);
  callbacks.shift()?.();
  assert.equal(scheduler.size(), 1);
  queue.clear();
  scheduler.runNext();
  assert.deepEqual(writes, ["abcd"]);
  assert.equal(queue.getPendingChars(), 0);
});

test("terminal output queue keeps surrogate pairs within one batch", () => {
  const scheduler = createManualScheduler();
  const writes = [];
  const queue = new TerminalOutputQueue({
    maxBatchChars: 4,
    schedule: scheduler.schedule,
    write(data, onParsed) {
      writes.push(data);
      onParsed();
    },
  });

  queue.enqueue("abc😀def");
  while (queue.getPendingChars() > 0 || scheduler.size() > 0) {
    scheduler.runNext();
  }

  assert.equal(writes.join(""), "abc😀def");
  assert.ok(writes.every((batch) => batch.length <= 4));
  assert.ok(writes.every((batch) => !/[\uD800-\uDBFF]$/.test(batch)));
  assert.ok(writes.every((batch) => !/^[\uDC00-\uDFFF]/.test(batch)));
});

test("terminal output queue stops after a writer error", () => {
  const scheduler = createManualScheduler();
  const errors = [];
  const queue = new TerminalOutputQueue({
    maxBatchChars: 4,
    onError: (error) => errors.push(error),
    schedule: scheduler.schedule,
    write() {
      throw new Error("disposed terminal");
    },
  });

  queue.enqueue("abcdefgh");
  scheduler.runNext();
  queue.enqueue("ignored");

  assert.equal(errors.length, 1);
  assert.equal(queue.getPendingChars(), 0);
  assert.equal(scheduler.size(), 0);
});

test("buffered text flush batches chunks and discards stale data", () => {
  const scheduler = createManualScheduler();
  const flushed = [];
  const buffer = new BufferedTextFlush({
    onFlush: (text) => flushed.push(text),
    schedule: scheduler.schedule,
  });

  for (let index = 0; index < 10_000; index += 1) {
    buffer.append(`${index},`);
  }
  assert.equal(scheduler.size(), 1);
  scheduler.runNext();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0], Array.from({ length: 10_000 }, (_, index) => `${index},`).join(""));

  buffer.append("stale");
  buffer.discard();
  assert.equal(scheduler.size(), 0);
  buffer.flush();
  assert.equal(flushed.length, 1);

  buffer.append("disposed");
  buffer.dispose();
  assert.equal(scheduler.size(), 0);
  assert.equal(flushed.length, 1);
});
