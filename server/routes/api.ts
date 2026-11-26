import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ServerEngine } from "../../shared/types";
import type { CraftDockDB } from "../db/database";
import {
  createServerBackup,
  deleteServerBackup,
  exportWorldZip,
  importWorldZip,
  restoreServerBackup,
} from "../services/backupService";
import {
  deleteDatapack,
  installDatapackFromModrinth,
  listDatapacks,
  searchModrinthDatapacks,
  toggleDatapack,
  uploadDatapackZip,
} from "../services/datapackService";
import {
  createServerEntry,
  deleteServerEntry,
  listServerFiles,
  readServerTextFile,
  renameServerEntry,
  saveUploadedServerFile,
  writeServerTextFile,
} from "../services/fileManagerService";
import {
  deleteJarFromLibrary,
  downloadOfficialJarToLibrary,
  listRemoteBuilds,
  listRemoteVersions,
  saveCustomJarToLibrary,
} from "../services/jarLibraryService";
import {
  deleteInstalledMod,
  exportModsPackForFriends,
  getModFolderForServer,
  importMrpackModpack,
  installFromModrinth,
  listInstalledMods,
  listModpackVersions,
  searchModrinth,
  searchModrinthModpacks,
  toggleInstalledMod,
  uploadModJar,
} from "../services/modrinthService";
import { performPlayerAction, readPlayersState } from "../services/playersService";
import {
  readServerProperties,
  saveServerIcon,
  writeServerProperties,
} from "../services/propertiesService";
import { ensureJavaRuntime } from "../services/runtimeManager";
import type { ServerManager } from "../services/serverManager";
import { getSystemInfo } from "../services/systemInfo";
import type { TunnelManager } from "../services/tunnelManager";
import { resolveSafeChildPath } from "../utils/paths";

export interface ApiContext {
  db: CraftDockDB;
  serverManager: ServerManager;
  tunnelManager: TunnelManager;
  requestShutdown: () => void;
}

