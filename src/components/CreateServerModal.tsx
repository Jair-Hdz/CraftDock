import React, { useEffect, useState } from "react";
import {
  Blocks,
  Cpu,
  Layers,
  Smartphone,
  Sparkles,
  Wrench,
  Package,
  Check,
  Loader2,
} from "lucide-react";
import type {
  JarLibraryItem,
  RemoteVersionOption,
  ServerEngine,
  SystemInfo,
} from "../../shared/types";
import { api } from "../lib/api";
import { Button, Modal, RamSelector } from "./ui/Primitives";

interface EngineCardDef {
  id: ServerEngine | "crossplay";
  title: string;
  desc: string;
  icon: React.ReactNode;
  tag: string;
}

const ENGINE_CARDS: EngineCardDef[] = [
  {
    id: "paper",
    title: "Paper (Recomendado)",
    desc: "El mejor rendimiento para Java y soporte de plugins.",
    icon: <Sparkles className="w-5 h-5 text-teal-400" />,
    tag: "Plugins",
  },
  {
    id: "crossplay",
    title: "Crossplay (Java + Bedrock)",
    desc: "Paper con Geyser y Floodgate: PC, celular y consola juntos.",
    icon: <Layers className="w-5 h-5 text-sky-400" />,
    tag: "Todos juntos",
  },
  {
    id: "vanilla",
    title: "Java Vanilla Oficial",
    desc: "Minecraft puro directo de Mojang, sin modificaciones.",
    icon: <Blocks className="w-5 h-5 text-emerald-400" />,
    tag: "Oficial",
  },
  {
    id: "fabric",
    title: "Fabric (Mods modernos)",
    desc: "Rápido y ligero, ideal para mods actuales de Modrinth.",
    icon: <Package className="w-5 h-5 text-yellow-400" />,
    tag: "Mods",
  },
  {
    id: "forge",
    title: "Forge (Mods clásicos)",
    desc: "El estándar clásico para grandes packs de mods.",
    icon: <Wrench className="w-5 h-5 text-orange-400" />,
    tag: "Mods",
  },
  {
    id: "bedrock",
    title: "Bedrock Oficial",
    desc: "Servidor nativo de Windows/Celular/Consolas (sin Java).",
    icon: <Smartphone className="w-5 h-5 text-sky-400" />,
    tag: "Bedrock",
  },
  {
    id: "custom",
    title: "Elegir .JAR de mi Biblioteca",
    desc: "Usa un .jar ya descargado o subido por ti (Purpur, Spigot, etc.).",
    icon: <Cpu className="w-5 h-5 text-slate-300" />,
    tag: "Tu .JAR",
  },
];

