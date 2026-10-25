// The debug info the settings window's About section shows, and `GET /api/v2/pear`:
// app, OS, CPU, GPU and memory use.

import os from "node:os";
import { app } from "electron";
import type { AppDebugInfo } from "@pear/sdk/protocol";
import { buildLabel, copyright } from "./app-info.ts";

/** Subset of chromium's GPUInfo that the debug info cares about. */
interface GpuInfo {
  auxAttributes?: {
    driverVersion?: string;
    glRenderer?: string;
    glVendor?: string;
    softwareRendering?: boolean;
  };
  gpuDevice?: {
    active?: boolean;
    deviceId?: number;
    deviceString?: string;
    driverVendor?: string;
    driverVersion?: string;
    vendorId?: number;
    vendorString?: string;
  }[];
}

/** Vendor ids, for when chromium has no name for the card. */
const GPU_VENDORS: Record<number, string> = {
  0x1002: "AMD",
  0x1022: "AMD",
  0x106b: "Apple",
  0x10de: "NVIDIA",
  0x13b5: "ARM",
  0x5143: "Qualcomm",
  0x8086: "Intel",
};

/**
 * A readable GPU name: `complete` gives chromium's renderer string (what
 * chrome://gpu shows), the bus ids are the fallback when it does not.
 */
function describeGpu(info: GpuInfo) {
  const devices = info.gpuDevice ?? [];
  const device = devices.find((entry) => entry.active) ?? devices[0];

  const named = [device?.vendorString, device?.deviceString].filter(Boolean).join(" ");
  const ids = [GPU_VENDORS[device?.vendorId ?? 0] ?? "GPU", device?.deviceId ? `0x${device.deviceId.toString(16)}` : ""]
    .filter(Boolean)
    .join(" ");
  const renderer =
    info.auxAttributes?.glRenderer ||
    named ||
    (device ? ids : "") ||
    (info.auxAttributes?.softwareRendering ? "software rendering" : undefined);
  const vendor = info.auxAttributes?.glVendor ?? device?.driverVendor;
  const driver = device?.driverVersion || info.auxAttributes?.driverVersion;

  return {
    ...(renderer ? { renderer } : {}),
    ...(vendor ? { vendor } : {}),
    ...(driver ? { driver } : {}),
  };
}

/** The debug info the About section shows: app, OS, CPU, GPU and memory use. */
export type AppMeta = AppDebugInfo;

/** Reads the debug info. Shared by the settings window and the API server. */
export async function getAppMeta(): Promise<AppMeta> {
  const metrics = app.getAppMetrics();
  const workingSet = (type: string) =>
    metrics.filter((metric) => metric.type === type).reduce((total, metric) => total + metric.memory.workingSetSize, 0);

  // Kilobytes, as Electron reports them. Browser is the app's own node process;
  // whatever is left is the chromium renderers, whatever Electron calls them.
  const main = workingSet("Browser") || Math.round(process.memoryUsage().rss / 1024);
  const renderers = metrics
    .filter((metric) => metric.type !== "Browser" && metric.type !== "GPU")
    .reduce((total, metric) => total + metric.memory.workingSetSize, 0);

  const cpus = os.cpus();

  let gpu: GpuInfo = {};
  try {
    // Rejects when the GPU is entirely disabled; the feature status still says
    // whether that is the case.
    gpu = (await app.getGPUInfo("complete")) as GpuInfo;
  } catch {}

  return {
    name: app.getName(),
    version: app.getVersion(),
    build: buildLabel(),
    copyright,
    platform: process.platform,
    arch: process.arch,
    osVersion: `${os.type()} ${os.release()}`,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    cpu: {
      model: cpus[0]?.model.trim() ?? "unknown",
      threads: cpus.length,
    },
    gpu: {
      ...describeGpu(gpu),
      features: { ...app.getGPUFeatureStatus() } as Record<string, string>,
    },
    memory: { main, renderers, gpu: workingSet("GPU") },
  };
}
