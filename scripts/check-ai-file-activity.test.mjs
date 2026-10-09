import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/features/ai/aiFileActivity.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { getFileActivity, fileActivityLabel, splitActivityPath } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("resolved metadata wins over request parameters and preserves actual counts", () => {
  const call = { name: "apply_file_change", arguments: '{"path":"wrong.txt","change_id":"internal-id"}', file_activity: { path: "/tmp/demo.txt", operation: "create", added_lines: 2, removed_lines: 0 } };
  assert.deepEqual(getFileActivity(call), call.file_activity);
  assert.equal(fileActivityLabel(call, getFileActivity(call)), "新建");
  assert.equal(fileActivityLabel({ ...call, name: "preview_file_change" }, call.file_activity), "预览");
});

test("Windows and SSH paths keep filenames intact, including spaces and unicode", () => {
  assert.deepEqual(splitActivityPath("C:\\demo\\src\\示例 文件.ts"), { filename: "示例 文件.ts", directory: "C:\\demo\\src\\" });
  assert.deepEqual(splitActivityPath("/tmp/project/src/file.rs"), { filename: "file.rs", directory: "/tmp/project/src/" });
  assert.deepEqual(splitActivityPath("README.md"), { filename: "README.md", directory: "" });
});

test("legacy paths are supported without inventing paths or counts from internal ids", () => {
  const legacy = getFileActivity({ name: "read_file", arguments: '{"path":"src/file.ts"}' });
  assert.equal(legacy.path, "src/file.ts");
  assert.equal(legacy.added_lines, undefined);
  for (const argumentsText of ['{"patch_id":"123"}', '{"path":42}', 'not json', 'null']) {
    assert.equal(getFileActivity({ name: "apply_patch", arguments: argumentsText, command: "patch:123" }), null);
  }
  assert.equal(getFileActivity({ name: "run_command", arguments: '{"path":"file.ts"}' }), null);
});
