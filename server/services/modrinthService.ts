import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModItem, ModrinthSearchHit, ServerRecord } from "../../shared/types";
import { eventBus } from "../utils/eventBus";
import { downloadFile, fetchJson } from "../utils/http";
import { resolveSafeChildPath, sanitizeFileName } from "../utils/paths";
import { createZipArchive, extractZipArchive, isZipMagicBytes, readZipEntryText } from "../utils/zip";

const MODRINTH_API = "https://api.modrinth.com/v2";

export function getModFolderForServer(server: ServerRecord): "mods" | "plugins" | null {
  if (server.engine === "paper") return "plugins";
  if (server.engine === "fabric" || server.engine === "forge") return "mods";
  if (server.engine === "custom") return "plugins";
  return null;
}

export function listInstalledMods(serverDir: string, server: ServerRecord): ModItem[] {
  const folders: Array<"mods" | "plugins"> =
    server.engine === "custom"
      ? ["mods", "plugins"]
      : getModFolderForServer(server)
      ? [getModFolderForServer(server)!]
      : [];

  const items: ModItem[] = [];
  for (const folder of folders) {
    const dir = path.join(serverDir, folder);
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith(".jar") && !lower.endsWith(".jar.disabled")) continue;

      const stat = fs.statSync(path.join(dir, entry.name));
      const isSystem =
        folder === "plugins" &&
        (lower.startsWith("geyser-spigot") || lower.startsWith("floodgate-spigot"));

      items.push({
        fileName: entry.name,
        enabled: lower.endsWith(".jar"),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        folder,
        isSystemPlugin: isSystem,
      });
    }
  }

  items.sort((a, b) => a.fileName.localeCompare(b.fileName, "es", { sensitivity: "base" }));
  return items;
}

export function toggleInstalledMod(
  serverDir: string,
  folder: "mods" | "plugins",
  fileName: string
): ModItem {
  const full = resolveSafeChildPath(path.join(serverDir, folder), fileName);
  if (!fs.existsSync(full)) {
    throw new Error("Mod/Plugin no encontrado.");
  }

  const nextName = fileName.endsWith(".disabled")
    ? fileName.replace(/\.disabled$/i, "")
    : `${fileName}.disabled`;
  const nextFull = resolveSafeChildPath(path.join(serverDir, folder), nextName);
  fs.renameSync(full, nextFull);

  const stat = fs.statSync(nextFull);
  return {
    fileName: nextName,
    enabled: nextName.endsWith(".jar"),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    folder,
  };
}

export function deleteInstalledMod(
  serverDir: string,
  folder: "mods" | "plugins",
  fileName: string
): void {
  const full = resolveSafeChildPath(path.join(serverDir, folder), fileName);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { force: true });
  }
}

export function uploadModJar(
  serverDir: string,
  folder: "mods" | "plugins",
  fileName: string,
  bytes: Uint8Array
): ModItem {
  if (!fileName.toLowerCase().endsWith(".jar")) {
    throw new Error("Solo se permiten archivos .jar para mods y plugins.");
  }
  if (!isZipMagicBytes(bytes)) {
    throw new Error("El archivo subido no es un .jar válido.");
  }

  const safeName = sanitizeFileName(fileName);
  const destDir = path.join(serverDir, folder);
  fs.mkdirSync(destDir, { recursive: true });
  const full = resolveSafeChildPath(destDir, safeName);
  fs.writeFileSync(full, bytes);
  const stat = fs.statSync(full);

  return {
    fileName: safeName,
    enabled: true,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    folder,
  };
}

export async function searchModrinth(params: {
  query: string;
  mcVersion?: string;
  engine: ServerRecord["engine"];
  projectType?: "mod" | "plugin" | "modpack";
  limit?: number;
}): Promise<ModrinthSearchHit[]> {
  const facets: string[][] = [];

  const resolvedType =
    params.projectType ||
    (params.engine === "paper" ? "plugin" : "mod");
  facets.push([`project_type:${resolvedType}`]);

  if (params.mcVersion && params.mcVersion !== "custom") {
    facets.push([`versions:${params.mcVersion}`]);
  }

  if (resolvedType === "plugin" || params.engine === "paper") {
    facets.push(["categories:paper", "categories:spigot", "categories:bukkit"]);
  } else if (params.engine === "fabric") {
    facets.push(["categories:fabric"]);
  } else if (params.engine === "forge") {
    facets.push(["categories:forge"]);
  }

  const qs = new URLSearchParams({
    query: params.query || "",
    limit: String(params.limit || 20),
    facets: JSON.stringify(facets),
  });

  const data = await fetchJson<{ hits: any[] }>(`${MODRINTH_API}/search?${qs.toString()}`);
  return (data.hits || []).map((hit) => ({
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description || "",
    iconUrl: hit.icon_url || null,
    downloads: hit.downloads || 0,
    author: hit.author || "Desconocido",
    projectType: hit.project_type || resolvedType,
    categories: Array.isArray(hit.categories) ? hit.categories : [],
  }));
}

