export type ConnectionTransferMode = "import" | "export";
export type ConnectionTransferConflictStrategy = "skip" | "overwrite";

export interface ConnectionTransferItemStats {
  total: number;
  new: number;
  conflicts: number;
}

export interface ConnectionTransferPreviewSummary {
  connections: ConnectionTransferItemStats;
  credentials: ConnectionTransferItemStats;
  groups: ConnectionTransferItemStats;
  private_key_warnings: string[];
}

export interface ConnectionTransferPreviewResult {
  fingerprint: string;
  summary: ConnectionTransferPreviewSummary;
}

export interface ConnectionTransferExportResult {
  file_name: string;
  connections: number;
  credentials: number;
  groups: number;
  secrets: number;
}

export interface ConnectionTransferMutationStats {
  created: number;
  updated: number;
  skipped: number;
}

export interface ConnectionTransferImportResult {
  connections: ConnectionTransferMutationStats;
  credentials: ConnectionTransferMutationStats;
  groups: ConnectionTransferMutationStats;
  secrets: number;
}
