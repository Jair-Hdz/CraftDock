import React, { useEffect, useState } from "react";
import {
  Archive,
  RotateCcw,
  Download,
  Trash2,
  Upload,
  Plus,
  ShieldCheck,
  Clock,
} from "lucide-react";
import type { BackupRecord, ServerView } from "../../../shared/types";
import { api, formatBytes } from "../../lib/api";
import { Button } from "../ui/Primitives";

export function BackupsWorldsTab({
  server,
  onServerUpdated,
  onToast,
}: {
  server: ServerView;
  onServerUpdated: (s: ServerView) => void;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [intervalMin, setIntervalMin] = useState(server.autoBackupIntervalMinutes);
  const [retention, setRetention] = useState(server.backupRetentionCount);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const isOnline = server.status === "running" || server.status === "starting";

  const loadBackups = async () => {
    try {
      const res = await api.listBackups(server.id);
      setBackups(res.backups);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  useEffect(() => {
    void loadBackups();
  }, [server.id]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.createBackup(server.id, label.trim() || undefined);
      setLabel("");
      onToast("success", "Respaldo del mundo creado correctamente.");
      await loadBackups();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (b: BackupRecord) => {
    if (
      !window.confirm(
        `¿Restaurar "${b.label}"? Antes de sobrescribir, CraftDock creará un respaldo automático de seguridad de tu mundo actual.`
      )
    ) {
      return;
    }
    setRestoringId(b.id);
    try {
      await api.restoreBackup(server.id, b.id);
      onToast("success", "Mundo restaurado correctamente.");
      await loadBackups();
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setRestoringId(null);
    }
  };

  const handleImportWorld = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await api.importWorld(server.id, file);
      onToast("success", `Mundo importado en "${res.worldName}".`);
      await loadBackups();
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      const res = await api.updateServer(server.id, {
        autoBackupIntervalMinutes: intervalMin,
        backupRetentionCount: retention,
      });
      onServerUpdated(res.server);
      onToast("success", "Política de respaldos automáticos guardada.");
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSavingPolicy(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-slide-up">
      {/* World Import / Export + Manual Backup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Crear Respaldo en 1 Clic
          </h3>
          <p className="text-xs text-text-secondary">
            Guarda el mundo completo (Overworld, Nether, End) junto con la configuración y listas de
            jugadores.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Etiqueta opcional (ej. Antes del Dragón)"
              className="flex-1 bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
            />
            <Button loading={creating} onClick={handleCreate}>
              <Plus className="w-4 h-4" />
              Respaldar
            </Button>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-xl p-5 space-y-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Archive className="w-4 h-4 text-sky-400" />
            Importar o Exportar Mundo (.zip)
          </h3>
          <p className="text-xs text-text-secondary">
            Sube un mapa descargado o tu mundo de un jugador (debe incluir{" "}
            <code className="font-mono">level.dat</code>). Se crea un respaldo previo automático.
          </p>
          <div className="flex flex-wrap gap-2">
            <label
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-elevated border border-border-strong text-sm font-medium ${
                isOnline ? "opacity-50 pointer-events-none" : "hover:bg-[#252E3D] cursor-pointer"
              }`}
            >
              <Upload className="w-4 h-4 text-emerald-400" />
              Subir Mundo (.zip)
              <input
                type="file"
                accept=".zip"
                disabled={isOnline}
                className="hidden"
                onChange={(e) => {
                  void handleImportWorld(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <a
              href={`/api/servers/${server.id}/worlds/export`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-elevated border border-border-strong hover:bg-[#252E3D] text-sm font-medium"
            >
              <Download className="w-4 h-4 text-sky-400" />
              Descargar Mundo (.zip)
            </a>
          </div>
          {isOnline && (
            <p className="text-[11px] text-amber-300">
              Apaga el servidor para poder importar o restaurar un mundo.
            </p>
          )}
        </div>
      </div>

      {/* Automatic backup policy */}
      <div className="bg-surface border border-border-subtle rounded-xl p-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5 mb-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              Auto-backup periódico mientras está encendido
            </label>
            <select
              value={intervalMin}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
              className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary"
            >
              <option value={0}>Desactivado (solo manual + anti-desastres)</option>
              <option value={30}>Cada 30 minutos</option>
              <option value={60}>Cada 1 hora</option>
              <option value={120}>Cada 2 horas</option>
              <option value={240}>Cada 4 horas</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Conservar últimos respaldos automáticos (para no llenar el disco)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
              className="w-full bg-canvas border border-border-strong rounded-lg px-3 py-2 text-sm font-mono text-text-primary"
            />
          </div>
        </div>
        <Button variant="secondary" loading={savingPolicy} onClick={handleSavePolicy}>
          Guardar Política
        </Button>
      </div>

      {/* Backups history */}
      <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
          <h3 className="text-sm font-semibold">Historial de Respaldos ({backups.length})</h3>
        </div>
        {backups.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">
            Todavía no hay respaldos guardados para este servidor.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {backups.map((b) => (
              <div
                key={b.id}
                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-elevated/40"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{b.label}</span>
                    <span
                      className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                        b.kind === "pre-change"
                          ? "bg-amber-500/12 text-amber-300 border-amber-500/25"
                          : b.kind === "scheduled"
                          ? "bg-sky-500/12 text-sky-300 border-sky-500/25"
                          : "bg-emerald-500/12 text-emerald-300 border-emerald-500/25"
                      }`}
                    >
                      {b.kind === "pre-change"
                        ? "Anti-desastres"
                        : b.kind === "scheduled"
                        ? "Automático"
                        : "Manual"}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted font-mono mt-0.5">
                    {new Date(b.createdAt).toLocaleString("es")} • {formatBytes(b.sizeBytes)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isOnline}
                    loading={restoringId === b.id}
                    onClick={() => handleRestore(b)}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restaurar
                  </Button>
                  <a
                    href={`/api/servers/${server.id}/backups/${b.id}/download`}
                    className="p-2 rounded-lg bg-elevated border border-border-subtle hover:border-border-strong text-text-secondary hover:text-text-primary"
                    title="Descargar .zip"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      await api.deleteBackup(server.id, b.id);
                      onToast("info", "Respaldo eliminado.");
                      await loadBackups();
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
    </div>
  );
}
