import React, { useEffect, useState } from "react";
import {
  Download,
  Upload,
  Trash2,
  Package,
  Search,
  CheckCircle2,
  Loader2,
  HardDrive,
} from "lucide-react";
import type { JarLibraryItem, RemoteVersionOption, ServerEngine } from "../../shared/types";
import { api, formatBytes } from "../lib/api";
import { Button, EngineBadge } from "./ui/Primitives";

const OFFICIAL_ENGINES: Array<{ id: Exclude<ServerEngine, "custom">; label: string; desc: string }> = [
  { id: "paper", label: "Paper", desc: "Alto rendimiento + plugins (PaperMC v3)" },
  { id: "vanilla", label: "Java Vanilla", desc: "Oficial de Mojang" },
  { id: "fabric", label: "Fabric", desc: "Mods modernos (Fabric Meta v2)" },
  { id: "neoforge", label: "NeoForge", desc: "Mods modernos 1.20.4+ / 1.21+ (Maven)" },
  { id: "forge", label: "Forge", desc: "Instalador oficial de Forge Maven" },
  { id: "bedrock", label: "Bedrock", desc: "Servidor oficial Windows (.zip)" },
];

export function JarLibraryView({
  jars,
  onRefreshJars,
  onToast,
}: {
  jars: JarLibraryItem[];
  onRefreshJars: () => Promise<void>;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [tab, setTab] = useState<"local" | "official" | "upload">("local");
  const [selectedEngine, setSelectedEngine] =
    useState<Exclude<ServerEngine, "custom">>("paper");
  const [versions, setVersions] = useState<RemoteVersionOption[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [search, setSearch] = useState("");
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  // Upload custom JAR state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState("");
  const [customMcVersion, setCustomMcVersion] = useState("1.21.4");
  const [customJava, setCustomJava] = useState(21);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (tab !== "official") return;
    let cancelled = false;
    setLoadingVersions(true);
    api
      .listRemoteVersions(selectedEngine)
      .then((res) => {
        if (!cancelled) setVersions(res.versions);
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
  }, [tab, selectedEngine]);

  const handleDownloadOfficial = async (mcVersion: string) => {
    const key = `${selectedEngine}:${mcVersion}`;
    setDownloadingKey(key);
    try {
      const res = await api.downloadJar(selectedEngine, mcVersion);
      onToast("success", `${res.jar.name} guardado en tu Biblioteca.`);
      await onRefreshJars();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleUploadCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      onToast("error", "Selecciona un archivo .jar primero.");
      return;
    }
    setUploading(true);
    try {
      const res = await api.uploadCustomJar(uploadFile, {
        name: customName || uploadFile.name.replace(/\.jar$/i, ""),
        mcVersion: customMcVersion,
        javaMajor: customJava,
      });
      onToast("success", `Archivo "${res.jar.name}" agregado a tu Biblioteca.`);
      setUploadFile(null);
      setCustomName("");
      await onRefreshJars();
      setTab("local");
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteJar = async (jar: JarLibraryItem) => {
    try {
      await api.deleteJar(jar.id);
      onToast("info", `"${jar.name}" eliminado de la Biblioteca.`);
      await onRefreshJars();
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const filteredVersions = versions.filter((v) =>
    v.mcVersion.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Biblioteca de .JAR y Motores</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Descarga archivos oficiales, reutilízalos entre servidores o sube tu propio{" "}
            <code className="font-mono text-emerald-300">.jar</code> (Purpur, Spigot, Mohist, etc.).
          </p>
        </div>
        <div className="inline-flex bg-surface border border-border-subtle rounded-lg p-1 self-start">
          {[
            { id: "local", label: `Guardados (${jars.length})` },
            { id: "official", label: "Catálogo Oficial" },
            { id: "upload", label: "Subir .JAR Propio" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-emerald-mc text-[#06180D] font-semibold"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: LOCAL JARS */}
      {tab === "local" && (
        <div className="space-y-3">
          {jars.length === 0 ? (
            <div className="bg-surface border border-dashed border-border-strong rounded-xl py-14 px-6 text-center">
              <Package className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <h2 className="text-base font-semibold">Tu Biblioteca está vacía</h2>
              <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
                Descarga un motor desde el <strong>Catálogo Oficial</strong> o sube un{" "}
                <code className="font-mono">.jar</code> propio para asignarlo a cualquier servidor.
              </p>
              <div className="mt-5 flex items-center justify-center gap-2">
                <Button onClick={() => setTab("official")}>Explorar Catálogo Oficial</Button>
                <Button variant="secondary" onClick={() => setTab("upload")}>
                  Subir .JAR Propio
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-surface border border-border-subtle rounded-xl divide-y divide-border-subtle overflow-hidden">
              {jars.map((jar) => (
                <div
                  key={jar.id}
                  className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-elevated/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-text-primary">{jar.name}</span>
                      <EngineBadge engine={jar.engine} />
                      <span className="text-xs font-mono text-text-secondary">
                        v{jar.mcVersion}
                      </span>
                      {jar.javaMajor && (
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-canvas border border-border-subtle text-text-muted">
                          Java {jar.javaMajor}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted font-mono mt-1">
                      <span className="truncate">{jar.fileName}</span>
                      <span className="inline-flex items-center gap-1 shrink-0">
                        <HardDrive className="w-3 h-3" />
                        {formatBytes(jar.sizeBytes)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDeleteJar(jar)}
                    title="Eliminar de la biblioteca"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: OFFICIAL CATALOG */}
      {tab === "official" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {OFFICIAL_ENGINES.map((eng) => (
              <button
                key={eng.id}
                onClick={() => setSelectedEngine(eng.id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedEngine === eng.id
                    ? "bg-emerald-500/12 border-emerald-mc text-text-primary"
                    : "bg-surface border-border-subtle hover:border-border-strong text-text-secondary"
                }`}
              >
                <p className="text-sm font-semibold">{eng.label}</p>
                <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{eng.desc}</p>
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar versión (ej. 1.21.4, 1.20.1, 26.1)..."
              className="w-full bg-surface border border-border-subtle focus:border-emerald-mc rounded-lg pl-10 pr-4 py-2 text-sm text-text-primary focus:outline-none"
            />
          </div>

          {loadingVersions ? (
            <div className="flex items-center justify-center py-12 text-sm text-text-secondary gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              Consultando versiones oficiales...
            </div>
          ) : (
            <div className="bg-surface border border-border-subtle rounded-xl divide-y divide-border-subtle max-h-[520px] overflow-y-auto">
              {filteredVersions.map((v) => {
                const isCached = jars.some(
                  (j) => j.engine === selectedEngine && j.mcVersion === v.mcVersion
                );
                const key = `${selectedEngine}:${v.mcVersion}`;
                return (
                  <div
                    key={v.mcVersion}
                    className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-elevated/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-sm text-text-primary">
                        Minecraft {v.mcVersion}
                      </span>
                      {v.javaMajor && (
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-canvas border border-border-subtle text-text-secondary">
                          Java {v.javaMajor}
                        </span>
                      )}
                      {isCached && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          En biblioteca
                        </span>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant={isCached ? "secondary" : "primary"}
                      loading={downloadingKey === key}
                      onClick={() => handleDownloadOfficial(v.mcVersion)}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {isCached ? "Re-verificar" : "Descargar"}
                    </Button>
                  </div>
                );
              })}
              {filteredVersions.length === 0 && (
                <div className="py-10 text-center text-sm text-text-muted">
                  No hay versiones que coincidan con "{search}".
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: UPLOAD CUSTOM JAR */}
      {tab === "upload" && (
        <form
          onSubmit={handleUploadCustom}
          className="bg-surface border border-border-subtle rounded-xl p-6 max-w-xl space-y-4"
        >
          <div>
            <label className="block text-sm font-medium mb-1.5">Archivo de servidor (.jar)</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border-strong hover:border-emerald-mc rounded-xl p-6 cursor-pointer bg-canvas/60 transition-colors">
              <Upload className="w-7 h-7 text-emerald-400 mb-2" />
              <span className="text-sm font-medium text-text-primary">
                {uploadFile ? uploadFile.name : "Haz clic para seleccionar tu archivo .jar"}
              </span>
              <span className="text-xs text-text-muted mt-1">
                Compatible con Purpur, Spigot, Mohist, Arclight, Paper o cualquier server .jar
              </span>
              <input
                type="file"
                accept=".jar"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setUploadFile(f);
                  if (f && !customName) setCustomName(f.name.replace(/\.jar$/i, ""));
                }}
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Nombre para identificarlo en tu Biblioteca
            </label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Ej. Purpur 1.21.4 Optimizado"
              className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Versión de Minecraft
              </label>
              <input
                type="text"
                value={customMcVersion}
                onChange={(e) => setCustomMcVersion(e.target.value)}
                placeholder="1.21.4"
                className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Versión de Java recomendada
              </label>
              <select
                value={customJava}
                onChange={(e) => setCustomJava(Number(e.target.value))}
                className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
              >
                <option value={8}>Java 8 (≤ 1.16.5)</option>
                <option value={17}>Java 17 (1.17 – 1.20.4)</option>
                <option value={21}>Java 21 (1.20.5 – 1.21.x)</option>
                <option value={25}>Java 25 (26.x+)</option>
              </select>
            </div>
          </div>

          <Button type="submit" loading={uploading} disabled={!uploadFile}>
            <Upload className="w-4 h-4" />
            Guardar .JAR en Biblioteca
          </Button>
        </form>
      )}
    </div>
  );
}
