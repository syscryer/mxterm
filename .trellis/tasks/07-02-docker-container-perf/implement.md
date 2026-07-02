# Docker 容器列表切换性能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Docker 工具面板在大容器数量下切换仍然流畅。

**Architecture:** 容器列表窗口化渲染，非 active 时降低整棵 Docker 子树的参与成本。保持现有操作能力和视觉样式不变。

**Tech Stack:** React 19, TypeScript, existing mXterm shared UI components, CSS layout.

---

### Task 1: Build a virtualized container list

**Files:**
- Modify: `src/features/tools/DockerToolPanel.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add a failing behavior check mentally and lock the target**

窗口化后的容器列表必须在 200+ 条时只渲染可见范围附近的条目，而不是一次性 map 全部容器。实现时保留固定行高和滚动高度占位。

- [ ] **Step 2: Implement the windowing logic**

在 `ContainerList` 中按固定卡片高度和滚动位置计算可见区间，使用顶部和底部占位块撑开总高度，只渲染当前窗口条目。

- [ ] **Step 3: Update styles for the virtualized scroller**

```css
.docker-list--containers {
  position: relative;
  display: block;
  overflow: auto;
  padding: 8px;
}

.docker-container-window {
  display: grid;
  gap: 8px;
}
```

- [ ] **Step 4: Verify with local checks**

Run: `npm run check`

Expected: TypeScript check passes.

### Task 2: Reduce non-active Docker render cost

**Files:**
- Modify: `src/features/layout/WorkspaceShell.tsx`
- Modify: `src/features/files/RemoteFilePanel.tsx`
- Modify: `src/features/tools/DockerToolPanel.tsx`
- Add: `src/features/tools/dockerRefreshStrategy.ts`

- [ ] **Step 1: Keep the heavy Docker subtree out of inactive switch paths**

Make sure the Docker tool panel does not stay mounted as a heavy active subtree when another right-pane tool is selected.

- [ ] **Step 2: Keep only lightweight shell state when hidden**

Preserve the remembered Docker tab/view state, but do not keep the full container list tree mounted just to remember that state.

- [ ] **Step 3: Keep only the active remote file panel rendered**

Preserve each SSH tab's remote file path and expanded-directory state through `stateKey` cache, but render only the current active SSH tab's `RemoteFilePanel` so tab switching does not keep multiple panel instances or file trees in React.

- [ ] **Step 4: Avoid tab-switch refresh commands**

When cached Docker data exists for a connection, switching SSH session tabs must restore the cache without immediately scheduling `docker ps`. Missing cache may load after a short delay. Auto-refresh should only run for the visible Docker sub-view.

- [ ] **Step 5: Verify the right pane still switches normally**

Use the desktop app to switch between 文件 / 工具 / 网络诊断 and confirm the right pane remains responsive.

### Task 3: Desktop performance verification

**Files:**
- None

- [ ] **Step 1: Open a large-container SSH session in the desktop app**

Use the existing Windows app session with a large Docker list.

- [ ] **Step 2: Measure switching to Docker and away from Docker**

Use the computer-use tool to switch between the right pane tools and record whether the lag is still noticeable.

- [ ] **Step 3: Validate no regression on smaller Docker sessions**

Check a small-container session to confirm the new behavior still feels normal there.

- [ ] **Step 4: Stop only after evidence is fresh**

Do not claim success without a fresh desktop verification pass.
