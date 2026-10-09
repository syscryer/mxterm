use super::*;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct WorkspaceLocation {
    local_root: Option<PathBuf>,
    ssh: Option<SshIdentity>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SshIdentity {
    connection_id: String,
    host: String,
    port: u16,
    username: String,
}

impl WorkspaceLocation {
    pub(super) fn from_agent(agent: &PreparedAgent) -> Self {
        Self {
            local_root: agent
                .local_workspace
                .clone()
                .or(agent.host_local_directory.clone()),
            ssh: agent.config.as_ref().map(|config| SshIdentity {
                connection_id: config.connection_id.clone(),
                host: config.host.clone(),
                port: config.port,
                username: config.username.clone(),
            }),
        }
    }

    fn resolve_ssh(
        &self,
        app: &AppHandle,
        needed: bool,
    ) -> Result<Option<ResolvedSshConfig>, AppError> {
        if !needed {
            return Ok(None);
        }
        let identity = self
            .ssh
            .as_ref()
            .ok_or_else(|| history_error("撤销记录缺少 SSH 主机信息。"))?;
        let config =
            crate::ssh_config::resolve_saved_connection(app, &identity.connection_id, None)?;
        if config.host != identity.host
            || config.port != identity.port
            || config.username != identity.username
        {
            return Err(history_error(
                "原 SSH 连接的主机或用户已改变，不能在新主机上撤销。",
            ));
        }
        Ok(Some(config))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiFileChangeEntry {
    pub path: String,
    pub target: String,
    pub added_lines: usize,
    pub removed_lines: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiFileChangeSummary {
    pub checkpoint_id: String,
    pub message_id: String,
    pub status: String,
    pub files: Vec<AiFileChangeEntry>,
    pub added_lines: usize,
    pub removed_lines: usize,
    pub remaining_changes: usize,
}

#[derive(Debug, Deserialize)]
pub struct AiFileChangesUndoRequest {
    pub session_id: String,
    pub message_id: String,
    pub checkpoint_id: String,
}

#[derive(Debug, Serialize)]
pub struct AiFileChangesUndoResult {
    pub summary: AiFileChangeSummary,
    pub reverted_changes: usize,
    pub error: Option<String>,
}

fn history_error(message: &str) -> AppError {
    AppError::new("ai_file_history_invalid", message, message, true)
}

impl WorkspaceState {
    pub(super) fn register_applied(
        &mut self,
        id: String,
        mut patch: PendingPatch,
        message_id: &str,
        location: WorkspaceLocation,
    ) {
        self.next_applied_sequence = self.next_applied_sequence.max(
            self.applied
                .values()
                .map(|patch| patch.applied_sequence)
                .max()
                .unwrap_or(0),
        ) + 1;
        patch.applied_sequence = self.next_applied_sequence;
        patch.applied_at_ms = now_millis();
        let checkpoint = match self
            .checkpoints
            .iter()
            .position(|checkpoint| checkpoint.message_id == message_id)
        {
            Some(index) => &mut self.checkpoints[index],
            None => {
                self.checkpoints.push(WorkspaceCheckpoint {
                    id: Uuid::new_v4().to_string(),
                    label: "本轮文件修改".into(),
                    created_at_ms: now_millis(),
                    change_ids: Vec::new(),
                    status: "active".into(),
                    rolled_back_at_ms: None,
                    message_id: message_id.into(),
                    changes: Vec::new(),
                    location,
                });
                self.checkpoints
                    .last_mut()
                    .expect("checkpoint just inserted")
            }
        };
        checkpoint.change_ids.push(id.clone());
        checkpoint.changes.push((id.clone(), patch.clone()));
        self.applied.insert(id, patch);
    }

    pub(crate) fn file_change_summaries(&self) -> Vec<AiFileChangeSummary> {
        self.checkpoints
            .iter()
            .filter(|checkpoint| !checkpoint.message_id.is_empty())
            .map(|checkpoint| self.file_change_summary(checkpoint))
            .collect()
    }

    fn file_change_summary(&self, checkpoint: &WorkspaceCheckpoint) -> AiFileChangeSummary {
        // Aggregate actual before/after versions, including repeated writes to the same file.
        let mut versions: BTreeMap<String, (String, String, Option<String>, Option<String>)> =
            BTreeMap::new();
        let mut add =
            |target: WorkspaceTarget, path: &str, before: Option<String>, after: Option<String>| {
                versions
                    .entry(scoped_workspace_path(target, path))
                    .and_modify(|entry| entry.3 = after.clone())
                    .or_insert((path.into(), target.key_prefix().into(), before, after));
            };
        for (_, patch) in &checkpoint.changes {
            if patch.action == "rename" {
                add(patch.target, &patch.path, patch.before.clone(), None);
                if let Some(destination) = &patch.destination {
                    add(patch.target, destination, None, patch.before.clone());
                }
            } else {
                add(
                    patch.target,
                    &patch.path,
                    patch.before.clone(),
                    patch.after.clone(),
                );
            }
        }
        let files: Vec<_> = versions
            .into_values()
            .filter(|(_, _, before, after)| before != after)
            .map(|(path, target, before, after)| {
                let (added_lines, removed_lines) = crate::ai_workspace::changed_line_counts(
                    before.as_deref().unwrap_or_default(),
                    after.as_deref().unwrap_or_default(),
                );
                AiFileChangeEntry {
                    path,
                    target,
                    added_lines,
                    removed_lines,
                }
            })
            .collect();
        let remaining_changes = checkpoint
            .change_ids
            .iter()
            .filter(|id| self.applied.contains_key(*id))
            .count();
        AiFileChangeSummary {
            checkpoint_id: checkpoint.id.clone(),
            message_id: checkpoint.message_id.clone(),
            status: if remaining_changes == 0 {
                "reverted"
            } else if remaining_changes < checkpoint.change_ids.len() {
                "partial"
            } else {
                "applied"
            }
            .into(),
            added_lines: files.iter().map(|file| file.added_lines).sum(),
            removed_lines: files.iter().map(|file| file.removed_lines).sum(),
            files,
            remaining_changes,
        }
    }

    fn undo_plan(
        &self,
        request: &AiFileChangesUndoRequest,
    ) -> Result<(WorkspaceCheckpoint, Vec<(String, PendingPatch)>), AppError> {
        let checkpoint = self
            .checkpoints
            .iter()
            .find(|checkpoint| {
                checkpoint.id == request.checkpoint_id
                    && checkpoint.message_id == request.message_id
                    && !checkpoint.message_id.is_empty()
            })
            .ok_or_else(|| history_error("该回复的文件修改记录不存在。"))?
            .clone();
        // Record order is application order, independent of wall-clock resolution.
        let patches: Vec<_> = checkpoint
            .change_ids
            .iter()
            .rev()
            .filter_map(|id| {
                self.applied
                    .get(id)
                    .map(|patch| (id.clone(), patch.clone()))
            })
            .collect();
        if patches.is_empty() {
            return Err(history_error("本轮修改已经撤销。"));
        }
        // Do not undo a later turn implicitly, even if it happened to write identical text.
        for (_, patch) in &patches {
            if self.applied.values().any(|later| {
                later.applied_sequence > patch.applied_sequence
                    && !patches
                        .iter()
                        .any(|(_, selected)| selected.applied_sequence == later.applied_sequence)
                    && later.target == patch.target
                    && touched_paths(later)
                        .iter()
                        .any(|path| touched_paths(patch).contains(path))
            }) {
                return Err(history_error(
                    "后续回复仍有对同一文件的修改，请先撤销后续修改。",
                ));
            }
        }
        Ok((checkpoint, patches))
    }
}

fn touched_paths(patch: &PendingPatch) -> Vec<&str> {
    let mut paths = vec![patch.path.as_str()];
    if let Some(destination) = patch.destination.as_deref() {
        paths.push(destination);
    }
    paths
}

pub(crate) fn persisted_summaries(
    app: &AppHandle,
    session_id: &str,
) -> Result<Vec<AiFileChangeSummary>, AppError> {
    let mut summaries = Vec::new();
    for (_, json) in crate::storage_sqlite::list_ai_workspace_states(app, session_id)? {
        let state: WorkspaceState = serde_json::from_str(&json).map_err(|error| {
            AppError::new(
                "ai_file_history_invalid",
                "读取文件修改记录失败。",
                error,
                true,
            )
        })?;
        summaries.extend(state.file_change_summaries());
    }
    Ok(summaries)
}

pub(crate) async fn undo(
    app: &AppHandle,
    pool: &RemoteExecSessionPool,
    state: &mut WorkspaceState,
    request: &AiFileChangesUndoRequest,
    scope: &str,
) -> Result<AiFileChangesUndoResult, AppError> {
    let (checkpoint, patches) = state.undo_plan(request)?;
    let config = checkpoint.location.resolve_ssh(
        app,
        patches
            .iter()
            .any(|(_, patch)| patch.target == WorkspaceTarget::Ssh),
    )?;
    let rollback = WorkspaceRollback {
        app,
        pool,
        config: config.as_ref(),
        local_root: checkpoint.location.local_root.as_deref(),
    };
    // Preflight every file with a virtual reverse state before modifying any file.
    let mut versions = HashMap::new();
    for (_, patch) in &patches {
        for path in touched_paths(patch) {
            let key = scoped_workspace_path(patch.target, path);
            if !versions.contains_key(&key) {
                versions.insert(key, rollback.read_version(patch.target, path).await?);
            }
        }
    }
    validate_reverse_versions(&patches, &mut versions)?;
    // A changed or missing backup must fail before any remote delete restoration.
    if let Some(config) = config.as_ref() {
        let manager = app.state::<crate::remote_files::RemoteFileManager>();
        for (id, patch) in &patches {
            if patch.target == WorkspaceTarget::Ssh && patch.action == "delete" {
                let backup = manager.read_file(app, config.clone(), id).await?;
                if Some(backup.content) != patch.before {
                    return Err(history_error(&format!(
                        "{}：备份内容发生变化，未执行撤销。",
                        patch.path
                    )));
                }
            }
        }
    }
    let mut reverted_changes = 0;
    let mut failure = None;
    for (id, patch) in &patches {
        if let Err(error) = rollback.rollback_applied_patch(id, patch).await {
            failure = Some(format!("{}：{}", patch.path, error.message));
            break;
        }
        reverted_changes += 1;
        state.applied.remove(id);
        for checkpoint in &mut state.checkpoints {
            let remaining = checkpoint
                .change_ids
                .iter()
                .filter(|id| state.applied.contains_key(*id))
                .count();
            if remaining == 0 {
                checkpoint.status = "rolled_back".into();
                checkpoint.rolled_back_at_ms.get_or_insert_with(now_millis);
            } else if remaining < checkpoint.change_ids.len() {
                checkpoint.status = "partial".into();
            }
        }
        state
            .reads
            .remove(&scoped_workspace_path(patch.target, &patch.path));
        state
            .remote_meta
            .remove(&scoped_workspace_path(patch.target, &patch.path));
        if let Some(destination) = patch.destination.as_deref() {
            state
                .reads
                .remove(&scoped_workspace_path(patch.target, destination));
            state
                .remote_meta
                .remove(&scoped_workspace_path(patch.target, destination));
        }
        let json =
            serde_json::to_string(state).map_err(|error| history_error(&error.to_string()))?;
        if let Err(error) = crate::storage_sqlite::upsert_ai_workspace_state(
            app,
            &request.session_id,
            scope,
            &json,
            now_millis(),
        ) {
            failure = Some(format!(
                "文件已撤销，但保存撤销记录失败：{}。请勿重复撤销。",
                error.message
            ));
            break;
        }
    }
    Ok(AiFileChangesUndoResult {
        summary: state.file_change_summary(&checkpoint),
        reverted_changes,
        error: failure,
    })
}

fn validate_reverse_versions(
    patches: &[(String, PendingPatch)],
    versions: &mut HashMap<String, Option<String>>,
) -> Result<(), AppError> {
    for (_, patch) in patches {
        let key = scoped_workspace_path(patch.target, &patch.path);
        let current = versions
            .get(&key)
            .ok_or_else(|| history_error("缺少文件版本。"))?;
        if patch.action == "rename" {
            let destination = patch
                .destination
                .as_deref()
                .ok_or_else(|| history_error("重命名缺少目标路径。"))?;
            let destination_key = scoped_workspace_path(patch.target, destination);
            if current.is_some() || versions.get(&destination_key) != Some(&patch.before) {
                return Err(history_error(&format!(
                    "{}：文件在修改后发生变化，未执行撤销。",
                    patch.path
                )));
            }
            versions.insert(destination_key, None);
        } else if current != &patch.after {
            return Err(history_error(&format!(
                "{}：文件在修改后发生变化，未执行撤销。",
                patch.path
            )));
        }
        versions.insert(key, patch.before.clone());
    }
    Ok(())
}

pub(super) struct WorkspaceRollback<'a> {
    pub app: &'a AppHandle,
    pub pool: &'a RemoteExecSessionPool,
    pub config: Option<&'a ResolvedSshConfig>,
    pub local_root: Option<&'a Path>,
}

impl WorkspaceRollback<'_> {
    async fn read_version(
        &self,
        target: WorkspaceTarget,
        path: &str,
    ) -> Result<Option<String>, AppError> {
        if target == WorkspaceTarget::Local {
            return crate::ai_workspace::read_version(
                self.local_root
                    .ok_or_else(|| history_error("撤销记录缺少本地目录。"))?,
                path,
            );
        }
        let config = self
            .config
            .ok_or_else(|| history_error("撤销记录缺少 SSH 主机。"))?;
        let exists = self
            .pool
            .exec(
                self.app,
                config,
                &format!("test -e {}", quote_posix_shell(path)),
                RemoteExecRetry::None,
            )
            .await?;
        match exists.exit_status {
            Some(0) => Ok(Some(
                self.app
                    .state::<crate::remote_files::RemoteFileManager>()
                    .read_file(self.app, config.clone(), path)
                    .await?
                    .content,
            )),
            Some(1) => Ok(None),
            _ => Err(history_error("检查远程文件版本失败。")),
        }
    }
    async fn exec_remote_checked(
        &self,
        config: &ResolvedSshConfig,
        command: &str,
    ) -> Result<ExecOutput, AppError> {
        let output = self
            .pool
            .exec(self.app, config, command, RemoteExecRetry::None)
            .await?;
        if output.exit_status == Some(0) {
            return Ok(output);
        }
        Err(AppError::new(
            "ai_remote_workspace_rollback_failed",
            "远程工作区回滚失败。",
            String::from_utf8_lossy(&output.stderr),
            true,
        ))
    }

    pub(super) async fn rollback_applied_patch(
        &self,
        backup_id: &str,
        patch: &PendingPatch,
    ) -> Result<(), AppError> {
        if patch.target == WorkspaceTarget::Local {
            let Some(root) = self.local_root else {
                return Err(AppError::new(
                    "ai_local_workspace_missing",
                    "本地文件回滚缺少工作区。",
                    "local workspace required",
                    true,
                ));
            };
            let backup_dir = self
                .app
                .path()
                .app_data_dir()
                .map(|path| path.join("ai-agent-backups"))
                .unwrap_or_else(|_| root.join(".mxterm-agent-backups"));
            return rollback_local(root, &backup_dir, backup_id, patch);
        }

        let Some(config) = self.config else {
            return Err(AppError::new(
                "ai_workspace_missing",
                "没有可用的工作区。",
                "workspace",
                true,
            ));
        };
        if !is_remote_absolute_path(&patch.path)
            || patch
                .destination
                .as_deref()
                .is_some_and(|path| !is_remote_absolute_path(path))
            || (patch.action != "create" && !is_remote_absolute_path(backup_id))
        {
            return Err(AppError::new(
                "ai_workspace_path_forbidden",
                "回滚路径必须是当前 SSH 主机上的绝对路径。",
                patch.path.clone(),
                true,
            ));
        }
        let manager = self.app.state::<crate::remote_files::RemoteFileManager>();
        let exists = self
            .pool
            .exec(
                self.app,
                config,
                &format!("test -e {}", quote_posix_shell(&patch.path)),
                RemoteExecRetry::None,
            )
            .await?;
        let current = match exists.exit_status {
            Some(0) => Some(
                manager
                    .read_file(self.app, config.clone(), &patch.path)
                    .await?,
            ),
            Some(1) => None,
            Some(status) => {
                return Err(AppError::new(
                    "ai_remote_workspace_rollback_failed",
                    "检查远程文件状态失败。",
                    format!("exit_status={status}"),
                    true,
                ))
            }
            None => {
                return Err(AppError::new(
                    "ai_remote_workspace_rollback_failed",
                    "检查远程文件状态失败。",
                    "missing exit status",
                    true,
                ))
            }
        };
        match patch.action.as_str() {
            "patch" | "write" => {
                let Some(current) = current else {
                    return Err(AppError::new(
                        "ai_workspace_rollback_conflict",
                        "远程文件在应用后已不存在，不能整体回滚。",
                        patch.path.clone(),
                        true,
                    ));
                };
                if Some(current.content.clone()) != patch.after {
                    return Err(AppError::new(
                        "ai_workspace_rollback_conflict",
                        "远程文件在应用后又发生变化，不能整体回滚。",
                        patch.path.clone(),
                        true,
                    ));
                }
                if let Some(before) = patch.before.as_deref() {
                    manager
                        .write_file(
                            self.app,
                            config.clone(),
                            &patch.path,
                            before,
                            current.mtime,
                            current.size,
                            false,
                        )
                        .await?;
                } else {
                    self.exec_remote_checked(
                        config,
                        &format!("rm -f -- {}", quote_posix_shell(&patch.path)),
                    )
                    .await?;
                }
            }
            "create" => {
                let Some(current) = current else {
                    return Err(AppError::new(
                        "ai_workspace_rollback_conflict",
                        "远程创建的文件已经不存在。",
                        patch.path.clone(),
                        true,
                    ));
                };
                if Some(current.content) != patch.after {
                    return Err(AppError::new(
                        "ai_workspace_rollback_conflict",
                        "远程文件在应用后又发生变化，不能整体回滚。",
                        patch.path.clone(),
                        true,
                    ));
                }
                self.exec_remote_checked(
                    config,
                    &format!("rm -f -- {}", quote_posix_shell(&patch.path)),
                )
                .await?;
            }
            "delete" => {
                if current.is_some() {
                    return Err(AppError::new(
                        "ai_workspace_rollback_conflict",
                        "远程删除目标已经被重新创建，不能整体回滚。",
                        patch.path.clone(),
                        true,
                    ));
                }
                self.exec_remote_checked(
                    config,
                    &format!(
                        "cp -p -- {} {}",
                        quote_posix_shell(backup_id),
                        quote_posix_shell(&patch.path)
                    ),
                )
                .await?;
            }
            "rename" => {
                let destination = patch.destination.as_deref().ok_or_else(|| {
                    AppError::new(
                        "ai_workspace_rollback_failed",
                        "远程重命名回滚缺少目标路径。",
                        backup_id,
                        true,
                    )
                })?;
                let destination_current = manager
                    .read_file(self.app, config.clone(), destination)
                    .await
                    .map_err(|error| {
                        AppError::new(
                            "ai_workspace_rollback_conflict",
                            "远程重命名目标已发生变化，不能整体回滚。",
                            error.message,
                            true,
                        )
                    })?;
                if current.is_some() || Some(destination_current.content) != patch.before {
                    return Err(AppError::new(
                        "ai_workspace_rollback_conflict",
                        "远程重命名目标已发生变化，不能整体回滚。",
                        patch.path.clone(),
                        true,
                    ));
                }
                self.exec_remote_checked(
                    config,
                    &format!(
                        "mv -- {} {}",
                        quote_posix_shell(destination),
                        quote_posix_shell(&patch.path)
                    ),
                )
                .await?;
            }
            _ => {
                return Err(AppError::new(
                    "ai_workspace_operation_invalid",
                    "工作区回滚操作无效。",
                    patch.action.clone(),
                    true,
                ));
            }
        }
        Ok(())
    }
}

fn rollback_local(
    root: &Path,
    backup_dir: &Path,
    backup_id: &str,
    patch: &PendingPatch,
) -> Result<(), AppError> {
    let current = crate::ai_workspace::read_version(root, &patch.path)?;
    let conflict = || {
        AppError::new(
            "ai_workspace_rollback_conflict",
            "文件在应用后又发生变化，不能整体回滚。",
            patch.path.clone(),
            true,
        )
    };
    match patch.action.as_str() {
        "patch" | "write" => {
            if current != patch.after {
                return Err(conflict());
            }
            if let Some(before) = patch.before.as_deref() {
                crate::ai_workspace::write_version(
                    root,
                    &patch.path,
                    current.as_deref(),
                    before,
                    backup_dir,
                )?;
            } else {
                let path = crate::ai_workspace::resolve_workspace_path(root, &patch.path)?;
                std::fs::remove_file(path).map_err(|error| {
                    AppError::new(
                        "ai_workspace_rollback_failed",
                        "删除已创建文件失败。",
                        error,
                        true,
                    )
                })?;
            }
        }
        "create" => {
            if current != patch.after {
                return Err(conflict());
            }
            let path = crate::ai_workspace::resolve_workspace_path(root, &patch.path)?;
            std::fs::remove_file(path).map_err(|error| {
                AppError::new(
                    "ai_workspace_rollback_failed",
                    "删除已创建文件失败。",
                    error,
                    true,
                )
            })?;
        }
        "delete" => {
            if current.is_some() || patch.before.is_none() {
                return Err(conflict());
            }
            crate::ai_workspace::write_version(
                root,
                &patch.path,
                None,
                patch.before.as_deref().unwrap_or_default(),
                backup_dir,
            )?;
        }
        "rename" => {
            let destination = patch.destination.as_deref().ok_or_else(|| {
                AppError::new(
                    "ai_workspace_rollback_failed",
                    "重命名回滚缺少目标路径。",
                    backup_id,
                    true,
                )
            })?;
            if current.is_some()
                || crate::ai_workspace::read_version(root, destination)? != patch.before
            {
                return Err(conflict());
            }
            let source = crate::ai_workspace::resolve_workspace_path(root, &patch.path)?;
            let target = crate::ai_workspace::resolve_workspace_path(root, destination)?;
            std::fs::rename(target, source).map_err(|error| {
                AppError::new(
                    "ai_workspace_rollback_failed",
                    "重命名回滚失败。",
                    error,
                    true,
                )
            })?;
        }
        _ => {
            return Err(AppError::new(
                "ai_workspace_operation_invalid",
                "工作区回滚操作无效。",
                patch.action.clone(),
                true,
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(
        target: WorkspaceTarget,
        path: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> PendingPatch {
        PendingPatch {
            target,
            path: path.into(),
            before: before.map(str::to_string),
            after: after.map(str::to_string),
            diff: String::new(),
            action: if before.is_none() {
                "create"
            } else if after.is_none() {
                "delete"
            } else {
                "patch"
            }
            .into(),
            destination: None,
            applied_at_ms: 0,
            applied_sequence: 0,
        }
    }
    fn request(state: &WorkspaceState, message: &str) -> AiFileChangesUndoRequest {
        AiFileChangesUndoRequest {
            session_id: "test-session".into(),
            message_id: message.into(),
            checkpoint_id: state
                .checkpoints
                .iter()
                .find(|checkpoint| checkpoint.message_id == message)
                .unwrap()
                .id
                .clone(),
        }
    }

    #[test]
    fn ssh_create_then_patch_records_real_time_and_inverse_order() {
        let mut state = WorkspaceState::default();
        state.register_applied(
            "create".into(),
            patch(WorkspaceTarget::Ssh, "/tmp/test.txt", None, Some("one\n")),
            "reply",
            Default::default(),
        );
        state.register_applied(
            "patch".into(),
            patch(
                WorkspaceTarget::Ssh,
                "/tmp/test.txt",
                Some("one\n"),
                Some("one\ntwo\n"),
            ),
            "reply",
            Default::default(),
        );
        assert!(state.applied["patch"].applied_at_ms > 0);
        assert!(state.applied["patch"].applied_sequence > state.applied["create"].applied_sequence);
        // Even a tied clock cannot affect application order.
        state.applied.get_mut("patch").unwrap().applied_at_ms =
            state.applied["create"].applied_at_ms;
        let (_, plan) = state.undo_plan(&request(&state, "reply")).unwrap();
        assert_eq!(
            plan.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["patch", "create"]
        );
        let mut versions =
            HashMap::from([("ssh::/tmp/test.txt".into(), Some("one\ntwo\n".into()))]);
        validate_reverse_versions(&plan, &mut versions).unwrap();
        assert_eq!(versions["ssh::/tmp/test.txt"], None);
    }

    #[test]
    fn summary_counts_net_versions_and_keeps_hosts_distinct() {
        let mut state = WorkspaceState::default();
        state.register_applied(
            "a".into(),
            patch(
                WorkspaceTarget::Local,
                "/sample.txt",
                Some("a\n"),
                Some("b\n"),
            ),
            "reply",
            Default::default(),
        );
        state.register_applied(
            "b".into(),
            patch(
                WorkspaceTarget::Local,
                "/sample.txt",
                Some("b\n"),
                Some("a\nc\n"),
            ),
            "reply",
            Default::default(),
        );
        state.register_applied(
            "remote".into(),
            patch(WorkspaceTarget::Ssh, "/sample.txt", None, Some("r\n")),
            "reply",
            Default::default(),
        );
        let summary = &state.file_change_summaries()[0];
        assert_eq!(summary.files.len(), 2);
        assert_eq!(summary.added_lines, 2);
        assert_eq!(summary.removed_lines, 0);
    }

    #[test]
    fn later_turn_must_be_undone_first_even_for_identical_contents() {
        let mut state = WorkspaceState::default();
        state.register_applied(
            "first".into(),
            patch(WorkspaceTarget::Local, "a.txt", None, Some("a")),
            "one",
            Default::default(),
        );
        state.register_applied(
            "later".into(),
            patch(WorkspaceTarget::Local, "a.txt", Some("a"), Some("a")),
            "two",
            Default::default(),
        );
        assert!(state.undo_plan(&request(&state, "one")).is_err());
        state.applied.remove("later");
        assert!(state.undo_plan(&request(&state, "one")).is_ok());
        let mut wrong = request(&state, "one");
        wrong.message_id = "other-reply".into();
        assert!(state.undo_plan(&wrong).is_err());
    }

    #[test]
    fn persisted_index_retains_undo_and_legacy_data_has_no_fabricated_round() {
        let mut state = WorkspaceState::default();
        state.register_applied(
            "first".into(),
            patch(WorkspaceTarget::Local, "a.txt", None, Some("a")),
            "one",
            Default::default(),
        );
        let mut restored: WorkspaceState =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(
            restored
                .undo_plan(&request(&restored, "one"))
                .unwrap()
                .1
                .len(),
            1
        );
        restored.applied.remove("first");
        assert_eq!(restored.file_change_summaries()[0].status, "reverted");
        let legacy: WorkspaceState =
            serde_json::from_value(json!({"reads":{},"remote_meta":{},"patches":{},"applied":{}}))
                .unwrap();
        assert!(legacy.file_change_summaries().is_empty());
    }

    #[test]
    fn conflict_preflight_checks_all_files_before_writes() {
        let mut state = WorkspaceState::default();
        state.register_applied(
            "a".into(),
            patch(
                WorkspaceTarget::Local,
                "a.txt",
                Some("old-a"),
                Some("new-a"),
            ),
            "reply",
            Default::default(),
        );
        state.register_applied(
            "b".into(),
            patch(
                WorkspaceTarget::Local,
                "b.txt",
                Some("old-b"),
                Some("new-b"),
            ),
            "reply",
            Default::default(),
        );
        let (_, plan) = state.undo_plan(&request(&state, "reply")).unwrap();
        let versions = HashMap::from([
            ("local::a.txt".into(), Some("manual-edit".into())),
            ("local::b.txt".into(), Some("new-b".into())),
        ]);
        assert!(validate_reverse_versions(&plan, &mut versions.clone()).is_err());
        assert_eq!(state.applied.len(), 2);
        assert_eq!(state.file_change_summaries()[0].status, "applied");
        state.applied.remove("b");
        assert_eq!(state.file_change_summaries()[0].status, "partial");
    }

    #[test]
    fn local_disk_create_patch_rename_delete_chain_survives_restart_and_undo() {
        let root = std::env::temp_dir().join(format!("mxterm-file-history-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let mut state = WorkspaceState::default();
        let location = WorkspaceLocation {
            local_root: Some(root.clone()),
            ssh: None,
        };
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        state.register_applied(
            "create".into(),
            patch(WorkspaceTarget::Local, "a.txt", None, Some("a\n")),
            "reply",
            location.clone(),
        );
        std::fs::write(root.join("a.txt"), "a\n中文\n").unwrap();
        state.register_applied(
            "edit".into(),
            patch(
                WorkspaceTarget::Local,
                "a.txt",
                Some("a\n"),
                Some("a\n中文\n"),
            ),
            "reply",
            location.clone(),
        );
        std::fs::rename(root.join("a.txt"), root.join("b.txt")).unwrap();
        let mut rename = patch(
            WorkspaceTarget::Local,
            "a.txt",
            Some("a\n中文\n"),
            Some("a\n中文\n"),
        );
        rename.action = "rename".into();
        rename.destination = Some("b.txt".into());
        state.register_applied("rename".into(), rename, "reply", location.clone());
        std::fs::remove_file(root.join("b.txt")).unwrap();
        state.register_applied(
            "delete".into(),
            patch(WorkspaceTarget::Local, "b.txt", Some("a\n中文\n"), None),
            "reply",
            location,
        );
        let state: WorkspaceState =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        let (_, plan) = state.undo_plan(&request(&state, "reply")).unwrap();
        let mut versions =
            HashMap::from([("local::a.txt".into(), None), ("local::b.txt".into(), None)]);
        validate_reverse_versions(&plan, &mut versions).unwrap();
        for (id, patch) in plan {
            rollback_local(&root, &root.join("backups"), &id, &patch).unwrap();
        }
        assert!(!root.join("a.txt").exists());
        assert!(!root.join("b.txt").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
