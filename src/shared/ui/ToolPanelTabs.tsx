import { Activity, Bot, Folder, ListTree, PanelRightClose, Wrench } from "lucide-react";
import { Tooltip } from "./Tooltip";

export type ToolPanelTool = "files" | "monitor" | "commands" | "tools" | "ai";
export const defaultToolPanelTools: ToolPanelTool[] = ["files", "monitor", "commands", "tools", "ai"];

export function ToolPanelTabs({
  activeTool,
  availableTools,
  onToolChange,
  onToggleRightPane,
}: {
  activeTool: ToolPanelTool;
  availableTools: ToolPanelTool[];
  onToolChange?: (tool: ToolPanelTool) => void;
  onToggleRightPane?: () => void;
}) {
  return (
    <nav className="tool-tabs" aria-label="工具标签">
      {availableTools.includes("files") ? (
        <button className={activeTool === "files" ? "active" : ""} type="button" onClick={() => onToolChange?.("files")}>
          <Folder className="ui-icon" aria-hidden="true" />
          文件
        </button>
      ) : null}
      {availableTools.includes("monitor") ? (
        <button className={activeTool === "monitor" ? "active" : ""} type="button" onClick={() => onToolChange?.("monitor")}>
          <Activity className="ui-icon" aria-hidden="true" />
          监控
        </button>
      ) : null}
      {availableTools.includes("commands") ? (
        <button className={activeTool === "commands" ? "active" : ""} type="button" onClick={() => onToolChange?.("commands")}>
          <ListTree className="ui-icon" aria-hidden="true" />
          命令
        </button>
      ) : null}
      {availableTools.includes("tools") ? (
        <button className={activeTool === "tools" ? "active" : ""} type="button" onClick={() => onToolChange?.("tools")}>
          <Wrench className="ui-icon" aria-hidden="true" />
          工具
        </button>
      ) : null}
      {availableTools.includes("ai") ? (
        <button className={activeTool === "ai" ? "active" : ""} type="button" onClick={() => onToolChange?.("ai")}>
          <Bot className="ui-icon" aria-hidden="true" />
          AI
        </button>
      ) : null}
      {onToggleRightPane ? (
        <Tooltip label="收起右侧面板">
          <button
            className="right-collapse-button"
            type="button"
            aria-label="收起右侧面板"
            aria-expanded
            onClick={onToggleRightPane}
          >
            <PanelRightClose className="ui-icon" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </nav>
  );
}
