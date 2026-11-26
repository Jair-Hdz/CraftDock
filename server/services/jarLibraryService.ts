import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  JarLibraryItem,
  RemoteVersionOption,
  ServerEngine,
} from "../../shared/types";
import type { CraftDockDB } from "../db/database";
import { eventBus } from "../utils/eventBus";
import { downloadFile, hashFileSha256 } from "../utils/http";
import { sanitizeFileName } from "../utils/paths";
import { isZipMagicBytes } from "../utils/zip";
import { listBedrockVersions, resolveBedrockDownload } from "./providers/bedrockProvider";
import { listFabricVersions, resolveFabricDownload } from "./providers/fabricProvider";
import { listForgeVersions, resolveForgeDownload } from "./providers/forgeProvider";
import { listMojangVersions, resolveMojangServerDownload } from "./providers/mojangProvider";
import { listPaperBuilds, listPaperVersions, resolvePaperDownload } from "./providers/paperProvider";
import { getRequiredJavaMajor } from "./systemInfo";

export async function listRemoteVersions(
  engine: ServerEngine,
  includeSnapshots = false
): Promise<RemoteVersionOption[]> {
  switch (engine) {
    case "vanilla":
      return listMojangVersions(includeSnapshots);
    case "paper":
      return listPaperVersions();
    case "fabric":
      return listFabricVersions(includeSnapshots);
    case "forge":
      return listForgeVersions();
    case "bedrock":
      return listBedrockVersions();
    case "custom":
      return [];
  }
}

export async function listRemoteBuilds(engine: ServerEngine, mcVersion: string): Promise<string[]> {
  if (engine === "paper") {
    const builds = await listPaperBuilds(mcVersion);
    return builds.slice(0, 25).map((b) => b.build);
  }
  if (engine === "forge") {
    const versions = await listForgeVersions();
    return versions.find((v) => v.mcVersion === mcVersion)?.builds || [];
  }
  return ["latest"];
}

