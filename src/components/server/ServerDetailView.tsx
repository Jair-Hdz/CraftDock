import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Play,
  Square,
  RotateCw,
  Share2,
  Trash2,
  Terminal,
  Settings,
  Users,
  Package,
  Puzzle,
  Archive,
  FolderOpen,
  AlertTriangle,
  Sparkles,
  Send,
  Shield,
  UserX,
  UserCheck,
  Image as ImageIcon,
  Layers,
  HardDrive,
  Clock,
  Cpu,
} from "lucide-react";
import type {
  JarLibraryItem,
  PlayersState,
  ServerPropertiesForm,
  ServerView,
  SystemInfo,
} from "../../../shared/types";
import { api, formatUptime, resizeImageTo64Png } from "../../lib/api";
import { Button, EngineBadge, RamSelector, StatusBadge } from "../ui/Primitives";
import { BackupsWorldsTab } from "./BackupsWorldsTab";
import { DatapacksTab } from "./DatapacksTab";
import { FileLibraryTab } from "./FileLibraryTab";
import { ModsPluginsTab } from "./ModsPluginsTab";

type DetailTab = "console" | "settings" | "players" | "mods" | "datapacks" | "backups" | "files";

export function ServerDetailView({
  server,
  consoleLines,
  system,
  jars,
  onBack,
  onServerUpdated,
  onServerDeleted,
  onCopyInvite,
  onToast,
}: {
  server: ServerView;
  consoleLines: string[];
  system: SystemInfo | null;
  jars: JarLibraryItem[];
  onBack: () => void;
  onServerUpdated: (s: ServerView) => void;
  onServerDeleted: (id: string) => void;
  onCopyInvite: (id: string) => void;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("console");
  const [command, setCommand] = useState("");
  const [consoleSearch, setConsoleSearch] = useState("");
  const [modrinthPrefill, setModrinthPrefill] = useState("");
  const [busyAction, setBusyAction] = useState(false);

  // Settings tab state
  const [propsForm, setPropsForm] = useState<ServerPropertiesForm | null>(null);
  const [ramMaxMb, setRamMaxMb] = useState(server.ramMaxMb);
  const [javaMajor, setJavaMajor] = useState(server.javaMajor);
  const [autoShutdown, setAutoShutdown] = useState(server.autoShutdownMinutes);
  const [selectedJarId, setSelectedJarId] = useState(server.jarId || "");
  const [savingSettings, setSavingSettings] = useState(false);
  const [switchingJar, setSwitchingJar] = useState(false);

  // Regenerate World state
  const [regenSeed, setRegenSeed] = useState("");
  const [regenBackup, setRegenBackup] = useState(true);
  const [regenKeepDatapacks, setRegenKeepDatapacks] = useState(true);
  const [regeneratingWorld, setRegeneratingWorld] = useState(false);

  // Players tab state
  const [players, setPlayers] = useState<PlayersState | null>(null);
  const [playerInput, setPlayerInput] = useState("");

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const isOnline = server.status === "running" || server.status === "starting";

  useEffect(() => {
    setRamMaxMb(server.ramMaxMb);
    setJavaMajor(server.javaMajor);
    setAutoShutdown(server.autoShutdownMinutes);
    setSelectedJarId(server.jarId || "");
  }, [server.id, server.ramMaxMb, server.javaMajor, server.autoShutdownMinutes, server.jarId]);

  useEffect(() => {
    if (tab === "console" && !consoleSearch) {
      consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleLines.length, tab]);

  useEffect(() => {
    if (tab === "settings") {
      api
        .getProperties(server.id)
        .then((res) => setPropsForm(res.properties))
        .catch((err) => onToast("error", err.message));
    }
    if (tab === "players") {
      api
        .getPlayers(server.id)
        .then((res) => setPlayers(res.players))
        .catch((err) => onToast("error", err.message));
    }
  }, [tab, server.id]);

  const handleLifecycle = async (action: "start" | "stop" | "restart") => {
    setBusyAction(true);
    try {
      const res =
        action === "start"
          ? await api.startServer(server.id)
          : action === "stop"
          ? await api.stopServer(server.id)
          : await api.restartServer(server.id);
      if (res.server) onServerUpdated(res.server);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    try {
      await api.sendCommand(server.id, command.trim());
      setCommand("");
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleCrashAction = async () => {
    const qa = server.lastCrash?.quickAction;
    if (!qa) return;
    if (qa.type === "search_modrinth") {
      setModrinthPrefill(String(qa.payload?.query || ""));
      setTab("mods");
      return;
    }
    if (qa.type === "open_mods") {
      setTab("mods");
      return;
    }
    try {
      const res = await api.applyCrashFix(server.id);
      onServerUpdated(res.server);
      onToast("success", res.message);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propsForm) return;
    setSavingSettings(true);
    try {
      await api.saveProperties(server.id, propsForm);
      const res = await api.updateServer(server.id, {
        ramMaxMb,
        ramMinMb: Math.min(1024, ramMaxMb),
        javaMajor,
        autoShutdownMinutes: autoShutdown,
        port: propsForm.serverPort,
      });
      onServerUpdated(res.server);
      onToast("success", "Ajustes guardados. Reinicia el servidor si estaba encendido.");
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangeJar = async () => {
    if (!selectedJarId) return;
    if (
      !window.confirm(
        "¿Cambiar el archivo .jar de este servidor? CraftDock hará un respaldo automático de seguridad antes de aplicar el cambio."
      )
    ) {
      return;
    }
    setSwitchingJar(true);
    try {
      const res = await api.changeServerJar(server.id, selectedJarId);
      onServerUpdated(res.server);
      onToast("success", "Archivo .jar actualizado con respaldo previo automático.");
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSwitchingJar(false);
    }
  };

  const handleUploadIcon = async (file: File | undefined) => {
    if (!file) return;
    try {
      const pngBlob = await resizeImageTo64Png(file);
      await api.uploadIcon(server.id, pngBlob);
      onServerUpdated({ ...server, hasIcon: true, updatedAt: new Date().toISOString() });
      onToast("success", "Ícono del servidor (64x64 PNG) actualizado.");
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handlePlayerAction = async (action: string, targetName: string) => {
    if (!targetName.trim()) {
      onToast("error", "Escribe el nombre del jugador.");
      return;
    }
    try {
      const res = await api.playerAction(server.id, action, targetName.trim());
      setPlayers(res.players);
      setPlayerInput("");
      onToast("success", `Acción "${action}" aplicada a ${targetName}.`);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleDeleteServer = async () => {
    if (
      !window.confirm(
        `¿Eliminar definitivamente el servidor "${server.name}" junto con sus mundos y respaldos?`
      )
    ) {
      return;
    }
    try {
      await api.deleteServer(server.id);
      onToast("info", `Servidor "${server.name}" eliminado.`);
      onServerDeleted(server.id);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleRegenerateWorld = async () => {
    if (isOnline) {
      onToast("error", "Apaga el servidor antes de generar un nuevo mundo.");
      return;
    }
    const confirmMsg = regenBackup
      ? `¿Eliminar el mundo actual de "${server.name}" y generar uno nuevo?\n\nSe creará un respaldo de seguridad antes de borrar.`
      : `¿Eliminar DEFINITIVAMENTE el mundo actual de "${server.name}" (Overworld, Nether y End) sin respaldo y generar uno nuevo?`;

    if (!window.confirm(confirmMsg)) return;

    setRegeneratingWorld(true);
    try {
      const res = await api.regenerateWorld(server.id, {
        newSeed: regenSeed.trim(),
        createBackupFirst: regenBackup,
        keepDatapacks: regenKeepDatapacks,
      });
      if (propsForm) {
        setPropsForm({ ...propsForm, levelSeed: res.newSeed });
      }
      setRegenSeed("");
      onToast(
        "success",
        `¡Mundo eliminado${res.backupCreated ? " (con respaldo guardado)" : ""}${
          res.preservedDatapacks ? " y Datapacks conservados" : ""
        }! Enciende el servidor para generar el nuevo mundo.`
      );
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setRegeneratingWorld(false);
    }
  };

  const compatibleJars = jars.filter(
    (j) => (j.engine === "bedrock") === (server.engine === "bedrock")
  );

  const visibleConsole = consoleSearch.trim()
    ? consoleLines.filter((l) => l.toLowerCase().includes(consoleSearch.toLowerCase()))
    : consoleLines;

  return (
    <div className="space-y-5 animate-fade-slide-up">
      {/* Top Server Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border-subtle">
        <div className="flex items-center gap-3.5 min-w-0">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-surface border border-border-subtle hover:border-border-strong text-text-secondary hover:text-text-primary transition-colors"
            title="Volver a Mis Servidores"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="w-12 h-12 rounded-lg bg-elevated border border-border-subtle overflow-hidden shrink-0 flex items-center justify-center">
            {server.hasIcon ? (
              <img
                src={`/api/servers/${server.id}/icon?t=${encodeURIComponent(server.updatedAt)}`}
                alt={server.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-mono font-bold text-lg text-emerald-400">
                {server.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-text-primary truncate">{server.name}</h1>
              <StatusBadge status={server.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
              <EngineBadge engine={server.engine} crossplay={server.crossplayEnabled} />
              <span className="font-mono text-text-secondary">v{server.mcVersion}</span>
              {server.engine !== "bedrock" && (
                <span className="font-mono text-text-muted">• Java {server.javaMajor}</span>
              )}
              <span className="font-mono text-text-muted">• Puerto {server.port}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOnline ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                loading={busyAction}
                onClick={() => handleLifecycle("restart")}
              >
                <RotateCw className="w-3.5 h-3.5" />
                Reiniciar
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={busyAction}
                onClick={() => handleLifecycle("stop")}
              >
                <Square className="w-3.5 h-3.5" />
                Apagar Seguro
              </Button>
            </>
          ) : (
            <Button size="sm" loading={busyAction} onClick={() => handleLifecycle("start")}>
              <Play className="w-3.5 h-3.5" />
              Encender Servidor
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => onCopyInvite(server.id)}>
            <Share2 className="w-3.5 h-3.5 text-emerald-400" />
            Invitar Amigos
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDeleteServer} title="Eliminar servidor">
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
          </Button>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-border-subtle">
        {[
          { id: "console", label: "Consola y Resumen", icon: Terminal },
          { id: "settings", label: "Ajustes y .JAR", icon: Settings },
          { id: "players", label: "Jugadores", icon: Users },
          { id: "mods", label: "Mods / Plugins", icon: Package },
          { id: "datapacks", label: "Datapacks", icon: Puzzle },
          { id: "backups", label: "Mundos y Backups", icon: Archive },
          { id: "files", label: "Archivos y Editor", icon: FolderOpen },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id as DetailTab)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-emerald-500/12 text-emerald-300 border border-emerald-500/30"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface border border-transparent"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: CONSOLE & SUMMARY */}
      {tab === "console" && (
        <div className="space-y-4 animate-fade-slide-up">
          {/* Smart Crash Diagnosis Banner */}
          {server.lastCrash && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-200">{server.lastCrash.title}</p>
                  <p className="text-xs text-red-100/80 mt-0.5 leading-relaxed">
                    {server.lastCrash.explanation}
                  </p>
                  {server.lastCrash.matchedLine && (
                    <code className="block mt-1.5 text-[11px] font-mono text-red-300/90 bg-black/30 px-2 py-1 rounded">
                      {server.lastCrash.matchedLine}
                    </code>
                  )}
                </div>
              </div>
              {server.lastCrash.quickAction && (
                <Button size="sm" onClick={handleCrashAction} className="shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                  {server.lastCrash.quickAction.label}
                </Button>
              )}
            </div>
          )}

          {/* Live Metrics Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-surface border border-border-subtle rounded-xl p-3.5">
              <p className="text-xs text-text-secondary flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                RAM en uso
              </p>
              <p className="text-base font-bold font-mono mt-1">
                {server.metrics.memoryMb} MB{" "}
                <span className="text-xs font-normal text-text-muted">
                  / {server.ramMaxMb} MB
                </span>
              </p>
            </div>
            <div className="bg-surface border border-border-subtle rounded-xl p-3.5">
              <p className="text-xs text-text-secondary flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-sky-400" />
                Jugadores
              </p>
              <p className="text-base font-bold font-mono mt-1">
                {server.metrics.onlinePlayers.length}{" "}
                <span className="text-xs font-normal text-text-muted">/ {server.maxPlayers}</span>
              </p>
            </div>
            <div className="bg-surface border border-border-subtle rounded-xl p-3.5">
              <p className="text-xs text-text-secondary flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Tiempo encendido
              </p>
              <p className="text-base font-bold font-mono mt-1">
                {isOnline ? formatUptime(server.metrics.uptimeSeconds) : "Apagado"}
              </p>
            </div>
            <div className="bg-surface border border-border-subtle rounded-xl p-3.5">
              <p className="text-xs text-text-secondary flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-teal-400" />
                Dirección
              </p>
              <p className="text-xs font-bold font-mono text-emerald-400 mt-1.5 truncate">
                {server.tunnelAddress || `${system?.lanIp || "127.0.0.1"}:${server.port}`}
              </p>
            </div>
          </div>

          {/* Live Console */}
          <div className="bg-terminal border border-border-strong rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 bg-surface/80 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-text-secondary flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                Consola en vivo ({visibleConsole.length} líneas)
              </span>
              <input
                type="text"
                value={consoleSearch}
                onChange={(e) => setConsoleSearch(e.target.value)}
                placeholder="Filtrar logs..."
                className="bg-canvas border border-border-subtle rounded-md px-2.5 py-1 text-xs font-mono text-text-primary w-48 focus:outline-none focus:border-emerald-mc"
              />
            </div>

            <div className="p-4 h-[380px] overflow-y-auto font-mono text-xs leading-relaxed space-y-0.5">
              {visibleConsole.length === 0 ? (
                <p className="text-text-muted italic">
                  {isOnline
                    ? "Esperando salida del servidor..."
                    : "El servidor está apagado. Presiona 'Encender Servidor' para ver la consola en vivo."}
                </p>
              ) : (
                visibleConsole.map((line, i) => {
                  const cls = /ERROR|FATAL|Exception/i.test(line)
                    ? "text-red-400"
                    : /WARN/i.test(line)
                    ? "text-amber-300"
                    : /Done \(|Server started/i.test(line)
                    ? "text-emerald-400 font-semibold"
                    : "text-slate-300";
                  return (
                    <div key={i} className={`whitespace-pre-wrap break-words ${cls}`}>
                      {line}
                    </div>
                  );
                })
              )}
              <div ref={consoleEndRef} />
            </div>

            <form
              onSubmit={handleSendCommand}
              className="border-t border-border-subtle p-2.5 bg-surface/60 flex gap-2"
            >
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={!isOnline}
                placeholder={
                  isOnline
                    ? "Escribe un comando (ej. say Hola a todos, op TuNombre, time set day)..."
                    : "Enciende el servidor para enviar comandos..."
                }
                className="flex-1 bg-canvas border border-border-strong rounded-lg px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-emerald-mc disabled:opacity-50"
              />
              <Button type="submit" size="sm" disabled={!isOnline || !command.trim()}>
                <Send className="w-3.5 h-3.5" />
                Enviar
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: VISUAL SETTINGS & JAR SWITCHER */}
      {tab === "settings" && propsForm && (
        <div className="space-y-6 animate-fade-slide-up">
          <form
            onSubmit={handleSaveSettings}
            className="bg-surface border border-border-subtle rounded-xl p-5 space-y-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Ajustes Visuales del Servidor</h2>
              <Button type="submit" loading={savingSettings}>
                Guardar Cambios
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Descripción / MOTD
                </label>
                <input
                  type="text"
                  value={propsForm.motd}
                  onChange={(e) => setPropsForm({ ...propsForm, motd: e.target.value })}
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Semilla del mundo (level-seed)
                </label>
                <input
                  type="text"
                  value={propsForm.levelSeed}
                  onChange={(e) => setPropsForm({ ...propsForm, levelSeed: e.target.value })}
                  placeholder="Opcional (se aplica al generar mundo nuevo)"
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Modo de juego
                </label>
                <select
                  value={propsForm.gamemode}
                  onChange={(e) => setPropsForm({ ...propsForm, gamemode: e.target.value })}
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
                >
                  <option value="survival">Supervivencia</option>
                  <option value="creative">Creativo</option>
                  <option value="adventure">Aventura</option>
                  {server.engine !== "bedrock" && <option value="spectator">Espectador</option>}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Dificultad
                </label>
                <select
                  value={propsForm.difficulty}
                  onChange={(e) => setPropsForm({ ...propsForm, difficulty: e.target.value })}
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
                >
                  <option value="peaceful">Pacífico</option>
                  <option value="easy">Fácil</option>
                  <option value="normal">Normal</option>
                  <option value="hard">Difícil</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Jugadores máximos
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={propsForm.maxPlayers}
                  onChange={(e) =>
                    setPropsForm({ ...propsForm, maxPlayers: Number(e.target.value) })
                  }
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Puerto local ({server.engine === "bedrock" ? "UDP" : "TCP"})
                </label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={propsForm.serverPort}
                  onChange={(e) =>
                    setPropsForm({ ...propsForm, serverPort: Number(e.target.value) })
                  }
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Distancia de visión (chunks)
                </label>
                <input
                  type="number"
                  min={4}
                  max={32}
                  value={propsForm.viewDistance}
                  onChange={(e) =>
                    setPropsForm({ ...propsForm, viewDistance: Number(e.target.value) })
                  }
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Auto-apagado si pasan X minutos sin jugadores (0 = desactivado)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={autoShutdown}
                  onChange={(e) => setAutoShutdown(Number(e.target.value))}
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  key: "onlineMode",
                  label: "Permitir No-Premium",
                  checked: !propsForm.onlineMode,
                  onToggle: (v: boolean) => setPropsForm({ ...propsForm, onlineMode: !v }),
                },
                {
                  key: "pvp",
                  label: "PvP entre jugadores",
                  checked: propsForm.pvp,
                  onToggle: (v: boolean) => setPropsForm({ ...propsForm, pvp: v }),
                },
                {
                  key: "whiteList",
                  label: "Activar Whitelist privada",
                  checked: propsForm.whiteList,
                  onToggle: (v: boolean) => setPropsForm({ ...propsForm, whiteList: v }),
                },
                {
                  key: "allowCheats",
                  label: server.engine === "bedrock" ? "Permitir trucos" : "Bloques de comandos",
                  checked: propsForm.allowCheats,
                  onToggle: (v: boolean) => setPropsForm({ ...propsForm, allowCheats: v }),
                },
              ].map((t) => (
                <label
                  key={t.key}
                  className="flex items-center gap-2.5 p-3 rounded-lg bg-canvas border border-border-subtle cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={t.checked}
                    onChange={(e) => t.onToggle(e.target.checked)}
                    className="accent-[#1BD96A] w-4 h-4"
                  />
                  <span className="text-sm text-text-primary">{t.label}</span>
                </label>
              ))}
            </div>

            {server.engine !== "bedrock" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
                <div className="lg:col-span-2">
                  <RamSelector valueMb={ramMaxMb} onChange={setRamMaxMb} system={system} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">
                    Versión de Java
                  </label>
                  <select
                    value={javaMajor}
                    onChange={(e) => setJavaMajor(Number(e.target.value))}
                    className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2.5 text-sm font-mono text-text-primary"
                  >
                    <option value={8}>Java 8 (≤ 1.16.5)</option>
                    <option value={17}>Java 17 (1.17 – 1.20.4)</option>
                    <option value={21}>Java 21 (1.20.5 – 1.21.x)</option>
                    <option value={25}>Java 25 (26.x+)</option>
                  </select>
                </div>
              </div>
            )}
          </form>

          {/* Switch Server JAR + Crossplay + Server Icon */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-3">
              <h3 className="text-base font-semibold">Cambiar .JAR / Motor del Servidor</h3>
              <p className="text-xs text-text-secondary">
                Elige cualquier motor de tu <strong>Biblioteca de .jar</strong>. CraftDock crea un
                backup automático antes de cambiarlo.
              </p>
              <div className="flex gap-2">
                <select
                  value={selectedJarId}
                  onChange={(e) => setSelectedJarId(e.target.value)}
                  disabled={isOnline}
                  className="flex-1 bg-canvas border border-border-strong rounded-lg px-3 py-2 text-xs font-mono text-text-primary"
                >
                  <option value="">Selecciona un .jar de la Biblioteca...</option>
                  {compatibleJars.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name} ({j.fileName})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isOnline || !selectedJarId}
                  loading={switchingJar}
                  onClick={handleChangeJar}
                >
                  Aplicar .JAR
                </Button>
              </div>
            </div>

            <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-4">
              {server.engine !== "bedrock" && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-emerald-400" />
                      Ícono del servidor (server-icon.png)
                    </h3>
                    <p className="text-xs text-text-secondary">
                      Sube cualquier foto PNG/JPG y se recorta sola a 64×64.
                    </p>
                  </div>
                  <label className="px-3 py-1.5 rounded-lg bg-elevated border border-border-strong hover:bg-[#252E3D] text-xs font-medium cursor-pointer">
                    Subir imagen
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        void handleUploadIcon(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              )}

              {server.engine === "paper" && (
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-border-subtle">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-sky-400" />
                      Crossplay Java + Bedrock (Geyser + Floodgate)
                    </h3>
                    <p className="text-xs text-text-secondary">
                      {server.crossplayEnabled
                        ? `Activo en puerto UDP ${server.bedrockPort || 19132}`
                        : "Instala Geyser y Floodgate en 1 clic."}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={server.crossplayEnabled ? "danger" : "primary"}
                    disabled={isOnline}
                    onClick={async () => {
                      try {
                        const res = await api.toggleCrossplay(server.id, !server.crossplayEnabled);
                        onServerUpdated(res.server);
                        onToast(
                          "success",
                          res.server.crossplayEnabled
                            ? "Crossplay activado (Geyser + Floodgate instalados)."
                            : "Crossplay desactivado."
                        );
                      } catch (err: any) {
                        onToast("error", err.message);
                      }
                    }}
                  >
                    {server.crossplayEnabled ? "Desactivar" : "Activar Crossplay"}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Regenerate New World Card */}
          <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-red-200 flex items-center gap-2">
                  <RotateCw className="w-4 h-4 text-red-400" />
                  Generar Nuevo Mundo (Eliminar mundo actual)
                </h3>
                <p className="text-xs text-red-200/80 mt-0.5">
                  ¿No te gustó el mapa que se generó? Elimina el mundo actual (Overworld, Nether y
                  End) para que Minecraft cree uno completamente nuevo al encender el servidor.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Nueva semilla / Seed (déjalo vacío para una aleatoria)
                </label>
                <input
                  type="text"
                  value={regenSeed}
                  onChange={(e) => setRegenSeed(e.target.value)}
                  disabled={isOnline}
                  placeholder="Opcional (ej. 123456789 o vacío = aleatoria)"
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col justify-center gap-2">
                <label className="flex items-center gap-2.5 text-xs text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={regenBackup}
                    onChange={(e) => setRegenBackup(e.target.checked)}
                    disabled={isOnline}
                    className="accent-[#1BD96A] w-4 h-4"
                  />
                  Guardar un respaldo automático antes de eliminar el mundo actual
                </label>

                {server.engine !== "bedrock" && (
                  <label className="flex items-center gap-2.5 text-xs text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regenKeepDatapacks}
                      onChange={(e) => setRegenKeepDatapacks(e.target.checked)}
                      disabled={isOnline}
                      className="accent-[#1BD96A] w-4 h-4"
                    />
                    Conservar mis Datapacks instalados (ej. Terralith / Tectonic) en el mundo nuevo
                  </label>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {isOnline ? (
                <p className="text-xs text-amber-300">
                  Apaga el servidor primero para poder eliminar y regenerar el mundo.
                </p>
              ) : (
                <p className="text-xs text-text-muted">
                  Al terminar, presiona <strong>Encender Servidor</strong> para generar el nuevo mapa.
                </p>
              )}
              <Button
                variant="danger"
                disabled={isOnline}
                loading={regeneratingWorld}
                onClick={handleRegenerateWorld}
              >
                <Trash2 className="w-4 h-4" />
                Eliminar Mundo y Generar Nuevo
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PLAYERS */}
      {tab === "players" && (
        <div className="space-y-4 animate-fade-slide-up">
          <div className="bg-surface border border-border-subtle rounded-xl p-4 flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={playerInput}
              onChange={(e) => setPlayerInput(e.target.value)}
              placeholder="Nombre del jugador (gamertag o nick)..."
              className="flex-1 bg-canvas border border-border-strong rounded-lg px-3.5 py-2 text-sm text-text-primary"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => handlePlayerAction("op", playerInput)}>
                <Shield className="w-3.5 h-3.5" />
                Dar OP
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handlePlayerAction("whitelist_add", playerInput)}
              >
                <UserCheck className="w-3.5 h-3.5" />
                + Whitelist
              </Button>
              {server.engine !== "bedrock" && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handlePlayerAction("ban", playerInput)}
                >
                  <UserX className="w-3.5 h-3.5" />
                  Banear
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Online */}
            <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-2.5">
              <h3 className="text-sm font-semibold text-emerald-400">
                Conectados ahora ({players?.online.length || 0})
              </h3>
              {!players || players.online.length === 0 ? (
                <p className="text-xs text-text-muted">No hay jugadores conectados.</p>
              ) : (
                players.online.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between bg-canvas border border-border-subtle rounded-lg px-3 py-2"
                  >
                    <span className="font-mono text-sm">{name}</span>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => handlePlayerAction("op", name)}>
                        OP
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handlePlayerAction("kick", name)}>
                        Kick
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* OPs */}
            <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-2.5">
              <h3 className="text-sm font-semibold">Operadores / Admins ({players?.ops.length || 0})</h3>
              {!players || players.ops.length === 0 ? (
                <p className="text-xs text-text-muted">Sin operadores registrados.</p>
              ) : (
                players.ops.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between bg-canvas border border-border-subtle rounded-lg px-3 py-2"
                  >
                    <span className="font-mono text-sm">{p.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handlePlayerAction("deop", p.name)}
                    >
                      Quitar OP
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Whitelist */}
            <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-2.5">
              <h3 className="text-sm font-semibold">
                Whitelist / Allowlist ({players?.whitelist.length || 0})
              </h3>
              {!players || players.whitelist.length === 0 ? (
                <p className="text-xs text-text-muted">Lista vacía.</p>
              ) : (
                players.whitelist.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between bg-canvas border border-border-subtle rounded-lg px-3 py-2"
                  >
                    <span className="font-mono text-sm">{p.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handlePlayerAction("whitelist_remove", p.name)}
                    >
                      Quitar
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Banned */}
            {server.engine !== "bedrock" && (
              <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-red-300">
                  Baneados ({players?.banned.length || 0})
                </h3>
                {!players || players.banned.length === 0 ? (
                  <p className="text-xs text-text-muted">Ningún jugador baneado.</p>
                ) : (
                  players.banned.map((p) => (
                    <div
                      key={p.name}
                      className="flex items-center justify-between bg-canvas border border-border-subtle rounded-lg px-3 py-2"
                    >
                      <div>
                        <span className="font-mono text-sm">{p.name}</span>
                        {p.reason && <p className="text-[11px] text-text-muted">{p.reason}</p>}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handlePlayerAction("pardon", p.name)}
                      >
                        Desbanear
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: MODS & PLUGINS */}
      {tab === "mods" && (
        <ModsPluginsTab
          server={server}
          initialSearchQuery={modrinthPrefill}
          onToast={onToast}
        />
      )}

      {/* TAB 5: DATAPACKS */}
      {tab === "datapacks" && <DatapacksTab server={server} onToast={onToast} />}

      {/* TAB 6: BACKUPS & WORLDS */}
      {tab === "backups" && (
        <BackupsWorldsTab
          server={server}
          onServerUpdated={onServerUpdated}
          onToast={onToast}
        />
      )}

      {/* TAB 6: FILE LIBRARY & CODE EDITOR */}
      {tab === "files" && <FileLibraryTab serverId={server.id} onToast={onToast} />}
    </div>
  );
}
