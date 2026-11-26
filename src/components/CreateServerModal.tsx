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
  Flame,
  FolderArchive,
  Search,
} from "lucide-react";
import type {
  JarLibraryItem,
  ModpackVersionOption,
  ModrinthSearchHit,
  RemoteVersionOption,
  ServerEngine,
  SystemInfo,
} from "../../shared/types";
import { api } from "../lib/api";
import { Button, Modal, RamSelector } from "./ui/Primitives";

type CreateChoice = ServerEngine | "crossplay" | "modpack";

interface EngineCardDef {
  id: CreateChoice;
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
    id: "modpack",
    title: "Modpack Directo (Modrinth)",
    desc: "Busca un modpack y CraftDock instala motor, Java y mods en 1 clic.",
    icon: <FolderArchive className="w-5 h-5 text-emerald-400" />,
    tag: "1 Clic",
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
    id: "neoforge",
    title: "NeoForge (Mods 1.21+)",
    desc: "Sucesor moderno de Forge para los modpacks nuevos de 1.20.4+ y 1.21+.",
    icon: <Flame className="w-5 h-5 text-amber-400" />,
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
  const [choice, setChoice] = useState<CreateChoice>("paper");
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

  // Direct Modrinth Modpack state
  const [modpackQuery, setModpackQuery] = useState("");
  const [modpackLoaderFilter, setModpackLoaderFilter] = useState<"" | "fabric" | "forge" | "neoforge">("");
  const [modpackHits, setModpackHits] = useState<ModrinthSearchHit[]>([]);
  const [searchingPacks, setSearchingPacks] = useState(false);
  const [selectedPack, setSelectedPack] = useState<ModrinthSearchHit | null>(null);
  const [packVersions, setPackVersions] = useState<ModpackVersionOption[]>([]);
  const [loadingPackVersions, setLoadingPackVersions] = useState(false);
  const [selectedPackVersionId, setSelectedPackVersionId] = useState("");

