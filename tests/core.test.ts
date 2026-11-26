import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CraftDockDB } from "../server/db/database";
import {
  createServerBackup,
  enforceBackupRetention,
  restoreServerBackup,
} from "../server/services/backupService";
import { analyzeCrashLogs } from "../server/services/crashAnalyzer";
import {
  createServerEntry,
  deleteServerEntry,
  listServerFiles,
  readServerTextFile,
  renameServerEntry,
  writeServerTextFile,
} from "../server/services/fileManagerService";
import {
  deleteDatapack,
  listDatapacks,
  toggleDatapack,
  uploadDatapackZip,
} from "../server/services/datapackService";
import { saveCustomJarToLibrary } from "../server/services/jarLibraryService";
import {
  detectModpackEngine,
  exportModsPackForFriends,
  uploadModJar,
} from "../server/services/modrinthService";
import {
  buildDefaultProperties,
  parsePropertiesText,
  serializePropertiesPreservingComments,
} from "../server/services/propertiesService";
import { parseBedrockVersionIndex } from "../server/services/providers/bedrockProvider";
import { parseForgePromotions } from "../server/services/providers/forgeProvider";
import {
  neoforgeToMcVersion,
  parseNeoforgeVersions,
} from "../server/services/providers/neoforgeProvider";
import {
  parsePaperBuildsResponse,
  parsePaperProjectVersions,
} from "../server/services/providers/paperProvider";
import { evaluateRamZone, getRequiredJavaMajor } from "../server/services/systemInfo";
import { resolveSafeChildPath } from "../server/utils/paths";
import { createZipArchive, readZipEntryText } from "../server/utils/zip";

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "craftdock-test-"));

afterAll(() => {
  try {
    fs.rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows SQLite WAL handle may linger briefly until process exit
  }
});

describe("Sistema: Matriz de Java y Semáforo de RAM", () => {
  test("selecciona Java 8, 17, 21 y 25 correctamente según versión de Minecraft", () => {
    expect(getRequiredJavaMajor("1.8.9")).toBe(8);
    expect(getRequiredJavaMajor("1.16.5")).toBe(8);
    expect(getRequiredJavaMajor("1.17.1")).toBe(17);
    expect(getRequiredJavaMajor("1.20.4")).toBe(17);
    expect(getRequiredJavaMajor("1.20.5")).toBe(21);
    expect(getRequiredJavaMajor("1.21.4")).toBe(21);
    expect(getRequiredJavaMajor("26.1")).toBe(25);
    expect(getRequiredJavaMajor("26.3.1")).toBe(25);
  });

  test("evalúa correctamente las zonas verde, amarilla y roja de RAM", () => {
    expect(evaluateRamZone(4096, 16384).zone).toBe("green");
    expect(evaluateRamZone(10240, 16384).zone).toBe("yellow");
    expect(evaluateRamZone(14336, 16384).zone).toBe("red");
  });
});

describe("Seguridad: Gestor de Archivos y Path Traversal", () => {
  const srvRoot = path.join(sandboxRoot, "srv-files");
  fs.mkdirSync(srvRoot, { recursive: true });

  test("bloquea intentos de salir de la carpeta del servidor", () => {
    expect(() => resolveSafeChildPath(srvRoot, "../secreto.txt")).toThrow();
    expect(() => resolveSafeChildPath(srvRoot, "..\\..\\Windows\\win.ini")).toThrow();
    expect(() => resolveSafeChildPath(srvRoot, "C:\\Windows\\win.ini")).toThrow();
  });

  test("permite crear, leer, editar, renombrar y eliminar dentro del servidor", () => {
    const folderRel = createServerEntry(srvRoot, "", "config", "folder");
    expect(folderRel).toBe("config");

    const fileRel = createServerEntry(srvRoot, "config", "ajustes.yml", "file");
    writeServerTextFile(srvRoot, fileRel, "pvp: true\n");

    const read = readServerTextFile(srvRoot, fileRel);
    expect(read.content).toBe("pvp: true\n");

    const renamed = renameServerEntry(srvRoot, fileRel, "custom.yml");
    expect(renamed).toBe("config/custom.yml");

    const listed = listServerFiles(srvRoot, "config");
    expect(listed.map((e) => e.name)).toContain("custom.yml");
    expect(listed[0].editable).toBe(true);

    deleteServerEntry(srvRoot, "config/custom.yml");
    expect(listServerFiles(srvRoot, "config").length).toBe(0);
  });
});

