import type { RemoteVersionOption } from "../../../shared/types";
import { fetchJson } from "../../utils/http";
import { getRequiredJavaMajor } from "../systemInfo";

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

interface MojangManifest {
  latest: { release: string; snapshot: string };
  versions: Array<{
    id: string;
    type: string;
    url: string;
    releaseTime: string;
  }>;
}

interface MojangVersionMeta {
  id: string;
  javaVersion?: { majorVersion?: number };
  downloads?: {
    server?: {
      sha1: string;
      size: number;
      url: string;
    };
  };
}

let cachedManifest: { data: MojangManifest; fetchedAt: number } | null = null;

async function getManifest(): Promise<MojangManifest> {
  if (cachedManifest && Date.now() - cachedManifest.fetchedAt < 10 * 60_000) {
    return cachedManifest.data;
  }
  const data = await fetchJson<MojangManifest>(MANIFEST_URL);
  cachedManifest = { data, fetchedAt: Date.now() };
  return data;
}

export async function listMojangVersions(includeSnapshots = false): Promise<RemoteVersionOption[]> {
  const manifest = await getManifest();
  return manifest.versions
    .filter((v) => v.type === "release" || (includeSnapshots && v.type === "snapshot"))
    .slice(0, 80)
    .map((v) => ({
      mcVersion: v.id,
      releaseType: v.type === "snapshot" ? "snapshot" : "release",
      javaMajor: getRequiredJavaMajor(v.id),
    }));
}

export async function resolveMojangServerDownload(mcVersion: string): Promise<{
  url: string;
  sha1: string;
  javaMajor: number;
  build: string;
}> {
  const manifest = await getManifest();
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) {
    throw new Error(`Versión Vanilla "${mcVersion}" no encontrada en Mojang.`);
  }

  const meta = await fetchJson<MojangVersionMeta>(entry.url);
  const serverDl = meta.downloads?.server;
  if (!serverDl?.url) {
    throw new Error(`La versión Vanilla "${mcVersion}" no tiene server.jar oficial disponible.`);
  }

  return {
    url: serverDl.url,
    sha1: serverDl.sha1,
    javaMajor: meta.javaVersion?.majorVersion || getRequiredJavaMajor(mcVersion),
    build: "official",
  };
}
