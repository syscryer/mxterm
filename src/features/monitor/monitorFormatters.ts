import type { RemoteCpuSummary } from "./monitorTypes";

const ordinaryThreadsPerCoreLimit = 2;

function positiveCount(value?: number | null) {
  return value && value > 0 ? value : null;
}

function logicalCpuCount(cpu: RemoteCpuSummary) {
  return positiveCount(cpu.logical_cores) || cpu.cores.length || null;
}

function shouldDisplayThreadOnlyTopology(cpu: RemoteCpuSummary) {
  const physical = positiveCount(cpu.physical_cores);
  const logical = logicalCpuCount(cpu);
  return !cpu.is_virtualized && physical != null && logical != null && logical > physical * ordinaryThreadsPerCoreLimit;
}

export function formatCoreShape(cpu: RemoteCpuSummary) {
  if (cpu.is_virtualized) {
    return `虚拟化 · ${formatLogicalCpuCount(cpu)}`;
  }

  if (shouldDisplayThreadOnlyTopology(cpu)) {
    return formatLogicalCpuCount(cpu);
  }

  const physical = positiveCount(cpu.physical_cores);
  const logical = logicalCpuCount(cpu);
  const physicalLabel = physical ? `${physical.toString()} 核` : "核心未获取";
  const logicalLabel = logical ? `${logical.toString()} 线程` : "线程未获取";
  const sockets = cpu.sockets || 1;
  return `${sockets.toString()} 路 · ${physicalLabel} · ${logicalLabel}`;
}

export function formatCpuTopologyBadge(cpu: RemoteCpuSummary) {
  const physical = positiveCount(cpu.physical_cores);
  const logical = logicalCpuCount(cpu);

  if (cpu.is_virtualized && logical) {
    return `${logical.toString()} vCPU`;
  }
  if (shouldDisplayThreadOnlyTopology(cpu) && logical) {
    return `${logical.toString()} 线程`;
  }
  if (physical && logical) {
    return `${physical.toString()} 核 / ${logical.toString()} 线程`;
  }
  if (physical) {
    return `${physical.toString()} 核`;
  }
  if (logical) {
    return `${logical.toString()} 线程`;
  }
  return undefined;
}

export function formatLogicalCpuCount(cpu: RemoteCpuSummary) {
  const logical = logicalCpuCount(cpu);
  if (!logical) {
    return cpu.is_virtualized ? "vCPU 未获取" : "线程未获取";
  }
  return cpu.is_virtualized ? `${logical.toString()} vCPU` : `${logical.toString()} 线程`;
}
