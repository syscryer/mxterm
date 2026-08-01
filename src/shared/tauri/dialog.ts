import { open, save } from "@tauri-apps/plugin-dialog";

function normalizeSelectedPaths(selected: string | string[] | null) {
  if (!selected) {
    return [];
  }
  return Array.isArray(selected) ? selected : [selected];
}

export async function selectLocalUploadFiles() {
  const selected = await open({
    multiple: true,
    title: "选择上传文件",
  });
  return normalizeSelectedPaths(selected);
}

export async function selectLocalUploadDirectories() {
  const selected = await open({
    directory: true,
    multiple: true,
    recursive: true,
    title: "选择上传文件夹",
  });
  return normalizeSelectedPaths(selected);
}

export async function selectLocalDownloadDirectory() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择下载目录",
  });
  return normalizeSelectedPaths(selected)[0] || null;
}

export async function selectLocalPrivateKeyFile() {
  const selected = await open({
    multiple: false,
    title: "选择私钥文件",
  });
  return normalizeSelectedPaths(selected)[0] || null;
}

export async function selectDockerLogSavePath(defaultName: string) {
  return save({
    defaultPath: defaultName,
    filters: [
      {
        extensions: ["log", "txt"],
        name: "日志文件",
      },
    ],
    title: "保存容器日志",
  });
}

export async function selectConnectionTransferImportPath() {
  const selected = await open({
    multiple: false,
    filters: [
      {
        extensions: ["json"],
        name: "mXterm 连接迁移文件",
      },
    ],
    title: "选择连接迁移文件",
  });
  return normalizeSelectedPaths(selected)[0] || null;
}

export async function selectConnectionTransferExportPath() {
  return save({
    defaultPath: `mxterm-connections-${new Date().toISOString().slice(0, 10)}.mxterm-connections.json`,
    filters: [
      {
        extensions: ["json"],
        name: "mXterm 连接迁移文件",
      },
    ],
    title: "导出连接",
  });
}
