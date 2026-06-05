import { TerminalPanel } from "../terminal/TerminalPanel";

const connections = [
  { name: "203.0.113.70", group: "开发环境" },
  { name: "203.0.113.131", group: "测试环境" },
  { name: "prod-jump-01", group: "生产跳板" },
];

const files = ["logs", "config", "app.log", "nginx.conf"];

export function WorkspaceShell() {
  return (
    <main className="workspace-shell">
      <aside className="connection-pane" aria-label="连接仓库">
        <header className="pane-head">
          <button className="icon-button" type="button" aria-label="连接仓库">
            <span aria-hidden="true">≡</span>
          </button>
          <button className="icon-button" type="button" aria-label="刷新连接">
            <span aria-hidden="true">↻</span>
          </button>
        </header>
        <section className="pane-scroll">
          <h2 className="section-title">最近连接</h2>
          {connections.map((connection) => (
            <button className="connection-row" type="button" key={connection.name}>
              <span className="dot" aria-hidden="true" />
              <span>{connection.name}</span>
              <small>{connection.group}</small>
            </button>
          ))}
        </section>
        <footer className="settings-foot">
          <button className="icon-button" type="button" aria-label="设置">
            <span aria-hidden="true">⚙</span>
          </button>
        </footer>
      </aside>

      <section className="main-workbench" aria-label="编辑器和终端">
        <nav className="top-tabs" aria-label="终端连接标签">
          <button className="tab active" type="button">
            203.0.113.70
          </button>
          <button className="tab" type="button">
            prod-jump-01
          </button>
          <button className="add-tab" type="button" aria-label="新建连接">
            +
          </button>
        </nav>

        <section className="editor-area" aria-label="远程编辑器">
          <div className="editor-tabs">
            <button className="file-tab active" type="button">
              .bash_profile
            </button>
            <button className="file-tab" type="button">
              nginx.conf
            </button>
          </div>
          <div className="editor-toolbar" aria-label="编辑工具栏">
            <button type="button">↶</button>
            <button type="button">↷</button>
            <button type="button">↻</button>
            <button type="button">⌕</button>
            <span>LF</span>
            <span>UTF-8</span>
          </div>
          <pre className="code-preview">{`# .bash_profile

if [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi`}</pre>
        </section>

        <TerminalPanel />
      </section>

      <aside className="tool-pane" aria-label="右侧工具面板">
        <nav className="tool-tabs" aria-label="工具标签">
          <button className="active" type="button">
            文件
          </button>
          <button type="button">搜索</button>
          <button type="button">传输</button>
          <button type="button">监控</button>
        </nav>
        <div className="path-bar">/ &gt; root &gt; app</div>
        <section className="file-list" aria-label="远程文件列表">
          {files.map((file) => (
            <button className="file-row" type="button" key={file}>
              <span aria-hidden="true">{file.includes(".") ? "□" : "▣"}</span>
              <span>{file}</span>
            </button>
          ))}
        </section>
      </aside>
    </main>
  );
}
