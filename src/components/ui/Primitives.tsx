import React, { useEffect } from "react";
import { CheckCircle2, AlertTriangle, XCircle, X, Loader2 } from "lucide-react";
import type { ServerEngine, ServerStatus, SystemInfo, TaskProgress } from "../../../shared/types";
import { getRamZoneClient } from "../../lib/api";

export interface ToastItem {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-mc/70 disabled:opacity-50 disabled:pointer-events-none select-none";
  const variants = {
    primary: "bg-emerald-mc text-[#06180D] hover:bg-emerald-mc-hover font-semibold",
    secondary: "bg-elevated text-text-primary border border-border-strong hover:bg-[#252E3D]",
    danger: "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25",
    ghost: "text-text-secondary hover:text-text-primary hover:bg-elevated",
  };
  const sizes = {
    sm: "text-xs px-2.5 py-1.5",
    md: "text-sm px-3.5 py-2",
    lg: "text-sm px-5 py-2.5",
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: ServerStatus }) {
  const cfg: Record<
    ServerStatus,
    { label: string; dot: string; bg: string; text: string; pulse?: boolean }
  > = {
    running: {
      label: "En línea",
      dot: "bg-emerald-400",
      bg: "bg-emerald-500/12 border-emerald-500/30",
      text: "text-emerald-300",
      pulse: true,
    },
    starting: {
      label: "Iniciando",
      dot: "bg-amber-400",
      bg: "bg-amber-500/12 border-amber-500/30",
      text: "text-amber-300",
      pulse: true,
    },
    stopping: {
      label: "Apagando",
      dot: "bg-amber-400",
      bg: "bg-amber-500/12 border-amber-500/30",
      text: "text-amber-300",
    },
    crashed: {
      label: "Error",
      dot: "bg-red-400",
      bg: "bg-red-500/12 border-red-500/30",
      text: "text-red-300",
    },
    stopped: {
      label: "Apagado",
      dot: "bg-slate-500",
      bg: "bg-slate-500/10 border-border-subtle",
      text: "text-text-secondary",
    },
  };
  const item = cfg[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${item.bg} ${item.text}`}
    >
      <span className="relative flex h-2 w-2">
        {item.pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${item.dot} animate-pulse-ring`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${item.dot}`} />
      </span>
      {item.label}
    </span>
  );
}

export function EngineBadge({
  engine,
  crossplay = false,
}: {
  engine: ServerEngine;
  crossplay?: boolean;
}) {
  const styles: Record<ServerEngine, { label: string; cls: string }> = {
    vanilla: { label: "Java Vanilla", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25" },
    paper: {
      label: crossplay ? "Paper + Crossplay" : "Paper",
      cls: crossplay
        ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
        : "bg-teal-500/10 text-teal-300 border-teal-500/25",
    },
    fabric: { label: "Fabric", cls: "bg-yellow-500/12 text-yellow-300 border-yellow-500/25" },
    forge: { label: "Forge", cls: "bg-orange-500/12 text-orange-300 border-orange-500/25" },
    bedrock: { label: "Bedrock", cls: "bg-sky-500/12 text-sky-300 border-sky-500/25" },
    custom: { label: ".JAR Propio", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  };
  const s = styles[engine];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function RamSelector({
  valueMb,
  onChange,
  system,
}: {
  valueMb: number;
  onChange: (nextMb: number) => void;
  system: SystemInfo | null;
}) {
  const totalMb = system?.totalRamMb || 8192;
  const maxSlider = Math.max(2048, Math.min(totalMb - 1024, 32768));
  const zone = getRamZoneClient(valueMb, system);

  const zoneInfo = {
    green: {
      color: "text-emerald-400",
      bar: "bg-emerald-mc",
      bg: "bg-emerald-500/10 border-emerald-500/25",
      label: "Zona segura para tu PC",
    },
    yellow: {
      color: "text-amber-400",
      bar: "bg-amber-400",
      bg: "bg-amber-500/10 border-amber-500/25",
      label: "Zona justa — cierra navegadores o juegos pesados al hostear",
    },
    red: {
      color: "text-red-400",
      bar: "bg-red-500",
      bg: "bg-red-500/10 border-red-500/25",
      label: "Riesgo alto — podría trabar Windows o tu Minecraft",
    },
  }[zone];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-text-primary">Memoria RAM máxima</span>
        <span className={`font-mono font-semibold ${zoneInfo.color}`}>
          {(valueMb / 1024).toFixed(1)} GB ({valueMb} MB)
        </span>
      </div>
      <input
        type="range"
        min={1024}
        max={maxSlider}
        step={512}
        value={Math.min(valueMb, maxSlider)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#1BD96A] cursor-pointer"
      />
      <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${zoneInfo.bg}`}>
        <span className={zoneInfo.color}>{zoneInfo.label}</span>
        <span className="text-text-muted font-mono">
          PC: {(totalMb / 1024).toFixed(0)} GB total
        </span>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = "max-w-2xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[2px] animate-fade-slide-up"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidth} bg-surface border border-border-strong rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-border-subtle">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2.5 bg-elevated border border-border-strong rounded-xl px-4 py-3 shadow-xl animate-fade-slide-up"
        >
          {t.kind === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
          {t.kind === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
          {t.kind === "info" && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />}
          <p className="text-sm text-text-primary flex-1 leading-snug">{t.message}</p>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-text-muted hover:text-text-primary"
            aria-label="Cerrar notificación"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ProgressOverlay({ tasks }: { tasks: TaskProgress[] }) {
  const active = tasks.filter((t) => t.status === "running");
  if (active.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 w-80 space-y-2">
      {active.map((t) => (
        <div
          key={t.taskId}
          className="bg-surface border border-border-strong rounded-xl p-3.5 shadow-xl animate-fade-slide-up"
        >
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-semibold text-text-primary truncate pr-2">{t.title}</span>
            <span className="font-mono text-emerald-400">{t.percent}%</span>
          </div>
          <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden">
            <div
              className="h-full progress-shimmer rounded-full transition-all duration-200"
              style={{ width: `${Math.max(4, t.percent)}%` }}
            />
          </div>
          <p className="text-[11px] text-text-secondary mt-1.5 truncate">{t.detail}</p>
        </div>
      ))}
    </div>
  );
}
