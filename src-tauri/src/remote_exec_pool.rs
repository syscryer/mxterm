use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::ssh_config::ResolvedSshConfig;
use crate::terminal::session::{ExecOutput, ExecOutputChunkCallback, ReusableExecSession};

const DEFAULT_REMOTE_EXEC_SESSION_IDLE_TIMEOUT_MS: u64 = 180_000;
const DEFAULT_REMOTE_EXEC_MAX_CACHED_SESSIONS: usize = 4;

#[derive(Clone)]
pub(crate) struct RemoteExecSessionPool {
    options: RemoteExecSessionPoolOptions,
    sessions: Arc<Mutex<HashMap<String, RemoteExecSessionHandle>>>,
}

#[derive(Clone, Copy)]
pub(crate) struct RemoteExecSessionPoolOptions {
    pub idle_timeout_ms: u64,
    pub max_cached_sessions: usize,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum RemoteExecRetry {
    None,
    ReconnectOnce,
}

#[derive(Clone)]
struct RemoteExecSessionHandle {
    signature: String,
    connection_id: String,
    in_flight: Arc<Mutex<u32>>,
    last_used_ms: Arc<Mutex<u64>>,
    session: Arc<Mutex<ReusableExecSession>>,
}

#[derive(Clone, Debug)]
struct RemoteExecSessionMeta {
    signature: String,
    last_used_ms: u64,
}

impl Default for RemoteExecSessionPool {
    fn default() -> Self {
        Self::new(RemoteExecSessionPoolOptions::default())
    }
}

impl Default for RemoteExecSessionPoolOptions {
    fn default() -> Self {
        Self {
            idle_timeout_ms: DEFAULT_REMOTE_EXEC_SESSION_IDLE_TIMEOUT_MS,
            max_cached_sessions: DEFAULT_REMOTE_EXEC_MAX_CACHED_SESSIONS,
        }
    }
}

impl RemoteExecSessionPool {
    pub(crate) fn new(options: RemoteExecSessionPoolOptions) -> Self {
        Self {
            options,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn exec(
        &self,
        app: &AppHandle,
        config: &ResolvedSshConfig,
        command: &str,
        retry: RemoteExecRetry,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(app, config).await?;
        self.begin_handle_use(&handle).await;
        let result = {
            let session = handle.session.lock().await;
            session.exec(command).await
        };
        self.end_handle_use(&handle).await;

        match result {
            Ok(output) => {
                self.mark_handle_used(&handle).await;
                Ok(output)
            }
            Err(error) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                if retry == RemoteExecRetry::ReconnectOnce {
                    let refreshed = self.connect_and_store(app, config).await?;
                    self.begin_handle_use(&refreshed).await;
                    let retry_result = {
                        let session = refreshed.session.lock().await;
                        session.exec(command).await
                    };
                    self.end_handle_use(&refreshed).await;
                    if retry_result.is_ok() {
                        self.mark_handle_used(&refreshed).await;
                    } else {
                        self.invalidate_handle(&config.connection_id, &refreshed)
                            .await;
                    }
                    retry_result
                } else {
                    Err(error)
                }
            }
        }
    }

    pub(crate) async fn exec_with_stdout_chunks(
        &self,
        app: &AppHandle,
        config: &ResolvedSshConfig,
        command: &str,
        chunks: ExecOutputChunkCallback,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(app, config).await?;
        self.begin_handle_use(&handle).await;
        let result = {
            let session = handle.session.lock().await;
            session.exec_with_stdout_chunks(command, chunks).await
        };
        self.end_handle_use(&handle).await;

        match result {
            Ok(output) => {
                self.mark_handle_used(&handle).await;
                Ok(output)
            }
            Err(error) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                Err(error)
            }
        }
    }

    async fn session_handle(
        &self,
        app: &AppHandle,
        config: &ResolvedSshConfig,
    ) -> Result<RemoteExecSessionHandle, AppError> {
        let now_ms = now_millis();
        let signature = config.signature();

        self.prune_idle_sessions(now_ms).await;

        if let Some(existing) = self.lookup_handle(&config.connection_id).await {
            let last_used_ms = *existing.last_used_ms.lock().await;
            let meta = RemoteExecSessionMeta {
                signature: existing.signature.clone(),
                last_used_ms,
            };
            if can_reuse_remote_exec_session(
                &meta,
                &signature,
                self.options.idle_timeout_ms,
                now_ms,
            ) {
                return Ok(existing);
            }
            self.invalidate_handle(&config.connection_id, &existing)
                .await;
        }

        self.connect_and_store(app, config).await
    }

    async fn lookup_handle(&self, connection_id: &str) -> Option<RemoteExecSessionHandle> {
        self.sessions.lock().await.get(connection_id).cloned()
    }

