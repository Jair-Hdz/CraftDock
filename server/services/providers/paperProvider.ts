import type { RemoteVersionOption } from "../../../shared/types";
import { fetchJson } from "../../utils/http";
import { getRequiredJavaMajor } from "../systemInfo";

const PAPER_V3_BASE = "https://fill.papermc.io/v3/projects/paper";

let cachedVersions: { data: RemoteVersionOption[]; fetchedAt: number } | null = null;

export function parsePaperProjectVersions(payload: any): string[] {
  const rawVersions = payload?.versions;
  if (Array.isArray(rawVersions)) {
    return rawVersions.map(String);
  }
  if (rawVersions && typeof rawVersions === "object") {
    // Paper v3 groups versions by major/minor: { "1.21": ["1.21.4", "1.21.3"], ... }
    const flattened: string[] = [];
    for (const group of Object.values(rawVersions)) {
      if (Array.isArray(group)) {
        for (const item of group) flattened.push(String(item));
      }
    }
    return flattened;
  }
  return [];
}

export async function listPaperVersions(): Promise<RemoteVersionOption[]> {
  if (cachedVersions && Date.now() - cachedVersions.fetchedAt < 10 * 60_000) {
    return cachedVersions.data;
  }

  const payload = await fetchJson<any>(PAPER_V3_BASE);
  const versions = parsePaperProjectVersions(payload);

  // Newest first (Paper v3 returns newest groups first or sorted)
  const unique = Array.from(new Set(versions));
  const result: RemoteVersionOption[] = unique.map((v) => ({
    mcVersion: v,
    releaseType: "release",
    javaMajor: getRequiredJavaMajor(v),
  }));

  cachedVersions = { data: result, fetchedAt: Date.now() };
  return result;
}

export interface PaperBuildInfo {
  build: string;
  url: string;
  sha256?: string;
  fileName: string;
}

export function parsePaperBuildsResponse(payload: any): PaperBuildInfo[] {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.builds) ? payload.builds : [];
  const results: PaperBuildInfo[] = [];

  for (const item of list) {
    const buildId = String(item.id ?? item.build ?? "");
    const dl =
      item.downloads?.["server:default"] ||
      item.downloads?.application ||
      Object.values(item.downloads || {})[0];
    if (!buildId || !dl) continue;

    const url = dl.url;
    if (!url) continue;

    results.push({
      build: buildId,
      url,
      sha256: dl.checksums?.sha256 || dl.sha256,
      fileName: dl.name || `paper-build-${buildId}.jar`,
    });
  }

  // Ensure highest build number is first
  results.sort((a, b) => Number(b.build) - Number(a.build));
  return results;
}

export async function listPaperBuilds(mcVersion: string): Promise<PaperBuildInfo[]> {
  const payload = await fetchJson<any>(
    `${PAPER_V3_BASE}/versions/${encodeURIComponent(mcVersion)}/builds`
  );
  return parsePaperBuildsResponse(payload);
}

export async function resolvePaperDownload(
  mcVersion: string,
  requestedBuild?: string
): Promise<{
  url: string;
  sha256?: string;
  build: string;
  fileName: string;
  javaMajor: number;
}> {
  const builds = await listPaperBuilds(mcVersion);
  if (builds.length === 0) {
    throw new Error(`No hay builds de Paper disponibles para Minecraft ${mcVersion}.`);
  }

  const chosen =
    requestedBuild && requestedBuild !== "latest"
      ? builds.find((b) => b.build === requestedBuild) || builds[0]
      : builds[0];

  return {
    url: chosen.url,
    sha256: chosen.sha256,
    build: chosen.build,
    fileName: chosen.fileName,
    javaMajor: getRequiredJavaMajor(mcVersion),
  };
}