export async function downloadOfficialJarToLibrary(
  db: CraftDockDB,
  engine: Exclude<ServerEngine, "custom">,
  mcVersion: string,
  requestedBuild?: string
): Promise<JarLibraryItem> {
  const taskId = `jar-${engine}-${mcVersion}-${crypto.randomUUID().slice(0, 6)}`;

  let downloadUrl = "";
  let expectedSha1: string | undefined;
  let expectedSha256: string | undefined;
  let build = requestedBuild || "latest";
  let fileName = "";
  let javaMajor: number | null = engine === "bedrock" ? null : getRequiredJavaMajor(mcVersion);
  let browserUa = false;

  eventBus.emitProgress({
    taskId,
    scope: "jar",
    title: `Preparando ${engine.toUpperCase()} ${mcVersion}`,
    detail: "Consultando repositorio oficial...",
    percent: 5,
    status: "running",
  });

  try {
    if (engine === "vanilla") {
      const info = await resolveMojangServerDownload(mcVersion);
      downloadUrl = info.url;
      expectedSha1 = info.sha1;
      build = info.build;
      javaMajor = info.javaMajor;
      fileName = `vanilla-${mcVersion}.jar`;
    } else if (engine === "paper") {
      const info = await resolvePaperDownload(mcVersion, requestedBuild);
      downloadUrl = info.url;
      expectedSha256 = info.sha256;
      build = info.build;
      javaMajor = info.javaMajor;
      fileName = sanitizeFileName(info.fileName || `paper-${mcVersion}-${build}.jar`);
    } else if (engine === "fabric") {
      const info = await resolveFabricDownload(mcVersion);
      downloadUrl = info.url;
      build = info.build;
      javaMajor = info.javaMajor;
      fileName = sanitizeFileName(info.fileName);
    } else if (engine === "forge") {
      const info = await resolveForgeDownload(mcVersion, requestedBuild);
      downloadUrl = info.url;
      build = info.build;
      javaMajor = info.javaMajor;
      fileName = sanitizeFileName(info.fileName);
    } else if (engine === "bedrock") {
      const info = await resolveBedrockDownload(mcVersion);
      downloadUrl = info.url;
      build = info.build;
      fileName = sanitizeFileName(info.fileName);
      browserUa = true;
    }

    // Reuse cached item if already downloaded on disk
    const existing = db.findJarBySpec(engine, mcVersion, build);
    if (existing && fs.existsSync(existing.localPath)) {
      eventBus.emitProgress({
        taskId,
        scope: "jar",
        title: `${existing.name} listo (desde caché local)`,
        detail: "Archivo verificado en tu Biblioteca de .jar",
        percent: 100,
        status: "done",
      });
      return existing;
    }

    const destPath = path.join(db.paths.libraryDir, engine, fileName);
    const { sizeBytes, sha256 } = await downloadFile({
      url: downloadUrl,
      destPath,
      expectedSha1,
      expectedSha256,
      browserUa,
      onProgress: (dl, total, percent) => {
        const mb = (dl / (1024 * 1024)).toFixed(1);
        const totalMb = total > 0 ? ` / ${(total / (1024 * 1024)).toFixed(1)} MB` : " MB";
        eventBus.emitProgress({
          taskId,
          scope: "jar",
          title: `Descargando ${engine.toUpperCase()} ${mcVersion}`,
          detail: `${fileName} (${mb}${totalMb})`,
          percent: Math.max(10, Math.min(98, percent)),
          status: "running",
        });
      },
    });

    const labelPrefix: Record<Exclude<ServerEngine, "custom">, string> = {
      vanilla: "Java Vanilla",
      paper: "Paper",
      fabric: "Fabric",
      forge: "Forge",
      bedrock: "Bedrock Oficial",
    };

    const item: JarLibraryItem = {
      id: existing?.id || crypto.randomUUID(),
      name: `${labelPrefix[engine]} ${mcVersion}${build && build !== "official" && build !== "win64" ? ` (#${build})` : ""}`,
      engine,
      mcVersion,
      build,
      fileName,
      localPath: destPath,
      sizeBytes,
      sha256,
      source: "official",
      javaMajor,
      createdAt: new Date().toISOString(),
    };

    db.upsertJar(item);

    eventBus.emitProgress({
      taskId,
      scope: "jar",
      title: `${item.name} guardado en Biblioteca`,
      detail: "Listo para usar en cualquier servidor.",
      percent: 100,
      status: "done",
    });

    return item;
  } catch (err: any) {
    eventBus.emitProgress({
      taskId,
      scope: "jar",
      title: `Error descargando ${engine} ${mcVersion}`,
      detail: err?.message || "Fallo de descarga",
      percent: 0,
      status: "error",
    });
    throw err;
  }
}

export async function saveCustomJarToLibrary(
  db: CraftDockDB,
  file: {
    fileName: string;
    bytes: Uint8Array;
    displayName?: string;
    mcVersion?: string;
    javaMajor?: number;
  }
): Promise<JarLibraryItem> {
  if (!file.fileName.toLowerCase().endsWith(".jar")) {
    throw new Error("Solo se permiten archivos con extensión .jar.");
  }
  if (!isZipMagicBytes(file.bytes)) {
    throw new Error("El archivo subido no tiene cabecera válida de archivo .jar/ZIP.");
  }

  const safeName = sanitizeFileName(file.fileName);
  const uniqueName = `${Date.now()}-${safeName}`;
  const destPath = path.join(db.paths.libraryDir, "custom", uniqueName);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, file.bytes);

  const sha256 = await hashFileSha256(destPath);
  const mcVersion = file.mcVersion?.trim() || "custom";

  const item: JarLibraryItem = {
    id: crypto.randomUUID(),
    name: file.displayName?.trim() || safeName.replace(/\.jar$/i, ""),
    engine: "custom",
    mcVersion,
    build: "personalizado",
    fileName: safeName,
    localPath: destPath,
    sizeBytes: file.bytes.byteLength,
    sha256,
    source: "custom",
    javaMajor: file.javaMajor || getRequiredJavaMajor(mcVersion),
    createdAt: new Date().toISOString(),
  };

  db.upsertJar(item);
  return item;
}

export function deleteJarFromLibrary(db: CraftDockDB, jarId: string): void {
  const item = db.getJar(jarId);
  if (!item) {
    throw new Error("Archivo .jar no encontrado en la biblioteca.");
  }
  const inUse = db.countServersUsingJar(jarId);
  if (inUse > 0) {
    throw new Error(
      `No se puede eliminar "${item.name}" porque está asignado a ${inUse} servidor(es). Cambia su .jar primero.`
    );
  }
  if (fs.existsSync(item.localPath)) {
    fs.rmSync(item.localPath, { force: true });
  }
  db.deleteJar(jarId);
}