describe("Properties: Parser y Serializador sin pérdida de comentarios", () => {
  test("preserva comentarios al actualizar online-mode y server-port", () => {
    const initial = buildDefaultProperties("paper", {
      name: "Test",
      port: 25565,
      onlineMode: true,
    });
    const updated = serializePropertiesPreservingComments(initial, {
      "online-mode": "false",
      "server-port": "25570",
      "new-custom-key": "123",
    });

    expect(updated).toContain("# Configuración de Minecraft Java Server");
    const parsed = parsePropertiesText(updated);
    expect(parsed["online-mode"]).toBe("false");
    expect(parsed["server-port"]).toBe("25570");
    expect(parsed["new-custom-key"]).toBe("123");
  });
});

describe("Detector inteligente de Crashes (crashAnalyzer)", () => {
  test("detecta puerto ocupado con acción rápida automática", () => {
    const diag = analyzeCrashLogs([
      "[10:00:00 WARN]: **** FAILED TO BIND TO PORT!",
      "[10:00:00 WARN]: The exception was: java.net.BindException: Address already in use",
    ]);
    expect(diag?.code).toBe("PORT_IN_USE");
    expect(diag?.quickAction?.type).toBe("assign_free_port");
  });

  test("detecta versión de Java incorrecta (class 69 -> Java 25, class 65 -> Java 21)", () => {
    const diag25 = analyzeCrashLogs([
      "java.lang.UnsupportedClassVersionError: net/minecraft/Main has been compiled by a more recent version of the Java Runtime (class file version 69.0)",
    ]);
    expect(diag25?.code).toBe("WRONG_JAVA_VERSION");
    expect(diag25?.quickAction?.payload?.javaMajor).toBe(25);

    const diag21 = analyzeCrashLogs([
      "UnsupportedClassVersionError: class file version 65.0",
    ]);
    expect(diag21?.quickAction?.payload?.javaMajor).toBe(21);
  });

  test("detecta EULA, OutOfMemoryError y mod faltante en Fabric", () => {
    expect(
      analyzeCrashLogs(["You need to agree to the EULA in order to run the server."])?.code
    ).toBe("EULA_REQUIRED");
    expect(analyzeCrashLogs(["java.lang.OutOfMemoryError: Java heap space"])?.code).toBe(
      "OUT_OF_MEMORY"
    );

    const modDiag = analyzeCrashLogs([
      "Incompatible mods found! Install fabric-api, version 0.100.0 or later",
    ]);
    expect(modDiag?.code).toBe("MISSING_MOD_DEPENDENCY");
    expect(modDiag?.quickAction?.type).toBe("search_modrinth");
    expect(modDiag?.quickAction?.payload?.query).toBe("fabric-api");
  });
});

describe("Proveedores oficiales: parseo de contratos API", () => {
  test("parsea PaperMC Fill v3 versions & builds", () => {
    const versions = parsePaperProjectVersions({
      versions: { "1.21": ["1.21.4", "1.21.1"], "1.20": ["1.20.4"] },
    });
    expect(versions).toEqual(["1.21.4", "1.21.1", "1.20.4"]);

    const builds = parsePaperBuildsResponse([
      {
        id: 100,
        downloads: {
          "server:default": {
            name: "paper-1.21.4-100.jar",
            url: "https://fill-data.papermc.io/paper-100.jar",
            checksums: { sha256: "abc" },
          },
        },
      },
      {
        id: 120,
        downloads: {
          "server:default": {
            name: "paper-1.21.4-120.jar",
            url: "https://fill-data.papermc.io/paper-120.jar",
            checksums: { sha256: "def" },
          },
        },
      },
    ]);
    expect(builds[0].build).toBe("120");
    expect(builds[0].url).toContain("paper-120.jar");
  });

  test("parsea Forge promotions_slim.json y Bedrock index", () => {
    const forge = parseForgePromotions({
      "1.20.1-recommended": "47.3.0",
      "1.20.1-latest": "47.3.12",
      "1.21.4-latest": "54.0.2",
    });
    expect(forge[0].mcVersion).toBe("1.21.4");
    expect(forge[1].builds).toEqual(["47.3.0", "47.3.12"]);

    const bedrock = parseBedrockVersionIndex({
      release: {
        "1.21.50.10": { windows: { url: "https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.21.50.10.zip" } },
        "1.21.60.10": { windows: { url: "https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.21.60.10.zip" } },
      },
    });
    expect(bedrock[0].mcVersion).toBe("1.21.60.10");
  });
});

