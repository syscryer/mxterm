import { readFileSync } from "node:fs";

const dialogSource = readFileSync("src/features/connections/ConnectionDialog.tsx", "utf8");

const requiredSnippets = [
  {
    message: "ConnectionDialog should keep default protocol ports centralized.",
    snippet: "const protocolDefaultPorts",
  },
  {
    message: "ConnectionDialog should detect serial endpoint state before protocol switches.",
    snippet: "function usesSerialEndpoint",
  },
  {
    message: "ConnectionDialog protocol switch should prevent serial endpoint leakage.",
    snippet: "const serialEndpoint = usesSerialEndpoint(current);",
  },
  {
    message: "ConnectionDialog protocol switch should clear serial host when leaving serial.",
    snippet: 'host: serialEndpoint ? "" : current.host',
  },
  {
    message: "ConnectionDialog protocol switch should reset serial port when leaving serial.",
    snippet: "port: serialEndpoint",
  },
  {
    message: "ConnectionDialog should reset serial endpoint to the RDP default port.",
    snippet: "? protocolDefaultPorts.rdp",
  },
  {
    message: "ConnectionDialog should reset serial endpoint to the VNC default port.",
    snippet: "? protocolDefaultPorts.vnc",
  },
  {
    message: "ConnectionDialog should reset serial endpoint to the Telnet default port.",
    snippet: "? protocolDefaultPorts.telnet",
  },
  {
    message: "ConnectionDialog should reset serial endpoint to the SSH default port.",
    snippet: "? protocolDefaultPorts.ssh",
  },
  {
    message: "SSH host placeholder should use a local-network example.",
    snippet: 'placeholder="192.168.1.20"',
  },
];

for (const { message, snippet } of requiredSnippets) {
  if (!dialogSource.includes(snippet)) {
    throw new Error(`${message}: ${snippet}`);
  }
}

if (dialogSource.includes('placeholder="203.0.113.70"')) {
  throw new Error("SSH host placeholder should not use the public documentation address 203.0.113.70.");
}

const normalizeStart = dialogSource.indexOf("function normalizeForSubmit(");
const validateStart = dialogSource.indexOf("function validateNetworkPath(", normalizeStart);
if (normalizeStart === -1 || validateStart === -1) {
  throw new Error("ConnectionDialog should keep normalizeForSubmit before validateNetworkPath.");
}

const normalizeSource = dialogSource.slice(normalizeStart, validateStart);

const protocolIsolationChecks = [
  {
    protocol: "rdp",
    owns: ["rdp: withDefaultRdpConfig(form.rdp)"],
    clears: ["vnc: undefined", "telnet: undefined", "serial: undefined"],
  },
  {
    protocol: "vnc",
    owns: ["vnc: withDefaultVncConfig(form.vnc)"],
    clears: ["rdp: undefined", "telnet: undefined", "serial: undefined"],
  },
  {
    protocol: "telnet",
    owns: ["telnet: withDefaultTelnetConfig(form.telnet)"],
    clears: ["rdp: undefined", "vnc: undefined", "serial: undefined"],
  },
  {
    protocol: "serial",
    owns: ["serial: {", "port_name: portName"],
    clears: ["rdp: undefined", "vnc: undefined", "telnet: undefined"],
  },
  {
    protocol: "ssh",
    owns: ['protocol: "ssh"'],
    clears: ["rdp: undefined", "vnc: undefined", "telnet: undefined", "serial: undefined"],
  },
];

for (const { protocol, owns, clears } of protocolIsolationChecks) {
  const protocolIndex = normalizeSource.indexOf(`protocol: "${protocol}"`);
  if (protocolIndex === -1) {
    throw new Error(`normalizeForSubmit should explicitly submit the active ${protocol} protocol.`);
  }

  const nextProtocolIndex = protocolIsolationChecks
    .filter((check) => check.protocol !== protocol)
    .map((check) => normalizeSource.indexOf(`protocol: "${check.protocol}"`, protocolIndex + 1))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  const branchSource = normalizeSource.slice(
    protocolIndex,
    nextProtocolIndex === undefined ? normalizeSource.length : nextProtocolIndex,
  );

  for (const snippet of [...owns, ...clears]) {
    if (!branchSource.includes(snippet)) {
      throw new Error(`normalizeForSubmit ${protocol} branch should isolate active-tab data: ${snippet}`);
    }
  }
}

console.log("Connection protocol submit source check passed.");
