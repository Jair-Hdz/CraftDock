import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CrashDiagnosis,
  JarLibraryItem,
  RuntimeMetrics,
  ServerEngine,
  ServerRecord,
  ServerStatus,
  ServerView,
} from "../../shared/types";
import type { CraftDockDB } from "../db/database";
import { eventBus } from "../utils/eventBus";
import { extractZipArchive } from "../utils/zip";
import { createServerBackup } from "./backupService";
import { analyzeCrashLogs } from "./crashAnalyzer";
import { downloadOfficialJarToLibrary } from "./jarLibraryService";
import {
  buildDefaultProperties,
  readServerProperties,
  writeServerProperties,
} from "./propertiesService";
import { installForgeIntoServerDir } from "./providers/forgeProvider";
import { installCrossplayPlugins, removeCrossplayPlugins } from "./providers/geyserProvider";
import { ensureJavaRuntime } from "./runtimeManager";
import {
  detectLanIp,
  evaluateRamZone,
  findFreePort,
  getRequiredJavaMajor,
  getSystemInfo,
} from "./systemInfo";

interface ActiveServerState {
  proc: ReturnType<typeof Bun.spawn>;
  pid: number;
  status: ServerStatus;
  startedAt: number;
  consoleLines: string[];
  onlinePlayers: Set<string>;
  lastPlayerActivityAt: number;
  metrics: RuntimeMetrics;
  lastCrash: CrashDiagnosis | null;
  intentionalStop: boolean;
  metricsTimer?: ReturnType<typeof setInterval>;
  autoBackupTimer?: ReturnType<typeof setInterval>;
}

const MAX_CONSOLE_LINES = 1000;

export interface CreateServerInput {
  name: string;
  engine: ServerEngine;
  mcVersion?: string;
  build?: string;
  jarId?: string;
  crossplayEnabled?: boolean;
  ramMinMb?: number;
  ramMaxMb?: number;
  onlineMode?: boolean;
  gamemode?: string;
  difficulty?: string;
  maxPlayers?: number;
  eulaAccepted?: boolean;
  autoShutdownMinutes?: number;
  autoBackupIntervalMinutes?: number;
  backupRetentionCount?: number;
}

export class ServerManager {
  private active = new Map<string, ActiveServerState>();
  private lastLogs = new Map<string, string[]>();
  private lastCrashes = new Map<string, CrashDiagnosis | null>();

  constructor(private readonly db: CraftDockDB) {}

  getServerDir(serverId: string): string {
    return path.join(this.db.paths.serversDir, serverId);
  }

  getConsoleLines(serverId: string): string[] {
    const running = this.active.get(serverId);
    if (running) return [...running.consoleLines];
    return [...(this.lastLogs.get(serverId) || [])];
  }

  isRunning(serverId: string): boolean {
    const st = this.active.get(serverId);
    return Boolean(st && (st.status === "running" || st.status === "starting"));
  }

  getOnlinePlayers(serverId: string): string[] {
    const st = this.active.get(serverId);
    return st ? Array.from(st.onlinePlayers) : [];
  }

  private emptyMetrics(): RuntimeMetrics {
    return {
      cpuPercent: 0,
      memoryMb: 0,
      uptimeSeconds: 0,
      onlinePlayers: [],
      idleMinutes: 0,
    };
  }

  toServerView(record: ServerRecord): ServerView {
    const serverDir = this.getServerDir(record.id);
    const props = readServerProperties(serverDir, record.engine, record.port, record.name);
    const active = this.active.get(record.id);
    const jar = record.jarId ? this.db.getJar(record.jarId) : null;

    return {
      ...record,
      status: active?.status || (this.lastCrashes.get(record.id) ? "crashed" : "stopped"),
      metrics: active ? { ...active.metrics, onlinePlayers: Array.from(active.onlinePlayers) } : this.emptyMetrics(),
      lastCrash: active?.lastCrash ?? this.lastCrashes.get(record.id) ?? null,
      hasIcon: fs.existsSync(path.join(serverDir, "server-icon.png")),
      onlineMode: props.onlineMode,
      maxPlayers: props.maxPlayers,
      difficulty: props.difficulty,
      gamemode: props.gamemode,
      motd: props.motd,
      jarName: jar?.name || null,
    };
  }

