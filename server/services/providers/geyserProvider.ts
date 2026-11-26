import fs from "node:fs";
import path from "node:path";
import { downloadFile } from "../../utils/http";

const GEYSER_SPIGOT_URL =
  "https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot";
const FLOODGATE_SPIGOT_URL =
  "https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot";

export async function installCrossplayPlugins(
  serverDir: string,
  bedrockUdpPort: number,
  javaPort: number,
  onStep?: (detail: string, percent: number) => void
): Promise<void> {
  const pluginsDir = path.join(serverDir, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  onStep?.("Descargando GeyserMC (puente Bedrock → Java)...", 20);
  await downloadFile({
    url: GEYSER_SPIGOT_URL,
    destPath: path.join(pluginsDir, "Geyser-Spigot.jar"),
  });

  onStep?.("Descargando Floodgate (permite entrar desde Bedrock sin cuenta Java)...", 65);
  await downloadFile({
    url: FLOODGATE_SPIGOT_URL,
    destPath: path.join(pluginsDir, "Floodgate-Spigot.jar"),
  });

  // Pre-seed Geyser config so Bedrock UDP port & Floodgate auth work out of the box
  const geyserConfigDir = path.join(pluginsDir, "Geyser-Spigot");
  fs.mkdirSync(geyserConfigDir, { recursive: true });
  const geyserConfigPath = path.join(geyserConfigDir, "config.yml");

  if (!fs.existsSync(geyserConfigPath)) {
    const configYaml = [
      "# Configuración generada automáticamente por CraftDock para Crossplay",
      "bedrock:",
      "  address: 0.0.0.0",
      `  port: ${bedrockUdpPort}`,
      "  clone-remote-port: false",
      '  motd1: "Servidor Crossplay CraftDock"',
      '  motd2: "Java + Bedrock"',
      "remote:",
      "  address: auto",
      `  port: ${javaPort}`,
      "  auth-type: floodgate",
      "allow-third-party-capes: true",
      "config-version: 4",
      "",
    ].join("\n");
    fs.writeFileSync(geyserConfigPath, configYaml, "utf-8");
  }

  onStep?.("Crossplay (Geyser + Floodgate) instalado correctamente.", 100);
}

export function removeCrossplayPlugins(serverDir: string): void {
  const pluginsDir = path.join(serverDir, "plugins");
  for (const name of ["Geyser-Spigot.jar", "Floodgate-Spigot.jar"]) {
    const file = path.join(pluginsDir, name);
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }
}
