import React, { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Folder,
  FileText,
  File as FileIcon,
  Upload,
  FolderPlus,
  FilePlus,
  Trash2,
  Pencil,
  Download,
  Save,
  ChevronRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import type { FileEntry } from "../../../shared/types";
import { api, formatBytes } from "../../lib/api";
import { Button } from "../ui/Primitives";

function getEditorExtensions(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".mcmeta")) return [json()];
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return [yaml()];
  if (lower.endsWith(".xml")) return [xml()];
  return [];
}

export function FileLibraryTab({
  serverId,
  onToast,
}: {
  serverId: string;
  onToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [currentDir, setCurrentDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Built-in editor state
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  const isDirty = editingPath !== null && editorContent !== savedContent;

  const loadDir = async (dir: string) => {
    setLoading(true);
    try {
      const res = await api.listFiles(serverId, dir);
      setCurrentDir(res.path);
      setEntries(res.entries);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEditingPath(null);
    void loadDir("");
  }, [serverId]);

  const handleOpenFile = async (entry: FileEntry) => {
    if (entry.isDirectory) {
      void loadDir(entry.relativePath);
      return;
    }
    if (!entry.editable) {
      onToast("info", "Archivo binario: usa el botón Descargar para abrirlo en tu PC.");
      return;
    }
    setLoadingFile(true);
    try {
      const res = await api.readFile(serverId, entry.relativePath);
      setEditingPath(entry.relativePath);
      setEditingName(res.name);
      setEditorContent(res.content);
      setSavedContent(res.content);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleSaveFile = async () => {
    if (!editingPath) return;
    setSavingFile(true);
    try {
      await api.writeFile(serverId, editingPath, editorContent);
      setSavedContent(editorContent);
      onToast("success", `Archivo "${editingName}" guardado.`);
    } catch (err: any) {
      onToast("error", err.message);
    } finally {
      setSavingFile(false);
    }
  };

  // Ctrl+S shortcut inside editor
  useEffect(() => {
    if (!editingPath) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingPath, editorContent]);

  const handleCreate = async (type: "file" | "folder") => {
    const label = type === "folder" ? "Nombre de la nueva carpeta:" : "Nombre del nuevo archivo (ej. notas.txt):";
    const name = window.prompt(label);
    if (!name?.trim()) return;
    try {
      await api.createFileEntry(serverId, currentDir, name.trim(), type);
      onToast("success", `${type === "folder" ? "Carpeta" : "Archivo"} creado.`);
      await loadDir(currentDir);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleRename = async (entry: FileEntry) => {
    const next = window.prompt(`Nuevo nombre para "${entry.name}":`, entry.name);
    if (!next?.trim() || next.trim() === entry.name) return;
    try {
      await api.renameFileEntry(serverId, entry.relativePath, next.trim());
      onToast("success", "Renombrado correctamente.");
      await loadDir(currentDir);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    if (!window.confirm(`¿Eliminar "${entry.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deleteFileEntry(serverId, entry.relativePath);
      if (editingPath === entry.relativePath) setEditingPath(null);
      onToast("info", `"${entry.name}" eliminado.`);
      await loadDir(currentDir);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const res = await api.uploadFiles(serverId, currentDir, files);
      onToast("success", `${res.saved.length} archivo(s) subidos.`);
      await loadDir(currentDir);
    } catch (err: any) {
      onToast("error", err.message);
    }
  };

  const crumbs = currentDir ? currentDir.split("/") : [];

  if (editingPath !== null) {
    return (
      <div className="space-y-3 animate-fade-slide-up">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-surface border border-border-subtle rounded-xl px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (isDirty && !window.confirm("Tienes cambios sin guardar. ¿Salir igual?")) return;
                setEditingPath(null);
              }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-text-primary truncate">
                  {editingPath}
                </span>
                {isDirty && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Sin guardar
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-muted">Atajo rápido: Ctrl + S para guardar</p>
            </div>
          </div>

          <Button size="sm" loading={savingFile} disabled={!isDirty} onClick={handleSaveFile}>
            <Save className="w-3.5 h-3.5" />
            Guardar cambios
          </Button>
        </div>

        <div className="rounded-xl overflow-hidden border border-border-strong bg-terminal">
          <CodeMirror
            value={editorContent}
            height="520px"
            theme={oneDark}
            extensions={getEditorExtensions(editingName)}
            onChange={(val) => setEditorContent(val)}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              foldGutter: true,
              autocompletion: true,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-slide-up">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface border border-border-subtle rounded-xl px-4 py-3">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-xs font-mono flex-wrap">
          <button
            onClick={() => void loadDir("")}
            className="px-2 py-1 rounded hover:bg-elevated text-emerald-400 font-semibold"
          >
            /raiz
          </button>
          {crumbs.map((seg, i) => {
            const target = crumbs.slice(0, i + 1).join("/");
            return (
              <React.Fragment key={target}>
                <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                <button
                  onClick={() => void loadDir(target)}
                  className="px-2 py-1 rounded hover:bg-elevated text-text-primary"
                >
                  {seg}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => handleCreate("folder")}>
            <FolderPlus className="w-3.5 h-3.5" />
            Carpeta
          </Button>
          <Button variant="secondary" size="sm" onClick={() => handleCreate("file")}>
            <FilePlus className="w-3.5 h-3.5" />
            Archivo
          </Button>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-mc text-[#06180D] hover:bg-emerald-mc-hover text-xs font-semibold cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            Subir archivos
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {/* File Table */}
      <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
        {loading || loadingFile ? (
          <div className="flex items-center justify-center py-12 text-sm text-text-secondary gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            Cargando archivos...
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {currentDir && (
              <button
                onClick={() => {
                  const parent = crumbs.slice(0, -1).join("/");
                  void loadDir(parent);
                }}
                className="w-full px-4 py-2.5 flex items-center gap-3 text-xs font-mono text-text-secondary hover:bg-elevated/50 text-left"
              >
                <ArrowLeft className="w-4 h-4 text-text-muted" />
                .. (Subir un nivel)
              </button>
            )}

            {entries.map((entry) => (
              <div
                key={entry.relativePath}
                className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-elevated/40 transition-colors"
              >
                <button
                  onClick={() => void handleOpenFile(entry)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left"
                >
                  {entry.isDirectory ? (
                    <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : entry.editable ? (
                    <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <FileIcon className="w-4 h-4 text-text-muted shrink-0" />
                  )}
                  <span className="text-sm text-text-primary font-mono truncate">
                    {entry.name}
                  </span>
                  {entry.editable && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hidden sm:inline">
                      Editable
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  {!entry.isDirectory && (
                    <span className="text-xs font-mono text-text-muted w-20 text-right hidden sm:inline">
                      {formatBytes(entry.sizeBytes)}
                    </span>
                  )}
                  {!entry.isDirectory && (
                    <a
                      href={`/api/servers/${serverId}/files/download?path=${encodeURIComponent(
                        entry.relativePath
                      )}`}
                      className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated"
                      title="Descargar"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => void handleRename(entry)}
                    className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated"
                    title="Renombrar"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void handleDelete(entry)}
                    className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10"
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {entries.length === 0 && (
              <div className="py-12 text-center text-sm text-text-muted">
                Esta carpeta está vacía.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
