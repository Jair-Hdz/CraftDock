import fs from "node:fs";
import path from "node:path";
import type { FileEntry } from "../../shared/types";
import { resolveSafeChildPath, sanitizeFileName } from "../utils/paths";

const EDITABLE_EXTENSIONS = new Set([
  ".txt",
  ".properties",
  ".yml",
  ".yaml",
  ".json",
  ".toml",
  ".cfg",
  ".conf",
  ".ini",
  ".log",
  ".mcfunction",
  ".mcmeta",
  ".md",
  ".xml",
  ".csv",
  ".sh",
  ".bat",
  ".ps1",
]);

const MAX_EDITABLE_BYTES = 5 * 1024 * 1024; // 5 MB

export function isTextEditableFile(fileName: string, sizeBytes: number): boolean {
  if (sizeBytes > MAX_EDITABLE_BYTES) return false;
  const ext = path.extname(fileName).toLowerCase();
  if (EDITABLE_EXTENSIONS.has(ext)) return true;
  if (fileName === "eula.txt" || fileName === "banned-ips.json") return true;
  return false;
}

export function listServerFiles(serverRoot: string, relativeDir = ""): FileEntry[] {
  const targetDir = resolveSafeChildPath(serverRoot, relativeDir);
  if (!fs.existsSync(targetDir)) {
    throw new Error("Carpeta no encontrada.");
  }
  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    throw new Error("La ruta indicada no es una carpeta.");
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const result: FileEntry[] = [];

  for (const entry of entries) {
    const full = path.join(targetDir, entry.name);
    let fstat: fs.Stats;
    try {
      fstat = fs.statSync(full);
    } catch {
      continue;
    }

    const rel = path.relative(path.resolve(serverRoot), full).replace(/\\/g, "/");
    result.push({
      name: entry.name,
      relativePath: rel,
      isDirectory: entry.isDirectory(),
      sizeBytes: entry.isDirectory() ? 0 : fstat.size,
      modifiedAt: fstat.mtime.toISOString(),
      editable: !entry.isDirectory() && isTextEditableFile(entry.name, fstat.size),
    });
  }

  // Folders first, then alphabetical
  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });

  return result;
}

export function readServerTextFile(
  serverRoot: string,
  relativePath: string
): { content: string; sizeBytes: number; name: string } {
  const fullPath = resolveSafeChildPath(serverRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error("Archivo no encontrado.");
  }
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    throw new Error("No se puede abrir una carpeta en el editor de texto.");
  }
  if (stat.size > MAX_EDITABLE_BYTES) {
    throw new Error("El archivo supera los 5 MB; descárgalo para revisarlo localmente.");
  }

  const buf = fs.readFileSync(fullPath);
  // Quick binary check (NUL byte in first 4KB)
  const sampleLen = Math.min(buf.length, 4096);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) {
      throw new Error("Este archivo es binario y no puede editarse como texto.");
    }
  }

  return {
    content: buf.toString("utf-8"),
    sizeBytes: stat.size,
    name: path.basename(fullPath),
  };
}

export function writeServerTextFile(
  serverRoot: string,
  relativePath: string,
  content: string
): void {
  const fullPath = resolveSafeChildPath(serverRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

export function createServerEntry(
  serverRoot: string,
  parentRelativeDir: string,
  name: string,
  type: "file" | "folder"
): string {
  const safeName = sanitizeFileName(name);
  const relPath = parentRelativeDir ? `${parentRelativeDir}/${safeName}` : safeName;
  const fullPath = resolveSafeChildPath(serverRoot, relPath);

  if (fs.existsSync(fullPath)) {
    throw new Error(`Ya existe "${safeName}" en esta carpeta.`);
  }

  if (type === "folder") {
    fs.mkdirSync(fullPath, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "", "utf-8");
  }

  return path.relative(path.resolve(serverRoot), fullPath).replace(/\\/g, "/");
}

export function renameServerEntry(
  serverRoot: string,
  relativePath: string,
  newName: string
): string {
  const oldFull = resolveSafeChildPath(serverRoot, relativePath);
  if (!fs.existsSync(oldFull)) {
    throw new Error("El archivo o carpeta no existe.");
  }
  const safeName = sanitizeFileName(newName);
  const parentDir = path.dirname(oldFull);
  const nextRel = path
    .relative(path.resolve(serverRoot), path.join(parentDir, safeName))
    .replace(/\\/g, "/");
  const newFull = resolveSafeChildPath(serverRoot, nextRel);

  if (fs.existsSync(newFull)) {
    throw new Error(`Ya existe un elemento llamado "${safeName}".`);
  }

  fs.renameSync(oldFull, newFull);
  return nextRel;
}

export function deleteServerEntry(serverRoot: string, relativePath: string): void {
  if (!relativePath || relativePath === "." || relativePath === "/") {
    throw new Error("No se puede eliminar la carpeta raíz del servidor.");
  }
  const fullPath = resolveSafeChildPath(serverRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error("Elemento no encontrado.");
  }
  fs.rmSync(fullPath, { recursive: true, force: true });
}

export function saveUploadedServerFile(
  serverRoot: string,
  targetRelativeDir: string,
  fileName: string,
  bytes: Uint8Array
): string {
  const safeName = sanitizeFileName(fileName);
  const relPath = targetRelativeDir ? `${targetRelativeDir}/${safeName}` : safeName;
  const fullPath = resolveSafeChildPath(serverRoot, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, bytes);
  return path.relative(path.resolve(serverRoot), fullPath).replace(/\\/g, "/");
}
