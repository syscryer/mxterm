import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const sourcePath = path.resolve("src/features/connections/ConnectionSystemLogo.tsx");
const sourceCode = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(sourceCode, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText;

const tempDir = await mkdtemp(path.join(process.cwd(), ".tmp-connection-system-logo-"));
const tempFile = path.join(tempDir, "ConnectionSystemLogo.mjs");
await writeFile(tempFile, transpiled, "utf8");

const logoModule = await import(pathToFileURL(tempFile).href);
const { inferConnectionSystemKind } = logoModule;

test("RDP connections keep protocol icon instead of falling back to linux", () => {
  const kind = inferConnectionSystemKind({
    id: "rdp-demo",
    protocol: "rdp",
    name: "Windows desktop",
    host: "10.0.0.8",
    port: 3389,
  });

  assert.equal(kind, "rdp");
});

test("VNC connections keep protocol icon instead of falling back to linux", () => {
  const kind = inferConnectionSystemKind({
    id: "vnc-demo",
    protocol: "vnc",
    name: "Remote desktop",
    host: "10.0.0.9",
    port: 5900,
  });

  assert.equal(kind, "vnc");
});

await rm(tempDir, { recursive: true, force: true });
