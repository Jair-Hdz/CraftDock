import fs from "node:fs";
import path from "node:path";
import type { ServerWebSocket } from "bun";
import { CraftDockDB } from "./db/database";
import { EMBEDDED_ASSETS, HAS_EMBEDDED_ASSETS } from "./embeddedAssets";
import { handleApiRequest } from "./routes/api";
import { ServerManager } from "./services/serverManager";
import { TunnelManager } from "./services/tunnelManager";
import { eventBus } from "./utils/eventBus";

const PORT = Number(process.env.CRAFTDOCK_PORT || 3847);
const HOST = "127.0.0.1";
const DIST_WEB_DIR = path.resolve(process.cwd(), "dist", "web");

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
  };
  return map[ext] || "application/octet-stream";
}

function openBrowserWindows(url: string): void {
  if (process.platform !== "win32") return;
  try {
    Bun.spawn(["cmd", "/c", "start", "", url], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    // ignore if browser fails to open
  }
}

async function isAlreadyRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/system`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startCraftDockServer(options?: {
  port?: number;
  dataDir?: string;
  openBrowser?: boolean;
}) {
  const port = options?.port ?? PORT;
  const baseUrl = `http://${HOST}:${port}`;

  if (options?.openBrowser !== false && (await isAlreadyRunning(baseUrl))) {
    console.log(`[CraftDock] Ya existe una instancia activa en ${baseUrl}. Abriendo navegador...`);
    openBrowserWindows(baseUrl);
    process.exit(0);
  }

  const db = new CraftDockDB(options?.dataDir);
  const serverManager = new ServerManager(db);
  const tunnelManager = new TunnelManager(db);

  const wsClients = new Set<ServerWebSocket<unknown>>();

  const unsubscribe = eventBus.subscribe((event) => {
    const payload = JSON.stringify(event);
    for (const ws of wsClients) {
      try {
        ws.send(payload);
      } catch {
        wsClients.delete(ws);
      }
    }
  });

  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[CraftDock] Cerrando servidores Minecraft y túnel de forma segura...");
    unsubscribe();
    await serverManager.shutdownAll();
    await tunnelManager.stop();
    db.close();
    server.stop(true);
    process.exit(0);
  };

  const server = Bun.serve({
    hostname: HOST,
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const upgraded = srv.upgrade(req);
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade fallido", { status: 400 });
      }

      if (url.pathname.startsWith("/api/")) {
        return handleApiRequest(req, {
          db,
          serverManager,
          tunnelManager,
          requestShutdown: () => void gracefulShutdown(),
        });
      }

      // Serve embedded assets (when running as compiled CraftDock.exe)
      if (HAS_EMBEDDED_ASSETS) {
        const key = url.pathname === "/" ? "/index.html" : url.pathname;
        const asset = EMBEDDED_ASSETS[key] || EMBEDDED_ASSETS["/index.html"];
        if (asset) {
          return new Response(Bun.file(asset.filePath), {
            headers: { "Content-Type": asset.contentType },
          });
        }
      }

      // Serve dist/web when built locally
      if (fs.existsSync(DIST_WEB_DIR)) {
        const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
        const candidate = path.resolve(DIST_WEB_DIR, rel);
        if (
          candidate.startsWith(DIST_WEB_DIR) &&
          fs.existsSync(candidate) &&
          fs.statSync(candidate).isFile()
        ) {
          return new Response(Bun.file(candidate), {
            headers: { "Content-Type": getContentType(candidate) },
          });
        }
        const indexHtml = path.join(DIST_WEB_DIR, "index.html");
        if (fs.existsSync(indexHtml)) {
          return new Response(Bun.file(indexHtml), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      return new Response(
        "CraftDock API activa. En modo desarrollo abre http://localhost:5173",
        { status: 200 }
      );
    },
    websocket: {
      open(ws) {
        wsClients.add(ws);
        ws.send(JSON.stringify({ type: "tunnel_status", tunnel: tunnelManager.getStatus() }));
      },
      message(ws, message) {
        try {
          const parsed = JSON.parse(String(message)) as { type?: string; serverId?: string };
          if (parsed.type === "subscribe_console" && parsed.serverId) {
            ws.send(
              JSON.stringify({
                type: "console_snapshot",
                serverId: parsed.serverId,
                lines: serverManager.getConsoleLines(parsed.serverId),
              })
            );
          }
        } catch {
          // ignore malformed client messages
        }
      },
      close(ws) {
        wsClients.delete(ws);
      },
    },
  });

  process.on("SIGINT", () => void gracefulShutdown());
  process.on("SIGTERM", () => void gracefulShutdown());

  console.log(`[CraftDock] Panel disponible en ${baseUrl}`);
  console.log(`[CraftDock] Carpeta de datos: ${db.paths.root}`);

  const shouldAutoOpen =
    options?.openBrowser ??
    (HAS_EMBEDDED_ASSETS &&
      process.env.CRAFTDOCK_NO_BROWSER !== "1" &&
      db.getSetting("autoOpenBrowser") !== "false");

  if (shouldAutoOpen) {
    openBrowserWindows(baseUrl);
  }

  return { server, db, serverManager, tunnelManager, stop: gracefulShutdown };
}

if (import.meta.main) {
  void startCraftDockServer();
}
