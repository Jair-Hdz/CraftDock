import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PlayersState, ServerEngine } from "../../shared/types";

function readJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath: string, data: unknown[]): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function offlinePlayerUuid(name: string): string {
  // Standard Minecraft OfflinePlayer UUID v3 format
  const md5 = crypto.createHash("md5").update(`OfflinePlayer:${name}`).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readPlayersState(
  serverDir: string,
  engine: ServerEngine,
  onlinePlayers: string[]
): PlayersState {
  if (engine === "bedrock") {
    const perms = readJsonArray<{ permission: string; xuid: string }>(
      path.join(serverDir, "permissions.json")
    );
    const allowlist = readJsonArray<{ name: string; xuid?: string }>(
      path.join(serverDir, "allowlist.json")
    );
    return {
      online: onlinePlayers,
      ops: perms
        .filter((p) => p.permission === "operator")
        .map((p) => ({ name: p.xuid, xuid: p.xuid })),
      whitelist: allowlist.map((a) => ({ name: a.name, xuid: a.xuid })),
      banned: [],
    };
  }

  const ops = readJsonArray<{ name: string; uuid: string; level?: number }>(
    path.join(serverDir, "ops.json")
  );
  const whitelist = readJsonArray<{ name: string; uuid: string }>(
    path.join(serverDir, "whitelist.json")
  );
  const banned = readJsonArray<{ name: string; reason?: string; created?: string }>(
    path.join(serverDir, "banned-players.json")
  );

  return {
    online: onlinePlayers,
    ops,
    whitelist,
    banned,
  };
}

export type PlayerAction =
  | "op"
  | "deop"
  | "kick"
  | "ban"
  | "pardon"
  | "whitelist_add"
  | "whitelist_remove";

export function performPlayerAction(
  serverDir: string,
  engine: ServerEngine,
  action: PlayerAction,
  playerName: string,
  reason: string | undefined,
  isRunning: boolean,
  sendCommand: (cmd: string) => void
): PlayersState {
  const cleanName = playerName.trim();
  if (!cleanName || /[\r\n]/.test(cleanName)) {
    throw new Error("Nombre de jugador inválido.");
  }

  if (isRunning) {
    if (engine === "bedrock") {
      switch (action) {
        case "op":
          sendCommand(`op "${cleanName}"`);
          break;
        case "deop":
          sendCommand(`deop "${cleanName}"`);
          break;
        case "kick":
          sendCommand(`kick "${cleanName}" ${reason || "Expulsado desde CraftDock"}`);
          break;
        case "whitelist_add":
          sendCommand(`allowlist add "${cleanName}"`);
          break;
        case "whitelist_remove":
          sendCommand(`allowlist remove "${cleanName}"`);
          break;
        default:
          throw new Error("Bedrock usa Kick y Allowlist en lugar de ban por archivo.");
      }
    } else {
      switch (action) {
        case "op":
          sendCommand(`op ${cleanName}`);
          break;
        case "deop":
          sendCommand(`deop ${cleanName}`);
          break;
        case "kick":
          sendCommand(`kick ${cleanName} ${reason || "Expulsado desde CraftDock"}`);
          break;
        case "ban":
          sendCommand(`ban ${cleanName} ${reason || "Baneado desde CraftDock"}`);
          break;
        case "pardon":
          sendCommand(`pardon ${cleanName}`);
          break;
        case "whitelist_add":
          sendCommand(`whitelist add ${cleanName}`);
          break;
        case "whitelist_remove":
          sendCommand(`whitelist remove ${cleanName}`);
          break;
      }
    }
    return readPlayersState(serverDir, engine, []);
  }

  // Offline file edits when server is stopped
  if (engine === "bedrock") {
    if (action === "whitelist_add") {
      const file = path.join(serverDir, "allowlist.json");
      const list = readJsonArray<{ name: string; ignoresPlayerLimit?: boolean }>(file);
      if (!list.some((x) => x.name.toLowerCase() === cleanName.toLowerCase())) {
        list.push({ name: cleanName, ignoresPlayerLimit: false });
        writeJsonArray(file, list);
      }
    } else if (action === "whitelist_remove") {
      const file = path.join(serverDir, "allowlist.json");
      const list = readJsonArray<{ name: string }>(file).filter(
        (x) => x.name.toLowerCase() !== cleanName.toLowerCase()
      );
      writeJsonArray(file, list);
    } else if (action === "kick") {
      throw new Error("Solo puedes expulsar (kick) a un jugador mientras el servidor está encendido.");
    } else {
      throw new Error("En Bedrock, dar/quitar OP requiere que el servidor esté encendido.");
    }
    return readPlayersState(serverDir, engine, []);
  }

  if (action === "kick") {
    throw new Error("Solo puedes expulsar (kick) a un jugador mientras el servidor está encendido.");
  }

  if (action === "op") {
    const file = path.join(serverDir, "ops.json");
    const ops = readJsonArray<any>(file);
    if (!ops.some((x) => x.name?.toLowerCase() === cleanName.toLowerCase())) {
      ops.push({
        uuid: offlinePlayerUuid(cleanName),
        name: cleanName,
        level: 4,
        bypassesPlayerLimit: false,
      });
      writeJsonArray(file, ops);
    }
  } else if (action === "deop") {
    const file = path.join(serverDir, "ops.json");
    const ops = readJsonArray<any>(file).filter(
      (x) => x.name?.toLowerCase() !== cleanName.toLowerCase()
    );
    writeJsonArray(file, ops);
  } else if (action === "whitelist_add") {
    const file = path.join(serverDir, "whitelist.json");
    const list = readJsonArray<any>(file);
    if (!list.some((x) => x.name?.toLowerCase() === cleanName.toLowerCase())) {
      list.push({ uuid: offlinePlayerUuid(cleanName), name: cleanName });
      writeJsonArray(file, list);
    }
  } else if (action === "whitelist_remove") {
    const file = path.join(serverDir, "whitelist.json");
    const list = readJsonArray<any>(file).filter(
      (x) => x.name?.toLowerCase() !== cleanName.toLowerCase()
    );
    writeJsonArray(file, list);
  } else if (action === "ban") {
    const file = path.join(serverDir, "banned-players.json");
    const list = readJsonArray<any>(file);
    if (!list.some((x) => x.name?.toLowerCase() === cleanName.toLowerCase())) {
      list.push({
        uuid: offlinePlayerUuid(cleanName),
        name: cleanName,
        created: new Date().toISOString(),
        source: "CraftDock",
        expires: "forever",
        reason: reason || "Baneado desde CraftDock",
      });
      writeJsonArray(file, list);
    }
  } else if (action === "pardon") {
    const file = path.join(serverDir, "banned-players.json");
    const list = readJsonArray<any>(file).filter(
      (x) => x.name?.toLowerCase() !== cleanName.toLowerCase()
    );
    writeJsonArray(file, list);
  }

  return readPlayersState(serverDir, engine, []);
}
