import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/shared/ui/scrollFollow.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { ScrollFollowController } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const bottom = { top: 600, height: 1000, viewport: 400 };

function controllerAtBottom() {
  const controller = new ScrollFollowController();
  controller.record(bottom);
  return controller;
}

test("content growth and viewport resize do not cancel following", () => {
  for (const metrics of [
    { ...bottom, height: 1500 },
    { ...bottom, viewport: 200 },
    { top: 400, height: 800, viewport: 400 },
  ]) {
    assert.equal(controllerAtBottom().onScroll(metrics), true);
  }
});

test("even a small upward scroll pauses instead of resuming within the threshold", () => {
  const controller = controllerAtBottom();
  assert.equal(controller.onScroll({ ...bottom, top: 595 }), false);
  assert.equal(controller.onScroll({ ...bottom, top: 595 }), false);
});

test("upward user intent wins over output arriving in the same frame", () => {
  const controller = controllerAtBottom();
  controller.pause(bottom);
  assert.equal(controller.onScroll(bottom), false);
  assert.equal(controller.onScroll({ ...bottom, height: 1500, top: 580 }), false);
});

test("paused reading remains paused when content or viewport size changes", () => {
  const controller = controllerAtBottom();
  controller.onScroll({ ...bottom, top: 300 });
  assert.equal(controller.onScroll({ ...bottom, top: 300, height: 1500 }), false);
  assert.equal(controller.onScroll({ ...bottom, top: 300, height: 1500, viewport: 500 }), false);
});

test("browser anchoring above a paused reader does not resume following", () => {
  const controller = controllerAtBottom();
  controller.pause({ ...bottom, top: 580 });
  assert.equal(controller.onScroll({ top: 1080, height: 1500, viewport: 400 }), false);
});

test("scrolling downward near the bottom resumes following", () => {
  const controller = controllerAtBottom();
  controller.onScroll({ ...bottom, top: 300 });
  assert.equal(controller.onScroll({ ...bottom, top: 450 }), false);
  assert.equal(controller.onScroll({ ...bottom, top: 580 }), true);
});

test("fractional bottom offsets and programmatic scroll events remain stable", () => {
  const controller = controllerAtBottom();
  controller.record({ ...bottom, top: 599.6 });
  assert.equal(controller.onScroll({ ...bottom, top: 599.6 }), true);
});

test("explicit return to bottom restores following after a pause", () => {
  const controller = controllerAtBottom();
  controller.pause(bottom);
  controller.resume();
  controller.record(bottom);
  assert.equal(controller.onScroll({ ...bottom, height: 1600 }), true);
});
