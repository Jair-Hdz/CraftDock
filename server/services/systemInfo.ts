import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { RamZone, SystemInfo } from "../../shared/types";
import type { CraftDockDB } from "../db/database";

export const SUPPORTED_JAVA_MAJORS = [8, 17, 21, 25] as const;

/**
 * Determines required Adoptium Java major version for a given Minecraft Java version.
 * Supports classic 1.x versions AND 2026+ year-based versions (26.1+ -> Java 25).
 */
export function getRequiredJavaMajor(mcVersion: string): number {
  const clean = mcVersion.trim();
  const match = clean.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return 21;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);

  // 2026+ year-based versioning (26.1, 26.2, 26.3...) requires Java 25
  if (major >= 26) return 25;

  if (major === 1) {
    if (minor <= 16) return 8;
    if (minor <= 19) return 17;
    if (minor === 20) {
      return patch >= 5 ? 21 : 17;
    }
    return 21; // 1.21.x
  }

  return 21;
}

export function evaluateRamZone(
  selectedRamMb: number,
  totalRamMb: number
): { zone: RamZone; label: string; recommendedMaxMb: number; yellowMaxMb: number } {
  // Keep at least 3GB free for Windows + Minecraft client on typical gamer PCs
  const reserveFreeMb = Math.min(3072, Math.floor(totalRamMb * 0.35));
  const recommendedMaxMb = Math.max(
    1024,
    Math.min(Math.floor(totalRamMb * 0.5), totalRamMb - reserveFreeMb)
  );
  const yellowMaxMb = Math.max(
    recommendedMaxMb + 512,
    Math.floor(totalRamMb * 0.72)
  );

  if (selectedRamMb <= recommendedMaxMb) {
    return {
      zone: "green",
      label: "Zona segura para tu PC",
      recommendedMaxMb,
      yellowMaxMb,
    };
  }
  if (selectedRamMb <= yellowMaxMb) {
    return {
      zone: "yellow",
      label: "Zona justa (cierra programas pesados al jugar)",
      recommendedMaxMb,
      yellowMaxMb,
    };
  }
  return {
    zone: "red",
    label: "Demasiada RAM: podría trabar Windows o tu juego",
    recommendedMaxMb,
    yellowMaxMb,
  };
}

export function detectLanIp(): string {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const addr of entries) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}

export function getInstalledJavaVersions(runtimesDir: string): number[] {
  const installed: number[] = [];
  for (const major of SUPPORTED_JAVA_MAJORS) {
    const javaExe = path.join(runtimesDir, `jre-${major}`, "bin", "java.exe");
    if (fs.existsSync(javaExe)) {
      installed.push(major);
    }
  }
  return installed;
}

export function getSystemInfo(db: CraftDockDB): SystemInfo {
  const totalRamMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeRamMb = Math.round(os.freemem() / (1024 * 1024));
  const evalRam = evaluateRamZone(2048, totalRamMb);
  const cpus = os.cpus();

  return {
    totalRamMb,
    freeRamMb,
    recommendedMaxRamMb: evalRam.recommendedMaxMb,
    yellowMaxRamMb: evalRam.yellowMaxMb,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model?.trim() || "CPU Windows",
    lanIp: detectLanIp(),
    dataDir: db.paths.root,
    installedJavaVersions: getInstalledJavaVersions(db.paths.runtimesDir),
    platform: `${os.platform()} ${os.release()}`,
  };
}

export async function isTcpPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, "0.0.0.0");
  });
}

export async function findFreePort(
  db: CraftDockDB,
  preferredStart: number,
  isUdp = false
): Promise<number> {
  const usedPorts = new Set<number>();
  for (const srv of db.listServers()) {
    usedPorts.add(srv.port);
    if (srv.bedrockPort) usedPorts.add(srv.bedrockPort);
  }

  for (let p = preferredStart; p < preferredStart + 200; p++) {
    if (usedPorts.has(p)) continue;
    if (isUdp) return p;
    if (await isTcpPortAvailable(p)) return p;
  }
  return preferredStart;
}
