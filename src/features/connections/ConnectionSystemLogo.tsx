import type { CSSProperties } from "react";
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
  | "linux";

interface ConnectionSystemLogoProps {
  compact?: boolean;
  connection?: ConnectionProfile;
  decorative?: boolean;
  kind?: ConnectionSystemKind;
}

interface ConnectionSystemIconDefinition {
  icon: SimpleIcon;
  label?: string;
}

const CONNECTION_SYSTEM_ICONS: Record<ConnectionSystemKind, ConnectionSystemIconDefinition> = {
  alinux: { icon: siAlibabacloud, label: "Alibaba Cloud Linux" },
  almalinux: { icon: siAlmalinux },
  alpine: { icon: siAlpinelinux },
  arch: { icon: siArchlinux },
  centos: { icon: siCentos },
  debian: { icon: siDebian },
  fedora: { icon: siFedora },
  freebsd: { icon: siFreebsd },
  linux: { icon: siLinux },
  macos: { icon: siApple, label: "macOS" },
  opensuse: { icon: siOpensuse },
  redhat: { icon: siRedhat, label: "Red Hat Enterprise Linux" },
  rocky: { icon: siRockylinux },
  suse: { icon: siSuse },
  ubuntu: { icon: siUbuntu },
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
    "--os-logo-color": getSystemLogoColor(definition.icon),
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
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d={definition.icon.path} />
      </svg>
    </span>
  );
}

export function inferConnectionSystemKind(connection: ConnectionProfile): ConnectionSystemKind {
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
  return definition.label || definition.icon.title;
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