export async function installFromModrinth(
  serverDir: string,
  server: ServerRecord,
  projectId: string,
  visited = new Set<string>()
): Promise<{ installedFiles: string[] }> {
  if (visited.has(projectId)) return { installedFiles: [] };
  visited.add(projectId);

  const folder = getModFolderForServer(server);
  if (!folder) {
    throw new Error("Este motor de servidor no soporta mods ni plugins.");
  }

  const loaders =
    server.engine === "paper"
      ? ["paper", "spigot", "bukkit"]
      : server.engine === "fabric"
      ? ["fabric"]
      : server.engine === "forge"
      ? ["forge"]
      : [];

  const qs = new URLSearchParams();
  if (loaders.length > 0) qs.set("loaders", JSON.stringify(loaders));
  if (server.mcVersion && server.mcVersion !== "custom") {
    qs.set("game_versions", JSON.stringify([server.mcVersion]));
  }

  const versions = await fetchJson<any[]>(
    `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${qs.toString()}`
  );

  if (!versions || versions.length === 0) {
    throw new Error(
      `No se encontró una versión compatible para ${server.engine} ${server.mcVersion} en Modrinth.`
    );
  }

  const best = versions[0];
  const primaryFile =
    best.files?.find((f: any) => f.primary) || best.files?.[0];
  if (!primaryFile?.url) {
    throw new Error("El proyecto de Modrinth no contiene archivo descargable.");
  }

  const destDir = path.join(serverDir, folder);
  fs.mkdirSync(destDir, { recursive: true });
  const safeName = sanitizeFileName(primaryFile.filename);
  const destPath = path.join(destDir, safeName);

  const taskId = `mod-${projectId}-${crypto.randomUUID().slice(0, 6)}`;
  eventBus.emitProgress({
    taskId,
    scope: "mod",
    title: `Instalando ${safeName}`,
    detail: "Descargando desde Modrinth...",
    percent: 20,
    status: "running",
  });

  await downloadFile({
    url: primaryFile.url,
    destPath,
    expectedSha1: primaryFile.hashes?.sha1,
    onProgress: (_d, _t, pct) => {
      eventBus.emitProgress({
        taskId,
        scope: "mod",
        title: `Instalando ${safeName}`,
        detail: `${pct}% completado`,
        percent: pct,
        status: "running",
      });
    },
  });

  const installedFiles = [safeName];

  // Auto-install required dependencies listed by Modrinth (1 level deep)
  if (Array.isArray(best.dependencies) && visited.size < 5) {
    for (const dep of best.dependencies) {
      if (dep.dependency_type === "required" && dep.project_id && !visited.has(dep.project_id)) {
        try {
          const sub = await installFromModrinth(serverDir, server, dep.project_id, visited);
          installedFiles.push(...sub.installedFiles);
        } catch {
          // non-fatal if dependency lacks exact match
        }
      }
    }
  }

  eventBus.emitProgress({
    taskId,
    scope: "mod",
    title: `${safeName} instalado`,
    detail: `Guardado en ${folder}/`,
    percent: 100,
    status: "done",
  });

  return { installedFiles };
}

interface MrpackIndex {
  formatVersion: number;
  name: string;
  versionId?: string;
  dependencies?: Record<string, string>;
  files: Array<{
    path: string;
    hashes?: { sha1?: string; sha512?: string };
    env?: { client?: string; server?: string };
    downloads: string[];
    fileSize?: number;
  }>;
}

