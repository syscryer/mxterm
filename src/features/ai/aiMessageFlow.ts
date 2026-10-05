import type { AiChatMessage, AiThinkingBlock, AiThinkingUpdate, AiToolCallRecord } from "./aiTypes";

export type AiMessageFlowItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; block: AiThinkingBlock }
  | { kind: "tool"; id: string; call: AiToolCallRecord };

export function appendThinkingDelta(
  message: AiChatMessage,
  delta: string,
  update?: AiThinkingUpdate | null,
): AiChatMessage {
  if (!delta && !update) return message;
  const blocks = message.thinking_blocks || [];
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;
  const previous = update
    ? blocks.find((block) => block.id === update.id)
    : lastBlock?.finished_at_ms == null
      ? lastBlock
      : undefined;
  if (!delta && !previous) return message;
  const nextUpdate: AiThinkingUpdate = update || {
    id: `${message.id}-thinking-${blocks.length + 1}`,
    text_offset: Array.from(message.content).length,
    tool_offset: message.tool_calls.length,
    started_at_ms: Date.now(),
    finished_at_ms: null,
  };
  const next: AiThinkingBlock = {
    ...nextUpdate,
    content: (previous?.content || "") + delta,
  };
  return {
    ...message,
    thinking: message.thinking + delta,
    thinking_blocks: previous
      ? blocks.map((block) => block.id === previous.id ? { ...next, id: previous.id } : block)
      : [...blocks, next],
  };
}

export function finishThinkingBlock(message: AiChatMessage): AiChatMessage {
  const blocks = message.thinking_blocks || [];
  const active = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;
  if (!active || active.finished_at_ms != null) return message;
  return {
    ...message,
    thinking_blocks: blocks.map((block) =>
      block.id === active.id ? { ...block, finished_at_ms: Date.now() } : block,
    ),
  };
}

/** Interleave thought and tool boundaries with the original Unicode text offsets. */
export function buildAiMessageFlow(
  message: AiChatMessage,
  streamingOverride?: boolean,
): AiMessageFlowItem[] {
  const streaming = streamingOverride ?? message.status === "streaming";
  const chars = Array.from(message.content);
  const calls = message.tool_calls;
  const blocks: AiThinkingBlock[] = message.thinking_blocks?.length
    ? message.thinking_blocks
    : message.thinking ? [{
        id: `${message.id}-legacy-thinking`, content: message.thinking,
        text_offset: 0, tool_offset: 0, started_at_ms: 0,
        finished_at_ms: streaming ? null : 0,
      }] : [];
  const boundaries = [
    ...calls.map((call, index) => ({
      offset: call.text_offset, order: index * 2 + 1,
      item: { kind: "tool", id: call.id, call } as AiMessageFlowItem,
    })),
    ...blocks.map((block) => ({
      offset: block.text_offset, order: block.tool_offset * 2,
      item: { kind: "thinking", id: block.id, block } as AiMessageFlowItem,
    })),
  ].sort((a, b) => a.offset - b.offset || a.order - b.order);
  const items: AiMessageFlowItem[] = [];
  let cursor = 0;
  for (const boundary of boundaries) {
    const offset = Math.min(Math.max(boundary.offset, cursor), chars.length);
    const text = chars.slice(cursor, offset).join("");
    if (text.trim()) items.push({ kind: "text", id: `text-${cursor}`, text });
    items.push(boundary.item);
    cursor = offset;
  }
  const rest = chars.slice(cursor).join("");
  if (rest.trim()) items.push({ kind: "text", id: `text-${cursor}`, text: rest });
  return items;
}
