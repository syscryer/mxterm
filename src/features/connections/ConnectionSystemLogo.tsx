import type { CSSProperties } from "react";
import { Monitor, type LucideIcon } from "lucide-react";
import {
  siAlibabacloud,
  siAlmalinux,
  siAlpinelinux,
  siApple,
  siArchlinux,
  siCentos,
  siDebian,
  siFedora,
  siFreebsd,
  siLinux,
  siOpensuse,
  siRedhat,
  siRockylinux,
  siSuse,
  siUbuntu,
  type SimpleIcon,
} from "simple-icons";
import type { ConnectionProfile } from "./connectionTypes";

export type ConnectionSystemKind =
  | "ubuntu"
  | "debian"
  | "centos"
  | "rocky"
  | "almalinux"
  | "redhat"
  | "fedora"
  | "arch"
  | "alpine"
  | "suse"
  | "opensuse"
  | "freebsd"
  | "macos"
  | "alinux"
  | "rdp"
  | "vnc"
  | "linux";

interface ConnectionSystemLogoProps {
  compact?: boolean;
  connection?: ConnectionProfile;
  decorative?: boolean;
  kind?: ConnectionSystemKind;
}

interface ConnectionSystemIconDefinition {
  label?: string;
}

interface CustomIconDefinition extends ConnectionSystemIconDefinition {
  kind: "custom";
}

interface SimpleIconDefinition extends ConnectionSystemIconDefinition {
  kind: "simple";
  icon: SimpleIcon;
}

interface LucideIconDefinition extends ConnectionSystemIconDefinition {
  kind: "lucide";
  icon: LucideIcon;
}

type ConnectionSystemIconEntry =
  | CustomIconDefinition
  | SimpleIconDefinition
  | LucideIconDefinition;

const CONNECTION_SYSTEM_ICONS: Record<ConnectionSystemKind, ConnectionSystemIconEntry> = {
  alinux: { kind: "simple", icon: siAlibabacloud, label: "Alibaba Cloud Linux" },
  almalinux: { kind: "simple", icon: siAlmalinux },
  alpine: { kind: "simple", icon: siAlpinelinux },
  arch: { kind: "simple", icon: siArchlinux },
  centos: { kind: "simple", icon: siCentos },
  debian: { kind: "simple", icon: siDebian },
  fedora: { kind: "simple", icon: siFedora },
  freebsd: { kind: "simple", icon: siFreebsd },
  linux: { kind: "simple", icon: siLinux },
  macos: { kind: "simple", icon: siApple, label: "macOS" },
  opensuse: { kind: "simple", icon: siOpensuse },
  rdp: { kind: "custom", label: "RDP" },
  redhat: { kind: "simple", icon: siRedhat, label: "Red Hat Enterprise Linux" },
  rocky: { kind: "simple", icon: siRockylinux },
  suse: { kind: "simple", icon: siSuse },
  ubuntu: { kind: "simple", icon: siUbuntu },
  vnc: { kind: "lucide", icon: Monitor, label: "VNC" },
};

export function ConnectionSystemLogo({
  compact = false,
  connection,
  decorative = false,
  kind,
}: ConnectionSystemLogoProps) {
  const resolvedKind = kind || (connection ? inferConnectionSystemKind(connection) : "linux");
  const definition = CONNECTION_SYSTEM_ICONS[resolvedKind];
  const label = getConnectionSystemLabel(resolvedKind);
  const style = {
    "--os-logo-color":
      definition.kind === "simple"
        ? getSystemLogoColor(definition.icon)
        : resolvedKind === "rdp"
          ? "#1793d1"
          : "var(--mx-primary)",
  } as CSSProperties;

  return (
    <span
      className={compact ? `os-logo ${resolvedKind} compact` : `os-logo ${resolvedKind}`}
      style={style}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      data-system-kind={resolvedKind}
      title={decorative ? undefined : label}
    >
      {definition.kind === "custom" ? (
        <WindowsSystemLogo ariaHidden />
      ) : definition.kind === "lucide" ? (
        <definition.icon className="ui-icon" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d={definition.icon.path} />
        </svg>
      )}
    </span>
  );
}