export async function importMrpackModpack(
  serverDir: string,
  tmpDir: string,
  mrpackBytes: Uint8Array
): Promise<{ packName: string; downloadedCount: number; skippedClientOnly: number }> {
  if (!isZipMagicBytes(mrpackBytes)) {
    throw new Error("El archivo .mrpack no es un paquete ZIP válido.");
  }

  const tempPack = path.join(tmpDir, `modpack-${Date.now()}.mrpack`);
  fs.writeFileSync(tempPack, mrpackBytes);
  const taskId = `mrpack-${crypto.randomUUID().slice(0, 6)}`;

  try {
    const indexRaw = await readZipEntryText(tempPack, "modrinth.index.json");
    if (!indexRaw) {
      throw new Error("El archivo .mrpack no contiene modrinth.index.json.");
    }

    const index = JSON.parse(indexRaw) as MrpackIndex;
    const serverFiles = (index.files || []).filter(
      (f) => f.env?.server !== "unsupported" && Array.isArray(f.downloads) && f.downloads.length > 0
    );
    const skippedClientOnly = (index.files || []).length - serverFiles.length;

    eventBus.emitProgress({
      taskId,
      scope: "mod",
      title: `Importando modpack ${index.name || "Modrinth"}`,
      detail: `Descargando ${serverFiles.length} archivos compatibles con servidor...`,
      percent: 5,
      status: "running",
    });

    let completed = 0;
    for (const file of serverFiles) {
      const target = resolveSafeChildPath(serverDir, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await downloadFile({
        url: file.downloads[0],
        destPath: target,
        expectedSha1: file.hashes?.sha1,
      });
      completed++;
      const pct = Math.min(90, Math.round((completed / Math.max(1, serverFiles.length)) * 85) + 5);
      eventBus.emitProgress({
        taskId,
        scope: "mod",
        title: `Importando ${index.name || "modpack"}`,
        detail: `${completed}/${serverFiles.length} archivos (${path.basename(file.path)})`,
        percent: pct,
        status: "running",
      });
    }

    // Extract overrides/ and server-overrides/ safely into serverDir
    for (const prefix of ["overrides/", "server-overrides/"]) {
      await extractZipArchive(tempPack, serverDir, {
        stripTopLevelDir: true,
        filter: (name) => name.startsWith(prefix),
      });
    }

    eventBus.emitProgress({
      taskId,
      scope: "mod",
      title: `Modpack ${index.name || ""} importado`,
      detail: `${completed} archivos instalados (${skippedClientOnly} solo-cliente omitidos).`,
      percent: 100,
      status: "done",
    });

    return {
      packName: index.name || "Modpack",
      downloadedCount: completed,
      skippedClientOnly,
    };
  } catch (err: any) {
    eventBus.emitProgress({
      taskId,
      scope: "mod",
      title: "Error importando .mrpack",
      detail: err?.message || "Fallo inesperado",
      percent: 0,
      status: "error",
    });
    throw err;
  } finally {
    fs.rmSync(tempPack, { force: true });
  }
}

export async function exportModsPackForFriends(
  serverDir: string,
  tmpDir: string,
  server: ServerRecord
): Promise<{ zipPath: string; fileName: string; count: number }> {
  const modsDir = path.join(serverDir, "mods");
  const activeJars = fs.existsSync(modsDir)
    ? fs
        .readdirSync(modsDir)
        .filter((f) => f.toLowerCase().endsWith(".jar"))
    : [];

  if (activeJars.length === 0) {
    throw new Error("No hay mods activos (.jar) en la carpeta mods/ para exportar.");
  }

  const readme = [
    `=== Pack de Mods para "${server.name}" ===`,
    "",
    `Versión de Minecraft: ${server.mcVersion}`,
    `Motor de Mods requerido: ${server.engine.toUpperCase()}`,
    `Cantidad de mods incluidos: ${activeJars.length}`,
    server.tunnelAddress ? `IP del Servidor: ${server.tunnelAddress}` : "",
    "",
    "¿Cómo instalar estos mods para poder entrar?",
    `1. Instala Minecraft ${server.mcVersion} con ${server.engine.toUpperCase()} (recomendado: Modrinth App, Prism Launcher o el instalador oficial).`,
    "2. Abre la carpeta 'mods' de tu perfil de Minecraft.",
    "3. Copia TODOS los archivos .jar de la carpeta 'mods/' de este ZIP dentro de tu carpeta 'mods'.",
    "4. Abre Minecraft y conéctate al servidor.",
    "",
    "Empaquetado automáticamente por CraftDock.",
  ]
    .filter(Boolean)
    .join("\r\n");

  const fileName = `${sanitizeFileName(server.name)}-mods-${server.mcVersion}.zip`;
  const zipPath = path.join(tmpDir, `mods-pack-${server.id}-${Date.now()}.zip`);

  await createZipArchive(
    zipPath,
    activeJars.map((jar) => ({
      sourcePath: path.join(modsDir, jar),
      archiveName: `mods/${jar}`,
      isDirectory: false,
    })),
    [{ name: "LEEME_AMIGOS.txt", content: readme }]
  );

  return { zipPath, fileName, count: activeJars.length };
}
