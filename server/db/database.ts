import { Database } from "bun:sqlite";
import type {
  BackupRecord,
  JarLibraryItem,
  ServerEngine,
  ServerRecord,
} from "../../shared/types";
import { ensureDataDirectories, resolveDataPaths, type DataPaths } from "../utils/paths";

export class CraftDockDB {
  public readonly db: Database;
  public readonly paths: DataPaths;

  constructor(dataDir?: string) {
    this.paths = resolveDataPaths(dataDir);
    ensureDataDirectories(this.paths);
    this.db = new Database(this.paths.dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jar_library (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        engine TEXT NOT NULL,
        mc_version TEXT NOT NULL,
        build TEXT NOT NULL,
        file_name TEXT NOT NULL,
        local_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        source TEXT NOT NULL DEFAULT 'official',
        java_major INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        engine TEXT NOT NULL,
        mc_version TEXT NOT NULL,
        jar_id TEXT,
        crossplay_enabled INTEGER NOT NULL DEFAULT 0,
        port INTEGER NOT NULL,
        bedrock_port INTEGER,
        ram_min_mb INTEGER NOT NULL DEFAULT 1024,
        ram_max_mb INTEGER NOT NULL DEFAULT 2048,
        java_major INTEGER NOT NULL DEFAULT 21,
        auto_shutdown_minutes INTEGER NOT NULL DEFAULT 0,
        auto_backup_interval_minutes INTEGER NOT NULL DEFAULT 0,
        backup_retention_count INTEGER NOT NULL DEFAULT 5,
        eula_accepted INTEGER NOT NULL DEFAULT 0,
        tunnel_address TEXT NOT NULL DEFAULT '',
        tunnel_bedrock_address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (jar_id) REFERENCES jar_library(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'manual',
        file_name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
    `);

    const defaults: Record<string, string> = {
      dataDir: this.paths.root,
      autoOpenBrowser: "true",
      defaultBackupRetention: "5",
      port: "3847",
    };

    const insertSetting = this.db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
    );
    for (const [k, v] of Object.entries(defaults)) {
      insertSetting.run(k, v);
    }
  }

  getSetting(key: string): string | null {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(key);
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // ---- JAR Library ----

  listJars(): JarLibraryItem[] {
    const rows = this.db
      .query<any, []>("SELECT * FROM jar_library ORDER BY created_at DESC")
      .all();
    return rows.map(this.mapJarRow);
  }

  getJar(id: string): JarLibraryItem | null {
    const row = this.db
      .query<any, [string]>("SELECT * FROM jar_library WHERE id = ?")
      .get(id);
    return row ? this.mapJarRow(row) : null;
  }

  findJarBySpec(engine: ServerEngine, mcVersion: string, build: string): JarLibraryItem | null {
    const row = this.db
      .query<any, [string, string, string]>(
        "SELECT * FROM jar_library WHERE engine = ? AND mc_version = ? AND build = ? LIMIT 1"
      )
      .get(engine, mcVersion, build);
    return row ? this.mapJarRow(row) : null;
  }

  upsertJar(item: JarLibraryItem): void {
    this.db
      .prepare(
        `INSERT INTO jar_library
          (id, name, engine, mc_version, build, file_name, local_path, size_bytes, sha256, source, java_major, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          size_bytes = excluded.size_bytes,
          sha256 = excluded.sha256,
          local_path = excluded.local_path,
          java_major = excluded.java_major`
      )
      .run(
        item.id,
        item.name,
        item.engine,
        item.mcVersion,
        item.build,
        item.fileName,
        item.localPath,
        item.sizeBytes,
        item.sha256,
        item.source,
        item.javaMajor,
        item.createdAt
      );
  }

  deleteJar(id: string): void {
    this.db.prepare("DELETE FROM jar_library WHERE id = ?").run(id);
  }

  countServersUsingJar(jarId: string): number {
    const row = this.db
      .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM servers WHERE jar_id = ?")
      .get(jarId);
    return row?.count ?? 0;
  }

  private mapJarRow(row: any): JarLibraryItem {
    return {
      id: row.id,
      name: row.name,
      engine: row.engine as ServerEngine,
      mcVersion: row.mc_version,
      build: row.build,
      fileName: row.file_name,
      localPath: row.local_path,
      sizeBytes: row.size_bytes,
      sha256: row.sha256 ?? null,
      source: row.source === "custom" ? "custom" : "official",
      javaMajor: row.java_major ?? null,
      createdAt: row.created_at,
    };
  }

  // ---- Servers ----

  listServers(): ServerRecord[] {
    const rows = this.db
      .query<any, []>("SELECT * FROM servers ORDER BY created_at DESC")
      .all();
    return rows.map(this.mapServerRow);
  }

  getServer(id: string): ServerRecord | null {
    const row = this.db
      .query<any, [string]>("SELECT * FROM servers WHERE id = ?")
      .get(id);
    return row ? this.mapServerRow(row) : null;
  }

  insertServer(server: ServerRecord): void {
    this.db
      .prepare(
        `INSERT INTO servers (
          id, name, engine, mc_version, jar_id, crossplay_enabled, port, bedrock_port,
          ram_min_mb, ram_max_mb, java_major, auto_shutdown_minutes,
          auto_backup_interval_minutes, backup_retention_count, eula_accepted,
          tunnel_address, tunnel_bedrock_address, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        server.id,
        server.name,
        server.engine,
        server.mcVersion,
        server.jarId,
        server.crossplayEnabled ? 1 : 0,
        server.port,
        server.bedrockPort,
        server.ramMinMb,
        server.ramMaxMb,
        server.javaMajor,
        server.autoShutdownMinutes,
        server.autoBackupIntervalMinutes,
        server.backupRetentionCount,
        server.eulaAccepted ? 1 : 0,
        server.tunnelAddress,
        server.tunnelBedrockAddress,
        server.createdAt,
        server.updatedAt
      );
  }

  updateServer(id: string, patch: Partial<ServerRecord>): ServerRecord | null {
    const existing = this.getServer(id);
    if (!existing) return null;
    const updated: ServerRecord = {
      ...existing,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE servers SET
          name = ?, engine = ?, mc_version = ?, jar_id = ?, crossplay_enabled = ?,
          port = ?, bedrock_port = ?, ram_min_mb = ?, ram_max_mb = ?, java_major = ?,
          auto_shutdown_minutes = ?, auto_backup_interval_minutes = ?, backup_retention_count = ?,
          eula_accepted = ?, tunnel_address = ?, tunnel_bedrock_address = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        updated.name,
        updated.engine,
        updated.mcVersion,
        updated.jarId,
        updated.crossplayEnabled ? 1 : 0,
        updated.port,
        updated.bedrockPort,
        updated.ramMinMb,
        updated.ramMaxMb,
        updated.javaMajor,
        updated.autoShutdownMinutes,
        updated.autoBackupIntervalMinutes,
        updated.backupRetentionCount,
        updated.eulaAccepted ? 1 : 0,
        updated.tunnelAddress,
        updated.tunnelBedrockAddress,
        updated.updatedAt,
        id
      );

    return updated;
  }

  deleteServer(id: string): void {
    this.db.prepare("DELETE FROM servers WHERE id = ?").run(id);
  }

  private mapServerRow(row: any): ServerRecord {
    return {
      id: row.id,
      name: row.name,
      engine: row.engine as ServerEngine,
      mcVersion: row.mc_version,
      jarId: row.jar_id ?? null,
      crossplayEnabled: Boolean(row.crossplay_enabled),
      port: row.port,
      bedrockPort: row.bedrock_port ?? null,
      ramMinMb: row.ram_min_mb,
      ramMaxMb: row.ram_max_mb,
      javaMajor: row.java_major,
      autoShutdownMinutes: row.auto_shutdown_minutes,
      autoBackupIntervalMinutes: row.auto_backup_interval_minutes,
      backupRetentionCount: row.backup_retention_count,
      eulaAccepted: Boolean(row.eula_accepted),
      tunnelAddress: row.tunnel_address ?? "",
      tunnelBedrockAddress: row.tunnel_bedrock_address ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ---- Backups ----

  listBackups(serverId: string): BackupRecord[] {
    const rows = this.db
      .query<any, [string]>(
        "SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC"
      )
      .all(serverId);
    return rows.map(this.mapBackupRow);
  }

  getBackup(id: string): BackupRecord | null {
    const row = this.db
      .query<any, [string]>("SELECT * FROM backups WHERE id = ?")
      .get(id);
    return row ? this.mapBackupRow(row) : null;
  }

  insertBackup(record: BackupRecord): void {
    this.db
      .prepare(
        `INSERT INTO backups (id, server_id, label, kind, file_name, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.serverId,
        record.label,
        record.kind,
        record.fileName,
        record.sizeBytes,
        record.createdAt
      );
  }

  deleteBackup(id: string): void {
    this.db.prepare("DELETE FROM backups WHERE id = ?").run(id);
  }

  private mapBackupRow(row: any): BackupRecord {
    return {
      id: row.id,
      serverId: row.server_id,
      label: row.label,
      kind: row.kind as BackupRecord["kind"],
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
