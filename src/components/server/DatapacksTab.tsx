import React, { useEffect, useState } from "react";
import {
  Search,
  Download,
  Upload,
  Trash2,
  Power,
  RefreshCw,
  Loader2,
  Puzzle,
  Info,
  Folder,
  FileArchive,
} from "lucide-react";
import type { DatapackItem, ModrinthSearchHit, ServerView } from "../../../shared/types";
import { api, formatBytes } from "../../lib/api";
import { Button } from "../ui/Primitives";

export function DatapacksTab({
  server,
  onToast,
}: {
  server: ServerView;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [datapacks, setDatapacks] = useState<DatapackItem[]>([]);
  const [worldName, setWorldName] = useState("world");
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<"installed" | "modrinth">("installed");
  const [reloading, setReloading] = useState(false);

  // Modrinth datapacks search
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const isOnline = server.status === "running";

  const loadDatapacks = async () => {
    if (server.engine === "bedrock") return;
    setLoading(true);
    try {
      const res = await api.listDatapacks(server.id);
      setDatapacks(res.datapacks);
      setWorldName(res.worldName);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDatapacks();
  }, [server.id, server.engine]);

  const runSearch = async (q: string) => {
    setSearching(true);
    try {
      const res = await api.searchModrinthDatapacks(server.id, q);
      setHits(res.hits);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (subTab === "modrinth" && hits.length === 0 && server.engine !== "bedrock") {
      void runSearch(query);
    }
  }, [subTab]);

  if (server.engine === "bedrock") {
    return (
      <div className="bg-surface border border-border-subtle rounded-xl p-8 text-center">
        <Puzzle className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <h3 className="text-base font-semibold">Los Datapacks son exclusivos de Minecraft Java</h3>
        <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
          En Minecraft Bedrock se utilizan <strong>Behavior Packs</strong> y{" "}
          <strong>Resource Packs</strong>, los cuales puedes subir y administrar desde la pestaña{" "}
          <strong>Archivos y Editor</strong>.
        </p>
      </div>
    );
  }

  const handleUploadZip = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        await api.uploadDatapack(server.id, f);
        onToast("success", `Datapack "${f.name}" agregado en ${worldName}/datapacks/.`);
      } catch (err: any) {
        onToast("error", `${f.name}: ${err.message}`);
      }
    }
    await loadDatapacks();
  };

  const handleInstallModrinth = async (hit: ModrinthSearchHit) => {
    setInstallingId(hit.projectId);
    try {
      const res = await api.installModrinthDatapack(server.id, hit.projectId);
      onToast(
        "success",
        `Datapack "${hit.title}" (${res.fileName}) instalado en ${res.worldName}/datapacks/.`
      );
      await loadDatapacks();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setInstallingId(null);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      await api.reloadDatapacks(server.id);
      onToast("success", "Comando /reload enviado al servidor.");
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-slide-up">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex bg-surface border border-border-subtle rounded-lg p-1">
          <button
            onClick={() => setSubTab("installed")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              subTab === "installed"
                ? "bg-emerald-mc text-[#06180D] font-semibold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Instalados ({datapacks.length})
          </button>
          <button
            onClick={() => setSubTab("modrinth")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              subTab === "modrinth"
                ? "bg-emerald-mc text-[#06180D] font-semibold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Buscar en Modrinth
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOnline && (
            <Button size="sm" variant="secondary" loading={reloading} onClick={handleReload}>
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
              Recargar (/reload)
            </Button>
          )}
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-mc text-[#06180D] hover:bg-emerald-mc-hover text-xs font-semibold cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            Subir Datapack (.zip)
            <input
              type="file"
              accept=".zip"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUploadZip(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {/* Helpful world-gen notice */}
      <div className="bg-surface border border-border-subtle rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs text-text-secondary">
        <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <span>
          Carpeta activa: <code className="font-mono text-emerald-300">{worldName}/datapacks/</code>
          . Los datapacks funcionan incluso en <strong>Java Vanilla</strong> sin que tus amigos
          instalen mods. Nota: los datapacks de biomas o terreno (como <em>Terralith</em> o{" "}
          <em>Tectonic</em>) se aplican en chunks nuevos o al crear un mundo nuevo.
        </span>
      </div>

      {/* INSTALLED DATAPACKS */}
      {subTab === "installed" && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleUploadZip(e.dataTransfer.files);
          }}
          className="bg-surface border border-border-subtle rounded-xl overflow-hidden"
        >
          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              Leyendo {worldName}/datapacks/...
            </div>
          ) : datapacks.length === 0 ? (
            <div className="py-14 px-6 text-center">
              <Puzzle className="w-9 h-9 text-text-muted mx-auto mb-2.5" />
              <p className="text-sm font-medium text-text-primary">
                Todavía no tienes Datapacks instalados
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Arrastra un archivo <code className="font-mono">.zip</code> aquí o busca datapacks
                populares directo en <strong>Modrinth</strong> para Minecraft {server.mcVersion}.
              </p>
              <div className="mt-4">
                <Button size="sm" onClick={() => setSubTab("modrinth")}>
                  Explorar Datapacks en Modrinth
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {datapacks.map((dp) => (
                <div
                  key={dp.fileName}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-elevated/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {dp.isDirectory ? (
                      <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <FileArchive className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-mono truncate ${
                          dp.enabled ? "text-text-primary" : "text-text-muted line-through"
                        }`}
                      >
                        {dp.fileName}
                      </p>
                      <p className="text-xs text-text-muted font-mono">
                        {dp.isDirectory ? "Carpeta" : formatBytes(dp.sizeBytes)} •{" "}
                        {dp.enabled ? "Activo" : "Desactivado"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={dp.enabled ? "secondary" : "primary"}
                      onClick={async () => {
                        await api.toggleDatapack(server.id, dp.fileName);
                        await loadDatapacks();
                      }}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {dp.enabled ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        await api.deleteDatapack(server.id, dp.fileName);
                        onToast("info", `Datapack "${dp.fileName}" eliminado.`);
                        await loadDatapacks();
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODRINTH DATAPACKS SEARCH */}
      {subTab === "modrinth" && (
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Buscar datapacks en Modrinth para Minecraft ${server.mcVersion} (ej. Terralith, Tectonic, Incendium)...`}
                className="w-full bg-surface border border-border-strong rounded-lg pl-10 pr-4 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-mc"
              />
            </div>
            <Button type="submit" loading={searching}>
              Buscar
            </Button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {hits.map((hit) => (
              <div
                key={hit.projectId}
                className="bg-surface border border-border-subtle rounded-xl p-4 flex items-start gap-3.5"
              >
                <div className="w-11 h-11 rounded-lg bg-elevated border border-border-subtle overflow-hidden shrink-0 flex items-center justify-center">
                  {hit.iconUrl ? (
                    <img src={hit.iconUrl} alt={hit.title} className="w-full h-full object-cover" />
                  ) : (
                    <Puzzle className="w-5 h-5 text-text-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-text-primary leading-tight">
                        {hit.title}
                      </h4>
                      <p className="text-[11px] text-text-muted">
                        por {hit.author} • {hit.downloads.toLocaleString("es")} descargas
                      </p>
                    </div>
                    <Button
                      size="sm"
                      loading={installingId === hit.projectId}
                      onClick={() => void handleInstallModrinth(hit)}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Instalar
                    </Button>
                  </div>
                  <p className="text-xs text-text-secondary mt-1.5 line-clamp-2">
                    {hit.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {!searching && hits.length === 0 && (
            <div className="bg-surface border border-border-subtle rounded-xl py-10 text-center text-sm text-text-muted">
              No se encontraron datapacks compatibles con Minecraft {server.mcVersion}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
