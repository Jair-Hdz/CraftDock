import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatapackItem, ModrinthSearchHit, ServerRecord } from "../../shared/types";
import { eventBus } from "../utils/eventBus";
import { downloadFile, fetchJson } from "../utils/http";
import { resolveSafeChildPath, sanitizeFileName } from "../utils/paths";
import { isZipMagicBytes } from "../utils/zip";
import { readServerProperties } from "./propertiesService";

const MODRINTH_API = "https://api.modrinth.com/v2";

export function resolveDatapacksDir(
  serverDir: string,
  server: ServerRecord
): { dir: string; worldName: string } {
  if (server.engine === "bedrock") {
    throw new Error("Los Datapacks son exclusivos de Minecraft Java.");
  }
  const props = readServerProperties(serverDir, server.engine, server.port, server.name);
  const worldName = props.levelName || "world";
  const dir = resolveSafeChildPath(serverDir, `${worldName}/datapacks`);
  return { dir, worldName };
}

export function listDatapacks(serverDir: string, server: ServerRecord): {
  datapacks: DatapackItem[];
  worldName: string;
} {
  const { dir, worldName } = resolveDatapacksDir(serverDir, server);
  fs.mkdirSync(dir, { recursive: true });

  const items: DatapackItem[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const stat = fs.statSync(full);
    const lower = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      const enabled = !lower.endsWith(".disabled");
      items.push({
        fileName: entry.name,
        enabled,
        isDirectory: true,
        sizeBytes: 0,
        modifiedAt: stat.mtime.toISOString(),
        worldName,
      });
    } else if (lower.endsWith(".zip") || lower.endsWith(".zip.disabled")) {
      items.push({
        fileName: entry.name,
        enabled: lower.endsWith(".zip"),
        isDirectory: false,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        worldName,
      });
    }
  }

  items.sort((a, b) => a.fileName.localeCompare(b.fileName, "es", { sensitivity: "base" }));
  return { datapacks: items, worldName };
}

export function uploadDatapackZip(
  serverDir: string,
  server: ServerRecord,
  fileName: string,
  bytes: Uint8Array
): DatapackItem {
  if (!fileName.toLowerCase().endsWith(".zip")) {
    throw new Error("Solo se permiten archivos .zip para Datapacks.");
  }
  if (!isZipMagicBytes(bytes)) {
    throw new Error("El archivo subido no es un .zip válido.");
  }

  const { dir, worldName } = resolveDatapacksDir(serverDir, server);
  fs.mkdirSync(dir, { recursive: true });

  const safeName = sanitizeFileName(fileName);
  const full = resolveSafeChildPath(dir, safeName);
  fs.writeFileSync(full, bytes);
  const stat = fs.statSync(full);

  return {
    fileName: safeName,
    enabled: true,
    isDirectory: false,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    worldName,
  };
}

export function toggleDatapack(
  serverDir: string,
  server: ServerRecord,
  fileName: string
): DatapackItem {
  const { dir, worldName } = resolveDatapacksDir(serverDir, server);
  const full = resolveSafeChildPath(dir, fileName);
  if (!fs.existsSync(full)) {
    throw new Error("Datapack no encontrado.");
  }

  const nextName = fileName.endsWith(".disabled")
    ? fileName.replace(/\.disabled$/i, "")
    : `${fileName}.disabled`;
  const nextFull = resolveSafeChildPath(dir, nextName);
  fs.renameSync(full, nextFull);

  const stat = fs.statSync(nextFull);
  return {
    fileName: nextName,
    enabled: !nextName.endsWith(".disabled"),
    isDirectory: stat.isDirectory(),
    sizeBytes: stat.isDirectory() ? 0 : stat.size,
    modifiedAt: stat.mtime.toISOString(),
    worldName,
  };
}

export function deleteDatapack(
  serverDir: string,
  server: ServerRecord,
  fileName: string
): void {
  const { dir } = resolveDatapacksDir(serverDir, server);
  const full = resolveSafeChildPath(dir, fileName);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
  }
}

export async function searchModrinthDatapacks(
  query: string,
  mcVersion?: string,
  limit = 20
): Promise<ModrinthSearchHit[]> {
  const facets: string[][] = [["project_type:datapack"]];
  if (mcVersion && mcVersion !== "custom") {
    facets.push([`versions:${mcVersion}`]);
  }

  const qs = new URLSearchParams({
    query: query || "",
    limit: String(limit),
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
    projectType: "datapack",
    categories: Array.isArray(hit.categories) ? hit.categories : [],
    versions: Array.isArray(hit.versions) ? hit.versions : [],
  }));
}

export async function installDatapackFromModrinth(
  serverDir: string,
  server: ServerRecord,
  projectId: string
): Promise<{ fileName: string; worldName: string }> {
  const { dir, worldName } = resolveDatapacksDir(serverDir, server);
  fs.mkdirSync(dir, { recursive: true });

  const qs = new URLSearchParams({
    loaders: JSON.stringify(["datapack"]),
  });
  if (server.mcVersion && server.mcVersion !== "custom") {
    qs.set("game_versions", JSON.stringify([server.mcVersion]));
  }

  let versions = await fetchJson<any[]>(
    `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${qs.toString()}`
  );

  // Fallback without loader filter if author tagged as mod+datapack
  if (!versions || versions.length === 0) {
    const fallbackQs = new URLSearchParams();
    if (server.mcVersion && server.mcVersion !== "custom") {
      fallbackQs.set("game_versions", JSON.stringify([server.mcVersion]));
    }
    const all = await fetchJson<any[]>(
      `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${fallbackQs.toString()}`
    );
    versions = (all || []).filter((v) =>
      v.files?.some((f: any) => String(f.filename || "").toLowerCase().endsWith(".zip"))
    );
  }

  if (!versions || versions.length === 0) {
    throw new Error(
      `No se encontró una versión .zip de este datapack compatible con Minecraft ${server.mcVersion}.`
    );
  }

  const best = versions[0];
  const file =
    best.files?.find((f: any) => f.primary && String(f.filename).toLowerCase().endsWith(".zip")) ||
    best.files?.find((f: any) => String(f.filename).toLowerCase().endsWith(".zip")) ||
    best.files?.[0];

  if (!file?.url) {
    throw new Error("El datapack seleccionado no tiene un archivo .zip descargable.");
  }

  const safeName = sanitizeFileName(file.filename);
  const destPath = resolveSafeChildPath(dir, safeName);
  const taskId = `dp-${projectId}-${crypto.randomUUID().slice(0, 6)}`;

  eventBus.emitProgress({
    taskId,
    scope: "mod",
    title: `Instalando Datapack ${safeName}`,
    detail: `Descargando desde Modrinth en ${worldName}/datapacks/...`,
    percent: 25,
    status: "running",
  });

  await downloadFile({
    url: file.url,
    destPath,
    expectedSha1: file.hashes?.sha1,
    onProgress: (_d, _t, pct) => {
      eventBus.emitProgress({
        taskId,
        scope: "mod",
        title: `Instalando Datapack ${safeName}`,
        detail: `${pct}% completado`,
        percent: pct,
        status: "running",
      });
    },
  });

  eventBus.emitProgress({
    taskId,
    scope: "mod",
    title: `Datapack ${safeName} instalado`,
    detail: `Guardado en ${worldName}/datapacks/`,
    percent: 100,
    status: "done",
  });

  return { fileName: safeName, worldName };
}
