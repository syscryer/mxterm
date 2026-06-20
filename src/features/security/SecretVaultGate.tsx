import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";

import type { SecretVaultStatus } from "../../shared/tauri/commands";

interface SecretVaultGateProps {
  error: string | null;
  loading: boolean;
  onUnlock: (masterPassword: string) => Promise<SecretVaultStatus | null>;
  status: SecretVaultStatus;
  unlocking: boolean;
}

export function SecretVaultGate({
  error,
  loading,
  onUnlock,
  status,
  unlocking,
}: SecretVaultGateProps) {
  const [masterPassword, setMasterPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const title = status.initialized ? "解锁加密保险库" : "创建加密保险库";
  const buttonLabel = status.initialized ? "解锁" : "创建并解锁";

  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = masterPassword.trim();
    if (!password) {
      setLocalError("请输入主密码。");
      return;
    }

    setLocalError(null);
    const nextStatus = await onUnlock(password);
    if (nextStatus?.unlocked) {
      setMasterPassword("");
    }
  }

  return (
    <div className="vault-gate-overlay" role="presentation">
      <form className="vault-gate-panel" onSubmit={handleSubmit} aria-label={title}>
        <header className="vault-gate-head">
          <span className="vault-gate-icon" aria-hidden="true">
            <LockKeyhole className="ui-icon" />
          </span>
          <span>
            <strong>{title}</strong>
            <small>保存的 SSH 密码和私钥口令会写入本机加密文件。</small>
          </span>
        </header>

        {loading ? (
          <div className="vault-gate-loading" aria-live="polite">
            <Loader2 className="ui-icon spinning" />
            <span>正在读取保险库状态...</span>
          </div>
        ) : (
          <label className="vault-gate-field">
            <span>主密码</span>
            <span className="vault-gate-secret-field">
              <input
                ref={inputRef}
                value={masterPassword}
                type={showPassword ? "text" : "password"}
                autoComplete={status.initialized ? "current-password" : "new-password"}
                onChange={(event) => setMasterPassword(event.target.value)}
              />
              <button
                type="button"
                aria-label={showPassword ? "隐藏主密码" : "显示主密码"}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff className="ui-icon" /> : <Eye className="ui-icon" />}
              </button>
            </span>
          </label>
        )}

        <p className="vault-gate-note">忘记主密码后无法恢复已保存的密码和口令。</p>

        {localError || error ? (
          <p className="vault-gate-error" role="alert">
            {localError || error}
          </p>
        ) : null}

        <footer className="vault-gate-actions">
          <button className="primary-button" type="submit" disabled={loading || unlocking}>
            {unlocking ? <Loader2 className="ui-icon spinning" /> : null}
            {buttonLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}