  const actualEngine: ServerEngine =
    choice === "crossplay" ? "paper" : choice === "modpack" ? "fabric" : choice;
  const isCrossplay = choice === "crossplay";
  const isModpack = choice === "modpack";
  const isBedrock = actualEngine === "bedrock";

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSubmitting(false);
    setSelectedPack(null);
    setPackVersions([]);
    setSelectedPackVersionId("");
    if (system) {
      setRamMaxMb(Math.min(4096, Math.max(2048, system.recommendedMaxRamMb)));
    }
  }, [open, system]);

  const runModpackSearch = async (q: string, loader = modpackLoaderFilter) => {
    setSearchingPacks(true);
    try {
      const res = await api.searchModpacks(q, loader || undefined);
      setModpackHits(res.hits);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSearchingPacks(false);
    }
  };

  useEffect(() => {
    if (!open || step !== 2) return;
    if (choice === "custom") {
      if (jars[0] && !selectedJarId) setSelectedJarId(jars[0].id);
      return;
    }
    if (choice === "modpack") {
      if (modpackHits.length === 0) void runModpackSearch(modpackQuery, modpackLoaderFilter);
      if (system && ramMaxMb < 4096 && system.recommendedMaxRamMb >= 4096) {
        setRamMaxMb(4096);
      }
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

  const handleSelectModpack = async (hit: ModrinthSearchHit) => {
    setSelectedPack(hit);
    setSelectedPackVersionId("");
    setPackVersions([]);
    setLoadingPackVersions(true);
    if (!name.trim() || name === "Mi Mundo Survival") {
      setName(hit.title.slice(0, 50));
    }
    try {
      const res = await api.listModpackVersions(
        hit.projectId,
        modpackLoaderFilter || undefined
      );
      setPackVersions(res.versions);
      if (res.versions[0]) setSelectedPackVersionId(res.versions[0].versionId);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setLoadingPackVersions(false);
    }
  };

  const chosenPackVersion = packVersions.find((v) => v.versionId === selectedPackVersionId) || null;

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
      if (isModpack) {
        if (!selectedPackVersionId) {
          onToast("error", "Selecciona un modpack y una versión antes de continuar.");
          setSubmitting(false);
          return;
        }
        const res = await api.createServerFromModpack({
          name: name.trim(),
          modpackVersionId: selectedPackVersionId,
          ramMinMb: Math.min(2048, ramMaxMb),
          ramMaxMb,
          onlineMode,
          gamemode,
          difficulty,
          eulaAccepted: true,
        });
        onToast(
          "success",
          `¡Servidor "${res.server.name}" creado con "${res.packName}" (${res.downloadedCount} archivos instalados)!`
        );
        onCreated(res.server.id);
        onClose();
        return;
      }

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

  const canAdvanceStep2 = isModpack
    ? Boolean(selectedPackVersionId)
    : choice === "custom"
    ? Boolean(selectedJarId)
    : Boolean(mcVersion);

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
          { n: 2, label: isModpack ? "Modpack y RAM" : "Versión y RAM" },
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
          {isModpack ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={modpackQuery}
                    onChange={(e) => setModpackQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void runModpackSearch(modpackQuery, modpackLoaderFilter);
                      }
                    }}
                    placeholder="Buscar modpacks en Modrinth (ej. Cobblemon, Better MC, Create, Prominence)..."
                    className="w-full bg-canvas border border-border-strong rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-mc"
                  />
                </div>
                <select
                  value={modpackLoaderFilter}
                  onChange={(e) => {
                    const next = e.target.value as "" | "fabric" | "forge" | "neoforge";
                    setModpackLoaderFilter(next);
                    void runModpackSearch(modpackQuery, next);
                  }}
                  className="bg-canvas border border-border-strong rounded-lg px-3 py-2 text-xs font-mono text-text-primary"
                >
                  <option value="">Todos (Fabric/Forge/NeoForge)</option>
                  <option value="fabric">Solo Fabric</option>
                  <option value="neoforge">Solo NeoForge</option>
                  <option value="forge">Solo Forge</option>
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={searchingPacks}
                  onClick={() => void runModpackSearch(modpackQuery, modpackLoaderFilter)}
                >
                  Buscar
                </Button>
              </div>

              {/* Modpack list */}
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {searchingPacks ? (
                  <div className="py-6 flex items-center justify-center gap-2 text-xs text-text-secondary">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    Buscando modpacks compatibles con servidor en Modrinth...
                  </div>
                ) : (
                  modpackHits.map((hit) => {
                    const isPicked = selectedPack?.projectId === hit.projectId;
                    return (
                      <button
                        key={hit.projectId}
                        type="button"
                        onClick={() => void handleSelectModpack(hit)}
                        className={`w-full text-left p-2.5 rounded-lg border flex items-center gap-3 transition-colors ${
                          isPicked
                            ? "bg-emerald-500/12 border-emerald-mc"
                            : "bg-canvas border-border-subtle hover:border-border-strong"
                        }`}
                      >
                        <div className="w-9 h-9 rounded-md bg-elevated overflow-hidden shrink-0 flex items-center justify-center">
                          {hit.iconUrl ? (
                            <img src={hit.iconUrl} alt={hit.title} className="w-full h-full object-cover" />
                          ) : (
                            <FolderArchive className="w-4 h-4 text-text-muted" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-text-primary truncate">
                              {hit.title}
                            </span>
                            <span className="text-[11px] font-mono text-text-muted shrink-0">
                              {hit.downloads.toLocaleString("es")} desc.
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary truncate">{hit.description}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Version selector for chosen modpack */}
              {selectedPack && (
                <div className="bg-canvas border border-emerald-500/30 rounded-lg p-3 space-y-2">
                  <label className="block text-xs font-semibold text-emerald-300">
                    Versión del modpack "{selectedPack.title}"
                  </label>
                  {loadingPackVersions ? (
                    <div className="flex items-center gap-2 text-xs text-text-secondary py-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                      Cargando versiones...
                    </div>
                  ) : packVersions.length === 0 ? (
                    <p className="text-xs text-amber-300">
                      Este modpack no tiene versiones disponibles para Fabric, Forge o NeoForge.
                    </p>
                  ) : (
                    <select
                      value={selectedPackVersionId}
                      onChange={(e) => setSelectedPackVersionId(e.target.value)}
                      className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-xs font-mono text-text-primary"
                    >
                      {packVersions.map((v) => (
                        <option key={v.versionId} value={v.versionId}>
                          {v.name} — MC {v.mcVersion} ({v.detectedEngine?.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          ) : choice === "custom" ? (
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
            <Button onClick={() => setStep(3)} disabled={!canAdvanceStep2}>
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
            {isModpack && selectedPack && chosenPackVersion ? (
              <>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Modpack (Modrinth)</span>
                  <span className="font-semibold text-emerald-400">{selectedPack.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Motor y versión detectados</span>
                  <span className="font-mono text-text-primary">
                    {chosenPackVersion.detectedEngine?.toUpperCase()} • Minecraft{" "}
                    {chosenPackVersion.mcVersion}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Motor</span>
                  <span className="font-mono text-emerald-400">
                    {isCrossplay
                      ? "Paper + Crossplay (Geyser + Floodgate)"
                      : actualEngine.toUpperCase()}
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
              </>
            )}
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
                descargará Java, el motor{isModpack ? " y todos los mods del modpack" : ""} de forma
                automática.
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
              {isModpack ? "Instalar Modpack y Crear Servidor" : "Crear Servidor Ahora"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
