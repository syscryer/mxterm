// 终端 / 本地终端 / 分屏组 subtab 的右键菜单 actions 单一来源。
//
// 之前 renderSshTerminalSubtab 和 renderLocalTerminalSubtab 各写了一份
// 几乎一致的 actions 数组(只有 onSelect 引用的业务 helper 不同),
// 而 renderTerminalSplitGroupSubtab 直接没接 TabContextMenu,
// 右键事件冒泡到 WebView2 宿主,出现 Edge 原生菜单。
//
// 本文件提取共享的 7 项 (关闭/关闭其他/关闭右侧标签页/全部关闭/
// 向右分屏/向下分屏/四分屏),SSH + 统一模式下的第 8 项"恢复上下分屏"
// 通过 ctx.restoreSplit?: () => void 可选注入。
//
// 编辑菜单只需改 buildTerminalSubtabActions 一处,三个 caller 自动同步。
import type { TabContextMenuAction } from "../../shared/ui/TabContextMenu";

export interface TerminalSubtabMenuContext<T extends { id: string }> {
  tabs: readonly T[];
  index: number;
  activate: (tab: T) => void;
  close: (tab: T) => void;
  closeOthers: (tab: T) => void;
  closeRight: (tab: T) => void;
  closeAll: () => void;
  split: (tab: T, direction: "row" | "column") => void;
  fourPane: (tab: T) => void;
  restoreSplit?: (tab: T) => void;
}

export interface TerminalSubtabMenuOverrides {
  prepend?: TabContextMenuAction[];
  hideClose?: boolean;
  hideCloseOthers?: boolean;
  hideCloseRight?: boolean;
  hideCloseAll?: boolean;
  hideSplit?: boolean;
}

export function buildTerminalSubtabActions<T extends { id: string }>(
  ctx: TerminalSubtabMenuContext<T>,
  canSplit: boolean,
  overrides: TerminalSubtabMenuOverrides = {},
): TabContextMenuAction[] {
  const tab = ctx.tabs[ctx.index];
  const out: TabContextMenuAction[] = [];
  if (overrides.prepend) out.push(...overrides.prepend);
  if (!overrides.hideClose) {
    out.push({
      hint: "Ctrl+F4",
      label: "关闭",
      onSelect: () => {
        if (tab) ctx.close(tab);
      },
    });
  }
  if (!overrides.hideCloseOthers) {
    out.push({
      disabled: ctx.tabs.length <= 1,
      label: "关闭其他",
      onSelect: () => {
        if (tab) ctx.closeOthers(tab);
      },
    });
  }
  if (!overrides.hideCloseRight) {
    out.push({
      disabled: ctx.index >= ctx.tabs.length - 1,
      label: "关闭右侧标签页",
      onSelect: () => {
        if (tab) ctx.closeRight(tab);
      },
    });
  }
  if (!overrides.hideCloseAll) {
    out.push({
      disabled: ctx.tabs.length === 0,
      hint: "Ctrl+K W",
      label: "全部关闭",
      onSelect: () => ctx.closeAll(),
    });
  }
  if (!overrides.hideSplit) {
    const splitDisabled = !canSplit;
    out.push({
      disabled: splitDisabled,
      label: "向右分屏",
      onSelect: () => {
        if (tab) {
          ctx.activate(tab);
          ctx.split(tab, "row");
        }
      },
      separatorBefore: true,
    });
    out.push({
      disabled: splitDisabled,
      label: "向下分屏",
      onSelect: () => {
        if (tab) {
          ctx.activate(tab);
          ctx.split(tab, "column");
        }
      },
    });
    out.push({
      disabled: false,
      label: "四分屏",
      onSelect: () => {
        if (tab) {
          ctx.activate(tab);
          ctx.fourPane(tab);
        }
      },
    });
  }
  if (ctx.restoreSplit) {
    out.push({
      label: "恢复上下分屏",
      onSelect: () => {
        if (tab) ctx.restoreSplit!(tab);
      },
      separatorBefore: true,
    });
  }
  return out;
}
