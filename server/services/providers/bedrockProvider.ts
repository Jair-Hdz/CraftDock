import type { RemoteVersionOption } from "../../../shared/types";
import { fetchJson } from "../../utils/http";

const ENDSTONE_VERSIONS_URL =
  "https://raw.githubusercontent.com/EndstoneMC/bedrock-server-data/main/versions.json";
const KITTIZZ_DOWNLOADS_URL =
  "https://raw.githubusercontent.com/kittizz/bedrock-server-downloads/main/bedrock-server-downloads.json";

let cachedBedrock: { data: RemoteVersionOption[]; fetchedAt: number } | null = null;

export function parseBedrockVersionIndex(payload: any): RemoteVersionOption[] {
  const options: RemoteVersionOption[] = [];

  // Format 1: kittizz { release: { "1.21.x": { windows: { url, ... } } } }
  if (payload?.release && typeof payload.release === "object") {
    for (const [ver, info] of Object.entries<any>(payload.release)) {
      const winUrl =
        info?.windows?.url ||
        (typeof info?.windows === "string" ? info.windows : null) ||
        `https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-${ver}.zip`;
      options.push({
        mcVersion: ver,
        releaseType: "release",
        downloadUrl: winUrl,
      });
    }
  } else if (Array.isArray(payload?.versions)) {
    // Format 2: EndstoneMC { versions: ["1.21.50.10", ...] }
    for (const item of payload.versions) {
      const ver = typeof item === "string" ? item : item?.version;
      if (!ver) continue;
      options.push({
        mcVersion: String(ver),
        releaseType: "release",
        downloadUrl: `https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-${ver}.zip`,
      });
    }
  } else if (payload && typeof payload === "object") {
    // Format 3: flat map { "1.21.x": { windows: ... } }
    for (const [ver, info] of Object.entries<any>(payload)) {
      if (!/^\d+\.\d+/.test(ver)) continue;
      const winUrl =
        info?.windows?.url ||
        `https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-${ver}.zip`;
      options.push({
        mcVersion: ver,
        releaseType: "release",
        downloadUrl: winUrl,
      });
    }
  }

  options.sort((a, b) => compareVersionDesc(a.mcVersion, b.mcVersion));
  return options;
}

function compareVersionDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

export async function listBedrockVersions(): Promise<RemoteVersionOption[]> {
  if (cachedBedrock && Date.now() - cachedBedrock.fetchedAt < 10 * 60_000) {
    return cachedBedrock.data;
  }

  let options: RemoteVersionOption[] = [];
  try {
    const kittizz = await fetchJson<any>(KITTIZZ_DOWNLOADS_URL);
    options = parseBedrockVersionIndex(kittizz);
  } catch {
    // fallback below
  }

  if (options.length === 0) {
    try {
      const endstone = await fetchJson<any>(ENDSTONE_VERSIONS_URL);
      options = parseBedrockVersionIndex(endstone);
    } catch {
      // fallback below
    }
  }

  const sliced = options.slice(0, 40);
  if (sliced.length > 0) {
    cachedBedrock = { data: sliced, fetchedAt: Date.now() };
  }
  return sliced;
}

export async function resolveBedrockDownload(mcVersion: string): Promise<{
  url: string;
  build: string;
  fileName: string;
}> {
  const versions = await listBedrockVersions();
  const match = versions.find((v) => v.mcVersion === mcVersion);
  const url =
    match?.downloadUrl ||
    `https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-${mcVersion}.zip`;

  return {
    url,
    build: "win64",
    fileName: `bedrock-server-${mcVersion}.zip`,
  };
}
