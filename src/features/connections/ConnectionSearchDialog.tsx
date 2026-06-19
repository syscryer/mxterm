import * as Dialog from "@radix-ui/react-dialog";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Search, Star, X } from "lucide-react";

import { ConnectionSystemLogo } from "./ConnectionSystemLogo";
import type { ConnectionProfile } from "./connectionTypes";
import { buildConnectionSearchEntries, type ConnectionSearchEntry } from "./connectionSearch";

interface ConnectionSearchDialogProps {
  activeConnectionId: string | null;
  connections: ConnectionProfile[];
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (value: string) => void;
  onSelectConnection: (connection: ConnectionProfile) => void;
}

export function ConnectionSearchDialog({
  activeConnectionId,
  connections,
  open,
  query,
  onOpenChange,
  onQueryChange,
  onSelectConnection,
}: ConnectionSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const entries = useMemo(
    () => buildConnectionSearchEntries(connections, query),
    [connections, query],
  );
  const selectedIndex = Math.min(activeIndex, Math.max(0, entries.length - 1));
  const selectedEntry = entries[selectedIndex] || null;
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setActiveIndex(0);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, query]);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      onQueryChange("");
    }
  }

  function handleSelect(entry: ConnectionSearchEntry) {
    handleOpenChange(false);
    onSelectConnection(entry.connection);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
      const targetIndex = Number.parseInt(event.key, 10) - 1;
      const targetEntry = entries[targetIndex];
      if (targetEntry) {
        event.preventDefault();
        handleSelect(targetEntry);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, entries.length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && selectedEntry) {
      event.preventDefault();
      handleSelect(selectedEntry);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Overlay className="dialog-backdrop connection-search-backdrop" />
      <Dialog.Content
        className="connection-search-dialog"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <header className="connection-search-head">
          <div>
            <Dialog.Title className="connection-search-title">快速打开连接</Dialog.Title>
            <Dialog.Description className="sr-only">
              按名称、地址、用户、分组或备注查找连接
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button className="icon-button dialog-close-button" type="button" aria-label="关闭连接搜索">
              <X className="ui-icon" aria-hidden="true" />
            </button>
          </Dialog.Close>
        </header>

        <label className="connection-search-input-wrap" aria-label="搜索连接">
          <Search className="ui-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            spellCheck={false}
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索连接、地址、用户、备注"
          />
        </label>

        <div className="connection-search-section-title">
          <span>{hasQuery ? "搜索结果" : "最近连接"}</span>
          <small>{entries.length.toString()}</small>
        </div>

        <div className="connection-search-results" role="listbox" aria-label="连接搜索结果">
          {entries.length === 0 ? (
            <p className="connection-search-empty">
              {hasQuery ? "没有匹配的连接" : "暂无可打开的连接"}
            </p>
          ) : null}

          {entries.map((entry, index) => {
            const connection = entry.connection;
            const current = connection.id === activeConnectionId;

            return (
              <button
                key={connection.id}
                type="button"
                className={`connection-search-result ${index === selectedIndex ? "active" : ""} ${current ? "current" : ""}`}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(entry)}
              >
                <ConnectionSystemLogo connection={connection} compact decorative />
                <span className="connection-search-result-main">
                  <strong>{connection.name}</strong>
                  <small>{entry.address}</small>
                </span>
                <span className="connection-search-result-side">
                  {current ? <span className="connection-search-badge">当前</span> : null}
                  {connection.is_favorite ? (
                    <span className="connection-search-badge icon" aria-label="收藏">
                      <Star className="ui-icon" aria-hidden="true" />
                    </span>
                  ) : null}
                  <span className="connection-search-result-meta">{entry.metaLabel}</span>
                  {index < 9 ? (
                    <kbd className="connection-search-shortcut">{`Ctrl+${index + 1}`}</kbd>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}