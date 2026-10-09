import { Brain } from "lucide-react";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { StreamTextDisclosure } from "../../shared/ui/StreamTextDisclosure";
import { buildAiMessageFlow } from "./aiMessageFlow";
import type { AiChatMessage, AiToolCallRecord } from "./aiTypes";

interface AiMessageFlowProps {
  message: AiChatMessage;
  isStreaming?: boolean;
  ticking?: boolean;
  renderText: (text: string) => ReactNode;
  renderTool: (call: AiToolCallRecord, flowing?: boolean) => ReactNode;
}

function parseTimestamp(value: string, fallback: number) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const thinkingIcon = <Brain className="ui-icon" aria-hidden="true" />;

const TimelineText = memo(function TimelineText({ text, render }: {
  text: string;
  render: AiMessageFlowProps["renderText"];
}) {
  return <div className="ai-message-content">{render(text)}</div>;
});

const TimelineTool = memo(function TimelineTool({ call, flowing, render }: {
  call: AiToolCallRecord;
  flowing: boolean;
  render: AiMessageFlowProps["renderTool"];
}) {
  return <div>{render(call, flowing)}</div>;
});

export const AiMessageTimeline = memo(function AiMessageTimeline({
  message,
  isStreaming,
  ticking = true,
  renderText,
  renderTool,
}: AiMessageFlowProps) {
  const streaming = isStreaming ?? message.status === "streaming";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!streaming || !ticking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming, ticking]);
  const started = parseTimestamp(message.created_at, now);
  const ended = streaming ? now : parseTimestamp(message.updated_at, now);
  const elapsed = Math.max(0, Math.floor((ended - started) / 1000));
  const items = useMemo(() => buildAiMessageFlow(message, streaming), [message, streaming]);
  const runningCommandIds = items
    .filter(
      (item): item is Extract<(typeof items)[number], { kind: "tool" }> =>
        item.kind === "tool" && item.call.name === "run_command" && item.call.status === "running",
    )
    .map((item) => item.call.id);
  const lastRunningCommandId = runningCommandIds[runningCommandIds.length - 1];
  const hasThinking = items.some(
    (item) => item.kind === "thinking" && item.block.content.trim().length > 0,
  );
  return (
    <div className="ai-message-flow">
      {(streaming || message.thinking || message.tool_calls.length > 0) ? (
        <span className="ai-turn-duration">
          {streaming ? "工作中" : message.status === "stopped" ? "已停止" : message.status === "error" ? "已结束" : "已工作"}
          {` ${elapsed} 秒`}
        </span>
      ) : null}
      {streaming && !hasThinking ? (
        <StreamTextDisclosure
          label="思考"
          icon={thinkingIcon}
          text="正在思考"
          streaming
          caption="持续生成中"
        />
      ) : null}
      {items.map((item) => {
        if (item.kind === "tool") {
          return (
            <TimelineTool key={item.id} call={item.call}
              flowing={item.call.id === lastRunningCommandId} render={renderTool} />
          );
        }
        if (item.kind === "text") return <TimelineText key={item.id} text={item.text} render={renderText} />;
        const active = streaming && item.block.finished_at_ms == null;
        const blockEndedAt = item.block.finished_at_ms ?? now;
        const blockElapsed = Math.max(
          0,
          Math.floor((blockEndedAt - item.block.started_at_ms) / 1000),
        );
        return (
          <StreamTextDisclosure
            key={item.id}
            label="思考"
            icon={thinkingIcon}
            text={item.block.content}
            streaming={active}
            caption={active ? "持续生成中" : blockElapsed > 0 ? `持续了 ${blockElapsed} 秒` : "刚刚完成"}
          />
        );
      })}
      {streaming ? (
        <span className="ai-streaming-tail" role="status" aria-label="正在生成">
          <span className="ai-streaming-spinner" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} />
            ))}
          </span>
        </span>
      ) : null}
    </div>
  );
});
