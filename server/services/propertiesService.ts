import fs from "node:fs";
import path from "node:path";
import type { ServerEngine, ServerPropertiesForm } from "../../shared/types";

export function parsePropertiesText(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    const eqIdx = rawLine.indexOf("=");
    if (eqIdx === -1) continue;
    const key = rawLine.slice(0, eqIdx).trim();
    const val = rawLine.slice(eqIdx + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

/**
 * Updates key=value pairs in an existing server.properties file while preserving comments and key order.
 */
export function serializePropertiesPreservingComments(
  existingText: string,
  updates: Record<string, string>
): string {
  const lines = existingText ? existingText.split(/\r?\n/) : ["#Minecraft server properties"];
  const remaining = new Map<string, string>(Object.entries(updates));

  const updatedLines = lines.map((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      return rawLine;
    }
    const eqIdx = rawLine.indexOf("=");
    if (eqIdx === -1) return rawLine;
    const key = rawLine.slice(0, eqIdx).trim();
    if (remaining.has(key)) {
      const nextVal = remaining.get(key)!;
      remaining.delete(key);
      return `${key}=${nextVal}`;
    }
    return rawLine;
  });

  for (const [key, val] of remaining.entries()) {
    updatedLines.push(`${key}=${val}`);
  }

  return updatedLines.join("\n").replace(/\n*$/, "\n");
}

export function buildDefaultProperties(
  engine: ServerEngine,
  options: {
    name: string;
    port: number;
    onlineMode: boolean;
    gamemode?: string;
    difficulty?: string;
    maxPlayers?: number;
  }
): string {
  if (engine === "bedrock") {
    return [
      "# Configuración de Minecraft Bedrock Server generada por CraftDock",
      `server-name=${options.name}`,
      `gamemode=${options.gamemode || "survival"}`,
      `difficulty=${options.difficulty || "normal"}`,
      `allow-cheats=false`,
      `max-players=${options.maxPlayers || 10}`,
      `online-mode=${options.onlineMode ? "true" : "false"}`,
      `allow-list=false`,
      `server-port=${options.port}`,
      `server-portv6=${options.port + 1}`,
      `view-distance=16`,
      `tick-distance=4`,
      `level-name=Bedrock level`,
      `level-seed=`,
      `default-player-permission-level=member`,
      "",
    ].join("\n");
  }

  return [
    "# Configuración de Minecraft Java Server generada por CraftDock",
    `motd=${options.name} - Creado con CraftDock`,
    `server-port=${options.port}`,
    `gamemode=${options.gamemode || "survival"}`,
    `difficulty=${options.difficulty || "normal"}`,
    `max-players=${options.maxPlayers || 20}`,
    `online-mode=${options.onlineMode ? "true" : "false"}`,
    `pvp=true`,
    `allow-flight=false`,
    `white-list=false`,
    `enforce-whitelist=false`,
    `enable-command-block=true`,
    `level-name=world`,
    `level-seed=`,
    `view-distance=10`,
    `simulation-distance=8`,
    "",
  ].join("\n");
}

export function readServerProperties(
  serverDir: string,
  engine: ServerEngine,
  fallbackPort: number,
  fallbackName: string
): ServerPropertiesForm {
  const filePath = path.join(serverDir, "server.properties");
  const raw = fs.existsSync(filePath)
    ? parsePropertiesText(fs.readFileSync(filePath, "utf-8"))
    : {};

  if (engine === "bedrock") {
    return {
      motd: raw["server-name"] || fallbackName,
      gamemode: raw["gamemode"] || "survival",
      difficulty: raw["difficulty"] || "normal",
      maxPlayers: Number(raw["max-players"] || 10),
      onlineMode: raw["online-mode"] !== "false",
      pvp: true,
      allowFlight: false,
      allowCheats: raw["allow-cheats"] === "true",
      whiteList: raw["allow-list"] === "true",
      levelSeed: raw["level-seed"] || "",
      levelName: raw["level-name"] || "Bedrock level",
      viewDistance: Number(raw["view-distance"] || 16),
      simulationDistance: Number(raw["tick-distance"] || 4),
      serverPort: Number(raw["server-port"] || fallbackPort),
      raw,
    };
  }

  return {
    motd: raw["motd"] || fallbackName,
    gamemode: raw["gamemode"] || "survival",
    difficulty: raw["difficulty"] || "normal",
    maxPlayers: Number(raw["max-players"] || 20),
    onlineMode: raw["online-mode"] !== "false",
    pvp: raw["pvp"] !== "false",
    allowFlight: raw["allow-flight"] === "true",
    allowCheats: raw["enable-command-block"] !== "false",
    whiteList: raw["white-list"] === "true",
    levelSeed: raw["level-seed"] || "",
    levelName: raw["level-name"] || "world",
    viewDistance: Number(raw["view-distance"] || 10),
    simulationDistance: Number(raw["simulation-distance"] || 8),
    serverPort: Number(raw["server-port"] || fallbackPort),
    raw,
  };
}

export function writeServerProperties(
  serverDir: string,
  engine: ServerEngine,
  form: Partial<ServerPropertiesForm>
): ServerPropertiesForm {
  const filePath = path.join(serverDir, "server.properties");
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";

  const updates: Record<string, string> = {};
  if (engine === "bedrock") {
    if (form.motd !== undefined) updates["server-name"] = form.motd;
    if (form.gamemode !== undefined) updates["gamemode"] = form.gamemode;
    if (form.difficulty !== undefined) updates["difficulty"] = form.difficulty;
    if (form.maxPlayers !== undefined) updates["max-players"] = String(form.maxPlayers);
    if (form.onlineMode !== undefined) updates["online-mode"] = String(form.onlineMode);
    if (form.allowCheats !== undefined) updates["allow-cheats"] = String(form.allowCheats);
    if (form.whiteList !== undefined) updates["allow-list"] = String(form.whiteList);
    if (form.levelSeed !== undefined) updates["level-seed"] = form.levelSeed;
    if (form.levelName !== undefined) updates["level-name"] = form.levelName;
    if (form.viewDistance !== undefined) updates["view-distance"] = String(form.viewDistance);
    if (form.simulationDistance !== undefined) updates["tick-distance"] = String(form.simulationDistance);
    if (form.serverPort !== undefined) {
      updates["server-port"] = String(form.serverPort);
      updates["server-portv6"] = String(form.serverPort + 1);
    }
  } else {
    if (form.motd !== undefined) updates["motd"] = form.motd;
    if (form.gamemode !== undefined) updates["gamemode"] = form.gamemode;
    if (form.difficulty !== undefined) updates["difficulty"] = form.difficulty;
    if (form.maxPlayers !== undefined) updates["max-players"] = String(form.maxPlayers);
    if (form.onlineMode !== undefined) updates["online-mode"] = String(form.onlineMode);
    if (form.pvp !== undefined) updates["pvp"] = String(form.pvp);
    if (form.allowFlight !== undefined) updates["allow-flight"] = String(form.allowFlight);
    if (form.allowCheats !== undefined) updates["enable-command-block"] = String(form.allowCheats);
    if (form.whiteList !== undefined) {
      updates["white-list"] = String(form.whiteList);
      updates["enforce-whitelist"] = String(form.whiteList);
    }
    if (form.levelSeed !== undefined) updates["level-seed"] = form.levelSeed;
    if (form.levelName !== undefined) updates["level-name"] = form.levelName;
    if (form.viewDistance !== undefined) updates["view-distance"] = String(form.viewDistance);
    if (form.simulationDistance !== undefined) {
      updates["simulation-distance"] = String(form.simulationDistance);
    }
    if (form.serverPort !== undefined) updates["server-port"] = String(form.serverPort);
  }

  const nextText = serializePropertiesPreservingComments(existing, updates);
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(filePath, nextText, "utf-8");

  return readServerProperties(serverDir, engine, form.serverPort || 25565, form.motd || "Servidor");
}

export function isPngMagicBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export function saveServerIcon(serverDir: string, pngBytes: Uint8Array): void {
  if (!isPngMagicBytes(pngBytes)) {
    throw new Error("El ícono del servidor debe ser una imagen PNG válida de 64x64.");
  }
  if (pngBytes.byteLength > 2 * 1024 * 1024) {
    throw new Error("La imagen del ícono es demasiado grande (máximo 2 MB).");
  }
  fs.writeFileSync(path.join(serverDir, "server-icon.png"), pngBytes);
}