export function CreateServerModal({
  open,
  onClose,
  system,
  jars,
  onCreated,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  system: SystemInfo | null;
  jars: JarLibraryItem[];
  onCreated: (serverId: string) => void;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("Mi Mundo Survival");
  const [choice, setChoice] = useState<ServerEngine | "crossplay">("paper");
  const [versions, setVersions] = useState<RemoteVersionOption[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [mcVersion, setMcVersion] = useState("");
  const [selectedJarId, setSelectedJarId] = useState("");
  const [ramMaxMb, setRamMaxMb] = useState(2048);
  const [onlineMode, setOnlineMode] = useState(false);
  const [gamemode, setGamemode] = useState("survival");
  const [difficulty, setDifficulty] = useState("normal");
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const actualEngine: ServerEngine = choice === "crossplay" ? "paper" : choice;
  const isCrossplay = choice === "crossplay";
  const isBedrock = actualEngine === "bedrock";

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSubmitting(false);
    if (system) {
      setRamMaxMb(Math.min(4096, Math.max(2048, system.recommendedMaxRamMb)));
    }
  }, [open, system]);

  useEffect(() => {
    if (!open || step !== 2) return;
    if (choice === "custom") {
      if (jars[0] && !selectedJarId) setSelectedJarId(jars[0].id);
      return;
    }

    let cancelled = false;
    setLoadingVersions(true);
    api
      .listRemoteVersions(actualEngine)
      .then((res) => {
        if (cancelled) return;
        setVersions(res.versions);
        if (res.versions[0]) setMcVersion(res.versions[0].mcVersion);
      })
      .catch((err) => {
        if (!cancelled) onToast("error", err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, step, actualEngine, choice]);

  const handleCreate = async () => {
    if (!name.trim()) {
      onToast("error", "Escribe un nombre para tu servidor.");
      return;
    }
    if (!isBedrock && !eulaAccepted) {
      onToast("error", "Debes aceptar el EULA de Minecraft para crear un servidor Java.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        engine: actualEngine,
        crossplayEnabled: isCrossplay,
        ramMinMb: Math.min(1024, ramMaxMb),
        ramMaxMb,
        onlineMode,
        gamemode,
        difficulty,
        eulaAccepted: isBedrock ? true : eulaAccepted,
      };
      if (choice === "custom") {
        payload.jarId = selectedJarId;
      } else {
        payload.mcVersion = mcVersion;
      }

      const res = await api.createServer(payload);
      onToast("success", `¡Servidor "${res.server.name}" creado correctamente!`);
      onCreated(res.server.id);
      onClose();
    } catch (err: any) {
      onToast("error", err.message || "Error creando el servidor.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title="Crear Nuevo Servidor"
      subtitle={`Paso ${step} de 3 — Configuración guiada sin archivos técnicos`}
      maxWidth="max-w-3xl"
    >
      {/* Stepper indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[
          { n: 1, label: "Motor y Nombre" },
          { n: 2, label: "Versión y RAM" },
          { n: 3, label: "Confirmar y Crear" },
        ].map((item) => (
          <div
            key={item.n}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
              step === item.n
                ? "bg-emerald-500/12 border-emerald-500/40 text-emerald-300"
                : step > item.n
                ? "bg-elevated border-border-subtle text-text-primary"
                : "bg-canvas border-border-subtle text-text-muted"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-surface border border-border-strong flex items-center justify-center text-[11px] font-mono">
              {step > item.n ? <Check className="w-3 h-3 text-emerald-400" /> : item.n}
            </span>
            <span className="truncate">{item.label}</span>
          </div>
        ))}
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="space-y-5 animate-fade-slide-up">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Nombre del servidor
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Survival con los panas"
              className="w-full bg-canvas border border-border-strong rounded-lg px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:border-emerald-mc"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              ¿Qué tipo de servidor quieres crear?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {ENGINE_CARDS.map((card) => {
                const selected = choice === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setChoice(card.id)}
                    className={`text-left p-3.5 rounded-xl border transition-all duration-150 flex items-start gap-3 ${
                      selected
                        ? "bg-emerald-500/10 border-emerald-mc ring-1 ring-emerald-mc/40"
                        : "bg-canvas border-border-subtle hover:border-border-strong"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-surface border border-border-subtle flex items-center justify-center shrink-0">
                      {card.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-text-primary">
                          {card.title}
                        </span>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-elevated text-text-secondary">
                          {card.tag}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                        {card.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => setStep(2)} disabled={!name.trim()}>
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="space-y-5 animate-fade-slide-up">
          {choice === "custom" ? (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Elige un archivo .JAR de tu Biblioteca
              </label>
              {jars.length === 0 ? (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
                  Aún no tienes archivos guardados en tu Biblioteca de .jar. Ve primero a la sección{" "}
                  <strong>Biblioteca de .jar</strong> para descargar uno oficial o subir tu propio{" "}
                  <code className="font-mono">.jar</code>.
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {jars.map((jar) => (
                    <button
                      key={jar.id}
                      type="button"
                      onClick={() => setSelectedJarId(jar.id)}
                      className={`w-full text-left px-3.5 py-2.5 rounded-lg border flex items-center justify-between transition-colors ${
                        selectedJarId === jar.id
                          ? "bg-emerald-500/10 border-emerald-mc"
                          : "bg-canvas border-border-subtle hover:border-border-strong"
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-text-primary">{jar.name}</p>
                        <p className="text-xs text-text-secondary font-mono">
                          {jar.fileName} • {jar.engine} • v{jar.mcVersion}
                        </p>
                      </div>
                      {jar.javaMajor && (
                        <span className="text-xs font-mono text-text-muted">Java {jar.javaMajor}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">
                Versión de Minecraft
              </label>
              {loadingVersions ? (
                <div className="flex items-center gap-2 text-sm text-text-secondary py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  Consultando versiones oficiales...
                </div>
              ) : (
                <select
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                  className="w-full bg-canvas border border-border-strong rounded-lg px-3.5 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-emerald-mc"
                >
                  {versions.map((v) => (
                    <option key={v.mcVersion} value={v.mcVersion}>
                      Minecraft {v.mcVersion}
                      {v.javaMajor ? ` (usa Java ${v.javaMajor} automático)` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!isBedrock && (
            <RamSelector valueMb={ramMaxMb} onChange={setRamMaxMb} system={system} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Modo de juego
              </label>
              <select
                value={gamemode}
                onChange={(e) => setGamemode(e.target.value)}
                className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
              >
                <option value="survival">Supervivencia (Survival)</option>
                <option value="creative">Creativo (Creative)</option>
                <option value="adventure">Aventura (Adventure)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Dificultad
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
              >
                <option value="peaceful">Pacífico</option>
                <option value="easy">Fácil</option>
                <option value="normal">Normal</option>
                <option value="hard">Difícil</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-canvas border border-border-subtle cursor-pointer">
            <input
              type="checkbox"
              checked={!onlineMode}
              onChange={(e) => setOnlineMode(!e.target.checked)}
              className="mt-1 accent-[#1BD96A] w-4 h-4"
            />
            <div>
              <span className="text-sm font-medium text-text-primary">
                Permitir jugadores No-Premium (modo offline / cracked)
              </span>
              <p className="text-xs text-text-secondary mt-0.5">
                Actívalo si alguno de tus amigos juega sin cuenta oficial de Microsoft/Mojang.
              </p>
            </div>
          </label>

          <div className="flex justify-between pt-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={choice === "custom" ? !selectedJarId : !mcVersion}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="space-y-5 animate-fade-slide-up">
          <div className="bg-canvas border border-border-subtle rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Nombre</span>
              <span className="font-semibold text-text-primary">{name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Motor</span>
              <span className="font-mono text-emerald-400">
                {isCrossplay ? "Paper + Crossplay (Geyser + Floodgate)" : actualEngine.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Versión / JAR</span>
              <span className="font-mono text-text-primary">
                {choice === "custom"
                  ? jars.find((j) => j.id === selectedJarId)?.name || "Personalizado"
                  : mcVersion}
              </span>
            </div>
            {!isBedrock && (
              <div className="flex justify-between">
                <span className="text-text-secondary">RAM Máxima</span>
                <span className="font-mono text-text-primary">
                  {(ramMaxMb / 1024).toFixed(1)} GB
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-text-secondary">Acceso</span>
              <span className="text-text-primary">
                {onlineMode ? "Solo Premium" : "Premium y No-Premium"}
              </span>
            </div>
          </div>

          {!isBedrock && (
            <label className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/30 cursor-pointer">
              <input
                type="checkbox"
                checked={eulaAccepted}
                onChange={(e) => setEulaAccepted(e.target.checked)}
                className="mt-1 accent-[#1BD96A] w-4 h-4"
              />
              <div className="text-xs leading-relaxed text-text-secondary">
                <span className="text-sm font-semibold text-text-primary block mb-0.5">
                  Acepto el EULA oficial de Minecraft (Mojang)
                </span>
                Al marcar esta casilla aceptas los términos de licencia de servidor de Mojang (
                <a
                  href="https://aka.ms/MinecraftEULA"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 underline"
                >
                  aka.ms/MinecraftEULA
                </a>
                ). CraftDock generará <code className="font-mono">eula.txt</code> automáticamente y
                descargará la versión correcta de Java si aún no la tienes.
              </div>
            </label>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={submitting}>
              Atrás
            </Button>
            <Button
              onClick={handleCreate}
              loading={submitting}
              disabled={!isBedrock && !eulaAccepted}
            >
              Crear Servidor Ahora
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