describe("Integración: Biblioteca JAR, Backups con retención y Pack de Mods para amigos", () => {
  test("valida cabecera ZIP de JAR custom, crea/restaura backups y exporta pack de mods", async () => {
    const dataDir = path.join(sandboxRoot, "appdata");
    const db = new CraftDockDB(dataDir);

    // Reject fake jar
    await expect(
      saveCustomJarToLibrary(db, {
        fileName: "falso.jar",
        bytes: new TextEncoder().encode("esto no es un jar"),
      })
    ).rejects.toThrow();

    // Create a valid tiny zip to act as custom JAR
    const validJarPath = path.join(sandboxRoot, "purpur-test.jar");
    await createZipArchive(validJarPath, [], [{ name: "META-INF/MANIFEST.MF", content: "Manifest-Version: 1.0\n" }]);
    const jarBytes = new Uint8Array(fs.readFileSync(validJarPath));

    const savedJar = await saveCustomJarToLibrary(db, {
      fileName: "purpur-1.21.4.jar",
      bytes: jarBytes,
      displayName: "Purpur Test",
      mcVersion: "1.21.4",
    });
    expect(savedJar.engine).toBe("custom");
    expect(db.listJars().length).toBe(1);

    // Register a mock server with a world + mods
    const serverId = "srv-integ-1";
    const srvDir = path.join(db.paths.serversDir, serverId);
    fs.mkdirSync(path.join(srvDir, "world"), { recursive: true });
    fs.writeFileSync(path.join(srvDir, "world", "level.dat"), "ORIGINAL_WORLD_DATA");
    fs.writeFileSync(path.join(srvDir, "server.properties"), "level-name=world\nserver-port=25565\n");

    const now = new Date().toISOString();
    const srvRecord = {
      id: serverId,
      name: "Amigos Fabric",
      engine: "fabric" as const,
      mcVersion: "1.21.4",
      jarId: savedJar.id,
      crossplayEnabled: false,
      port: 25565,
      bedrockPort: null,
      ramMinMb: 1024,
      ramMaxMb: 2048,
      javaMajor: 21,
      autoShutdownMinutes: 0,
      autoBackupIntervalMinutes: 0,
      backupRetentionCount: 2,
      eulaAccepted: true,
      tunnelAddress: "amigos.gl.joinmc.link",
      tunnelBedrockAddress: "",
      createdAt: now,
      updatedAt: now,
    };
    db.insertServer(srvRecord);

    // Create backup, mutate world, restore backup
    const b1 = await createServerBackup(db, srvRecord, { label: "Snap 1", kind: "manual" });
    fs.writeFileSync(path.join(srvDir, "world", "level.dat"), "CORRUPTED_WORLD");
    await restoreServerBackup(db, srvRecord, b1.id);
    expect(fs.readFileSync(path.join(srvDir, "world", "level.dat"), "utf-8")).toBe(
      "ORIGINAL_WORLD_DATA"
    );

    // Test retention trims auto backups beyond limit (2)
    await createServerBackup(db, srvRecord, { label: "Auto 1", kind: "scheduled" });
    await createServerBackup(db, srvRecord, { label: "Auto 2", kind: "scheduled" });
    await createServerBackup(db, srvRecord, { label: "Auto 3", kind: "scheduled" });
    enforceBackupRetention(db, srvRecord);
    const autoCount = db
      .listBackups(serverId)
      .filter((b) => b.kind === "scheduled" || b.kind === "pre-change").length;
    expect(autoCount).toBeLessThanOrEqual(2);

    // Upload mod + export zip for friends
    uploadModJar(srvDir, "mods", "sodium-fabric.jar", jarBytes);
    const pack = await exportModsPackForFriends(srvDir, db.paths.tmpDir, srvRecord);
    expect(pack.count).toBe(1);
    const readmeText = await readZipEntryText(pack.zipPath, "LEEME_AMIGOS.txt");
    expect(readmeText).toContain("FABRIC");
    expect(readmeText).toContain("amigos.gl.joinmc.link");

    db.close();
  });
});

