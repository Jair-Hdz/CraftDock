import type { RemoteVersionOption } from "../../../shared/types";
import { fetchJson } from "../../utils/http";
import { getRequiredJavaMajor } from "../systemInfo";

const FABRIC_META_BASE = "https://meta.fabricmc.net/v2";

interface FabricGameVersion {
  version: string;
  stable: boolean;
}

interface FabricLoaderVersion {
  version: string;
  stable: boolean;
}

interface FabricInstallerVersion {
  version: string;
  stable: boolean;
}

let cachedGames: { data: FabricGameVersion[]; fetchedAt: number } | null = null;

export async function listFabricVersions(includeUnstable = false): Promise<RemoteVersionOption[]> {
  if (!cachedGames || Date.now() - cachedGames.fetchedAt > 10 * 60_000) {
    const games = await fetchJson<FabricGameVersion[]>(`${FABRIC_META_BASE}/versions/game`);
    cachedGames = { data: games, fetchedAt: Date.now() };
  }

  return cachedGames.data
    .filter((v) => v.stable || includeUnstable)
    .slice(0, 70)
    .map((v) => ({
      mcVersion: v.version,
      releaseType: v.stable ? "release" : "snapshot",
      javaMajor: getRequiredJavaMajor(v.version),
    }));
}

export async function resolveFabricDownload(mcVersion: string): Promise<{
  url: string;
  build: string;
  fileName: string;
  javaMajor: number;
}> {
  const [loaders, installers] = await Promise.all([
    fetchJson<FabricLoaderVersion[]>(`${FABRIC_META_BASE}/versions/loader`),
    fetchJson<FabricInstallerVersion[]>(`${FABRIC_META_BASE}/versions/installer`),
  ]);

  const loader = loaders.find((l) => l.stable) || loaders[0];
  const installer = installers.find((i) => i.stable) || installers[0];
  if (!loader || !installer) {
    throw new Error("No se pudieron resolver las versiones de Fabric Loader/Installer.");
  }

  const url = `${FABRIC_META_BASE}/versions/loader/${encodeURIComponent(
    mcVersion
  )}/${encodeURIComponent(loader.version)}/${encodeURIComponent(installer.version)}/server/jar`;

  return {
    url,
    build: `${loader.version}-${installer.version}`,
    fileName: `fabric-server-mc.${mcVersion}-loader.${loader.version}-launcher.${installer.version}.jar`,
    javaMajor: getRequiredJavaMajor(mcVersion),
  };
}
