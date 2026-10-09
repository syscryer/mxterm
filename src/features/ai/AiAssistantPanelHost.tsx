import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";

import { ToolPanelTabs, type ToolPanelTool } from "../../shared/ui/ToolPanelTabs";
import { PanelVisibilityContext } from "../../shared/ui/panelVisibility";
import { AiAssistantPanel, type AiAssistantPanelProps } from "./AiAssistantPanel";

interface AiAssistantPanelHostProps {
  panelProps: AiAssistantPanelProps;
  openScopeKeys: string[];
  availableTools: ToolPanelTool[];
  onToolChange: (tool: ToolPanelTool) => void;
}

type CommandAction = "onInsertCommand" | "onSaveCommand" | "onSendCommand";

export function AiAssistantPanelHost(props: AiAssistantPanelHostProps) {
  const { panelProps, openScopeKeys, availableTools, onToolChange } = props;
  const scopeKey = panelProps.stateScopeKey || "local:default";
  const [views, setViews] = useState<Record<string, AiAssistantPanelProps>>({});
  const openScopes = new Set(openScopeKeys);
  const nextViews = Object.fromEntries(Object.entries(views).filter(([key]) => openScopes.has(key)));
  if (panelProps.active && openScopes.has(scopeKey)) nextViews[scopeKey] = panelProps;
  if (Object.keys(nextViews).length !== Object.keys(views).length ||
      (panelProps.active && nextViews[scopeKey] !== views[scopeKey])) {
    // Updating this component's state during render keeps the retained views and
    // visibility in one commit, without an empty frame on activation or close.
    setViews(nextViews);
  }

  const committedPropsRef = useRef(panelProps);
  useLayoutEffect(() => { committedPropsRef.current = panelProps; }, [panelProps]);
  const dispatchCommand = useCallback((key: string, action: CommandAction, command: string) => {
    const current = committedPropsRef.current;
    if (!current.active || current.stateScopeKey !== key) {
      throw new Error("命令所属的终端已切换，请返回原会话后操作。");
    }
    return current[action](command);
  }, []);
  const openSettings = useCallback(() => committedPropsRef.current.onOpenSettings(), []);

  return (
    <aside className="tool-pane" hidden={!panelProps.active} aria-label="右侧工具面板">
      <ToolPanelTabs activeTool="ai" availableTools={availableTools} onToolChange={onToolChange} />
      {Object.entries(nextViews).map(([key, savedProps]) => (
        <RetainedAiScopeView key={key} scopeKey={key} panelProps={savedProps}
          active={panelProps.active && key === scopeKey}
          dispatchCommand={dispatchCommand} onOpenSettings={openSettings} />
      ))}
    </aside>
  );
}

const RetainedAiScopeView = memo(function RetainedAiScopeView({
  scopeKey, panelProps, active, dispatchCommand, onOpenSettings,
}: {
  scopeKey: string;
  panelProps: AiAssistantPanelProps;
  active: boolean;
  dispatchCommand: (key: string, action: CommandAction, command: string) => void | Promise<void>;
  onOpenSettings: () => void;
}) {
  const onInsertCommand = useCallback((command: string) => {
    dispatchCommand(scopeKey, "onInsertCommand", command);
  }, [scopeKey, dispatchCommand]);
  const onSaveCommand = useCallback((command: string) => {
    dispatchCommand(scopeKey, "onSaveCommand", command);
  }, [scopeKey, dispatchCommand]);
  const onSendCommand = useCallback(async (command: string) => {
    await dispatchCommand(scopeKey, "onSendCommand", command);
  }, [scopeKey, dispatchCommand]);
  return (
    <div className="tool-panel-slot" hidden={!active} data-ai-scope-key={scopeKey}>
      <PanelVisibilityContext.Provider value={active}>
      <AiAssistantPanel {...panelProps} active={active} onInsertCommand={onInsertCommand}
        onSaveCommand={onSaveCommand} onSendCommand={onSendCommand} onOpenSettings={onOpenSettings} />
      </PanelVisibilityContext.Provider>
    </div>
  );
});