describe("NeoForge, Modpacks directos y Datapacks", () => {
  test("mapea versiones de NeoForge a Minecraft 1.20/1.21 y 26.x+ correctamente", () => {
    expect(neoforgeToMcVersion("20.4.237")).toBe("1.20.4");
    expect(neoforgeToMcVersion("21.0.167")).toBe("1.21");
    expect(neoforgeToMcVersion("21.1.265")).toBe("1.21.1");
    expect(neoforgeToMcVersion("26.3.0.100")).toBe("26.3");

    const parsed = parseNeoforgeVersions([
      "21.1.10-beta",
      "21.1.265",
      "20.4.237",
      "26.1.0.50",
    ]);
    expect(parsed[0].mcVersion).toBe("26.1");
    expect(parsed[0].javaMajor).toBe(25);
    expect(parsed[1].mcVersion).toBe("1.21.1");
    expect(parsed[1].builds?.[0]).toBe("21.1.265");
  });

  test("detecta el motor de modpacks de Modrinth (Fabric, Forge, NeoForge)", () => {
    expect(detectModpackEngine(["fabric"])).toBe("fabric");
    expect(detectModpackEngine(["forge"])).toBe("forge");
    expect(detectModpackEngine(["neoforge"])).toBe("neoforge");
    expect(detectModpackEngine(["quilt"])).toBeNull();
  });

  test("gestiona datapacks (.zip, toggle, borrado) y rechaza archivos falsos o Bedrock", async () => {
    const srvDir = path.join(sandboxRoot, "srv-datapacks");
    fs.mkdirSync(srvDir, { recursive: true });
    fs.writeFileSync(path.join(srvDir, "server.properties"), "level-name=mi_mundo\n");

    const now = new Date().toISOString();
    const javaServer = {
      id: "dp-java-1",
      name: "Vanilla DP",
      engine: "vanilla" as const,
      mcVersion: "1.21.4",
      jarId: null,
      crossplayEnabled: false,
      port: 25565,
      bedrockPort: null,
      ramMinMb: 1024,
      ramMaxMb: 2048,
      javaMajor: 21,
      autoShutdownMinutes: 0,
      autoBackupIntervalMinutes: 0,
      backupRetentionCount: 5,
      eulaAccepted: true,
      tunnelAddress: "",
      tunnelBedrockAddress: "",
      createdAt: now,
      updatedAt: now,
    };

    // Auto-creates mi_mundo/datapacks even before first launch
    const initial = listDatapacks(srvDir, javaServer);
    expect(initial.worldName).toBe("mi_mundo");
    expect(initial.datapacks.length).toBe(0);

    // Rejects invalid non-zip bytes
    expect(() =>
      uploadDatapackZip(srvDir, javaServer, "falso.zip", new TextEncoder().encode("hola"))
    ).toThrow();

    // Accepts valid zip datapack
    const validZipPath = path.join(sandboxRoot, "terralith-test.zip");
    await createZipArchive(validZipPath, [], [
      { name: "pack.mcmeta", content: JSON.stringify({ pack: { pack_format: 61, description: "Test" } }) },
    ]);
    const zipBytes = new Uint8Array(fs.readFileSync(validZipPath));

    const uploaded = uploadDatapackZip(srvDir, javaServer, "terralith.zip", zipBytes);
    expect(uploaded.enabled).toBe(true);
    expect(uploaded.worldName).toBe("mi_mundo");

    const disabled = toggleDatapack(srvDir, javaServer, "terralith.zip");
    expect(disabled.enabled).toBe(false);
    expect(disabled.fileName).toBe("terralith.zip.disabled");

    const reEnabled = toggleDatapack(srvDir, javaServer, "terralith.zip.disabled");
    expect(reEnabled.enabled).toBe(true);
    expect(reEnabled.fileName).toBe("terralith.zip");

    deleteDatapack(srvDir, javaServer, "terralith.zip");
    expect(listDatapacks(srvDir, javaServer).datapacks.length).toBe(0);

    // Rejects Bedrock server
    expect(() => listDatapacks(srvDir, { ...javaServer, engine: "bedrock" })).toThrow();
  });
});
