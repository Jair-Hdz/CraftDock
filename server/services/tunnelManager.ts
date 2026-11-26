import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TunnelStatus } from "../../shared/types";
import type { CraftDockDB } from "../db/database";
import { eventBus } from "../utils/eventBus";
import { downloadFile, fetchJson } from "../utils/http";

const PLAYIT_RELEASES_API =
  "https://api.github.com/repos/playit-cloud/playit-agent/releases/latest";

export class TunnelManager {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private status: TunnelStatus;
  private readonly binaryPath: string;
  private readonly secretPath: string;

  constructor(private readonly db: CraftDockDB) {
    this.binaryPath = path.join(db.paths.binDir, "playit-windows-x86_64.exe");
    this.secretPath = path.join(db.paths.playitDir, "playit.toml");
    const installed = fs.existsSync(this.binaryPath);
    this.status = {
      installed,
      running: false,
      state: installed ? "stopped" : "not_installed",
      claimUrl: null,
      detectedAddresses: [],
      recentLogs: [],
      errorMessage: null,
    };
  }

  getStatus(): TunnelStatus {
    return {
      ...this.status,
      installed: fs.existsSync(this.binaryPath),
      detectedAddresses: [...this.status.detectedAddresses],
      recentLogs: [...this.status.recentLogs],
    };
  }

  private broadcast(): void {
    eventBus.emit({ type: "tunnel_status", tunnel: this.getStatus() });
  }

  async installBinary(): Promise<TunnelStatus> {
    if (fs.existsSync(this.binaryPath)) {
      this.status.installed = true;
      if (this.status.state === "not_installed") this.status.state = "stopped";
      this.broadcast();
      return this.getStatus();
    }

    const taskId = `playit-dl-${crypto.randomUUID().slice(0, 6)}`;
    eventBus.emitProgress({
      taskId,
      scope: "tunnel",
      title: "Descargando agente oficial playit.gg",
      detail: "Consultando GitHub Releases de playit-cloud/playit-agent...",
      percent: 10,
      status: "running",
    });

    try {
      const release = await fetchJson<{ assets: Array<{ name: string; browser_download_url: string }> }>(
        PLAYIT_RELEASES_API
      );
      const asset =
        release.assets?.find(
          (a) =>
            a.name.toLowerCase().includes("windows") &&
            a.name.toLowerCase().includes("x86_64") &&
            a.name.toLowerCase().endsWith(".exe") &&
            !a.name.toLowerCase().includes("gui") &&
            !a.name.toLowerCase().includes("msi")
        ) ||
        release.assets?.find(
          (a) =>
            a.name.toLowerCase().includes("windows") && a.name.toLowerCase().endsWith(".exe")
        );

      if (!asset?.browser_download_url) {
        throw new Error(
          "No se encontró el binario de Windows (.exe) en la última release de playit-agent."
        );
      }

      await downloadFile({
        url: asset.browser_download_url,
        destPath: this.binaryPath,
        onProgress: (_dl, _t, pct) => {
          eventBus.emitProgress({
            taskId,
            scope: "tunnel",
            title: "Descargando playit.gg para Windows",
            detail: `${asset.name} (${pct}%)`,
            percent: Math.max(15, pct),
            status: "running",
          });
        },
      });

      this.status.installed = true;
      this.status.state = "stopped";
      this.status.errorMessage = null;

      eventBus.emitProgress({
        taskId,
        scope: "tunnel",
        title: "Agente playit.gg instalado",
        detail: "Listo para iniciar y vincular tu cuenta gratuita.",
        percent: 100,
        status: "done",
      });
      this.broadcast();
      return this.getStatus();
    } catch (err: any) {
      this.status.errorMessage = err?.message || "No se pudo descargar playit.gg";
      eventBus.emitProgress({
        taskId,
        scope: "tunnel",
        title: "Error descargando playit.gg",
        detail: this.status.errorMessage || "Error",
        percent: 0,
        status: "error",
      });
      this.broadcast();
      throw err;
    }
  }

  async start(): Promise<TunnelStatus> {
    if (this.proc) return this.getStatus();
    if (!fs.existsSync(this.binaryPath)) {
      await this.installBinary();
    }

    fs.mkdirSync(this.db.paths.playitDir, { recursive: true });
    this.status.running = true;
    this.status.state = "starting";
    this.status.errorMessage = null;
    this.status.recentLogs = [];
    this.broadcast();

    const proc = Bun.spawn(
      [this.binaryPath, "--stdout", "--secret_path", this.secretPath],
      {
        cwd: this.db.paths.playitDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    this.proc = proc;

    const consume = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const decoder = new TextDecoder();
      const reader = stream.getReader();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() || "";
        for (const raw of parts) {
          this.handleLogLine(raw);
        }
      }
      if (buffer.trim()) this.handleLogLine(buffer);
    };

    void consume(proc.stdout);
    void consume(proc.stderr);

    proc.exited.then((code) => {
      if (this.proc === proc) {
        this.proc = null;
        this.status.running = false;
        if (this.status.state !== "stopped") {
          this.status.state = code === 0 ? "stopped" : "error";
          if (code !== 0) {
            this.status.errorMessage = `El agente playit.gg se detuvo (código ${code}).`;
          }
        }
        this.broadcast();
      }
    });

    return this.getStatus();
  }

  private handleLogLine(raw: string): void {
    // Strip ANSI escape codes
    const line = raw.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();
    if (!line) return;

    this.status.recentLogs.push(line);
    if (this.status.recentLogs.length > 80) {
      this.status.recentLogs.shift();
    }

    const claimMatch = line.match(/https:\/\/playit\.gg\/claim\/[a-zA-Z0-9_-]+/);
    if (claimMatch) {
      this.status.claimUrl = claimMatch[0];
      this.status.state = "unclaimed";
    }

    // Detect tunnel domains like example.gl.joinmc.link or example.gl.at.ply.gg:12345
    const domainMatches = line.match(
      /[a-zA-Z0-9-]+\.(?:gl\.(?:joinmc\.link|at\.ply\.gg)|auto\.playit\.gg)(?::\d+)?/g
    );
    if (domainMatches) {
      for (const addr of domainMatches) {
        if (!this.status.detectedAddresses.includes(addr)) {
          this.status.detectedAddresses.push(addr);
        }
      }
      this.status.state = "connected";
      this.status.claimUrl = null;
    }

    if (/tunnel running|agent registered|program ready/i.test(line)) {
      this.status.state = "connected";
      this.status.claimUrl = null;
    }

    this.broadcast();
  }

  async stop(): Promise<TunnelStatus> {
    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      this.status.running = false;
      this.status.state = "stopped";
      try {
        p.kill();
      } catch {
        // ignore
      }
      this.broadcast();
    }
    return this.getStatus();
  }
}