  listServerViews(): ServerView[] {
    return this.db.listServers().map((s) => this.toServerView(s));
  }

  getServerView(serverId: string): ServerView | null {
    const record = this.db.getServer(serverId);
    return record ? this.toServerView(record) : null;
  }

  async createServer(input: CreateServerInput): Promise<ServerView> {
    const id = crypto.randomUUID().slice(0, 12);
    const taskId = `create-${id}`;
    const serverDir = this.getServerDir(id);
    fs.mkdirSync(serverDir, { recursive: true });

    let jarItem: JarLibraryItem | null = null;
    let engine: ServerEngine = input.engine;
    let mcVersion = input.mcVersion || "1.21.4";

    eventBus.emitProgress({
      taskId,
      scope: "server",
      title: `Creando servidor "${input.name}"`,
      detail: "Resolviendo archivo de servidor (.jar / Bedrock)...",
      percent: 8,
      status: "running",
    });

    try {
      if (input.jarId) {
        jarItem = this.db.getJar(input.jarId);
        if (!jarItem || !fs.existsSync(jarItem.localPath)) {
          throw new Error("El archivo .jar seleccionado ya no existe en la Biblioteca.");
        }
        engine = jarItem.engine;
        mcVersion = jarItem.mcVersion;
      } else {
        if (engine === "custom") {
          throw new Error("Para un servidor personalizado debes elegir un .jar de tu Biblioteca.");
        }
        jarItem = await downloadOfficialJarToLibrary(
          this.db,
          engine,
          mcVersion,
          input.build
        );
      }

      const isBedrock = engine === "bedrock";
      const javaMajor = isBedrock
        ? 0
        : jarItem.javaMajor || getRequiredJavaMajor(mcVersion);

      const port = await findFreePort(this.db, isBedrock ? 19132 : 25565, isBedrock);
      const crossplayEnabled = engine === "paper" && Boolean(input.crossplayEnabled);
      const bedrockPort = crossplayEnabled
        ? await findFreePort(this.db, 19132, true)
        : null;

      eventBus.emitProgress({
        taskId,
        scope: "server",
        title: `Preparando archivos de "${input.name}"`,
        detail: isBedrock ? "Extrayendo Bedrock Dedicated Server..." : "Copiando motor del servidor...",
        percent: 45,
        status: "running",
      });

      await this.installJarFilesIntoServer(jarItem, serverDir, javaMajor, (line) => {
        eventBus.emitProgress({
          taskId,
          scope: "server",
          title: `Instalando ${engine.toUpperCase()}...`,
          detail: line.slice(0, 90),
          percent: 68,
          status: "running",
        });
      });

      if (crossplayEnabled && bedrockPort) {
        await installCrossplayPlugins(serverDir, bedrockPort, port, (detail, pct) => {
          eventBus.emitProgress({
            taskId,
            scope: "server",
            title: "Configurando Crossplay (Geyser + Floodgate)",
            detail,
            percent: 70 + Math.round(pct * 0.2),
            status: "running",
          });
        });
      }

      // Write default server.properties
      const propsContent = buildDefaultProperties(engine, {
        name: input.name,
        port,
        onlineMode: input.onlineMode ?? true,
        gamemode: input.gamemode || "survival",
        difficulty: input.difficulty || "normal",
        maxPlayers: input.maxPlayers || (isBedrock ? 10 : 20),
      });
      fs.writeFileSync(path.join(serverDir, "server.properties"), propsContent, "utf-8");

      if (!isBedrock && input.eulaAccepted) {
        fs.writeFileSync(
          path.join(serverDir, "eula.txt"),
          `# Aceptado por el usuario desde CraftDock (${new Date().toISOString()})\neula=true\n`,
          "utf-8"
        );
      }

      const now = new Date().toISOString();
      const record: ServerRecord = {
        id,
        name: input.name.trim(),
        engine,
        mcVersion,
        jarId: jarItem.id,
        crossplayEnabled,
        port,
        bedrockPort,
        ramMinMb: input.ramMinMb ?? 1024,
        ramMaxMb: input.ramMaxMb ?? 2048,
        javaMajor: isBedrock ? 0 : javaMajor,
        autoShutdownMinutes: input.autoShutdownMinutes ?? 0,
        autoBackupIntervalMinutes: input.autoBackupIntervalMinutes ?? 0,
        backupRetentionCount: input.backupRetentionCount ?? 5,
        eulaAccepted: isBedrock ? true : Boolean(input.eulaAccepted),
        tunnelAddress: "",
        tunnelBedrockAddress: "",
        createdAt: now,
        updatedAt: now,
      };

      this.db.insertServer(record);

      eventBus.emitProgress({
        taskId,
        scope: "server",
        title: `¡Servidor "${record.name}" listo!`,
        detail: "Ya puedes encenderlo desde el panel.",
        percent: 100,
        status: "done",
      });

      return this.toServerView(record);
    } catch (err: any) {
      fs.rmSync(serverDir, { recursive: true, force: true });
      eventBus.emitProgress({
        taskId,
        scope: "server",
        title: `Error creando "${input.name}"`,
        detail: err?.message || "No se pudo crear el servidor.",
        percent: 0,
        status: "error",
      });
      throw err;
    }
  }

