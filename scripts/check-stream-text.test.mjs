import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/shared/ui/streamText.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
);
const { latestStreamTextLine } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("live preview preserves the latest non-empty line across newline formats", () => {
  for (const newline of ["\n", "\r", "\r\n"]) {
    assert.equal(latestStreamTextLine(`较早的思考${newline} 最新内容 😀 ${newline}  ${newline}`), "最新内容 😀");
  }
  assert.equal(latestStreamTextLine("\n \r\n\t"), "");
  assert.equal(latestStreamTextLine("单行内容"), "单行内容");
});

test("large reasoning history retains complete text and the latest preview", () => {
  const text = "已完成的检查\r\n".repeat(100_000) + "最后一步 🧪\n\n";
  assert.equal(latestStreamTextLine(text), "最后一步 🧪");
  assert.equal(text.length, "已完成的检查\r\n".length * 100_000 + "最后一步 🧪\n\n".length);
});
