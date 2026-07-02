import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadModule() {
  const sourceUrl = new URL("../src/features/layout/remoteFilePanelStrategy.ts", import.meta.url);
  const sourceText = await readFile(sourceUrl, "utf8");
  const output = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
    },
    fileName: sourceUrl.pathname,
  });
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output.outputText)}`;
  return import(moduleUrl);
}

test("renders only the active SSH remote file panel while preserving its state key", async () => {
  const { buildSshRemoteFilePanelStack } = await loadModule();

  const panels = buildSshRemoteFilePanelStack({
    activeTabId: "tab-b",
    activeWorkspaceMode: "ssh",
    rightPaneCollapsed: false,
    rightTool: "files",
    tabs: [
      { connectionId: "conn-a", id: "tab-a", sessionId: "session-a", type: "terminal" },
      { connectionId: "conn-b", id: "tab-b", sessionId: "session-b", type: "terminal" },
      { connectionId: "conn-c", id: "tab-c", type: "connecting" },
    ],
  });

  assert.deepEqual(panels, [
    {
      active: true,
      connectionId: "conn-b",
      key: "ssh-file-panel:tab-b",
      renderDockerTools: false,
      tabId: "tab-b",
    },
  ]);
});

test("mounts Docker tools only inside the active SSH file panel", async () => {
  const { buildSshRemoteFilePanelStack } = await loadModule();

  const panels = buildSshRemoteFilePanelStack({
    activeTabId: "tab-b",
    activeWorkspaceMode: "ssh",
    rightPaneCollapsed: false,
    rightTool: "tools",
    tabs: [
      { connectionId: "conn-a", id: "tab-a", sessionId: "session-a", type: "terminal" },
      { connectionId: "conn-b", id: "tab-b", sessionId: "session-b", type: "terminal" },
    ],
  });

  assert.deepEqual(
    panels.map((panel) => ({ active: panel.active, renderDockerTools: panel.renderDockerTools })),
    [
      { active: true, renderDockerTools: true },
    ],
  );
});

test("does not render remote file panels for inactive SSH tabs", async () => {
  const { buildSshRemoteFilePanelStack } = await loadModule();

  const panels = buildSshRemoteFilePanelStack({
    activeTabId: "tab-c",
    activeWorkspaceMode: "ssh",
    rightPaneCollapsed: false,
    rightTool: "files",
    tabs: [
      { connectionId: "conn-a", id: "tab-a", sessionId: "session-a", type: "terminal" },
      { connectionId: "conn-b", id: "tab-b", sessionId: "session-b", type: "terminal" },
      { connectionId: "conn-c", id: "tab-c", sessionId: "session-c", type: "terminal" },
    ],
  });

  assert.equal(panels.length, 1);
  assert.equal(panels[0].tabId, "tab-c");
  assert.equal(panels[0].key, "ssh-file-panel:tab-c");
});

test("keeps inactive stacked remote file panels mounted but visually hidden", async () => {
  const remoteFilePanelSource = await readFile(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );
  const appCssSource = await readFile(new URL("../src/styles/app.css", import.meta.url), "utf8");

  assert.match(remoteFilePanelSource, /className=\{`tool-pane \$\{active \? "" : "is-hidden"\}`\}/);
  assert.match(appCssSource, /\.tool-pane\.is-hidden\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s);
  assert.match(appCssSource, /\.remote-file-panel-stack \.tool-pane\.is-hidden\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s);
});

test("prevents inactive remote file panels from re-rendering on unrelated tab switches", async () => {
  const remoteFilePanelSource = await readFile(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteFilePanelSource, /memo\(RemoteFilePanelComponent,\s*areRemoteFilePanelPropsEqual\)/);
  assert.match(remoteFilePanelSource, /if \(!previous\.active && !next\.active\)/);
});

test("renders inactive remote file panels as lightweight placeholders", async () => {
  const remoteFilePanelSource = await readFile(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteFilePanelSource, /if \(!active\)\s*\{\s*return \(\s*<aside/s);
  assert.match(remoteFilePanelSource, /className="tool-pane is-hidden"/);
  assert.match(remoteFilePanelSource, /aria-hidden="true"/);
  assert.match(remoteFilePanelSource, /data-remote-file-panel-placeholder="true"/);
});

test("guards remote file async loads after the active panel unmounts", async () => {
  const remoteFilePanelSource = await readFile(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteFilePanelSource, /const mountedRef = useRef\(true\);/);
  assert.match(remoteFilePanelSource, /mountedRef\.current = false;/);
  assert.match(remoteFilePanelSource, /mountedRef\.current &&/);
});

test("saves remote file state before tab-switch unmounts can occur", async () => {
  const remoteFilePanelSource = await readFile(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteFilePanelSource, /useLayoutEffect/);
  assert.match(remoteFilePanelSource, /useLayoutEffect\(\(\) => \{\s*if \(!stateKey\)/s);
  assert.match(remoteFilePanelSource, /remoteFilePanelStateCache\.set\(stateKey/);
});

test("defers heavy remote file tree rendering until after the tab switch frame", async () => {
  const remoteFilePanelSource = await readFile(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteFilePanelSource, /requestAnimationFrame/);
  assert.match(remoteFilePanelSource, /const fileTreeReady = active && readyFilePanelRenderKey === filePanelRenderKey;/);
  assert.match(remoteFilePanelSource, /\(\) => \(fileTreeReady \? visibleEntries/);
  assert.match(remoteFilePanelSource, /!fileTreeReady \? \(/);
});

test("restores deferred remote file tree with low-priority React work", async () => {
  const remoteFilePanelSource = await readFile(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(remoteFilePanelSource, /startTransition/);
  assert.match(
    remoteFilePanelSource,
    /requestAnimationFrame\(\(\) => \{[\s\S]*startTransition\(\(\) => \{[\s\S]*setReadyFilePanelRenderKey\(filePanelRenderKey\);/m,
  );
});

test("constructs SSH auxiliary right-pane tools only for the visible tool tab", async () => {
  const workspaceShellSource = await readFile(
    new URL("../src/features/layout/WorkspaceShell.tsx", import.meta.url),
    "utf8",
  );

  assert.match(workspaceShellSource, /monitorPanel=\{\s*panel\.active && rightTool === "monitor" \? \(/s);
  assert.match(workspaceShellSource, /commandPanel=\{panel\.active && rightTool === "commands" \? renderCommandLibraryPanel\(\) : null\}/);
  assert.match(workspaceShellSource, /tunnelPanel=\{\s*panel\.active && rightTool === "tunnels" \? \(/s);
  assert.match(workspaceShellSource, /transferPanel=\{\s*panel\.active && rightTool === "files" \? \(/s);
});
