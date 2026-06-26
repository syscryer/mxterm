import {
  AppWindow,
  Cable,
  Command,
  MonitorCog,
  Terminal,
  TerminalSquare,
} from "lucide-react";
import {
  siGitforwindows,
  siGnubash,
  siLinux,
  siZsh,
  type SimpleIcon,
} from "simple-icons";

import type { LocalTerminalProfile, LocalTerminalProfileKind } from "./localTerminalTypes";

interface LocalTerminalIconProps {
  className?: string;
  kind?: string | null;
  title?: string;
}

const simpleIconByKind: Partial<Record<LocalTerminalProfileKind | string, SimpleIcon>> = {
  bash: siGnubash,
  git_bash: siGitforwindows,
  wsl: siLinux,
  zsh: siZsh,
};

export function LocalTerminalIcon({
  className,
  kind,
  title,
}: LocalTerminalIconProps) {
  const icon = kind ? simpleIconByKind[kind] : undefined;
  if (icon) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        aria-hidden="true"
        role="img"
      >
        <title>{title || kind}</title>
        <path fill={`#${icon.hex}`} d={icon.path} />
      </svg>
    );
  }

  if (kind === "cmd") {
    return <Command className={className} aria-hidden="true" />;
  }

  if (kind === "powershell" || kind === "powershell_core" || kind === "pwsh") {
    return <MonitorCog className={className} aria-hidden="true" />;
  }

  if (kind === "telnet") {
    return <TerminalSquare className={className} aria-hidden="true" />;
  }

  if (kind === "serial") {
    return <Cable className={className} aria-hidden="true" />;
  }

  return <Terminal className={className} aria-hidden="true" />;
}

export function LocalTerminalWorkspaceIcon({ className }: { className?: string }) {
  return <AppWindow className={className} aria-hidden="true" />;
}

export function localTerminalTitle(profile: Pick<LocalTerminalProfile, "name">, index: number) {
  return index <= 1 ? profile.name : `${profile.name} ${index.toString()}`;
}
