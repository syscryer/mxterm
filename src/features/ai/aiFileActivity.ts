import type { AiFileActivity, AiToolCallRecord } from "./aiTypes";

const fileTools = new Set([
  "read_file", "preview_patch", "apply_patch", "preview_file_change", "apply_file_change", "rollback_patch",
]);

export function isFileActivity(call: AiToolCallRecord) {
  return fileTools.has(call.name);
}

// Old records have arguments but no resolved file metadata. Use only their
// explicit path; never display an internal change ID as if it were a filename.
export function getFileActivity(call: AiToolCallRecord): AiFileActivity | null {
  if (!isFileActivity(call)) return null;
  if (call.file_activity) return call.file_activity;
  try {
    const args: unknown = JSON.parse(call.arguments || "{}");
    if (!args || typeof args !== "object" || !("path" in args) || typeof args.path !== "string" || !args.path) return null;
    return {
      path: args.path,
      operation: call.name === "read_file" ? "read" :
        "operation" in args && typeof args.operation === "string" ? args.operation : "patch",
      destination: "destination" in args && typeof args.destination === "string" ? args.destination : null,
    };
  } catch {
    // Malformed legacy arguments remain available in the detail view.
    return null;
  }
}

export function fileActivityLabel(call: AiToolCallRecord, activity: AiFileActivity | null) {
  if (call.name.startsWith("preview_")) return "预览";
  if (call.name === "read_file") return "读取";
  if (call.name === "rollback_patch") return "回滚";
  switch (activity?.operation) {
    case "create": return "新建";
    case "delete": return "删除";
    case "rename": return "重命名";
    default: return "编辑";
  }
}

export function splitActivityPath(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { filename: path.slice(index + 1) || path, directory: index < 0 ? "" : path.slice(0, index + 1) };
}
