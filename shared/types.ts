export type ServerEngine =
  | "vanilla"
  | "paper"
  | "fabric"
  | "forge"
  | "neoforge"
  | "bedrock"
  | "custom";

export type ServerStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed";

export type RamZone = "green" | "yellow" | "red";

export interface SystemInfo {
  totalRamMb: number;
  freeRamMb: number;
  recommendedMaxRamMb: number;
  yellowMaxRamMb: number;
  cpuCount: number;
  cpuModel: string;
  lanIp: string;
  dataDir: string;
  installedJavaVersions: number[];
  platform: string;
}

export interface GlobalSettings {
  dataDir: string;
  autoOpenBrowser: boolean;
  defaultBackupRetention: number;
  playitInstalled: boolean;
  port: number;
}

export interface JarLibraryItem {
  id: string;
  name: string;
  engine: ServerEngine;
  mcVersion: string;
  build: string;
  fileName: string;
  localPath: string;
  sizeBytes: number;
  sha256: string | null;
  source: "official" | "custom";
  javaMajor: number | null;
  createdAt: string;
}

export interface RemoteVersionOption {
  mcVersion: string;
  releaseType: "release" | "snapshot" | "recommended" | "latest";
  builds?: string[];
  javaMajor?: number;
  downloadUrl?: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  engine: ServerEngine;
  mcVersion: string;
  jarId: string | null;
  crossplayEnabled: boolean;
  port: number;
  bedrockPort: number | null;
  ramMinMb: number;
  ramMaxMb: number;
  javaMajor: number;
  autoShutdownMinutes: number;
  autoBackupIntervalMinutes: number;
  backupRetentionCount: number;
  eulaAccepted: boolean;
  tunnelAddress: string;
  tunnelBedrockAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeMetrics {
  cpuPercent: number;
  memoryMb: number;
  uptimeSeconds: number;
  onlinePlayers: string[];
  idleMinutes: number;
}

export interface CrashQuickAction {
  type:
    | "assign_free_port"
    | "switch_java"
    | "increase_ram"
    | "search_modrinth"
    | "accept_eula"
    | "open_mods";
  label: string;
  payload?: Record<string, string | number>;
}

export interface CrashDiagnosis {
  code: string;
  title: string;
  explanation: string;
  severity: "warning" | "error";
  matchedLine?: string;
  quickAction?: CrashQuickAction;
}

export interface ServerView extends ServerRecord {
  status: ServerStatus;
  metrics: RuntimeMetrics;
  lastCrash: CrashDiagnosis | null;
  hasIcon: boolean;
  onlineMode: boolean;
  maxPlayers: number;
  difficulty: string;
  gamemode: string;
  motd: string;
  jarName: string | null;
}

export interface ServerPropertiesForm {
  motd: string;
  gamemode: string;
  difficulty: string;
  maxPlayers: number;
  onlineMode: boolean;
  pvp: boolean;
  allowFlight: boolean;
  allowCheats: boolean;
  whiteList: boolean;
  levelSeed: string;
  levelName: string;
  viewDistance: number;
  simulationDistance: number;
  serverPort: number;
  raw: Record<string, string>;
}

export interface PlayersState {
  online: string[];
  ops: Array<{ name: string; uuid?: string; xuid?: string; level?: number }>;
  whitelist: Array<{ name: string; uuid?: string; xuid?: string }>;
  banned: Array<{ name: string; reason?: string; created?: string }>;
}

export interface ModItem {
  fileName: string;
  enabled: boolean;
  sizeBytes: number;
  modifiedAt: string;
  folder: "mods" | "plugins";
  isSystemPlugin?: boolean;
}

export interface ModrinthSearchHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  author: string;
  projectType: "mod" | "plugin" | "modpack" | "datapack";
  categories: string[];
  versions?: string[];
  serverSide?: string;
}

export interface ModpackVersionOption {
  versionId: string;
  name: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  detectedEngine: "fabric" | "forge" | "neoforge" | null;
  mcVersion: string;
  mrpackUrl: string;
  mrpackSha1?: string;
  fileName: string;
  fileSize: number;
  datePublished: string;
}

export interface DatapackItem {
  fileName: string;
  enabled: boolean;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  worldName: string;
}

export interface BackupRecord {
  id: string;
  serverId: string;
  label: string;
  kind: "manual" | "pre-change" | "scheduled";
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  editable: boolean;
}

export interface TunnelStatus {
  installed: boolean;
  running: boolean;
  state: "not_installed" | "stopped" | "starting" | "unclaimed" | "connected" | "error";
  claimUrl: string | null;
  detectedAddresses: string[];
  recentLogs: string[];
  errorMessage: string | null;
}

export interface TaskProgress {
  taskId: string;
  scope: "runtime" | "jar" | "server" | "mod" | "backup" | "tunnel";
  title: string;
  detail: string;
  percent: number;
  status: "running" | "done" | "error";
}

export type WsEvent =
  | { type: "console_line"; serverId: string; line: string; timestamp: string }
  | { type: "console_snapshot"; serverId: string; lines: string[] }
  | {
      type: "server_status";
      serverId: string;
      status: ServerStatus;
      lastCrash: CrashDiagnosis | null;
    }
  | { type: "server_metrics"; serverId: string; metrics: RuntimeMetrics }
  | { type: "task_progress"; progress: TaskProgress }
  | { type: "tunnel_status"; tunnel: TunnelStatus };
