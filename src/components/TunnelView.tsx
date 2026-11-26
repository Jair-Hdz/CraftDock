import React, { useState } from "react";
import {
  Globe,
  Play,
  Square,
  Download,
  ExternalLink,
  Copy,
  CheckCircle2,
  Terminal,
  Info,
} from "lucide-react";
import type { ServerView, TunnelStatus } from "../../shared/types";
import { api } from "../lib/api";
import { Button } from "./ui/Primitives";

export function TunnelView({
  tunnel,
  servers,
  onRefresh,
  onToast,
}: {
  tunnel: TunnelStatus | null;
  servers: ServerView[];
  onRefresh: () => Promise<void>;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [savingServerId, setSavingServerId] = useState<string | null>(null);
  const [draftAddrs, setDraftAddrs] = useState<
    Record<string, { java: string; bedrock: string }>
  >({});

  const runAction = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      onToast("success", okMsg);
      await onRefresh();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (txt: string, label = "Copiado al portapapeles") => {
    await navigator.clipboard.writeText(txt);
    onToast("success", label);
  };

  const saveServerTunnel = async (srv: ServerView) => {
    const draft = draftAddrs[srv.id] || {
      java: srv.tunnelAddress,
      bedrock: srv.tunnelBedrockAddress,
    };
    setSavingServerId(srv.id);
    try {
      await api.updateServer(srv.id, {
        tunnelAddress: draft.java,
        tunnelBedrockAddress: draft.bedrock,
      });
      onToast("success", `Direcciones remotas guardadas para "${srv.name}".`);
      await onRefresh();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSavingServerId(null);
    }
  };

  const stateLabel: Record<TunnelStatus["state"], { text: string; cls: string }> = {
    not_installed: { text: "No instalado", cls: "text-text-secondary" },
    stopped: { text: "Detenido", cls: "text-text-secondary" },
    starting: { text: "Conectando...", cls: "text-amber-400" },
    unclaimed: { text: "Esperando vinculación en navegador", cls: "text-amber-300" },
    connected: { text: "Túnel activo y conectado", cls: "text-emerald-400" },
    error: { text: "Error del agente", cls: "text-red-400" },
  };
  const st = stateLabel[tunnel?.state || "not_installed"];

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Conexión Remota (playit.gg)</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Permite que amigos de cualquier parte del país entren a tus servidores{" "}
            <strong>sin abrir puertos del router</strong> y sin que ellos instalen nada.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!tunnel?.installed ? (
            <Button
              loading={busy}
              onClick={() =>
                runAction(() => api.installTunnel(), "Agente playit.gg descargado.")
              }
            >
              <Download className="w-4 h-4" />
              Instalar playit.gg
            </Button>
          ) : tunnel.running ? (
            <Button
              variant="danger"
              loading={busy}
              onClick={() => runAction(() => api.stopTunnel(), "Túnel detenido.")}
            >
              <Square className="w-4 h-4" />
              Detener Túnel
            </Button>
          ) : (
            <Button
              loading={busy}
              onClick={() => runAction(() => api.startTunnel(), "Agente playit.gg iniciado.")}
            >
              <Play className="w-4 h-4" />
              Encender Túnel
            </Button>
          )}
        </div>
      </div>

      {/* Status + 3-step guide */}
      <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/12 text-emerald-400 flex items-center justify-center">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-text-secondary">Estado del agente local</p>
              <p className={`text-base font-semibold ${st.cls}`}>{st.text}</p>
            </div>
          </div>

          <a
            href="https://playit.gg/account/tunnels"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:underline"
          >
            Abrir panel de túneles en playit.gg
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {tunnel?.claimUrl && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-200">
                Paso único: vincula este equipo con tu cuenta gratis de playit.gg
              </p>
              <p className="text-xs text-amber-100/80 mt-0.5">
                Haz clic en el botón, inicia sesión (o crea cuenta gratis) y crea tu túnel{" "}
                <strong>Minecraft Java (TCP)</strong> o <strong>Minecraft Bedrock (UDP)</strong>.
              </p>
            </div>
            <a
              href={tunnel.claimUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-400 text-[#1A1200] font-semibold text-sm hover:bg-amber-300 shrink-0"
            >
              Vincular Cuenta
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}

        {tunnel?.detectedAddresses && tunnel.detectedAddresses.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-secondary">
              Direcciones detectadas automáticamente:
            </p>
            <div className="flex flex-wrap gap-2">
              {tunnel.detectedAddresses.map((addr) => (
                <button
                  key={addr}
                  onClick={() => copyText(addr, `Dirección ${addr} copiada`)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/12 border border-emerald-500/30 text-emerald-300 font-mono text-xs hover:bg-emerald-500/20"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {addr}
                  <Copy className="w-3 h-3 opacity-70" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {[
            {
              n: "1",
              title: "Enciende el agente",
              body: "CraftDock descarga y corre playit.gg en segundo plano sin consolas complicadas.",
            },
            {
              n: "2",
              title: "Crea tu túnel en playit.gg",
              body: "Usa puerto local 25565 (TCP) para Java y 19132 (UDP) para Bedrock o Crossplay.",
            },
            {
              n: "3",
              title: "Guarda la IP en tu servidor",
              body: "Pégala abajo para que el botón 'Invitar Amigos' la incluya lista para Discord.",
            },
          ].map((card) => (
            <div
              key={card.n}
              className="bg-canvas border border-border-subtle rounded-lg p-3.5 text-xs"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono font-bold mb-2">
                {card.n}
              </span>
              <p className="font-semibold text-text-primary text-sm">{card.title}</p>
              <p className="text-text-secondary mt-1 leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Assign public addresses per server */}
      {servers.length > 0 && (
        <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Direcciones públicas por servidor</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Asocia la dirección que te dio playit.gg a cada servidor para compartirla en 1 clic.
            </p>
          </div>
          <div className="space-y-3">
            {servers.map((srv) => {
              const draft = draftAddrs[srv.id] || {
                java: srv.tunnelAddress,
                bedrock: srv.tunnelBedrockAddress,
              };
              return (
                <div
                  key={srv.id}
                  className="bg-canvas border border-border-subtle rounded-lg p-3.5 flex flex-col lg:flex-row lg:items-end gap-3"
                >
                  <div className="min-w-[160px]">
                    <p className="text-sm font-semibold text-text-primary">{srv.name}</p>
                    <p className="text-xs text-text-muted font-mono">
                      Puerto local: {srv.port}
                      {srv.bedrockPort ? ` / UDP ${srv.bedrockPort}` : ""}
                    </p>
                  </div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-text-secondary mb-1">
                        {srv.engine === "bedrock"
                          ? "Dirección Bedrock (ej. algo.gl.at.ply.gg:12345)"
                          : "Dirección Java (ej. ejemplo.gl.joinmc.link)"}
                      </label>
                      <input
                        type="text"
                        value={draft.java}
                        onChange={(e) =>
                          setDraftAddrs((prev) => ({
                            ...prev,
                            [srv.id]: { ...draft, java: e.target.value },
                          }))
                        }
                        placeholder="mi-server.gl.joinmc.link"
                        className="w-full bg-surface border border-border-strong rounded-lg px-3 py-1.5 text-xs font-mono text-text-primary"
                      />
                    </div>
                    {srv.crossplayEnabled && (
                      <div>
                        <label className="block text-[11px] text-text-secondary mb-1">
                          Dirección Bedrock Crossplay (UDP)
                        </label>
                        <input
                          type="text"
                          value={draft.bedrock}
                          onChange={(e) =>
                            setDraftAddrs((prev) => ({
                              ...prev,
                              [srv.id]: { ...draft, bedrock: e.target.value },
                            }))
                          }
                          placeholder="mi-server.gl.at.ply.gg:19132"
                          className="w-full bg-surface border border-border-strong rounded-lg px-3 py-1.5 text-xs font-mono text-text-primary"
                        />
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="secondary"
                    loading={savingServerId === srv.id}
                    onClick={() => saveServerTunnel(srv)}
                  >
                    Guardar
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Windows Bedrock loopback tip */}
      <div className="bg-surface border border-border-subtle rounded-xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
        <div className="text-xs text-text-secondary space-y-1.5 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            ¿Juegas Minecraft Bedrock en la misma PC donde corre el servidor?
          </p>
          <p>
            Tus amigos desde internet o celulares se conectan sin hacer nada. Si tú entras desde
            Minecraft Bedrock en esta misma PC y Windows bloquea{" "}
            <code className="font-mono text-sky-300">127.0.0.1</code>, ejecuta este comando oficial
            una sola vez en PowerShell como Administrador:
          </p>
          <div className="flex items-center gap-2 bg-terminal border border-border-subtle rounded-lg px-3 py-2 font-mono text-[11px] text-sky-200">
            <span className="truncate flex-1">
              CheckNetIsolation LoopbackExempt -a -n=&quot;Microsoft.MinecraftUWP_8wekyb3d8bbwe&quot;
            </span>
            <button
              onClick={() =>
                copyText(
                  'CheckNetIsolation LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"',
                  "Comando copiado"
                )
              }
              className="text-text-secondary hover:text-text-primary shrink-0"
              title="Copiar comando"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Live agent logs */}
      {tunnel && tunnel.recentLogs.length > 0 && (
        <div className="bg-terminal border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-2">
            <Terminal className="w-3.5 h-3.5" />
            Registro en vivo de playit.gg
          </div>
          <pre className="text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
            {tunnel.recentLogs.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
