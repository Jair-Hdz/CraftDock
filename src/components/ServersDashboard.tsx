import React from "react";
import {
  Play,
  Square,
  Plus,
  Share2,
  Users,
  Cpu,
  HardDrive,
  ChevronRight,
  Server as ServerIcon,
  Globe,
  AlertTriangle,
} from "lucide-react";
import type { ServerView, SystemInfo, TunnelStatus } from "../../shared/types";
import { Button, EngineBadge, StatusBadge } from "./ui/Primitives";

export function ServersDashboard({
  servers,
  system,
  tunnel,
  onSelectServer,
  onOpenCreate,
  onStart,
  onStop,
  onCopyInvite,
  onGoTunnel,
}: {
  servers: ServerView[];
  system: SystemInfo | null;
  tunnel: TunnelStatus | null;
  onSelectServer: (id: string) => void;
  onOpenCreate: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onCopyInvite: (id: string) => void;
  onGoTunnel: () => void;
}) {
  const runningCount = servers.filter((s) => s.status === "running" || s.status === "starting").length;
  const totalOnlinePlayers = servers.reduce((acc, s) => acc + s.metrics.onlinePlayers.length, 0);

  return (
    <div className="space-y-6 animate-fade-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Mis Servidores</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Crea, edita y comparte servidores de Minecraft Java, Bedrock y Crossplay desde tu PC.
          </p>
        </div>
        <Button onClick={onOpenCreate} size="lg">
          <Plus className="w-4 h-4" />
          Nuevo Servidor
        </Button>
      </div>

      {/* Quick status strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface border border-border-subtle rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/12 text-emerald-400 flex items-center justify-center">
            <ServerIcon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-text-secondary">Servidores activos</p>
            <p className="text-base font-semibold font-mono">
              {runningCount} <span className="text-text-muted font-normal">/ {servers.length}</span>
            </p>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/12 text-sky-400 flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-text-secondary">Jugadores conectados</p>
            <p className="text-base font-semibold font-mono">{totalOnlinePlayers}</p>
          </div>
        </div>

        <button
          onClick={onGoTunnel}
          className="bg-surface border border-border-subtle hover:border-border-strong rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors"
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                tunnel?.state === "connected"
                  ? "bg-emerald-500/12 text-emerald-400"
                  : "bg-elevated text-text-secondary"
              }`}
            >
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-text-secondary">Túnel remoto (playit.gg)</p>
              <p className="text-sm font-semibold">
                {tunnel?.state === "connected"
                  ? "Conectado"
                  : tunnel?.state === "unclaimed"
                  ? "Falta vincular cuenta"
                  : tunnel?.installed
                  ? "Detenido"
                  : "Sin activar"}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </button>
      </div>

      {/* Empty State */}
      {servers.length === 0 ? (
        <div className="bg-surface border border-dashed border-border-strong rounded-xl py-16 px-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-xl bg-emerald-500/12 text-emerald-400 flex items-center justify-center mb-4">
            <ServerIcon className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">
            Todavía no tienes servidores creados
          </h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto mt-1.5">
            Crea tu primer servidor en menos de un minuto: elige Vanilla, Paper, Crossplay (Java +
            Bedrock), Fabric, Forge, Bedrock oficial o sube tu propio archivo <code className="font-mono text-emerald-300">.jar</code>.
          </p>
          <div className="mt-6">
            <Button onClick={onOpenCreate} size="lg">
              <Plus className="w-4 h-4" />
              Crear mi primer servidor
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {servers.map((srv) => {
            const isOnline = srv.status === "running" || srv.status === "starting";
            return (
              <div
                key={srv.id}
                className="group bg-surface border border-border-subtle hover:border-border-strong rounded-xl p-4 transition-all duration-150 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  {/* Server Icon */}
                  <div className="w-12 h-12 rounded-lg bg-elevated border border-border-subtle overflow-hidden shrink-0 flex items-center justify-center">
                    {srv.hasIcon ? (
                      <img
                        src={`/api/servers/${srv.id}/icon?t=${encodeURIComponent(srv.updatedAt)}`}
                        alt={srv.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="font-mono font-bold text-lg text-emerald-400">
                        {srv.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => onSelectServer(srv.id)}
                        className="text-base font-semibold text-text-primary hover:text-emerald-400 transition-colors truncate text-left"
                      >
                        {srv.name}
                      </button>
                      <StatusBadge status={srv.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <EngineBadge engine={srv.engine} crossplay={srv.crossplayEnabled} />
                      <span className="text-xs font-mono text-text-secondary bg-elevated px-2 py-0.5 rounded-md border border-border-subtle">
                        v{srv.mcVersion}
                      </span>
                      <span className="text-xs text-text-muted">
                        {srv.onlineMode ? "Premium" : "No-Premium"}
                      </span>
                    </div>

                    {srv.lastCrash && srv.status === "crashed" && (
                      <div className="mt-2.5 flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg px-2.5 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{srv.lastCrash.title}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Metrics & Address row */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary bg-canvas/70 rounded-lg px-3 py-2 border border-border-subtle/70">
                  <div className="flex items-center gap-3 font-mono">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-text-muted" />
                      {srv.metrics.onlinePlayers.length}/{srv.maxPlayers}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5 text-text-muted" />
                      {isOnline && srv.metrics.memoryMb > 0
                        ? `${srv.metrics.memoryMb} MB`
                        : `${(srv.ramMaxMb / 1024).toFixed(1)} GB máx`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-text-muted" />:{srv.port}
                    </span>
                  </div>
                  <span className="font-mono text-emerald-400 truncate max-w-[200px]">
                    {srv.tunnelAddress || `${system?.lanIp || "127.0.0.1"}:${srv.port}`}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    {isOnline ? (
                      <Button variant="danger" size="sm" onClick={() => onStop(srv.id)}>
                        <Square className="w-3.5 h-3.5" />
                        Apagar
                      </Button>
                    ) : (
                      <Button variant="primary" size="sm" onClick={() => onStart(srv.id)}>
                        <Play className="w-3.5 h-3.5" />
                        Encender
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onCopyInvite(srv.id)}
                      title="Copiar invitación lista para Discord / WhatsApp"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Invitar
                    </Button>
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => onSelectServer(srv.id)}>
                    Administrar
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
