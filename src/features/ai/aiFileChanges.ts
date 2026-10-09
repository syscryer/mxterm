import type { AiChatMessage, AiFileChangeSummary } from "./aiTypes";

export function applyFileChangeSummaries(
  messages: AiChatMessage[],
  sessionId: string,
  summaries: AiFileChangeSummary[],
): AiChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.session_id !== sessionId) return message;
    const updates = summaries.filter((summary) => summary.message_id === message.id);
    if (!updates.length) return message;
    changed = true;
    const checkpoints = new Map((message.file_changes ?? []).map((summary) => [summary.checkpoint_id, summary]));
    updates.forEach((summary) => checkpoints.set(summary.checkpoint_id, summary));
    return { ...message, file_changes: [...checkpoints.values()] };
  });
  return changed ? next : messages;
}
