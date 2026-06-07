import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Save, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

import { Tooltip } from "../../shared/ui/Tooltip";
import { remoteFileLanguageForPath } from "./remoteFileLanguages";
import type { RemoteFileEditorTab } from "./remoteFileEditorTypes";

const monacoGlobal = self as unknown as {
  MonacoEnvironment?: monaco.Environment;
};

monacoGlobal.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") {
      return new JsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new CssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new HtmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new TsWorker();
    }
    return new EditorWorker();
  },
};

interface RemoteFileEditorProps {
  active: boolean;
  fontFamily: string;
  fontSize: number;
  tab: RemoteFileEditorTab;
  onChange: (tabId: string, content: string) => void;
  onClose: (tabId: string) => void;
  onDiscard: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onSave: (tabId: string) => void;
}

export function RemoteFileEditor({
  active,
  fontFamily,
  fontSize,
  onChange,
  onClose,
  onDiscard,
  onReload,
  onSave,
  tab,
}: RemoteFileEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const applyingContentRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const uri = monaco.Uri.parse(`mxterm-remote://${encodeURIComponent(tab.connectionId)}${tab.path}`);
    const model =
      monaco.editor.getModel(uri) ||
      monaco.editor.createModel(tab.content, remoteFileLanguageForPath(tab.path), uri);
    const editor = monaco.editor.create(hostRef.current, {
      automaticLayout: true,
      contextmenu: true,
      cursorBlinking: "smooth",
      fontFamily,
      fontSize,
      glyphMargin: false,
      lineNumbers: "on",
      minimap: { enabled: false },
      model,
      padding: { top: 10, bottom: 10 },
      renderLineHighlight: "line",
      scrollBeyondLastLine: false,
      tabSize: 2,
      theme: "vs",
      wordWrap: "off",
    });

    modelRef.current = model;
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave(tab.id));
    const changeDisposable = model.onDidChangeContent(() => {
      if (!applyingContentRef.current) {
        onChange(tab.id, model.getValue());
      }
    });

    return () => {
      changeDisposable.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [fontFamily, fontSize, onChange, onSave, tab.connectionId, tab.id, tab.path]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || model.getValue() === tab.content) {
      return;
    }

    applyingContentRef.current = true;
    model.setValue(tab.content);
    applyingContentRef.current = false;
  }, [tab.content]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) {
      return;
    }
    const language = remoteFileLanguageForPath(tab.path);
    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [tab.path]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.updateOptions({ fontFamily, fontSize });
  }, [fontFamily, fontSize]);

  useEffect(() => {
    if (active) {
      editorRef.current?.layout();
      editorRef.current?.focus();
    }
  }, [active]);

  return (
    <section
      className={`remote-file-editor ${active ? "" : "is-hidden"}`}
      aria-label={`${tab.name} 文件编辑器`}
    >
      <header className="remote-file-editor-head">
        <div className="remote-file-editor-title">
          <strong>{tab.name}</strong>
          <span title={tab.path}>{tab.connectionName}:{tab.path}</span>
        </div>
        <div className="remote-file-editor-toolbar" aria-label="文件编辑器工具栏">
          <Tooltip label="保存">
            <button
              className="mini-action"
              type="button"
              aria-label="保存"
              disabled={tab.saveState === "loading" || tab.saveState === "saving" || !tab.dirty}
              onClick={() => onSave(tab.id)}
            >
              {tab.saveState === "saving" ? (
                <Loader2 className="ui-icon spin" aria-hidden="true" />
              ) : (
                <Save className="ui-icon" aria-hidden="true" />
              )}
            </button>
          </Tooltip>
          <Tooltip label="重新加载">
            <button
              className="mini-action"
              type="button"
              aria-label="重新加载"
              disabled={tab.saveState === "loading" || tab.saveState === "saving"}
              onClick={() => onReload(tab.id)}
            >
              <RefreshCw className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="放弃更改">
            <button
              className="mini-action"
              type="button"
              aria-label="放弃更改"
              disabled={!tab.dirty || tab.saveState === "saving"}
              onClick={() => onDiscard(tab.id)}
            >
              <RotateCcw className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="查找">
            <button
              className="mini-action"
              type="button"
              aria-label="查找"
              onClick={() => void editorRef.current?.getAction("actions.find")?.run()}
            >
              <Search className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="关闭文件">
            <button className="mini-action" type="button" aria-label="关闭文件" onClick={() => onClose(tab.id)}>
              <X className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>
      <div className="remote-file-editor-status" data-state={tab.saveState}>
        {tab.saveState === "loading" || tab.saveState === "saving" ? (
          <Loader2 className="ui-icon spin" aria-hidden="true" />
        ) : null}
        {tab.saveState === "error" || tab.saveState === "conflict" ? (
          <AlertTriangle className="ui-icon" aria-hidden="true" />
        ) : null}
        <span>{remoteFileStatusLabel(tab)}</span>
      </div>
      <div className="remote-file-monaco" ref={hostRef} />
    </section>
  );
}

function remoteFileStatusLabel(tab: RemoteFileEditorTab) {
  if (tab.statusMessage) {
    return tab.statusMessage;
  }
  if (tab.saveState === "loading") return "读取中";
  if (tab.saveState === "saving") return "保存中";
  if (tab.saveState === "saved") return "已保存";
  if (tab.saveState === "dirty" || tab.dirty) return "已修改";
  if (tab.saveState === "conflict") return "远端已变化";
  if (tab.saveState === "error") return tab.error || "操作失败";
  return "就绪";
}
