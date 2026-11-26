import React, { useEffect, useState } from "react";
import {
  Search,
  Download,
  Upload,
  Trash2,
  Package,
  Archive,
  Power,
  Loader2,
  FolderArchive,
  ShieldCheck,
} from "lucide-react";
import type {
  ModItem,
  ModpackVersionOption,
  ModrinthSearchHit,
  ServerView,
} from "../../../shared/types";
import { api, formatBytes } from "../../lib/api";
import { Button } from "../ui/Primitives";

export function ModsPluginsTab({
  server,
  initialSearchQuery = "",
  onToast,
}: {
  server: ServerView;
  initialSearchQuery?: string;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [mods, setMods] = useState<ModItem[]>([]);
  const [folder, setFolder] = useState<"mods" | "plugins" | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<"installed" | "modrinth" | "modpacks">(
    initialSearchQuery ? "modrinth" : "installed"
  );

  // Modrinth search (mods / plugins)
  const [query, setQuery] = useState(initialSearchQuery);
  const [hits, setHits] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  // Modrinth Modpacks search (direct install into existing server)
  const [packQuery, setPackQuery] = useState("");
  const [packHits, setPackHits] = useState<ModrinthSearchHit[]>([]);
  const [searchingPacks, setSearchingPacks] = useState(false);
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
  const [packVersions, setPackVersions] = useState<ModpackVersionOption[]>([]);
  const [loadingPackVer, setLoadingPackVer] = useState(false);
  const [installingPackVerId, setInstallingPackVerId] = useState<string | null>(null);

  const isOnline = server.status === "running" || server.status === "starting";
  const isMods =
    server.engine === "fabric" || server.engine === "forge" || server.engine === "neoforge";

  const loadMods = async () => {
    setLoading(true);
    try {
      const res = await api.listMods(server.id);
      setMods(res.mods);
      setFolder(res.folder);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMods();
  }, [server.id]);

  useEffect(() => {
    if (initialSearchQuery) {
      setQuery(initialSearchQuery);
      setSubTab("modrinth");
      void runModrinthSearch(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const runModrinthSearch = async (q: string) => {
    setSearching(true);
    try {
      const res = await api.searchModrinth(server.id, q);
      setHits(res.hits);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSearching(false);
    }
  };

  const runModpacksSearch = async (q: string) => {
    setSearchingPacks(true);
    try {
      const loader = isMods ? server.engine : undefined;
      const res = await api.searchModpacks(q, loader, server.mcVersion);
      setPackHits(res.hits);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSearchingPacks(false);
    }
  };

  useEffect(() => {
    if (subTab === "modrinth" && hits.length === 0) {
      void runModrinthSearch(query);
    }
    if (subTab === "modpacks" && packHits.length === 0) {
      void runModpacksSearch(packQuery);
    }
  }, [subTab]);

  const handleUploadJar = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        await api.uploadMod(server.id, f, folder || undefined);
        onToast("success", `"${f.name}" agregado.`);
      } catch (err: any) {
        onToast("error", `${f.name}: ${err.message}`);
      }
    }
    await loadMods();
  };

  const handleImportMrpack = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await api.importMrpack(server.id, file);
      onToast(
        "success",
        `Modpack "${res.packName}" instalado (${res.downloadedCount} archivos).`
      );
      await loadMods();
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleInstallModrinth = async (hit: ModrinthSearchHit) => {
    setInstallingId(hit.projectId);
    try {
      const res = await api.installModrinth(server.id, hit.projectId);
      onToast(
        "success",
        `Instalado "${hit.title}" (${res.installedFiles.length} archivo/s). Reinicia el servidor para aplicarlo.`
      );
      await loadMods();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setInstallingId(null);
    }
  };

  const handleExpandModpack = async (projectId: string) => {
    if (expandedPackId === projectId) {
      setExpandedPackId(null);
      return;
    }
    setExpandedPackId(projectId);
    setLoadingPackVer(true);
    try {
      const res = await api.listModpackVersions(
        projectId,
        isMods ? server.engine : undefined,
        server.mcVersion
      );
      setPackVersions(res.versions);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setLoadingPackVer(false);
    }
  };

  const handleInstallModpackDirect = async (ver: ModpackVersionOption, packTitle: string) => {
    if (isOnline) {
      onToast("error", "Apaga el servidor antes de instalar un modpack.");
      return;
    }
    if (
      !window.confirm(
        `¿Instalar el modpack "${packTitle}" (${ver.name}) en este servidor? CraftDock hará un respaldo automático de seguridad antes de instalar los archivos.`
      )
    ) {
      return;
    }
    setInstallingPackVerId(ver.versionId);
    try {
      const res = await api.installModpackOnServer(server.id, ver.versionId);
      onToast(
        "success",
        `Modpack "${res.packName}" instalado (${res.downloadedCount} archivos, ${res.skippedClientOnly} solo-cliente omitidos).`
      );
      await loadMods();
      setSubTab("installed");
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setInstallingPackVerId(null);
    }
  };

  if (server.engine === "vanilla" || server.engine === "bedrock") {
    return (
      <div className="bg-surface border border-border-subtle rounded-xl p-8 text-center">
        <Package className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <h3 className="text-base font-semibold">
          {server.engine === "bedrock"
            ? "Bedrock usa Behavior/Resource Packs en la pestaña Archivos"
            : "Java Vanilla no carga mods ni plugins"}
        </h3>
        <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
          {server.engine === "vanilla"
            ? "Si quieres usar plugins o mods, cambia el archivo .jar de este servidor a Paper, Fabric, NeoForge o Forge en la pestaña Ajustes (se hace respaldo automático antes), o usa Datapacks en la pestaña Datapacks."
            : "Puedes administrar tus packs directamente desde la pestaña Archivos (development_behavior_packs / resource_packs)."}
        </p>
      </div>
    );
  }

  const label = isMods ? "Mods" : "Plugins";

  return (
    <div className="space-y-4 animate-fade-slide-up">
      {/* Header actions */}
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
            Instalados ({mods.length})
          </button>
          <button
            onClick={() => setSubTab("modrinth")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              subTab === "modrinth"
                ? "bg-emerald-mc text-[#06180D] font-semibold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {label} (Modrinth)
          </button>
          {isMods && (
            <button
              onClick={() => setSubTab("modpacks")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                subTab === "modpacks"
                  ? "bg-emerald-mc text-[#06180D] font-semibold"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Modpacks Directos
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated border border-border-strong hover:bg-[#252E3D] text-xs font-medium cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            Subir .jar
            <input
              type="file"
              accept=".jar"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUploadJar(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          {isMods && (
            <>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated border border-border-strong hover:bg-[#252E3D] text-xs font-medium cursor-pointer">
                <FolderArchive className="w-3.5 h-3.5 text-sky-400" />
                Subir .mrpack
                <input
                  type="file"
                  accept=".mrpack,.zip"
                  className="hidden"
                  onChange={(e) => {
                    void handleImportMrpack(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>

              <a
                href={`/api/servers/${server.id}/mods/export`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-semibold"
              >
                <Archive className="w-3.5 h-3.5" />
                Exportar .zip para amigos
              </a>
            </>
          )}
        </div>
      </div>

      {/* INSTALLED LIST */}
      {subTab === "installed" && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleUploadJar(e.dataTransfer.files);
          }}
          className="bg-surface border border-border-subtle rounded-xl overflow-hidden"
        >
          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              Leyendo carpeta {folder}/...
            </div>
          ) : mods.length === 0 ? (
            <div className="py-14 px-6 text-center">
              <Package className="w-9 h-9 text-text-muted mx-auto mb-2.5" />
              <p className="text-sm font-medium text-text-primary">
                Aún no hay {label.toLowerCase()} instalados
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Arrastra archivos <code className="font-mono">.jar</code> aquí, instálalos desde{" "}
                <strong>Modrinth</strong> o aplica un <strong>Modpack directo</strong>.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button size="sm" onClick={() => setSubTab("modrinth")}>
                  Explorar {label}
                </Button>
                {isMods && (
                  <Button size="sm" variant="secondary" onClick={() => setSubTab("modpacks")}>
                    Explorar Modpacks
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {mods.map((mod) => (
                <div
                  key={`${mod.folder}/${mod.fileName}`}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-elevated/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-mono truncate ${
                          mod.enabled ? "text-text-primary" : "text-text-muted line-through"
                        }`}
                      >
                        {mod.fileName}
                      </span>
                      {mod.isSystemPlugin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                          Crossplay
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted font-mono">
                      {mod.folder}/ • {formatBytes(mod.sizeBytes)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={mod.enabled ? "secondary" : "primary"}
                      onClick={async () => {
                        await api.toggleMod(server.id, mod.folder, mod.fileName);
                        await loadMods();
                      }}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {mod.enabled ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        await api.deleteMod(server.id, mod.folder, mod.fileName);
                        onToast("info", `"${mod.fileName}" eliminado.`);
                        await loadMods();
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

      {/* MODRINTH INDIVIDUAL MODS / PLUGINS */}
      {subTab === "modrinth" && (
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runModrinthSearch(query);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Buscar ${label.toLowerCase()} en Modrinth para ${server.engine} ${server.mcVersion}...`}
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
                    <Package className="w-5 h-5 text-text-muted" />
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
                      onClick={() => handleInstallModrinth(hit)}
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
              No se encontraron resultados compatibles para {server.engine} {server.mcVersion}.
            </div>
          )}
        </div>
      )}

      {/* MODRINTH DIRECT MODPACKS */}
      {subTab === "modpacks" && isMods && (
        <div className="space-y-3">
          <div className="bg-emerald-500/8 border border-emerald-500/25 rounded-xl px-4 py-3 flex items-center gap-3 text-xs text-emerald-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Mostrando modpacks de Modrinth compatibles con{" "}
              <strong className="font-mono uppercase">{server.engine}</strong>{" "}
              <strong className="font-mono">v{server.mcVersion}</strong>. CraftDock crea un respaldo
              automático antes de instalar cualquier modpack.
            </span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runModpacksSearch(packQuery);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={packQuery}
                onChange={(e) => setPackQuery(e.target.value)}
                placeholder={`Buscar modpacks para ${server.engine} ${server.mcVersion}...`}
                className="w-full bg-surface border border-border-strong rounded-lg pl-10 pr-4 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-mc"
              />
            </div>
            <Button type="submit" loading={searchingPacks}>
              Buscar Modpacks
            </Button>
          </form>

          <div className="space-y-2.5">
            {packHits.map((hit) => {
              const expanded = expandedPackId === hit.projectId;
              return (
                <div
                  key={hit.projectId}
                  className="bg-surface border border-border-subtle rounded-xl overflow-hidden"
                >
                  <div className="p-4 flex items-start gap-3.5">
                    <div className="w-12 h-12 rounded-lg bg-elevated border border-border-subtle overflow-hidden shrink-0 flex items-center justify-center">
                      {hit.iconUrl ? (
                        <img
                          src={hit.iconUrl}
                          alt={hit.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FolderArchive className="w-5 h-5 text-text-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-semibold text-text-primary">{hit.title}</h4>
                          <p className="text-[11px] text-text-muted">
                            por {hit.author} • {hit.downloads.toLocaleString("es")} descargas
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={expanded ? "secondary" : "primary"}
                          onClick={() => void handleExpandModpack(hit.projectId)}
                        >
                          {expanded ? "Ocultar versiones" : "Elegir versión"}
                        </Button>
                      </div>
                      <p className="text-xs text-text-secondary mt-1.5">{hit.description}</p>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-border-subtle bg-canvas/70 px-4 py-3 space-y-2">
                      {loadingPackVer ? (
                        <div className="flex items-center gap-2 text-xs text-text-secondary py-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          Cargando versiones compatibles...
                        </div>
                      ) : packVersions.length === 0 ? (
                        <p className="text-xs text-text-muted">
                          No hay versiones publicadas exactamente para {server.engine}{" "}
                          {server.mcVersion}.
                        </p>
                      ) : (
                        packVersions.slice(0, 8).map((ver) => (
                          <div
                            key={ver.versionId}
                            className="flex flex-wrap items-center justify-between gap-2 bg-surface border border-border-subtle rounded-lg px-3 py-2"
                          >
                            <div className="text-xs">
                              <span className="font-semibold text-text-primary">{ver.name}</span>
                              <span className="ml-2 font-mono text-text-muted">
                                MC {ver.mcVersion} • {ver.detectedEngine?.toUpperCase()}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              disabled={isOnline}
                              loading={installingPackVerId === ver.versionId}
                              onClick={() => void handleInstallModpackDirect(ver, hit.title)}
                            >
                              <Download className="w-3.5 h-3.5" />
                              Instalar Pack
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!searchingPacks && packHits.length === 0 && (
              <div className="bg-surface border border-border-subtle rounded-xl py-10 text-center text-sm text-text-muted">
                No se encontraron modpacks para {server.engine} {server.mcVersion}. También puedes
                crear un servidor nuevo eligiendo <strong>Modpack Directo (Modrinth)</strong> para
                que detecte automáticamente cualquier versión.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