  private async installJarFilesIntoServer(
    jarItem: JarLibraryItem,
    serverDir: string,
    javaMajor: number,
    onLog?: (line: string) => void
  ): Promise<void> {
    if (jarItem.engine === "bedrock") {
      await extractZipArchive(jarItem.localPath, serverDir);
      return;
    }

    if (jarItem.engine === "forge") {
      const javaExe = await ensureJavaRuntime(this.db, javaMajor || 21);
      const launch = await installForgeIntoServerDir(javaExe, jarItem.localPath, serverDir, onLog);
      fs.writeFileSync(
        path.join(serverDir, ".craftdock-launch.json"),
        JSON.stringify(launch, null, 2),
        "utf-8"
      );
      return;
    }

    // Standard Java JAR (Vanilla, Paper, Fabric, Custom)
    const targetJar = path.join(serverDir, "server.jar");
    fs.copyFileSync(jarItem.localPath, targetJar);
    fs.writeFileSync(
      path.join(serverDir, ".craftdock-launch.json"),
      JSON.stringify({ launchMode: "jar", targetRef: "server.jar" }, null, 2),
      "utf-8"
    );
  }

  async changeServerJar(serverId: string, jarId: string): Promise<ServerView> {
    const server = this.db.getServer(serverId);
    if (!server) throw new Error("Servidor no encontrado.");
    if (this.isRunning(serverId)) {
      throw new Error("Apaga el servidor antes de cambiar su archivo .jar.");
    }

    const jar = this.db.getJar(jarId);
    if (!jar || !fs.existsSync(jar.localPath)) {
      throw new Error("El archivo .jar seleccionado no existe en la Biblioteca.");
    }
    if ((server.engine === "bedrock") !== (jar.engine === "bedrock")) {
      throw new Error("No se puede cambiar directamente entre un servidor Java y uno Bedrock.");
    }

    // Automatic anti-disaster backup before switching engine/version!
    await createServerBackup(this.db, server, {
      label: `Antes de cambiar a ${jar.name}`,
      kind: "pre-change",
    });

    const serverDir = this.getServerDir(serverId);
    const nextJava = jar.engine === "bedrock" ? 0 : jar.javaMajor || getRequiredJavaMajor(jar.mcVersion);

    await this.installJarFilesIntoServer(jar, serverDir, nextJava);

    const updated = this.db.updateServer(serverId, {
      engine: jar.engine,
      mcVersion: jar.mcVersion,
      jarId: jar.id,
      javaMajor: nextJava,
      crossplayEnabled: jar.engine === "paper" ? server.crossplayEnabled : false,
    });
    if (!updated) throw new Error("No se pudo actualizar el servidor.");

    return this.toServerView(updated);
  }

  async toggleCrossplay(serverId: string, enabled: boolean): Promise<ServerView> {
    const server = this.db.getServer(serverId);
    if (!server) throw new Error("Servidor no encontrado.");
    if (server.engine !== "paper") {
      throw new Error("Crossplay automático (Geyser + Floodgate) está disponible para servidores Paper.");
    }
    if (this.isRunning(serverId)) {
      throw new Error("Apaga el servidor antes de activar o desactivar Crossplay.");
    }

    const serverDir = this.getServerDir(serverId);
    let bedrockPort = server.bedrockPort;
    if (enabled) {
      bedrockPort = bedrockPort || (await findFreePort(this.db, 19132, true));
      await installCrossplayPlugins(serverDir, bedrockPort, server.port);
    } else {
      removeCrossplayPlugins(serverDir);
    }

    const updated = this.db.updateServer(serverId, {
      crossplayEnabled: enabled,
      bedrockPort: enabled ? bedrockPort : null,
    });
    return this.toServerView(updated!);
  }

