import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CraftDockDB } from "../db/database";
import { eventBus } from "../utils/eventBus";
import { downloadFile } from "../utils/http";
import { extractZipArchive } from "../utils/zip";

const inFlightDownloads = new Map<number, Promise<string>>();

export function getJavaExecutablePath(runtimesDir: string, javaMajor: number): string {
  return path.join(runtimesDir, `jre-${javaMajor}`, "bin", "java.exe");
}

export async function ensureJavaRuntime(
  db: CraftDockDB,
  javaMajor: number
): Promise<string> {
  const exePath = getJavaExecutablePath(db.paths.runtimesDir, javaMajor);
  if (fs.existsSync(exePath)) {
    return exePath;
  }

  const existing = inFlightDownloads.get(javaMajor);
  if (existing) return existing;

  const task = downloadAndInstallJava(db, javaMajor).finally(() => {
    inFlightDownloads.delete(javaMajor);
  });
  inFlightDownloads.set(javaMajor, task);
  return task;
}

async function downloadAndInstallJava(
  db: CraftDockDB,
  javaMajor: number
): Promise<string> {
  const taskId = `java-${javaMajor}-${crypto.randomUUID().slice(0, 6)}`;
  const targetDir = path.join(db.paths.runtimesDir, `jre-${javaMajor}`);
  const tempZip = path.join(db.paths.tmpDir, `temurin-jre-${javaMajor}-${Date.now()}.zip`);

  // Adoptium API v3 official Windows x64 JRE (with JDK fallback for newer majors if JRE isn't published yet)
  const jreUrl = `https://api.adoptium.net/v3/binary/latest/${javaMajor}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  const jdkUrl = `https://api.adoptium.net/v3/binary/latest/${javaMajor}/ga/windows/x64/jdk/hotspot/normal/eclipse`;

  eventBus.emitProgress({
    taskId,
    scope: "runtime",
    title: `Instalando Java ${javaMajor} (Adoptium Temurin)`,
    detail: "Conectando con los servidores oficiales de Eclipse Adoptium...",
    percent: 2,
    status: "running",
  });

  try {
    try {
      await downloadFile({
        url: jreUrl,
        destPath: tempZip,
        onProgress: (downloaded, total, percent) => {
          const mb = (downloaded / (1024 * 1024)).toFixed(1);
          const totalMb = total > 0 ? ` / ${(total / (1024 * 1024)).toFixed(1)} MB` : " MB";
          eventBus.emitProgress({
            taskId,
            scope: "runtime",
            title: `Descargando Java ${javaMajor} portable`,
            detail: `${mb}${totalMb}`,
            percent: Math.min(82, Math.round(percent * 0.82)),
            status: "running",
          });
        },
      });
    } catch {
      await downloadFile({
        url: jdkUrl,
        destPath: tempZip,
        onProgress: (downloaded, total, percent) => {
          const mb = (downloaded / (1024 * 1024)).toFixed(1);
          const totalMb = total > 0 ? ` / ${(total / (1024 * 1024)).toFixed(1)} MB` : " MB";
          eventBus.emitProgress({
            taskId,
            scope: "runtime",
            title: `Descargando Java ${javaMajor} (JDK portable)`,
            detail: `${mb}${totalMb}`,
            percent: Math.min(82, Math.round(percent * 0.82)),
            status: "running",
          });
        },
      });
    }

    eventBus.emitProgress({
      taskId,
      scope: "runtime",
      title: `Extrayendo Java ${javaMajor}`,
      detail: "Descomprimiendo archivos en CraftDock/runtimes...",
      percent: 88,
      status: "running",
    });

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    await extractZipArchive(tempZip, targetDir, { stripTopLevelDir: true });

    const exePath = getJavaExecutablePath(db.paths.runtimesDir, javaMajor);
    if (!fs.existsSync(exePath)) {
      throw new Error(`No se encontró bin/java.exe tras extraer Java ${javaMajor}.`);
    }

    eventBus.emitProgress({
      taskId,
      scope: "runtime",
      title: `Java ${javaMajor} listo`,
      detail: "Instalado correctamente en la carpeta de CraftDock.",
      percent: 100,
      status: "done",
    });

    return exePath;
  } catch (err: any) {
    eventBus.emitProgress({
      taskId,
      scope: "runtime",
      title: `Error instalando Java ${javaMajor}`,
      detail: err?.message || "No se pudo descargar Java.",
      percent: 0,
      status: "error",
    });
    throw err;
  } finally {
    if (fs.existsSync(tempZip)) {
      fs.rmSync(tempZip, { force: true });
    }
  }
}