    async fn connect_and_store(
        &self,
        app: &AppHandle,
        config: &ResolvedSshConfig,
    ) -> Result<RemoteExecSessionHandle, AppError> {
        self.prune_extra_sessions(&config.connection_id).await;

        let new_handle = RemoteExecSessionHandle {
            signature: config.signature(),
            connection_id: config.connection_id.clone(),
            in_flight: Arc::new(Mutex::new(0)),
            last_used_ms: Arc::new(Mutex::new(now_millis())),
            session: Arc::new(Mutex::new(
                ReusableExecSession::connect_resolved(app, config).await?,
            )),
        };

        let replaced = {
            let mut sessions = self.sessions.lock().await;
            if let Some(existing) = sessions.get(&config.connection_id).cloned() {
                if existing.signature == new_handle.signature {
                    existing
                } else {
                    sessions.insert(config.connection_id.clone(), new_handle.clone());
                    drop(sessions);
                    self.close_handle(existing).await;
                    return Ok(new_handle);
                }
            } else {
                sessions.insert(config.connection_id.clone(), new_handle.clone());
                return Ok(new_handle);
            }
        };

        self.close_handle(new_handle).await;
        Ok(replaced)
    }

    async fn prune_idle_sessions(&self, now_ms: u64) {
        let handles = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .map(|(connection_id, handle)| (connection_id.clone(), handle.clone()))
                .collect::<Vec<_>>()
        };

        for (connection_id, handle) in handles {
            if handle_is_busy(&handle).await {
                continue;
            }
            let last_used_ms = *handle.last_used_ms.lock().await;
            let meta = RemoteExecSessionMeta {
                signature: handle.signature.clone(),
                last_used_ms,
            };
            if !can_reuse_remote_exec_session(
                &meta,
                &handle.signature,
                self.options.idle_timeout_ms,
                now_ms,
            ) {
                self.invalidate_handle(&connection_id, &handle).await;
            }
        }
    }

    async fn prune_extra_sessions(&self, active_connection_id: &str) {
        if self.options.max_cached_sessions == 0 {
            return;
        }

        let stale = {
            let mut sessions = self.sessions.lock().await;
            if sessions.len() < self.options.max_cached_sessions {
                Vec::new()
            } else {
                let remove_count = sessions
                    .len()
                    .saturating_sub(self.options.max_cached_sessions.saturating_sub(1));
                let mut stale_ids = sessions
                    .keys()
                    .filter(|connection_id| connection_id.as_str() != active_connection_id)
                    .cloned()
                    .collect::<Vec<_>>();
                stale_ids.sort();
                stale_ids
                    .into_iter()
                    .take(remove_count)
                    .filter_map(|connection_id| sessions.remove(&connection_id))
                    .collect::<Vec<_>>()
            }
        };

        for handle in stale {
            self.close_handle(handle).await;
        }
    }

    async fn invalidate_handle(&self, connection_id: &str, handle: &RemoteExecSessionHandle) {
        let removed = {
            let mut sessions = self.sessions.lock().await;
            if let Some(current) = sessions.get(connection_id) {
                if Arc::ptr_eq(&current.session, &handle.session) {
                    sessions.remove(connection_id)
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(stale) = removed {
            self.close_handle(stale).await;
        }
    }

    async fn close_handle(&self, handle: RemoteExecSessionHandle) {
        let session = handle.session.lock().await;
        session.close().await;
    }

    async fn mark_handle_used(&self, handle: &RemoteExecSessionHandle) {
        *handle.last_used_ms.lock().await = now_millis();
        self.schedule_idle_prune(handle.clone());
    }

    async fn begin_handle_use(&self, handle: &RemoteExecSessionHandle) {
        let mut in_flight = handle.in_flight.lock().await;
        *in_flight = in_flight.saturating_add(1);
    }

    async fn end_handle_use(&self, handle: &RemoteExecSessionHandle) {
        let mut in_flight = handle.in_flight.lock().await;
        *in_flight = in_flight.saturating_sub(1);
    }

    fn schedule_idle_prune(&self, handle: RemoteExecSessionHandle) {
        let idle_timeout_ms = self.options.idle_timeout_ms;
        if idle_timeout_ms == 0 {
            return;
        }

        let pool = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(idle_timeout_ms.saturating_add(1_000))).await;
            if handle_is_busy(&handle).await {
                return;
            }
            let last_used_ms = *handle.last_used_ms.lock().await;
            if now_millis().saturating_sub(last_used_ms) > idle_timeout_ms {
                pool.invalidate_handle(&handle.connection_id, &handle).await;
            }
        });
    }
}

async fn handle_is_busy(handle: &RemoteExecSessionHandle) -> bool {
    *handle.in_flight.lock().await > 0
}

fn can_reuse_remote_exec_session(
    meta: &RemoteExecSessionMeta,
    signature: &str,
    idle_timeout_ms: u64,
    now_ms: u64,
) -> bool {
    meta.signature == signature && now_ms.saturating_sub(meta.last_used_ms) <= idle_timeout_ms
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{can_reuse_remote_exec_session, RemoteExecSessionMeta};

    #[test]
    fn reuse_requires_matching_signature() {
        let meta = RemoteExecSessionMeta {
            signature: "old".to_string(),
            last_used_ms: 100,
        };

        assert!(!can_reuse_remote_exec_session(&meta, "new", 1_000, 200));
    }

    #[test]
    fn reuse_rejects_idle_sessions() {
        let meta = RemoteExecSessionMeta {
            signature: "same".to_string(),
            last_used_ms: 100,
        };

        assert!(!can_reuse_remote_exec_session(&meta, "same", 50, 200));
        assert!(can_reuse_remote_exec_session(&meta, "same", 100, 200));
    }
}