  async startServer(serverId: string): Promise<ServerView> {
    const server = this.db.getServer(serverId);
    if (!server) throw new Error("Servidor no encontrado.");
    if (this.isRunning(serverId)) {
      return this.toServerView(server);
    }

    const serverDir = this.getServerDir(serverId);
    if (!fs.existsSync(serverDir)) {
      throw new Error("La carpeta del servidor no existe en disco.");
    }

    let command: string[];
    if (server.engine === "bedrock") {
      const bedrockExe = path.join(serverDir, "bedrock_server.exe");
      if (!fs.existsSync(bedrockExe)) {
        throw new Error("No se encontró bedrock_server.exe en la carpeta del servidor.");
      }
      command = [bedrockExe];
    } else {
      if (!server.eulaAccepted) {
        const eulaPath = path.join(serverDir, "eula.txt");
        if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, "utf-8").includes("eula=true")) {
          throw new Error("Debes aceptar el EULA de Minecraft antes de encender este servidor.");
        }
      } else {
        fs.writeFileSync(
          path.join(serverDir, "eula.txt"),
          "# Aceptado desde CraftDock\neula=true\n",
          "utf-8"
        );
      }

      const javaExe = await ensureJavaRuntime(this.db, server.javaMajor || 21);
      const launchMetaPath = path.join(serverDir, ".craftdock-launch.json");
      let launchMeta: { launchMode: "jar" | "win_args"; targetRef: string } = {
        launchMode: "jar",
        targetRef: "server.jar",
      };
      if (fs.existsSync(launchMetaPath)) {
        try {
          launchMeta = JSON.parse(fs.readFileSync(launchMetaPath, "utf-8"));
        } catch {
          // keep default
        }
      }

      const jvmArgs = [
        `-Xms${Math.min(server.ramMinMb, server.ramMaxMb)}M`,
        `-Xmx${server.ramMaxMb}M`,
        "-XX:+UseG1GC",
        "-XX:+ParallelRefProcEnabled",
        "-XX:MaxGCPauseMillis=200",
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:+DisableExplicitGC",
        "-Dfile.encoding=UTF-8",
      ];

