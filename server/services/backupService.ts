import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BackupRecord, ServerRecord } from "../../shared/types";
import type { CraftDockDB } from "../db/database";
import { eventBus } from "../utils/eventBus";
import { sanitizeFileName } from "../utils/paths";
import { createZipArchive, extractZipArchive, isZipMagicBytes } from "../utils/zip";
import { readServerProperties } from "./propertiesService";

export function getWorldFolders(serverDir: string, server: ServerRecord): string[] {
  const props = readServerProperties(serverDir, server.engine, server.port, server.name);
  if (server.engine === "bedrock") {
    const worldsRoot = path.join(serverDir, "worlds");
    if (fs.existsSync(worldsRoot)) {
      return ["worlds"];
    }
    return [];
  }

  const base = props.levelName || "world";
  const candidates = [base, `${base}_nether`, `${base}_the_end`];
  return candidates.filter((name) => fs.existsSync(path.join(serverDir, name)));
}

export async function createServerBackup(
  db: CraftDockDB,
  server: ServerRecord,
  options: {
    label?: string;
    kind: BackupRecord["kind"];
    isRunning?: boolean;
    sendConsoleCommand?: (cmd: string) => void;
  }
): Promise<BackupRecord> {
  const serverDir = path.join(db.paths.serversDir, server.id);
  const backupFolder = path.join(db.paths.backupsDir, server.id);
  fs.mkdirSync(backupFolder, { recursive: true });

  const taskId = `backup-${server.id}-${crypto.randomUUID().slice(0, 6)}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const label = options.label?.trim() || (options.kind === "pre-change" ? "Auto-backup antes de cambio" : options.kind === "scheduled" ? "Respaldo automático" : "Respaldo manual");
  const fileName = `${stamp}_${options.kind}_${sanitizeFileName(label).slice(0, 32)}.zip`;
  const destZip = path.join(backupFolder, fileName);

  eventBus.emitProgress({
    taskId,
    scope: "backup",
    title: `Creando respaldo de ${server.name}`,
    detail: "Preparando archivos del mundo...",
    percent: 15,
    status: "running",
  });

  try {
    if (options.isRunning && options.sendConsoleCommand && server.engine !== "bedrock") {
      options.sendConsoleCommand("save-off");
      options.sendConsoleCommand("save-all flush");
      await Bun.sleep(1500);
    }

    const worldFolders = getWorldFolders(serverDir, server);
    const entries: Array<{ sourcePath: string; archiveName: string; isDirectory: boolean }> = [];

    for (const folder of worldFolders) {
      entries.push({
        sourcePath: path.join(serverDir, folder),
        archiveName: folder,
        isDirectory: true,
      });
    }

    // Always include server.properties & player lists if present so restores are complete
    for (const cfg of [
      "server.properties",
      "ops.json",
      "whitelist.json",
      "banned-players.json",
      "permissions.json",
      "allowlist.json",
    ]) {
      const full = path.join(serverDir, cfg);
      if (fs.existsSync(full)) {
        entries.push({ sourcePath: full, archiveName: cfg, isDirectory: false });
      }
    }

    eventBus.emitProgress({
      taskId,
      scope: "backup",
      title: `Comprimiendo ${server.name}`,
      detail: `${entries.length} elemento(s) incluidos...`,
      percent: 55,
      status: "running",
    });

    const sizeBytes = await createZipArchive(destZip, entries);

    const record: BackupRecord = {
      id: crypto.randomUUID(),
      serverId: server.id,
      label,
      kind: options.kind,
      fileName,
      sizeBytes,
      createdAt: new Date().toISOString(),
    };
    db.insertBackup(record);

    // Enforce retention policy for scheduled/pre-change backups so disk doesn't fill up
    enforceBackupRetention(db, server);

    eventBus.emitProgress({
      taskId,
      scope: "backup",
      title: `Respaldo completado`,
      detail: `${fileName} (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB)`,
      percent: 100,
      status: "done",
    });

    return record;
  } catch (err: any) {
    eventBus.emitProgress({
      taskId,
      scope: "backup",
      title: "Error al crear respaldo",
      detail: err?.message || "Fallo inesperado",
      percent: 0,
      status: "error",
    });
    throw err;
  } finally {
    if (options.isRunning && options.sendConsoleCommand && server.engine !== "bedrock") {
      options.sendConsoleCommand("save-on");
    }
  }
}

export function enforceBackupRetention(db: CraftDockDB, server: ServerRecord): void {
  const limit = Math.max(1, server.backupRetentionCount || 5);
  const autoBackups = db
    .listBackups(server.id)
    .filter((b) => b.kind === "scheduled" || b.kind === "pre-change");

  if (autoBackups.length <= limit) return;

  const toDelete = autoBackups.slice(limit);
  for (const old of toDelete) {
    const zipPath = path.join(db.paths.backupsDir, server.id, old.fileName);
    if (fs.existsSync(zipPath)) {
      fs.rmSync(zipPath, { force: true });
    }
    db.deleteBackup(old.id);
  }
}

export async function restoreServerBackup(
  db: CraftDockDB,
  server: ServerRecord,
  backupId: string
): Promise<void> {
  const backup = db.getBackup(backupId);
  if (!backup || backup.serverId !== server.id) {
    throw new Error("Respaldo no encontrado.");
  }

  const zipPath = path.join(db.paths.backupsDir, server.id, backup.fileName);
  if (!fs.existsSync(zipPath)) {
    throw new Error("El archivo .zip del respaldo ya no existe en disco.");
  }

  const serverDir = path.join(db.paths.serversDir, server.id);

  // Safety anti-disaster backup right before restoring!
  const worldFolders = getWorldFolders(serverDir, server);
  if (worldFolders.length > 0) {
    await createServerBackup(db, server, {
      label: `Previo a restaurar ${backup.label}`,
      kind: "pre-change",
    });
  }

  // Clear old world folders before extracting restored backup
  for (const folder of worldFolders) {
    fs.rmSync(path.join(serverDir, folder), { recursive: true, force: true });
  }

  await extractZipArchive(zipPath, serverDir);
}

export function deleteServerBackup(db: CraftDockDB, serverId: string, backupId: string): void {
  const backup = db.getBackup(backupId);
  if (!backup || backup.serverId !== serverId) {
    throw new Error("Respaldo no encontrado.");
  }
  const zipPath = path.join(db.paths.backupsDir, serverId, backup.fileName);
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }
  db.deleteBackup(backupId);
}

export async function importWorldZip(
  db: CraftDockDB,
  server: ServerRecord,
  zipBytes: Uint8Array
): Promise<{ worldName: string }> {
  if (!isZipMagicBytes(zipBytes)) {
    throw new Error("El archivo subido no es un .zip válido.");
  }

  const serverDir = path.join(db.paths.serversDir, server.id);
  const props = readServerProperties(serverDir, server.engine, server.port, server.name);
  const targetWorldName = props.levelName || (server.engine === "bedrock" ? "Bedrock level" : "world");

  const tempZip = path.join(db.paths.tmpDir, `import-world-${Date.now()}.zip`);
  const tempExtract = path.join(db.paths.tmpDir, `extract-world-${Date.now()}`);
  fs.writeFileSync(tempZip, zipBytes);

  try {
    await extractZipArchive(tempZip, tempExtract);

    // Find folder containing level.dat (either root of zip or one subdirectory deep)
    let sourceWorldDir: string | null = null;
    if (fs.existsSync(path.join(tempExtract, "level.dat"))) {
      sourceWorldDir = tempExtract;
    } else {
      for (const entry of fs.readdirSync(tempExtract, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(tempExtract, entry.name, "level.dat"))) {
          sourceWorldDir = path.join(tempExtract, entry.name);
          break;
        }
      }
    }

    if (!sourceWorldDir) {
      throw new Error(
        "El archivo .zip no contiene un mundo de Minecraft válido (no se encontró level.dat)."
      );
    }

    // Create safety backup if a world already exists
    if (getWorldFolders(serverDir, server).length > 0) {
      await createServerBackup(db, server, {
        label: "Previo a importar mundo",
        kind: "pre-change",
      });
    }

    const destWorldDir =
      server.engine === "bedrock"
        ? path.join(serverDir, "worlds", targetWorldName)
        : path.join(serverDir, targetWorldName);

    if (fs.existsSync(destWorldDir)) {
      fs.rmSync(destWorldDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(destWorldDir), { recursive: true });
    fs.cpSync(sourceWorldDir, destWorldDir, { recursive: true });

    return { worldName: targetWorldName };
  } finally {
    fs.rmSync(tempZip, { force: true });
    fs.rmSync(tempExtract, { recursive: true, force: true });
  }
}

export async function exportWorldZip(
  db: CraftDockDB,
  server: ServerRecord
): Promise<{ zipPath: string; fileName: string }> {
  const serverDir = path.join(db.paths.serversDir, server.id);
  const folders = getWorldFolders(serverDir, server);
  if (folders.length === 0) {
    throw new Error("Este servidor aún no tiene un mundo generado. Enciéndelo una vez primero.");
  }

  const fileName = `${sanitizeFileName(server.name)}-mundo.zip`;
  const zipPath = path.join(db.paths.tmpDir, `export-${server.id}-${Date.now()}.zip`);
  await createZipArchive(
    zipPath,
    folders.map((f) => ({
      sourcePath: path.join(serverDir, f),
      archiveName: f,
      isDirectory: true,
    }))
  );
  return { zipPath, fileName };
}
