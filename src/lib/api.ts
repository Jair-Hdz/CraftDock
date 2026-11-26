import type {
  BackupRecord,
  FileEntry,
  GlobalSettings,
  JarLibraryItem,
  ModItem,
  ModrinthSearchHit,
  PlayersState,
  RamZone,
  RemoteVersionOption,
  ServerEngine,
  ServerPropertiesForm,
  ServerView,
  SystemInfo,
  TunnelStatus,
} from "../../shared/types";

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error(payload?.error || `Error ${res.status} al comunicarse con CraftDock.`);
  }
  return payload as T;
}

export const api = {
  getSystem: () => apiFetch<{ system: SystemInfo; settings: GlobalSettings }>("/api/system"),
  updateSettings: (patch: Partial<GlobalSettings>) =>
    apiFetch<{ ok: boolean }>("/api/system/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  installJava: (javaMajor: number) =>
    apiFetch<{ ok: boolean }>("/api/system/java/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ javaMajor }),
    }),
  shutdownApp: () => apiFetch<{ ok: boolean }>("/api/app/shutdown", { method: "POST" }),

  // JAR Library
  listJars: () => apiFetch<{ jars: JarLibraryItem[] }>("/api/jars"),
  listRemoteVersions: (engine: ServerEngine, snapshots = false) =>
    apiFetch<{ versions: RemoteVersionOption[] }>(
      `/api/jars/remote?engine=${encodeURIComponent(engine)}&snapshots=${snapshots}`
    ),
  listRemoteBuilds: (engine: ServerEngine, mcVersion: string) =>
    apiFetch<{ builds: string[] }>(
      `/api/jars/remote/builds?engine=${encodeURIComponent(engine)}&mcVersion=${encodeURIComponent(mcVersion)}`
    ),
  downloadJar: (engine: Exclude<ServerEngine, "custom">, mcVersion: string, build?: string) =>
    apiFetch<{ jar: JarLibraryItem }>("/api/jars/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, mcVersion, build }),
    }),
  uploadCustomJar: (file: File, meta: { name?: string; mcVersion?: string; javaMajor?: number }) => {
    const form = new FormData();
    form.append("file", file);
    if (meta.name) form.append("name", meta.name);
    if (meta.mcVersion) form.append("mcVersion", meta.mcVersion);
    if (meta.javaMajor) form.append("javaMajor", String(meta.javaMajor));
    return apiFetch<{ jar: JarLibraryItem }>("/api/jars/upload", { method: "POST", body: form });
  },
  deleteJar: (id: string) => apiFetch<{ ok: boolean }>(`/api/jars/${id}`, { method: "DELETE" }),

  // Tunnel
  getTunnel: () => apiFetch<{ tunnel: TunnelStatus }>("/api/tunnel"),
  installTunnel: () => apiFetch<{ tunnel: TunnelStatus }>("/api/tunnel/install", { method: "POST" }),
  startTunnel: () => apiFetch<{ tunnel: TunnelStatus }>("/api/tunnel/start", { method: "POST" }),
  stopTunnel: () => apiFetch<{ tunnel: TunnelStatus }>("/api/tunnel/stop", { method: "POST" }),

  // Servers
  listServers: () => apiFetch<{ servers: ServerView[] }>("/api/servers"),
  getServer: (id: string) =>
    apiFetch<{ server: ServerView; consoleLines: string[] }>(`/api/servers/${id}`),
  createServer: (payload: Record<string, unknown>) =>
    apiFetch<{ server: ServerView }>("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  updateServer: (id: string, patch: Record<string, unknown>) =>
    apiFetch<{ server: ServerView }>(`/api/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  deleteServer: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${id}`, { method: "DELETE" }),
  startServer: (id: string) =>
    apiFetch<{ server: ServerView }>(`/api/servers/${id}/start`, { method: "POST" }),
  stopServer: (id: string) =>
    apiFetch<{ server: ServerView }>(`/api/servers/${id}/stop`, { method: "POST" }),
  restartServer: (id: string) =>
    apiFetch<{ server: ServerView }>(`/api/servers/${id}/restart`, { method: "POST" }),
  sendCommand: (id: string, command: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${id}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }),
  applyCrashFix: (id: string) =>
    apiFetch<{ message: string; server: ServerView }>(`/api/servers/${id}/crash/fix`, {
      method: "POST",
    }),
  changeServerJar: (id: string, jarId: string) =>
    apiFetch<{ server: ServerView }>(`/api/servers/${id}/jar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jarId }),
    }),
  toggleCrossplay: (id: string, enabled: boolean) =>
    apiFetch<{ server: ServerView }>(`/api/servers/${id}/crossplay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  getInvite: (id: string) =>
    apiFetch<{ text: string; lanAddress: string }>(`/api/servers/${id}/invite`),

  // Properties & Icon
  getProperties: (id: string) =>
    apiFetch<{ properties: ServerPropertiesForm }>(`/api/servers/${id}/properties`),
  saveProperties: (id: string, form: Partial<ServerPropertiesForm>) =>
    apiFetch<{ properties: ServerPropertiesForm; server: ServerView }>(
      `/api/servers/${id}/properties`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }
    ),
  uploadIcon: (id: string, pngBlob: Blob) => {
    const form = new FormData();
    form.append("file", new File([pngBlob], "server-icon.png", { type: "image/png" }));
    return apiFetch<{ ok: boolean }>(`/api/servers/${id}/icon`, { method: "POST", body: form });
  },

  // Players
  getPlayers: (id: string) => apiFetch<{ players: PlayersState }>(`/api/servers/${id}/players`),
  playerAction: (id: string, action: string, playerName: string, reason?: string) =>
    apiFetch<{ players: PlayersState }>(`/api/servers/${id}/players/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, playerName, reason }),
    }),

  // Mods & Plugins
  listMods: (id: string) =>
    apiFetch<{ mods: ModItem[]; folder: "mods" | "plugins" | null }>(`/api/servers/${id}/mods`),
  uploadMod: (id: string, file: File, folder?: "mods" | "plugins") => {
    const form = new FormData();
    form.append("file", file);
    if (folder) form.append("folder", folder);
    return apiFetch<{ mod: ModItem }>(`/api/servers/${id}/mods/upload`, {
      method: "POST",
      body: form,
    });
  },
  toggleMod: (id: string, folder: "mods" | "plugins", fileName: string) =>
    apiFetch<{ mod: ModItem }>(`/api/servers/${id}/mods/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, fileName }),
    }),
  deleteMod: (id: string, folder: "mods" | "plugins", fileName: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${id}/mods/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, fileName }),
    }),
  searchModrinth: (id: string, q: string, type?: "mod" | "plugin" | "modpack") =>
    apiFetch<{ hits: ModrinthSearchHit[] }>(
      `/api/servers/${id}/mods/modrinth/search?q=${encodeURIComponent(q)}${
        type ? `&type=${type}` : ""
      }`
    ),
  installModrinth: (id: string, projectId: string) =>
    apiFetch<{ installedFiles: string[] }>(`/api/servers/${id}/mods/modrinth/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    }),
  importMrpack: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ packName: string; downloadedCount: number; skippedClientOnly: number }>(
      `/api/servers/${id}/mods/mrpack`,
      { method: "POST", body: form }
    );
  },

  // Backups & Worlds
  listBackups: (id: string) => apiFetch<{ backups: BackupRecord[] }>(`/api/servers/${id}/backups`),
  createBackup: (id: string, label?: string) =>
    apiFetch<{ backup: BackupRecord }>(`/api/servers/${id}/backups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }),
  restoreBackup: (id: string, backupId: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${id}/backups/${backupId}/restore`, {
      method: "POST",
    }),
  deleteBackup: (id: string, backupId: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${id}/backups/${backupId}`, { method: "DELETE" }),
  importWorld: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ worldName: string }>(`/api/servers/${id}/worlds/import`, {
      method: "POST",
      body: form,
    });
  },

  // File Library
  listFiles: (id: string, relPath = "") =>
    apiFetch<{ path: string; entries: FileEntry[] }>(
      `/api/servers/${id}/files?path=${encodeURIComponent(relPath)}`
    ),
  readFile: (id: string, relPath: string) =>
    apiFetch<{ content: string; sizeBytes: number; name: string }>(
      `/api/servers/${id}/files/content?path=${encodeURIComponent(relPath)}`
    ),
  writeFile: (id: string, relPath: string, content: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${id}/files/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, content }),
    }),
  createFileEntry: (id: string, dir: string, name: string, type: "file" | "folder") =>
    apiFetch<{ path: string }>(`/api/servers/${id}/files/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, name, type }),
    }),
  renameFileEntry: (id: string, relPath: string, newName: string) =>
    apiFetch<{ path: string }>(`/api/servers/${id}/files/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, newName }),
    }),
  deleteFileEntry: (id: string, relPath: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${id}/files/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath }),
    }),
  uploadFiles: (id: string, dir: string, files: FileList | File[]) => {
    const form = new FormData();
    form.append("dir", dir);
    for (const f of Array.from(files)) {
      form.append("file", f);
    }
    return apiFetch<{ saved: string[] }>(`/api/servers/${id}/files/upload`, {
      method: "POST",
      body: form,
    });
  },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatUptime(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function getRamZoneClient(selectedMb: number, system: SystemInfo | null): RamZone {
  if (!system) return "green";
  if (selectedMb <= system.recommendedMaxRamMb) return "green";
  if (selectedMb <= system.yellowMaxRamMb) return "yellow";
  return "red";
}

export async function resizeImageTo64Png(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");

  const minSide = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - minSide) / 2;
  const sy = (bitmap.height - minSide) / 2;
  ctx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, 64, 64);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Error convirtiendo imagen a PNG 64x64."));
    }, "image/png");
  });
}