      if (launchMeta.launchMode === "win_args") {
        // Forge 1.17+ uses user_jvm_args.txt + @libraries/.../win_args.txt
        fs.writeFileSync(
          path.join(serverDir, "user_jvm_args.txt"),
          jvmArgs.join("\n") + "\n",
          "utf-8"
        );
        command = [javaExe, "@user_jvm_args.txt", launchMeta.targetRef, "nogui"];
      } else {
        const jarFull = path.join(serverDir, launchMeta.targetRef);
        if (!fs.existsSync(jarFull)) {
          throw new Error(`No se encontró ${launchMeta.targetRef} en la carpeta del servidor.`);
        }
        command = [javaExe, ...jvmArgs, "-jar", launchMeta.targetRef, "nogui"];
      }
    }

    this.lastCrashes.set(serverId, null);

    const proc = Bun.spawn(command, {
      cwd: serverDir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const state: ActiveServerState = {
      proc,
      pid: proc.pid,
      status: "starting",
      startedAt: Date.now(),
      consoleLines: [],
      onlinePlayers: new Set<string>(),
      lastPlayerActivityAt: Date.now(),
      metrics: this.emptyMetrics(),
      lastCrash: null,
      intentionalStop: false,
    };
    this.active.set(serverId, state);
    this.emitStatus(serverId, "starting", null);

    const pushLine = (rawLine: string) => {
      const line = rawLine.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trimEnd();
      if (!line) return;

      state.consoleLines.push(line);
      if (state.consoleLines.length > MAX_CONSOLE_LINES) {
        state.consoleLines.shift();
      }
      this.lastLogs.set(serverId, [...state.consoleLines]);

      eventBus.emit({
        type: "console_line",
        serverId,
        line,
        timestamp: new Date().toISOString(),
      });

      this.parseConsoleOutput(serverId, server.engine, state, line);
    };

    const consume = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const decoder = new TextDecoder();
      const reader = stream.getReader();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || "";
        for (const l of lines) pushLine(l);
      }
      if (buf) pushLine(buf);
    };

    void consume(proc.stdout);
    void consume(proc.stderr);

    // Poll metrics & auto-shutdown every 4 seconds
    state.metricsTimer = setInterval(() => {
      void this.updateProcessMetrics(serverId, state);
    }, 4000);

    // Optional scheduled auto-backup timer
    if (server.autoBackupIntervalMinutes > 0) {
      state.autoBackupTimer = setInterval(() => {
        const current = this.db.getServer(serverId);
        if (current && this.isRunning(serverId)) {
          void createServerBackup(this.db, current, {
            kind: "scheduled",
            isRunning: true,
            sendConsoleCommand: (cmd) => this.sendCommand(serverId, cmd),
          }).catch(() => {});
        }
      }, server.autoBackupIntervalMinutes * 60_000);
    }

    proc.exited.then((code) => {
      if (state.metricsTimer) clearInterval(state.metricsTimer);
      if (state.autoBackupTimer) clearInterval(state.autoBackupTimer);

      const wasIntentional = state.intentionalStop;
      let diagnosis: CrashDiagnosis | null = null;
      let nextStatus: ServerStatus = "stopped";

      if (!wasIntentional && (code !== 0 || state.status === "starting")) {
        diagnosis = analyzeCrashLogs(state.consoleLines, serverDir);
        nextStatus = "crashed";
      }

      this.lastLogs.set(serverId, [...state.consoleLines]);
      this.lastCrashes.set(serverId, diagnosis);
      this.active.delete(serverId);
      this.emitStatus(serverId, nextStatus, diagnosis);
    });

    return this.toServerView(server);
  }

  private parseConsoleOutput(
    serverId: string,
    engine: ServerEngine,
    state: ActiveServerState,
    line: string
  ): void {
    // Detect ready state
    if (state.status === "starting") {
      if (
        (engine === "bedrock" && /Server started\.?/i.test(line)) ||
        (engine !== "bedrock" && /Done \([0-9.,]+s\)! For help, type "help"/i.test(line))
      ) {
        state.status = "running";
        this.emitStatus(serverId, "running", null);
      }
    }

    // Track players joining / leaving
    if (engine === "bedrock") {
      const join = line.match(/Player connected:\s*([^,]+),/i);
      const leave = line.match(/Player disconnected:\s*([^,]+),/i);
      if (join?.[1]) {
        state.onlinePlayers.add(join[1].trim());
        state.lastPlayerActivityAt = Date.now();
      } else if (leave?.[1]) {
        state.onlinePlayers.delete(leave[1].trim());
        if (state.onlinePlayers.size === 0) state.lastPlayerActivityAt = Date.now();
      }
    } else {
      const join = line.match(/]:\s+([a-zA-Z0-9_.-]{2,32}) joined the game/i);
      const leave = line.match(/]:\s+([a-zA-Z0-9_.-]{2,32}) left the game/i);
      if (join?.[1]) {
        state.onlinePlayers.add(join[1].trim());
        state.lastPlayerActivityAt = Date.now();
      } else if (leave?.[1]) {
        state.onlinePlayers.delete(leave[1].trim());
        if (state.onlinePlayers.size === 0) state.lastPlayerActivityAt = Date.now();
      }
    }
  }

  private async updateProcessMetrics(
    serverId: string,
    state: ActiveServerState
  ): Promise<void> {
    if (!this.active.has(serverId)) return;

    const uptimeSeconds = Math.floor((Date.now() - state.startedAt) / 1000);
    const idleMinutes =
      state.onlinePlayers.size === 0
        ? Math.floor((Date.now() - state.lastPlayerActivityAt) / 60_000)
        : 0;

    let memoryMb = state.metrics.memoryMb;
    let cpuPercent = state.metrics.cpuPercent;

    try {
      // Lightweight Windows process memory lookup via PowerShell Get-Process
      const probe = Bun.spawn(
        [
          "powershell",
          "-NoProfile",
          "-Command",
          `$p = Get-Process -Id ${state.pid} -ErrorAction SilentlyContinue; if ($p) { Write-Output "$($p.WorkingSet64)|$([math]::Round($p.CPU, 2))" }`,
        ],
        { stdout: "pipe", stderr: "ignore" }
      );
      const out = (await new Response(probe.stdout).text()).trim();
      if (out.includes("|")) {
        const [wsStr] = out.split("|");
        const wsBytes = Number(wsStr);
        if (!Number.isNaN(wsBytes) && wsBytes > 0) {
          memoryMb = Math.round(wsBytes / (1024 * 1024));
        }
      }
      cpuPercent = Math.min(100, Math.max(0, cpuPercent));
    } catch {
      // non-fatal metric miss
    }

    state.metrics = {
      cpuPercent,
      memoryMb,
      uptimeSeconds,
      onlinePlayers: Array.from(state.onlinePlayers),
      idleMinutes,
    };

    eventBus.emit({
      type: "server_metrics",
      serverId,
      metrics: state.metrics,
    });

    // Check auto-shutdown when idle with 0 players
    const record = this.db.getServer(serverId);
    if (
      record &&
      record.autoShutdownMinutes > 0 &&
      state.status === "running" &&
      state.onlinePlayers.size === 0 &&
      idleMinutes >= record.autoShutdownMinutes
    ) {
      eventBus.emit({
        type: "console_line",
        serverId,
        line: `[CraftDock] Auto-apagado activado: ${record.autoShutdownMinutes} minutos sin jugadores conectados.`,
        timestamp: new Date().toISOString(),
      });
      void this.stopServer(serverId);
    }
  }

  sendCommand(serverId: string, command: string): void {
    const state = this.active.get(serverId);
    if (!state || !state.proc.stdin) {
      throw new Error("El servidor no está encendido.");
    }
    const clean = command.replace(/[\r\n]+/g, " ").trim();
    if (!clean) return;
    const stdin = state.proc.stdin;
    if (typeof stdin !== "number") {
      stdin.write(`${clean}\n`);
      stdin.flush?.();
    }
  }

  async stopServer(serverId: string): Promise<void> {
    const state = this.active.get(serverId);
    if (!state) return;

    state.intentionalStop = true;
    state.status = "stopping";
    this.emitStatus(serverId, "stopping", null);

    const record = this.db.getServer(serverId);
    try {
      if (record && record.engine !== "bedrock") {
        this.sendCommand(serverId, "save-all");
        await Bun.sleep(600);
      }
      this.sendCommand(serverId, "stop");
    } catch {
      // proceed to wait/kill
    }

    const exited = await Promise.race([
      state.proc.exited.then(() => true),
      Bun.sleep(20_000).then(() => false),
    ]);

    if (!exited && this.active.has(serverId)) {
      try {
        state.proc.kill();
      } catch {
        // ignore
      }
    }
  }

  async restartServer(serverId: string): Promise<ServerView> {
    if (this.isRunning(serverId)) {
      await this.stopServer(serverId);
    }
    return this.startServer(serverId);
  }

  async applyCrashQuickAction(serverId: string): Promise<{ message: string; server: ServerView }> {
    const server = this.db.getServer(serverId);
    if (!server) throw new Error("Servidor no encontrado.");
    const crash = this.lastCrashes.get(serverId);
    if (!crash?.quickAction) {
      throw new Error("No hay una acción rápida automática para este error.");
    }

    const action = crash.quickAction;
    const serverDir = this.getServerDir(serverId);

    if (action.type === "assign_free_port") {
      const nextPort = await findFreePort(
        this.db,
        server.engine === "bedrock" ? 19132 : 25565,
        server.engine === "bedrock"
      );
      writeServerProperties(serverDir, server.engine, { serverPort: nextPort });
      const updated = this.db.updateServer(serverId, { port: nextPort })!;
      this.lastCrashes.set(serverId, null);
      return {
        message: `Puerto actualizado automáticamente al ${nextPort}. Ya puedes encender el servidor.`,
        server: this.toServerView(updated),
      };
    }

    if (action.type === "switch_java") {
      const targetJava = Number(action.payload?.javaMajor || 21);
      const updated = this.db.updateServer(serverId, { javaMajor: targetJava })!;
      this.lastCrashes.set(serverId, null);
      return {
        message: `Java cambiado a versión ${targetJava}. Se descargará automáticamente al encender.`,
        server: this.toServerView(updated),
      };
    }

    if (action.type === "increase_ram") {
      const sys = getSystemInfo(this.db);
      const evalZone = evaluateRamZone(server.ramMaxMb + 1024, sys.totalRamMb);
      const safeTarget = Math.min(server.ramMaxMb + 1024, evalZone.yellowMaxMb);
      const updated = this.db.updateServer(serverId, { ramMaxMb: Math.max(server.ramMaxMb, safeTarget) })!;
      this.lastCrashes.set(serverId, null);
      return {
        message: `RAM ajustada a ${updated.ramMaxMb} MB.`,
        server: this.toServerView(updated),
      };
    }

    if (action.type === "accept_eula") {
      fs.writeFileSync(
        path.join(serverDir, "eula.txt"),
        `# Aceptado desde CraftDock (${new Date().toISOString()})\neula=true\n`,
        "utf-8"
      );
      const updated = this.db.updateServer(serverId, { eulaAccepted: true })!;
      this.lastCrashes.set(serverId, null);
      return {
        message: "EULA aceptado correctamente. Ya puedes encender el servidor.",
        server: this.toServerView(updated),
      };
    }

    return {
      message: "Sigue la acción sugerida en la interfaz.",
      server: this.toServerView(server),
    };
  }

  async deleteServer(serverId: string): Promise<void> {
    if (this.isRunning(serverId)) {
      await this.stopServer(serverId);
    }
    const serverDir = this.getServerDir(serverId);
    const backupDir = path.join(this.db.paths.backupsDir, serverId);
    if (fs.existsSync(serverDir)) fs.rmSync(serverDir, { recursive: true, force: true });
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
    this.lastLogs.delete(serverId);
    this.lastCrashes.delete(serverId);
    this.db.deleteServer(serverId);
  }

  buildInviteText(serverId: string): { text: string; lanAddress: string } {
    const view = this.getServerView(serverId);
    if (!view) throw new Error("Servidor no encontrado.");
    const lanIp = detectLanIp();
    const lanAddress = `${lanIp}:${view.port}`;

    const engineLabel: Record<ServerEngine, string> = {
      vanilla: "Minecraft Java Vanilla",
      paper: view.crossplayEnabled ? "Paper Crossplay (Java + Bedrock)" : "Minecraft Java (Paper)",
      fabric: "Minecraft Java (Fabric con Mods)",
      forge: "Minecraft Java (Forge con Mods)",
      bedrock: "Minecraft Bedrock",
      custom: "Minecraft Java (.jar personalizado)",
    };

    const lines = [
      `🎮 ¡Únete a mi servidor "${view.name}"!`,
      `📦 Edición: ${engineLabel[view.engine]} — Versión ${view.mcVersion}`,
      `🔑 Acceso: ${view.onlineMode ? "Solo Premium (Cuenta oficial)" : "Premium y No-Premium"}`,
    ];

    if (view.tunnelAddress) {
      lines.push(`🌐 IP para conectar (Java / Internet): ${view.tunnelAddress}`);
    } else {
      lines.push(`🏠 IP en red local (LAN): ${lanAddress}`);
      lines.push(`💡 (Activa el túnel playit.gg en CraftDock para compartir IP a todo el país)`);
    }

    if (view.crossplayEnabled && view.tunnelBedrockAddress) {
      lines.push(`📱 IP para Bedrock / Celular: ${view.tunnelBedrockAddress}`);
    } else if (view.engine === "bedrock" && !view.tunnelAddress) {
      lines.push(`📱 Puerto Bedrock local: ${view.port}`);
    }

    if (view.engine === "fabric" || view.engine === "forge") {
      lines.push(`🧩 Nota: Requiere instalar el pack de mods (${view.engine.toUpperCase()} ${view.mcVersion}).`);
    }

    return { text: lines.join("\n"), lanAddress };
  }

  async shutdownAll(): Promise<void> {
    const ids = Array.from(this.active.keys());
    await Promise.all(ids.map((id) => this.stopServer(id)));
  }

  private emitStatus(
    serverId: string,
    status: ServerStatus,
    lastCrash: CrashDiagnosis | null
  ): void {
    eventBus.emit({
      type: "server_status",
      serverId,
      status,
      lastCrash,
    });
  }
}
