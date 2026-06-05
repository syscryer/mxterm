import type { ConnectionProfile, ConnectionProfileInput } from "./connectionTypes";

interface ConnectionPaneProps {
  connections: ConnectionProfile[];
  error: string | null;
  loading: boolean;
  onCreate: () => void;
  onEdit: (connection: ConnectionProfile) => void;
  onOpen: (connection: ConnectionProfile) => void;
  onRefresh: () => void;
  selectedId: string | null;
}

export function ConnectionPane({
  connections,
  error,
  loading,
  onCreate,
  onEdit,
  onOpen,
  onRefresh,
  selectedId,
}: ConnectionPaneProps) {
  return (
    <aside className="connection-pane" aria-label="连接仓库">
      <header className="pane-head">
        <button className="icon-button" type="button" aria-label="新增连接" onClick={onCreate}>
          <span aria-hidden="true">+</span>
        </button>
        <button className="icon-button" type="button" aria-label="刷新连接" onClick={onRefresh}>
          <span aria-hidden="true">↻</span>
        </button>
      </header>
      <section className="pane-scroll">
        <h2 className="section-title">连接仓库</h2>
        {loading ? <p className="pane-note">加载中</p> : null}
        {error ? <p className="pane-error">{error}</p> : null}
        {!loading && connections.length === 0 ? <p className="pane-note">暂无连接</p> : null}
        {connections.map((connection) => (
          <div
            className={`connection-row ${connection.id === selectedId ? "active" : ""}`}
            key={connection.id}
          >
            <button type="button" onClick={() => onOpen(connection)}>
              <span className="dot" aria-hidden="true" />
              <span>{connection.name}</span>
              <small>{formatAddress(connection)}</small>
            </button>
            <button
              className="row-icon"
              type="button"
              aria-label={`编辑 ${connection.name}`}
              onClick={() => onEdit(connection)}
            >
              ✎
            </button>
          </div>
        ))}
      </section>
      <footer className="settings-foot">
        <button className="icon-button" type="button" aria-label="设置">
          <span aria-hidden="true">⚙</span>
        </button>
      </footer>
    </aside>
  );
}

function formatAddress(connection: ConnectionProfile | ConnectionProfileInput) {
  return `${connection.username}@${connection.host}:${connection.port.toString()}`;
}
