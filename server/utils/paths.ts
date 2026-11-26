import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getDefaultDataDir(): string {
  if (process.env.CRAFTDOCK_DATA_DIR) {
    return path.resolve(process.env.CRAFTDOCK_DATA_DIR);
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    return path.join(localAppData, "CraftDock");
  }
  return path.join(os.homedir(), ".craftdock");
}

export interface DataPaths {
  root: string;
  dbPath: string;
  binDir: string;
  playitDir: string;
  runtimesDir: string;
  libraryDir: string;
  serversDir: string;
  backupsDir: string;
  tmpDir: string;
}

export function resolveDataPaths(rootDir?: string): DataPaths {
  const root = path.resolve(rootDir || getDefaultDataDir());
  return {
    root,
    dbPath: path.join(root, "craftdock.db"),
    binDir: path.join(root, "bin"),
    playitDir: path.join(root, "playit"),
    runtimesDir: path.join(root, "runtimes"),
    libraryDir: path.join(root, "library"),
    serversDir: path.join(root, "servers"),
    backupsDir: path.join(root, "backups"),
    tmpDir: path.join(root, "tmp"),
  };
}

export function ensureDataDirectories(paths: DataPaths): void {
  const dirs = [
    paths.root,
    paths.binDir,
    paths.playitDir,
    paths.runtimesDir,
    paths.libraryDir,
    path.join(paths.libraryDir, "vanilla"),
    path.join(paths.libraryDir, "paper"),
    path.join(paths.libraryDir, "fabric"),
    path.join(paths.libraryDir, "forge"),
    path.join(paths.libraryDir, "bedrock"),
    path.join(paths.libraryDir, "custom"),
    paths.serversDir,
    paths.backupsDir,
    paths.tmpDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Resolves a relative user path inside a root directory and guarantees no traversal escapes `rootDir`.
 */
export function resolveSafeChildPath(rootDir: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const cleaned = (relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (path.isAbsolute(relativePath) && !relativePath.startsWith("/")) {
    throw new Error("Ruta inválida: no se permiten rutas absolutas.");
  }
  if (/^[a-zA-Z]:/.test(cleaned)) {
    throw new Error("Ruta inválida: no se permiten unidades de disco.");
  }

  const candidate = path.resolve(normalizedRoot, cleaned);
  const rel = path.relative(normalizedRoot, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Acceso denegado: la ruta sale de la carpeta del servidor.");
  }

  // If the target or its parent already exists, verify realpath to guard against symlinks escaping root
  if (fs.existsSync(normalizedRoot)) {
    const realRoot = fs.realpathSync(normalizedRoot);
    let checkPath = candidate;
    while (!fs.existsSync(checkPath) && checkPath !== normalizedRoot) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    if (fs.existsSync(checkPath)) {
      const realCheck = fs.realpathSync(checkPath);
      const realRel = path.relative(realRoot, realCheck);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new Error("Acceso denegado: enlace simbólico fuera del servidor.");
      }
    }
  }

  return candidate;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "archivo";
}