const createServerSchema = z.object({
  name: z.string().min(1, "Escribe un nombre para el servidor").max(60),
  engine: z.enum(["vanilla", "paper", "fabric", "forge", "neoforge", "bedrock", "custom"]),
  mcVersion: z.string().optional(),
  build: z.string().optional(),
  jarId: z.string().optional(),
  crossplayEnabled: z.boolean().optional(),
  ramMinMb: z.number().int().min(512).max(65536).optional(),
  ramMaxMb: z.number().int().min(512).max(65536).optional(),
  onlineMode: z.boolean().optional(),
  gamemode: z.string().optional(),
  difficulty: z.string().optional(),
  maxPlayers: z.number().int().min(1).max(500).optional(),
  eulaAccepted: z.boolean().optional(),
  autoShutdownMinutes: z.number().int().min(0).max(1440).optional(),
  autoBackupIntervalMinutes: z.number().int().min(0).max(1440).optional(),
  backupRetentionCount: z.number().int().min(1).max(50).optional(),
});

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function errorJson(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function handleApiRequest(req: Request, ctx: ApiContext): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // ---- System & Settings ----
    if (pathname === "/api/system" && method === "GET") {
      return json({
        system: getSystemInfo(ctx.db),
        settings: {
          dataDir: ctx.db.getSetting("dataDir") || ctx.db.paths.root,
          autoOpenBrowser: ctx.db.getSetting("autoOpenBrowser") !== "false",
          defaultBackupRetention: Number(ctx.db.getSetting("defaultBackupRetention") || 5),
          playitInstalled: ctx.tunnelManager.getStatus().installed,
          port: Number(ctx.db.getSetting("port") || 3847),
        },
      });
    }

    if (pathname === "/api/system/settings" && method === "PATCH") {
      const body = (await req.json()) as Record<string, any>;
      if (typeof body.autoOpenBrowser === "boolean") {
        ctx.db.setSetting("autoOpenBrowser", String(body.autoOpenBrowser));
      }
      if (typeof body.defaultBackupRetention === "number") {
        ctx.db.setSetting("defaultBackupRetention", String(Math.max(1, Math.min(50, body.defaultBackupRetention))));
      }
      if (typeof body.dataDir === "string" && body.dataDir.trim()) {
        ctx.db.setSetting("dataDir", body.dataDir.trim());
      }
      return json({ ok: true });
    }

    if (pathname === "/api/system/java/install" && method === "POST") {
      const body = (await req.json()) as { javaMajor?: number };
      const major = Number(body.javaMajor);
      if (![8, 17, 21, 25].includes(major)) {
        return errorJson("Versión de Java no soportada (usa 8, 17, 21 o 25).");
      }
      const exePath = await ensureJavaRuntime(ctx.db, major);
      return json({ ok: true, javaMajor: major, exePath });
    }

    if (pathname === "/api/app/shutdown" && method === "POST") {
      setTimeout(() => ctx.requestShutdown(), 150);
      return json({ ok: true, message: "Cerrando servidores de forma segura..." });
    }

    // ---- JAR Library ----
    if (pathname === "/api/jars" && method === "GET") {
      return json({ jars: ctx.db.listJars() });
    }

    if (pathname === "/api/jars/remote" && method === "GET") {
      const engine = (url.searchParams.get("engine") || "paper") as ServerEngine;
      const includeSnapshots = url.searchParams.get("snapshots") === "true";
      const versions = await listRemoteVersions(engine, includeSnapshots);
      return json({ versions });
    }

    if (pathname === "/api/jars/remote/builds" && method === "GET") {
      const engine = (url.searchParams.get("engine") || "paper") as ServerEngine;
      const mcVersion = url.searchParams.get("mcVersion") || "";
      if (!mcVersion) return errorJson("Falta parámetro mcVersion.");
      const builds = await listRemoteBuilds(engine, mcVersion);
      return json({ builds });
    }

    if (pathname === "/api/jars/download" && method === "POST") {
      const body = (await req.json()) as {
        engine: Exclude<ServerEngine, "custom">;
        mcVersion: string;
        build?: string;
      };
      if (!body.engine || !body.mcVersion) {
        return errorJson("Falta indicar motor y versión de Minecraft.");
      }
      const jar = await downloadOfficialJarToLibrary(
        ctx.db,
        body.engine,
        body.mcVersion,
        body.build
      );
      return json({ jar }, 201);
    }

    if (pathname === "/api/jars/upload" && method === "POST") {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return errorJson("Debes adjuntar un archivo .jar.");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const jar = await saveCustomJarToLibrary(ctx.db, {
        fileName: file.name,
        bytes,
        displayName: String(form.get("name") || ""),
        mcVersion: String(form.get("mcVersion") || "custom"),
        javaMajor: form.get("javaMajor") ? Number(form.get("javaMajor")) : undefined,
      });
      return json({ jar }, 201);
    }

    const jarDeleteMatch = pathname.match(/^\/api\/jars\/([^/]+)$/);
    if (jarDeleteMatch && method === "DELETE") {
      deleteJarFromLibrary(ctx.db, jarDeleteMatch[1]);
      return json({ ok: true });
    }

    // ---- Tunnel (playit.gg) ----
    if (pathname === "/api/tunnel" && method === "GET") {
      return json({ tunnel: ctx.tunnelManager.getStatus() });
    }
    if (pathname === "/api/tunnel/install" && method === "POST") {
      const tunnel = await ctx.tunnelManager.installBinary();
      return json({ tunnel });
    }
    if (pathname === "/api/tunnel/start" && method === "POST") {
      const tunnel = await ctx.tunnelManager.start();
      return json({ tunnel });
    }
    if (pathname === "/api/tunnel/stop" && method === "POST") {
      const tunnel = await ctx.tunnelManager.stop();
      return json({ tunnel });
    }

    // ---- Global Modpacks (Modrinth Direct) ----
    if (pathname === "/api/modpacks/search" && method === "GET") {
      const query = url.searchParams.get("q") || "";
      const mcVersion = url.searchParams.get("mcVersion") || undefined;
      const loaderParam = url.searchParams.get("loader") || undefined;
      const loader =
        loaderParam === "fabric" || loaderParam === "forge" || loaderParam === "neoforge"
          ? loaderParam
          : undefined;
      const hits = await searchModrinthModpacks({ query, mcVersion, loader });
      return json({ hits });
    }

    const modpackVerMatch = pathname.match(/^\/api\/modpacks\/([^/]+)\/versions$/);
    if (modpackVerMatch && method === "GET") {
      const projectId = modpackVerMatch[1];
      const mcVersion = url.searchParams.get("mcVersion") || undefined;
      const loaderParam = url.searchParams.get("loader") || undefined;
      const loader =
        loaderParam === "fabric" || loaderParam === "forge" || loaderParam === "neoforge"
          ? loaderParam
          : undefined;
      const versions = await listModpackVersions(projectId, { mcVersion, loader });
      return json({ versions });
    }

    // ---- Servers CRUD ----
    if (pathname === "/api/servers" && method === "GET") {
      return json({ servers: ctx.serverManager.listServerViews() });
    }

    if (pathname === "/api/servers/from-modpack" && method === "POST") {
      const body = (await req.json()) as {
        name?: string;
        modpackVersionId?: string;
        ramMinMb?: number;
        ramMaxMb?: number;
        onlineMode?: boolean;
        gamemode?: string;
        difficulty?: string;
        maxPlayers?: number;
        eulaAccepted?: boolean;
      };
      if (!body.modpackVersionId) {
        return errorJson("Debes seleccionar una versión de modpack de Modrinth.");
      }
      const result = await ctx.serverManager.createServerFromModpack({
        name: body.name,
        modpackVersionId: body.modpackVersionId,
        ramMinMb: body.ramMinMb,
        ramMaxMb: body.ramMaxMb,
        onlineMode: body.onlineMode,
        gamemode: body.gamemode,
        difficulty: body.difficulty,
        maxPlayers: body.maxPlayers,
        eulaAccepted: Boolean(body.eulaAccepted),
      });
      return json(result, 201);
    }

    if (pathname === "/api/servers" && method === "POST") {
      const parsed = createServerSchema.safeParse(await req.json());
      if (!parsed.success) {
        return errorJson(parsed.error.issues[0]?.message || "Datos inválidos.");
      }
      const server = await ctx.serverManager.createServer(parsed.data);
      return json({ server }, 201);
    }

    const serverMatch = pathname.match(/^\/api\/servers\/([^/]+)(?:\/(.*))?$/);
    if (serverMatch) {
      const serverId = serverMatch[1];
      const sub = serverMatch[2] || "";
      const server = ctx.db.getServer(serverId);
      if (!server) return errorJson("Servidor no encontrado.", 404);
      const serverDir = ctx.serverManager.getServerDir(serverId);

      // Single server details / update / delete
      if (!sub && method === "GET") {
        return json({
          server: ctx.serverManager.getServerView(serverId),
          consoleLines: ctx.serverManager.getConsoleLines(serverId),
        });
      }

      if (!sub && method === "PATCH") {
        const body = (await req.json()) as Record<string, any>;
        const updated = ctx.db.updateServer(serverId, {
          ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(typeof body.ramMinMb === "number" ? { ramMinMb: body.ramMinMb } : {}),
          ...(typeof body.ramMaxMb === "number" ? { ramMaxMb: body.ramMaxMb } : {}),
          ...(typeof body.javaMajor === "number" ? { javaMajor: body.javaMajor } : {}),
          ...(typeof body.port === "number" ? { port: body.port } : {}),
          ...(typeof body.bedrockPort === "number" ? { bedrockPort: body.bedrockPort } : {}),
          ...(typeof body.autoShutdownMinutes === "number"
            ? { autoShutdownMinutes: body.autoShutdownMinutes }
            : {}),
          ...(typeof body.autoBackupIntervalMinutes === "number"
            ? { autoBackupIntervalMinutes: body.autoBackupIntervalMinutes }
            : {}),
          ...(typeof body.backupRetentionCount === "number"
            ? { backupRetentionCount: body.backupRetentionCount }
            : {}),
          ...(typeof body.eulaAccepted === "boolean" ? { eulaAccepted: body.eulaAccepted } : {}),
          ...(typeof body.tunnelAddress === "string"
            ? { tunnelAddress: body.tunnelAddress.trim() }
            : {}),
          ...(typeof body.tunnelBedrockAddress === "string"
            ? { tunnelBedrockAddress: body.tunnelBedrockAddress.trim() }
            : {}),
        });
        if (typeof body.port === "number") {
          writeServerProperties(serverDir, server.engine, { serverPort: body.port });
        }
        return json({ server: ctx.serverManager.toServerView(updated!) });
      }

      if (!sub && method === "DELETE") {
        await ctx.serverManager.deleteServer(serverId);
        return json({ ok: true });
      }

      // Lifecycle actions
      if (sub === "start" && method === "POST") {
        const view = await ctx.serverManager.startServer(serverId);
        return json({ server: view });
      }
      if (sub === "stop" && method === "POST") {
        await ctx.serverManager.stopServer(serverId);
        return json({ server: ctx.serverManager.getServerView(serverId) });
      }
      if (sub === "restart" && method === "POST") {
        const view = await ctx.serverManager.restartServer(serverId);
        return json({ server: view });
      }
      if (sub === "command" && method === "POST") {
        const body = (await req.json()) as { command?: string };
        if (!body.command) return errorJson("Falta el comando.");
        ctx.serverManager.sendCommand(serverId, body.command);
        return json({ ok: true });
      }
      if (sub === "crash/fix" && method === "POST") {
        const result = await ctx.serverManager.applyCrashQuickAction(serverId);
        return json(result);
      }
      if (sub === "jar" && method === "POST") {
        const body = (await req.json()) as { jarId?: string };
        if (!body.jarId) return errorJson("Falta jarId.");
        const view = await ctx.serverManager.changeServerJar(serverId, body.jarId);
        return json({ server: view });
      }
      if (sub === "crossplay" && method === "POST") {
        const body = (await req.json()) as { enabled?: boolean };
        const view = await ctx.serverManager.toggleCrossplay(serverId, Boolean(body.enabled));
        return json({ server: view });
      }
      if (sub === "invite" && method === "GET") {
        return json(ctx.serverManager.buildInviteText(serverId));
      }

      // Properties & Icon
      if (sub === "properties" && method === "GET") {
        return json({
          properties: readServerProperties(serverDir, server.engine, server.port, server.name),
        });
      }
      if (sub === "properties" && method === "PUT") {
        const body = (await req.json()) as Record<string, any>;
        const properties = writeServerProperties(serverDir, server.engine, body);
        if (typeof body.serverPort === "number" && body.serverPort !== server.port) {
          ctx.db.updateServer(serverId, { port: body.serverPort });
        }
        return json({ properties, server: ctx.serverManager.getServerView(serverId) });
      }
      if (sub === "icon" && method === "GET") {
        const iconPath = path.join(serverDir, "server-icon.png");
        if (!fs.existsSync(iconPath)) return new Response(null, { status: 404 });
        return new Response(Bun.file(iconPath), {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" },
        });
      }
      if (sub === "icon" && method === "POST") {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return errorJson("Adjunta una imagen PNG.");
        saveServerIcon(serverDir, new Uint8Array(await file.arrayBuffer()));
        return json({ ok: true });
      }

      // Players
      if (sub === "players" && method === "GET") {
        return json({
          players: readPlayersState(
            serverDir,
            server.engine,
            ctx.serverManager.getOnlinePlayers(serverId)
          ),
        });
      }
      if (sub === "players/action" && method === "POST") {
        const body = (await req.json()) as {
          action: any;
          playerName: string;
          reason?: string;
        };
        const players = performPlayerAction(
          serverDir,
          server.engine,
          body.action,
          body.playerName,
          body.reason,
          ctx.serverManager.isRunning(serverId),
          (cmd) => ctx.serverManager.sendCommand(serverId, cmd)
        );
        return json({ players });
      }

      // Mods & Plugins & Modrinth
      if (sub === "mods" && method === "GET") {
        return json({
          mods: listInstalledMods(serverDir, server),
          folder: getModFolderForServer(server),
        });
      }
      if (sub === "mods/upload" && method === "POST") {
        const form = await req.formData();
        const file = form.get("file");
        const folder =
          (form.get("folder") as "mods" | "plugins" | null) ||
          getModFolderForServer(server) ||
          "mods";
        if (!(file instanceof File)) return errorJson("Adjunta un archivo .jar.");
        const item = uploadModJar(
          serverDir,
          folder,
          file.name,
          new Uint8Array(await file.arrayBuffer())
        );
        return json({ mod: item }, 201);
      }
      if (sub === "mods/toggle" && method === "POST") {
        const body = (await req.json()) as { folder: "mods" | "plugins"; fileName: string };
        const mod = toggleInstalledMod(serverDir, body.folder, body.fileName);
        return json({ mod });
      }
      if (sub === "mods/delete" && method === "POST") {
        const body = (await req.json()) as { folder: "mods" | "plugins"; fileName: string };
        deleteInstalledMod(serverDir, body.folder, body.fileName);
        return json({ ok: true });
      }
      if (sub === "mods/modrinth/search" && method === "GET") {
        const query = url.searchParams.get("q") || "";
        const type = url.searchParams.get("type") as "mod" | "plugin" | "modpack" | null;
        const hits = await searchModrinth({
          query,
          mcVersion: server.mcVersion,
          engine: server.engine,
          projectType: type || undefined,
        });
        return json({ hits });
      }
      if (sub === "mods/modrinth/install" && method === "POST") {
        const body = (await req.json()) as { projectId?: string };
        if (!body.projectId) return errorJson("Falta projectId.");
        const result = await installFromModrinth(serverDir, server, body.projectId);
        return json(result, 201);
      }
      if (sub === "mods/modrinth/install-modpack" && method === "POST") {
        const body = (await req.json()) as { modpackVersionId?: string };
        if (!body.modpackVersionId) return errorJson("Falta modpackVersionId.");
        const result = await ctx.serverManager.installModpackOnExistingServer(
          serverId,
          body.modpackVersionId
        );
        return json(result, 201);
      }
      if (sub === "mods/mrpack" && method === "POST") {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return errorJson("Adjunta un archivo .mrpack.");
        const result = await importMrpackModpack(
          serverDir,
          ctx.db.paths.tmpDir,
          new Uint8Array(await file.arrayBuffer())
        );
        return json(result, 201);
      }
      if (sub === "mods/export" && method === "GET") {
        const { zipPath, fileName } = await exportModsPackForFriends(
          serverDir,
          ctx.db.paths.tmpDir,
          server
        );
        const bytes = fs.readFileSync(zipPath);
        fs.rmSync(zipPath, { force: true });
        return new Response(bytes, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${fileName}"`,
          },
        });
      }

      // Datapacks (Java <world>/datapacks/)
      if (sub === "datapacks" && method === "GET") {
        return json(listDatapacks(serverDir, server));
      }
      if (sub === "datapacks/upload" && method === "POST") {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return errorJson("Adjunta un archivo .zip de datapack.");
        const datapack = uploadDatapackZip(
          serverDir,
          server,
          file.name,
          new Uint8Array(await file.arrayBuffer())
        );
        return json({ datapack }, 201);
      }
      if (sub === "datapacks/toggle" && method === "POST") {
        const body = (await req.json()) as { fileName?: string };
        if (!body.fileName) return errorJson("Falta fileName.");
        const datapack = toggleDatapack(serverDir, server, body.fileName);
        return json({ datapack });
      }
      if (sub === "datapacks/delete" && method === "POST") {
        const body = (await req.json()) as { fileName?: string };
        if (!body.fileName) return errorJson("Falta fileName.");
        deleteDatapack(serverDir, server, body.fileName);
        return json({ ok: true });
      }
      if (sub === "datapacks/reload" && method === "POST") {
        ctx.serverManager.sendCommand(serverId, "reload");
        return json({ ok: true });
      }
      if (sub === "datapacks/modrinth/search" && method === "GET") {
        const query = url.searchParams.get("q") || "";
        const hits = await searchModrinthDatapacks(query, server.mcVersion);
        return json({ hits });
      }
      if (sub === "datapacks/modrinth/install" && method === "POST") {
        const body = (await req.json()) as { projectId?: string };
        if (!body.projectId) return errorJson("Falta projectId.");
        const result = await installDatapackFromModrinth(serverDir, server, body.projectId);
        return json(result, 201);
      }

      // Worlds & Backups
      if (sub === "backups" && method === "GET") {
        return json({ backups: ctx.db.listBackups(serverId) });
      }
      if (sub === "backups" && method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { label?: string };
        const backup = await createServerBackup(ctx.db, server, {
          label: body.label,
          kind: "manual",
          isRunning: ctx.serverManager.isRunning(serverId),
          sendConsoleCommand: (cmd) => ctx.serverManager.sendCommand(serverId, cmd),
        });
        return json({ backup }, 201);
      }
      const backupActionMatch = sub.match(/^backups\/([^/]+)(?:\/(restore|download))?$/);
      if (backupActionMatch) {
        const backupId = backupActionMatch[1];
        const bAction = backupActionMatch[2];
        if (!bAction && method === "DELETE") {
          deleteServerBackup(ctx.db, serverId, backupId);
          return json({ ok: true });
        }
        if (bAction === "restore" && method === "POST") {
          if (ctx.serverManager.isRunning(serverId)) {
            return errorJson("Apaga el servidor antes de restaurar un respaldo.");
          }
          await restoreServerBackup(ctx.db, server, backupId);
          return json({ ok: true });
        }
        if (bAction === "download" && method === "GET") {
          const backup = ctx.db.getBackup(backupId);
          if (!backup || backup.serverId !== serverId) return errorJson("No encontrado.", 404);
          const zipPath = path.join(ctx.db.paths.backupsDir, serverId, backup.fileName);
          if (!fs.existsSync(zipPath)) return errorJson("Archivo no encontrado.", 404);
          return new Response(Bun.file(zipPath), {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${backup.fileName}"`,
            },
          });
        }
      }
      if (sub === "worlds/import" && method === "POST") {
        if (ctx.serverManager.isRunning(serverId)) {
          return errorJson("Apaga el servidor antes de importar un mundo.");
        }
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return errorJson("Adjunta un archivo .zip del mundo.");
        const res = await importWorldZip(ctx.db, server, new Uint8Array(await file.arrayBuffer()));
        return json(res);
      }
      if (sub === "worlds/export" && method === "GET") {
        const { zipPath, fileName } = await exportWorldZip(ctx.db, server);
        const bytes = fs.readFileSync(zipPath);
        fs.rmSync(zipPath, { force: true });
        return new Response(bytes, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${fileName}"`,
          },
        });
      }

      // File Manager & Built-in Code Editor
      if (sub === "files" && method === "GET") {
        const dir = url.searchParams.get("path") || "";
        return json({ path: dir, entries: listServerFiles(serverDir, dir) });
      }
      if (sub === "files/content" && method === "GET") {
        const rel = url.searchParams.get("path") || "";
        if (!rel) return errorJson("Falta parámetro path.");
        return json(readServerTextFile(serverDir, rel));
      }
      if (sub === "files/content" && method === "PUT") {
        const body = (await req.json()) as { path: string; content: string };
        if (!body.path) return errorJson("Falta ruta del archivo.");
        writeServerTextFile(serverDir, body.path, body.content ?? "");
        return json({ ok: true });
      }
      if (sub === "files/create" && method === "POST") {
        const body = (await req.json()) as {
          dir?: string;
          name: string;
          type: "file" | "folder";
        };
        const createdPath = createServerEntry(serverDir, body.dir || "", body.name, body.type);
        return json({ path: createdPath }, 201);
      }
      if (sub === "files/rename" && method === "POST") {
        const body = (await req.json()) as { path: string; newName: string };
        const nextPath = renameServerEntry(serverDir, body.path, body.newName);
        return json({ path: nextPath });
      }
      if (sub === "files/delete" && method === "POST") {
        const body = (await req.json()) as { path: string };
        deleteServerEntry(serverDir, body.path);
        return json({ ok: true });
      }
      if (sub === "files/upload" && method === "POST") {
        const form = await req.formData();
        const dir = String(form.get("dir") || "");
        const files = form.getAll("file");
        const saved: string[] = [];
        for (const item of files) {
          if (item instanceof File) {
            const p = saveUploadedServerFile(
              serverDir,
              dir,
              item.name,
              new Uint8Array(await item.arrayBuffer())
            );
            saved.push(p);
          }
        }
        return json({ saved }, 201);
      }
      if (sub === "files/download" && method === "GET") {
        const rel = url.searchParams.get("path") || "";
        const full = resolveSafeChildPath(serverDir, rel);
        if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
          return errorJson("Archivo no encontrado.", 404);
        }
        return new Response(Bun.file(full), {
          headers: {
            "Content-Disposition": `attachment; filename="${path.basename(full)}"`,
          },
        });
      }
    }

    return errorJson("Ruta de API no encontrada.", 404);
  } catch (err: any) {
    return errorJson(err?.message || "Error interno en CraftDock.", 400);
  }
}
