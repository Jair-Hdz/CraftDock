import React, { useState } from "react";
import { Cpu, HardDrive, FolderOpen, Download, CheckCircle2, Power } from "lucide-react";
import type { GlobalSettings, SystemInfo } from "../../shared/types";
import { api } from "../lib/api";
import { Button } from "./ui/Primitives";

const JAVA_VERSIONS = [
  { major: 8, note: "Para Minecraft 1.16.5 y anteriores" },
  { major: 17, note: "Para Minecraft 1.17 – 1.20.4" },
  { major: 21, note: "Para Minecraft 1.20.5 – 1.21.x" },
  { major: 25, note: "Para Minecraft 26.x+" },
];

export function SystemSettingsView({
  system,
  settings,
  onRefresh,
  onToast,
}: {
  system: SystemInfo | null;
  settings: GlobalSettings | null;
  onRefresh: () => Promise<void>;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [installingJava, setInstallingJava] = useState<number | null>(null);
  const [shuttingDown, setShuttingDown] = useState(false);

  const handleInstallJava = async (major: number) => {
    setInstallingJava(major);
    try {
      await api.installJava(major);
      onToast("success", `Java ${major} (Adoptium Temurin) listo.`);
      await onRefresh();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setInstallingJava(null);
    }
  };

  const handleToggleAutoOpen = async (next: boolean) => {
    try {
      await api.updateSettings({ autoOpenBrowser: next });
      onToast("success", "Preferencia guardada.");
      await onRefresh();
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleSafeShutdown = async () => {
    setShuttingDown(true);
    try {
      await api.shutdownApp();
      onToast(
        "info",
        "Guardando todos los mundos y cerrando CraftDock de forma segura. Ya puedes cerrar esta pestaña."
      );
    } catch (err: any) {
      onToast("error", err.message);
      setShuttingDown(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-slide-up max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ajustes y Sistema</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Información de tu PC, versiones portables de Java y cierre seguro de servidores.
        </p>
      </div>

      {/* Hardware specs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-text-secondary mb-1">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            Memoria RAM del equipo
          </div>
          <p className="text-lg font-bold font-mono">
            {system ? `${(system.totalRamMb / 1024).toFixed(1)} GB` : "..."}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            Máximo seguro sugerido:{" "}
            <span className="font-mono text-emerald-400">
              {system ? `${(system.recommendedMaxRamMb / 1024).toFixed(1)} GB` : "-"}
            </span>
          </p>
        </div>

        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-text-secondary mb-1">
            <Cpu className="w-4 h-4 text-sky-400" />
            Procesador
          </div>
          <p className="text-lg font-bold font-mono">{system ? `${system.cpuCount} hilos` : "..."}</p>
          <p className="text-xs text-text-muted mt-0.5 truncate">{system?.cpuModel}</p>
        </div>

        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-text-secondary mb-1">
            <FolderOpen className="w-4 h-4 text-amber-400" />
            Red local (LAN)
          </div>
          <p className="text-lg font-bold font-mono">{system?.lanIp || "127.0.0.1"}</p>
          <p className="text-xs text-text-muted mt-0.5">{system?.platform}</p>
        </div>
      </div>

      {/* Java Runtimes */}
      <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Motores Java Portables (Adoptium Temurin)</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            CraftDock descarga Java automáticamente cuando creas o enciendes un servidor, pero
            también puedes pre-instalar cualquier versión aquí.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {JAVA_VERSIONS.map((jv) => {
            const installed = system?.installedJavaVersions.includes(jv.major) ?? false;
            return (
              <div
                key={jv.major}
                className="bg-canvas border border-border-subtle rounded-lg p-3.5 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-semibold font-mono text-text-primary">
                    Java {jv.major}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">{jv.note}</p>
                </div>
                {installed ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/12 border border-emerald-500/25 px-2.5 py-1 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Instalado
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={installingJava === jv.major}
                    onClick={() => handleInstallJava(jv.major)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Instalar
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Data Dir & Preferences */}
      <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold">Almacenamiento y Comportamiento</h2>

        <div>
          <p className="text-xs text-text-secondary mb-1">
            Carpeta actual de datos (servidores, mundos, .jar y respaldos):
          </p>
          <div className="bg-canvas border border-border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-primary break-all">
            {system?.dataDir || settings?.dataDir}
          </div>
          <p className="text-[11px] text-text-muted mt-1">
            También puedes definir la variable de entorno{" "}
            <code className="font-mono">CRAFTDOCK_DATA_DIR</code> si deseas usar una unidad externa.
          </p>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings?.autoOpenBrowser ?? true}
            onChange={(e) => handleToggleAutoOpen(e.target.checked)}
            className="accent-[#1BD96A] w-4 h-4"
          />
          <span className="text-sm text-text-primary">
            Abrir automáticamente el navegador al iniciar CraftDock.exe
          </span>
        </label>
      </div>

      {/* Safe Shutdown */}
      <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-red-200">Cierre Seguro de CraftDock</h2>
          <p className="text-xs text-red-200/80 mt-0.5">
            Envía <code className="font-mono">save-all</code> y <code className="font-mono">stop</code>{" "}
            a todos los servidores encendidos y apaga el túnel playit.gg antes de salir, evitando
            mundos corruptos.
          </p>
        </div>
        <Button variant="danger" loading={shuttingDown} onClick={handleSafeShutdown}>
          <Power className="w-4 h-4" />
          Cerrar CraftDock Seguro
        </Button>
      </div>
    </div>
  );
}
