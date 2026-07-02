import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadModule() {
  const sourceUrl = new URL("../src/features/tools/dockerVirtualization.ts", import.meta.url);
  const sourceText = await readFile(sourceUrl, "utf8");
  const output = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: sourceUrl.pathname,
  });
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output.outputText)}`;
  return import(moduleUrl);
}

async function loadRefreshStrategyModule() {
  const sourceUrl = new URL("../src/features/tools/dockerRefreshStrategy.ts", import.meta.url);
  const sourceText = await readFile(sourceUrl, "utf8");
  const output = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: sourceUrl.pathname,
  });
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output.outputText)}`;
  return import(moduleUrl);
}

test("calculates a clipped docker container render window", async () => {
  const { calculateDockerVirtualWindow } = await loadModule();

  const window = calculateDockerVirtualWindow({
    itemCount: 276,
    scrollTop: 420,
    viewportHeight: 300,
  });

  assert.deepEqual(window, {
    startIndex: 3,
    endIndexExclusive: 11,
    totalHeight: 23176,
    topPadding: 252,
    bottomPadding: 22260,
    rowStep: 84,
  });
});

test("keeps the window small when the list is huge", async () => {
  const { calculateDockerVirtualWindow } = await loadModule();

  const window = calculateDockerVirtualWindow({
    itemCount: 276,
    scrollTop: 8400,
    viewportHeight: 320,
  });

  assert.ok(window.endIndexExclusive - window.startIndex < 20);
  assert.equal(window.totalHeight, 23176);
});

test("skips initial docker ps when cached container data is fresh", async () => {
  const { planDockerInitialRefresh } = await loadRefreshStrategyModule();

  const plan = planDockerInitialRefresh({
    active: true,
    connectionId: "conn-a",
    documentVisible: true,
    dockerView: "containers",
    initialRefreshStarted: false,
    lastContainersRefreshAt: 10_000,
    lastImagesRefreshAt: 10_000,
    now: 15_000,
    toolboxView: "docker",
  });

  assert.equal(plan, null);
});

test("does not run initial docker ps on tab switch when stale cached containers exist", async () => {
  const { planDockerInitialRefresh } = await loadRefreshStrategyModule();

  const plan = planDockerInitialRefresh({
    active: true,
    connectionId: "conn-a",
    documentVisible: true,
    dockerView: "containers",
    initialRefreshStarted: false,
    lastContainersRefreshAt: 1_000,
    lastImagesRefreshAt: 1_000,
    now: 20_000,
    toolboxView: "docker",
  });

  assert.equal(plan, null);
});

test("delays initial docker ps only when no cached container data exists", async () => {
  const { planDockerInitialRefresh } = await loadRefreshStrategyModule();

  const plan = planDockerInitialRefresh({
    active: true,
    connectionId: "conn-a",
    documentVisible: true,
    dockerView: "containers",
    initialRefreshStarted: false,
    lastContainersRefreshAt: 0,
    lastImagesRefreshAt: 0,
    now: 20_000,
    toolboxView: "docker",
  });

  assert.deepEqual(plan, {
    delayMs: 1200,
    refreshContainers: true,
    refreshImages: false,
    silent: false,
  });
});

test("does not plan docker refresh outside the active docker tool", async () => {
  const { planDockerInitialRefresh } = await loadRefreshStrategyModule();

  assert.equal(
    planDockerInitialRefresh({
      active: false,
      connectionId: "conn-a",
      documentVisible: true,
      dockerView: "containers",
      initialRefreshStarted: false,
      lastContainersRefreshAt: 0,
      lastImagesRefreshAt: 0,
      now: 20_000,
      toolboxView: "docker",
    }),
    null,
  );
  assert.equal(
    planDockerInitialRefresh({
      active: true,
      connectionId: "conn-a",
      documentVisible: true,
      dockerView: "containers",
      initialRefreshStarted: false,
      lastContainersRefreshAt: 0,
      lastImagesRefreshAt: 0,
      now: 20_000,
      toolboxView: "network",
    }),
    null,
  );
});

test("runs docker auto refresh only for the visible docker view", async () => {
  const { shouldRunDockerAutoRefresh } = await loadRefreshStrategyModule();

  assert.equal(
    shouldRunDockerAutoRefresh({
      active: true,
      dockerView: "containers",
      refreshKind: "containers",
    }),
    true,
  );
  assert.equal(
    shouldRunDockerAutoRefresh({
      active: true,
      dockerView: "images",
      refreshKind: "containers",
    }),
    false,
  );
  assert.equal(
    shouldRunDockerAutoRefresh({
      active: false,
      dockerView: "containers",
      refreshKind: "containers",
    }),
    false,
  );
});