export function inferConnectionSystemKind(connection: ConnectionProfile): ConnectionSystemKind {
  if (connection.protocol === "rdp") {
    return "rdp";
  }
  if (connection.protocol === "vnc") {
    return "vnc";
  }

  const remoteKind = inferSystemKindFromText(
    [
      connection.remote_os_id || "",
      connection.remote_os_name || "",
      connection.remote_os_version || "",
    ].join(" "),
  );
  if (remoteKind) {
    return remoteKind;
  }

  const text = [
    connection.name,
    connection.notes || "",
    connection.group || "",
    connection.username,
    connection.host,
  ]
    .join(" ")
    .toLowerCase();

  const localKind = inferSystemKindFromText(text);
  if (localKind) {
    return localKind;
  }

  if (connection.id === "demo-dev-core" || connection.id === "demo-cloud-ubuntu") return "ubuntu";
  if (connection.id === "demo-test-web" || connection.id === "demo-dev-k8s") return "debian";
  if (connection.id === "demo-bastion") return "macos";
  if (connection.id === "demo-stage") return "centos";
  return "linux";
}

function inferSystemKindFromText(rawText: string): ConnectionSystemKind | null {
  const text = rawText.toLowerCase();

  if (matchesSystemText(text, [/\balibaba\b/, /\baliyun\b/, /\balinux\b/, /\banolis\b/])) {
    return "alinux";
  }
  if (matchesSystemText(text, [/\bubuntu\b/, /\bub\b/])) return "ubuntu";
  if (
    matchesSystemText(text, [
      /\bdebian\b/,
      /\braspbian\b/,
      /\barmbian\b/,
      /\borangepi\b/,
      /\borange pi\b/,
      "香橙",
    ])
  ) {
    return "debian";
  }
  if (matchesSystemText(text, [/\bmacos\b/, /\bmac\b/, /\bdarwin\b/, /\bm4-/])) return "macos";
  if (matchesSystemText(text, [/\bcentos\b/, /\bcent os\b/])) return "centos";
  if (matchesSystemText(text, [/\brocky\b/, /\brocky linux\b/])) return "rocky";
  if (matchesSystemText(text, [/\balma\b/, /\balmalinux\b/, /\balma linux\b/])) {
    return "almalinux";
  }
  if (matchesSystemText(text, [/\brhel\b/, /\bredhat\b/, /\bred hat\b/])) return "redhat";
  if (matchesSystemText(text, [/\bfedora\b/])) return "fedora";
  if (matchesSystemText(text, [/\barch\b/, /\barchlinux\b/, /\barch linux\b/])) return "arch";
  if (matchesSystemText(text, [/\balpine\b/, /\balpine linux\b/])) return "alpine";
  if (matchesSystemText(text, [/\bopensuse\b/, /\bopen suse\b/])) return "opensuse";
  if (matchesSystemText(text, [/\bsuse\b/])) return "suse";
  if (matchesSystemText(text, [/\bfreebsd\b/, /\bfree bsd\b/])) return "freebsd";
  return null;
}

export function getConnectionSystemLabel(kind: ConnectionSystemKind) {
  const definition = CONNECTION_SYSTEM_ICONS[kind];
  if (definition.label) {
    return definition.label;
  }

  if (definition.kind === "simple") {
    return definition.icon.title;
  }

  return kind.toUpperCase();
}

function getSystemLogoColor(icon: SimpleIcon) {
  if (!icon.hex || icon.hex === "000000" || icon.hex === "FFFFFF") {
    return "var(--mx-text)";
  }

  return `#${icon.hex}`;
}

function matchesSystemText(text: string, patterns: Array<RegExp | string>) {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text),
  );
}

function WindowsSystemLogo({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden={ariaHidden}>
      <rect x="2.05" y="2.05" width="8.95" height="8.95" rx="0.88" fill="currentColor" opacity="0.92" />
      <rect x="13" y="2.05" width="8.95" height="8.95" rx="0.88" fill="currentColor" opacity="0.92" />
      <rect x="2.05" y="13" width="8.95" height="8.95" rx="0.88" fill="currentColor" opacity="0.92" />
      <rect x="13" y="13" width="8.95" height="8.95" rx="0.88" fill="currentColor" opacity="0.92" />
    </svg>
  );
}
