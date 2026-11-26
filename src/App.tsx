import React, { useCallback, useEffect, useState } from "react";
import {
  Server as ServerIcon,
  Package,
  Globe,
  Settings,
  Plus,
  Menu,
  X,
  Blocks,
} from "lucide-react";
import type {
  GlobalSettings,
  JarLibraryItem,
  ServerView,
  SystemInfo,
  TaskProgress,
  TunnelStatus,
  WsEvent,
} from "../shared/types";
import { CreateServerModal } from "./components/CreateServerModal";
import { JarLibraryView } from "./components/JarLibraryView";
import { ServerDetailView } from "./components/server/ServerDetailView";
import { ServersDashboard } from "./components/ServersDashboard";
import { SystemSettingsView } from "./components/SystemSettingsView";
import { TunnelView } from "./components/TunnelView";
import {
  Button,
  ProgressOverlay,
  ToastContainer,
  type ToastItem,
} from "./components/ui/Primitives";
import { api } from "./lib/api";
import { useCraftDockWs } from "./lib/useCraftDockWs";

type NavSection = "servers" | "jars" | "tunnel" | "settings";

export function App() {
  const [nav, setNav] = useState<NavSection>("servers");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [servers, setServers] = useState<ServerView[]>([]);
  const [jars, setJars] = useState<JarLibraryItem[]>([]);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [consoleByServer, setConsoleByServer] = useState<Record<string, string[]>>({});
  const [tasks, setTasks] = useState<TaskProgress[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((kind: ToastItem["kind"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [sysRes, srvRes, jarRes, tunRes] = await Promise.all([
        api.getSystem(),
        api.listServers(),
        api.listJars(),
        api.getTunnel(),
      ]);
      setSystem(sysRes.system);
      setSettings(sysRes.settings);
      setServers(srvRes.servers);
      setJars(jarRes.jars);
      setTunnel(tunRes.tunnel);
    } catch (err: any) {
      addToast("error", err.message || "No se pudo conectar con el servidor local de CraftDock.");
    }
  }, [addToast]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleWsEvent = useCallback((ev: WsEvent) => {
    if (ev.type === "console_snapshot") {
      setConsoleByServer((prev) => ({ ...prev, [ev.serverId]: ev.lines }));
    } else if (ev.type === "console_line") {
      setConsoleByServer((prev) => {
        const list = prev[ev.serverId] || [];
        const next = [...list, ev.line];
        if (next.length > 1000) next.splice(0, next.length - 1000);
        return { ...prev, [ev.serverId]: next };
      });
    } else if (ev.type === "server_status") {
      setServers((prev) =>
        prev.map((s) =>
          s.id === ev.serverId
            ? { ...s, status: ev.status, lastCrash: ev.lastCrash }
            : s
        )
      );
    } else if (ev.type === "server_metrics") {
      setServers((prev) =>
        prev.map((s) => (s.id === ev.serverId ? { ...s, metrics: ev.metrics } : s))
      );
    } else if (ev.type === "tunnel_status") {
      setTunnel(ev.tunnel);
    } else if (ev.type === "task_progress") {
      setTasks((prev) => {
        const others = prev.filter((t) => t.taskId !== ev.progress.taskId);
        return [...others, ev.progress];
      });
      if (ev.progress.status !== "running") {
        setTimeout(() => {
          setTasks((prev) => prev.filter((t) => t.taskId !== ev.progress.taskId));
        }, 2500);
      }
    }
  }, []);

  const { subscribeConsole } = useCraftDockWs(handleWsEvent);

  const openServerDetail = async (id: string) => {
    setSelectedServerId(id);
    setNav("servers");
    subscribeConsole(id);
    try {
      const res = await api.getServer(id);
      setServers((prev) => prev.map((s) => (s.id === id ? res.server : s)));
      setConsoleByServer((prev) => ({ ...prev, [id]: res.consoleLines }));
    } catch (err: any) {
      addToast("error", err.message);
    }
  };

  const handleCopyInvite = async (id: string) => {
    try {
      const res = await api.getInvite(id);
      await navigator.clipboard.writeText(res.text);
      addToast("success", "¡Invitación copiada! Lista para pegar en Discord o WhatsApp.");
    } catch (err: any) {
      addToast("error", err.message);
    }
  };

  const selectedServer = selectedServerId
    ? servers.find((s) => s.id === selectedServerId) || null
    : null;

  const navItems: Array<{ id: NavSection; label: string; icon: React.ComponentType<any>; badge?: string }> = [
    {
      id: "servers",
      label: "Mis Servidores",
      icon: ServerIcon,
      badge: servers.length > 0 ? String(servers.length) : undefined,
    },
    {
      id: "jars",
      label: "Biblioteca de .JAR",
      icon: Package,
      badge: jars.length > 0 ? String(jars.length) : undefined,
    },
    {
      id: "tunnel",
      label: "Conexión Remota",
      icon: Globe,
      badge: tunnel?.state === "connected" ? "ON" : undefined,
    },
    { id: "settings", label: "Ajustes y Sistema", icon: Settings },
  ];

  const SidebarContent = (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-border-subtle">
        <div className="w-9 h-9 rounded-lg bg-emerald-mc text-[#06180D] flex items-center justify-center shadow-sm">
          <Blocks className="w-5 h-5" />
        </div>
        <div>
          <span className="font-bold text-base tracking-tight text-text-primary block leading-none">
            CraftDock
          </span>
          <span className="text-[11px] text-text-muted font-mono">Windows Local Host</span>
        </div>
      </div>

      {/* Primary CTA */}
      <div className="px-4 pt-4">
        <Button className="w-full" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" />
          Nuevo Servidor
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = nav === item.id && (item.id !== "servers" || !selectedServer);
          return (
            <button
              key={item.id}
              onClick={() => {
                setNav(item.id);
                setSelectedServerId(null);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active || (nav === item.id && item.id === "servers" && selectedServer)
                  ? "bg-emerald-500/12 text-emerald-300 border border-emerald-500/25"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface border border-transparent"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="w-4 h-4" />
                {item.label}
              </span>
              {item.badge && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-elevated text-text-secondary">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom System Pill */}
      <div className="p-4 border-t border-border-subtle text-xs text-text-secondary space-y-1.5">
        <div className="flex justify-between font-mono">
          <span>RAM del equipo</span>
          <span className="text-text-primary">
            {system ? `${(system.totalRamMb / 1024).toFixed(0)} GB` : "..."}
          </span>
        </div>
        <div className="flex justify-between font-mono">
          <span>Java instalados</span>
          <span className="text-emerald-400">
            {system?.installedJavaVersions.length
              ? system.installedJavaVersions.join(", ")
              : "Auto"}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-canvas text-text-primary">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col bg-sidebar border-r border-border-subtle shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile Header + Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-64 bg-sidebar border-r border-border-strong h-full">
            {SidebarContent}
          </div>
          <div
            className="flex-1 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-sidebar border-b border-border-subtle">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded-lg text-text-secondary hover:bg-surface"
              aria-label="Menú"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="font-bold text-sm">CraftDock</span>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Crear
          </Button>
        </header>

        <main className="flex-1 p-5 sm:p-8 max-w-6xl w-full mx-auto">
          {nav === "servers" && selectedServer ? (
            <ServerDetailView
              server={selectedServer}
              consoleLines={consoleByServer[selectedServer.id] || []}
              system={system}
              jars={jars}
              onBack={() => setSelectedServerId(null)}
              onServerUpdated={(updated) =>
                setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
              }
              onServerDeleted={(deletedId) => {
                setServers((prev) => prev.filter((s) => s.id !== deletedId));
                setSelectedServerId(null);
              }}
              onCopyInvite={handleCopyInvite}
              onToast={addToast}
            />
          ) : nav === "servers" ? (
            <ServersDashboard
              servers={servers}
              system={system}
              tunnel={tunnel}
              onSelectServer={(id) => void openServerDetail(id)}
              onOpenCreate={() => setCreateOpen(true)}
              onStart={async (id) => {
                try {
                  const res = await api.startServer(id);
                  setServers((prev) => prev.map((s) => (s.id === id ? res.server : s)));
                  subscribeConsole(id);
                } catch (err: any) {
                  addToast("error", err.message);
                }
              }}
              onStop={async (id) => {
                try {
                  const res = await api.stopServer(id);
                  if (res.server) {
                    setServers((prev) => prev.map((s) => (s.id === id ? res.server : s)));
                  }
                } catch (err: any) {
                  addToast("error", err.message);
                }
              }}
              onCopyInvite={handleCopyInvite}
              onGoTunnel={() => setNav("tunnel")}
            />
          ) : nav === "jars" ? (
            <JarLibraryView
              jars={jars}
              onRefreshJars={async () => {
                const res = await api.listJars();
                setJars(res.jars);
              }}
              onToast={addToast}
            />
          ) : nav === "tunnel" ? (
            <TunnelView
              tunnel={tunnel}
              servers={servers}
              onRefresh={refreshAll}
              onToast={addToast}
            />
          ) : (
            <SystemSettingsView
              system={system}
              settings={settings}
              onRefresh={refreshAll}
              onToast={addToast}
            />
          )}
        </main>
      </div>

      <CreateServerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        system={system}
        jars={jars}
        onCreated={async (newId) => {
          await refreshAll();
          await openServerDetail(newId);
        }}
        onToast={addToast}
      />

      <ProgressOverlay tasks={tasks} />
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
export default App;
