import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/features/ai/aiFileChanges.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { applyFileChangeSummaries } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const summary = { message_id: "reply", checkpoint_id: "checkpoint", status: "applied", files: [], added_lines: 0, removed_lines: 0, remaining_changes: 1 };

test("late undo result cannot overwrite a different session after switching tabs", () => {
  const messages = [{ id: "reply", session_id: "other-session", content: "unchanged" }];
  assert.equal(applyFileChangeSummaries(messages, "original-session", [summary]), messages);
});

test("partial progress replaces only its checkpoint and preserves conversation and other replies", () => {
  const messages = [
    { id: "reply", session_id: "session", content: "retained", status: "complete", file_changes: [summary, { ...summary, checkpoint_id: "other" }] },
    { id: "later", session_id: "session", content: "later" },
  ];
  const next = applyFileChangeSummaries(messages, "session", [{ ...summary, status: "partial" }]);
  assert.equal(next[0].file_changes.length, 2);
  assert.equal(next[0].file_changes[0].status, "partial");
  assert.equal(next[0].file_changes[1], messages[0].file_changes[1]);
  assert.equal(next[1], messages[1]);
  assert.equal(next[0].content, "retained");
  assert.equal(next[0].status, "complete");
});

test("file events hydrate missing metadata and retain reverted state", () => {
  const messages = [{ id: "reply", session_id: "session", content: "text" }];
  const next = applyFileChangeSummaries(messages, "session", [{ ...summary, status: "reverted", remaining_changes: 0 }]);
  assert.equal(next[0].file_changes[0].status, "reverted");
  assert.equal(next[0].file_changes[0].remaining_changes, 0);
  assert.equal(applyFileChangeSummaries(next, "session", []), next);
});
