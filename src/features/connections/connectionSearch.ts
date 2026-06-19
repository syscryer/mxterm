import type { ConnectionProfile } from "./connectionTypes";

export interface ConnectionSearchEntry {
  address: string;
  connection: ConnectionProfile;
  groupLabel: string;
  metaLabel: string;
  score: number;
}

interface ConnectionSearchFields {
  address: string;
  groupLabel: string;
  metaLabel: string;
  name: string;
  searchText: string;
}

const defaultConnectionSearchLimit = 50;

export function buildConnectionSearchEntries(
  connections: ConnectionProfile[],
  query: string,
  limit = defaultConnectionSearchLimit,
): ConnectionSearchEntry[] {
  const terms = normalizeConnectionSearchTerms(query);

  return connections
    .map((connection) => buildConnectionSearchEntry(connection, terms))
    .filter(isConnectionSearchEntry)
    .sort((left, right) => compareConnectionSearchEntries(left, right, terms.length > 0))
    .slice(0, limit);
}

export function normalizeConnectionSearchTerms(query: string) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function sortConnectionsByRecent(left: ConnectionProfile, right: ConnectionProfile) {
  const rightConnectedAt = connectionTimestampOf(right.last_connected_at);
  const leftConnectedAt = connectionTimestampOf(left.last_connected_at);

  if (rightConnectedAt !== leftConnectedAt) {
    return rightConnectedAt - leftConnectedAt;
  }

  const createdDiff = connectionTimestampOf(right.created_at) - connectionTimestampOf(left.created_at);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return left.name.localeCompare(right.name, "zh-Hans");
}

export function connectionTimestampOf(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 0;
  }

  const normalized = trimmed.toLowerCase();

  if (normalized === "demo" || normalized === "preview") {
    return Date.now();
  }

  if (/^\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatConnectionAddress(connection: ConnectionProfile) {
  return `${connection.username}@${connection.host}:${connection.port.toString()}`;
}

function buildConnectionSearchEntry(
  connection: ConnectionProfile,
  terms: string[],
): ConnectionSearchEntry | null {
  const fields = buildConnectionSearchFields(connection);

  if (!terms.every((term) => fields.searchText.includes(term))) {
    return null;
  }

  return {
    address: fields.address,
    connection,
    groupLabel: fields.groupLabel,
    metaLabel: fields.metaLabel,
    score: scoreConnectionSearchResult(connection, fields, terms),
  };
}

function buildConnectionSearchFields(connection: ConnectionProfile): ConnectionSearchFields {
  const address = formatConnectionAddress(connection);
  const groupLabel = connection.group?.trim() || "未分组";
  const systemLabel = [connection.remote_os_name, connection.remote_os_version]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
  const metaLabel = [groupLabel, systemLabel].filter(Boolean).join(" · ");
  const name = connection.name.trim();
  const searchText = [
    name,
    connection.host,
    connection.port.toString(),
    connection.username,
    address,
    groupLabel,
    connection.notes || "",
    connection.remote_os_id || "",
    connection.remote_os_name || "",
    connection.remote_os_version || "",
  ]
    .join("\n")
    .toLowerCase();

  return {
    address,
    groupLabel,
    metaLabel,
    name,
    searchText,
  };
}

function scoreConnectionSearchResult(
  connection: ConnectionProfile,
  fields: ConnectionSearchFields,
  terms: string[],
) {
  if (terms.length === 0) {
    return connection.is_favorite ? 1 : 0;
  }

  const name = fields.name.toLowerCase();
  const host = connection.host.toLowerCase();
  const address = fields.address.toLowerCase();
  const username = connection.username.toLowerCase();
  const group = fields.groupLabel.toLowerCase();
  const notes = (connection.notes || "").toLowerCase();
  const system = [connection.remote_os_id, connection.remote_os_name, connection.remote_os_version]
    .join(" ")
    .toLowerCase();

  return terms.reduce((score, term) => {
    if (name.startsWith(term)) return score + 120;
    if (name.includes(term)) return score + 90;
    if (host.includes(term)) return score + 70;
    if (address.includes(term)) return score + 65;
    if (username.includes(term)) return score + 50;
    if (group.includes(term)) return score + 45;
    if (notes.includes(term)) return score + 25;
    if (system.includes(term)) return score + 20;
    return score;
  }, connection.is_favorite ? 6 : 0);
}

function compareConnectionSearchEntries(
  left: ConnectionSearchEntry,
  right: ConnectionSearchEntry,
  hasQuery: boolean,
) {
  if (hasQuery && left.score !== right.score) {
    return right.score - left.score;
  }

  return sortConnectionsByRecent(left.connection, right.connection);
}

function isConnectionSearchEntry(value: ConnectionSearchEntry | null): value is ConnectionSearchEntry {
  return Boolean(value);
}