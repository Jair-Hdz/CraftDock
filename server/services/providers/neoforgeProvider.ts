import fs from "node:fs";
import path from "node:path";
import type { RemoteVersionOption } from "../../../shared/types";
import { fetchJson } from "../../utils/http";
import { getRequiredJavaMajor } from "../systemInfo";

const NEOFORGE_VERSIONS_URL =
  "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

let cachedRawVersions: { versions: string[]; fetchedAt: number } | null = null;

/**
 * Maps a NeoForge artifact version to its Minecraft version:
 * - 20.4.237   -> 1.20.4
 * - 21.0.167   -> 1.21
 * - 21.1.265   -> 1.21.1
 * - 26.1.0.12  -> 26.1
 * - 26.3.1.40  -> 26.3.1
 */
export function neoforgeToMcVersion(neoVer: string): string | null {
  if (/-(beta|alpha|snapshot)/i.test(neoVer) && !neoVer.includes("beta")) {
    return null;
  }
  const clean = neoVer.split("-")[0];
  const parts = clean.split(".").map((n) => Number(n));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;

  const [major, minor, patch] = parts;
  // Year-based MC 26.x+ format: <year>.<drop>.<patch>.<build>
  if (major >= 26) {
    return patch > 0 ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
  }
  // Classic 1.20.x / 1.21.x format: <mcMinor>.<mcPatch>.<build>
  if (major >= 20 && major <= 25) {
    return minor === 0 ? `1.${major}` : `1.${major}.${minor}`;
  }
  return null;
}

function compareVersionDesc(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map((n) => Number(n) || 0);
  const pb = b.split("-")[0].split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

export function parseNeoforgeVersions(rawVersions: string[]): RemoteVersionOption[] {
  const byMc = new Map<string, string[]>();

  for (const ver of rawVersions) {
    const mc = neoforgeToMcVersion(ver);
    if (!mc) continue;
    const list = byMc.get(mc) || [];
    list.push(ver);
    byMc.set(mc, list);
  }

  const options: RemoteVersionOption[] = [];
  for (const [mcVersion, builds] of byMc.entries()) {
    // Prefer non-beta builds first, newest first
    builds.sort((a, b) => {
      const aBeta = a.includes("beta") ? 1 : 0;
      const bBeta = b.includes("beta") ? 1 : 0;
      if (aBeta !== bBeta) return aBeta - bBeta;
      return compareVersionDesc(a, b);
    });
    options.push({
      mcVersion,
      releaseType: "release",
      builds: builds.slice(0, 15),
      javaMajor: getRequiredJavaMajor(mcVersion),
    });
  }

  options.sort((a, b) => compareVersionDesc(a.mcVersion, b.mcVersion));
  return options;
}

async function getRawVersions(): Promise<string[]> {
  if (cachedRawVersions && Date.now() - cachedRawVersions.fetchedAt < 10 * 60_000) {
    return cachedRawVersions.versions;
  }
  const data = await fetchJson<{ versions: string[] }>(NEOFORGE_VERSIONS_URL);
  const versions = Array.isArray(data.versions) ? data.versions : [];
  cachedRawVersions = { versions, fetchedAt: Date.now() };
  return versions;
}

export async function listNeoforgeVersions(): Promise<RemoteVersionOption[]> {
  const raw = await getRawVersions();
  return parseNeoforgeVersions(raw).slice(0, 40);
}

export async function resolveNeoforgeDownload(
  mcVersion: string,
  requestedBuild?: string
): Promise<{
  url: string;
  build: string;
  fileName: string;
  javaMajor: number;
}> {
  let neoBuild = requestedBuild && requestedBuild !== "latest" ? requestedBuild : "";
  if (!neoBuild) {
    const options = await listNeoforgeVersions();
    const match = options.find((o) => o.mcVersion === mcVersion);
    neoBuild = match?.builds?.[0] || "";
  }

  if (!neoBuild) {
    throw new Error(`No se encontró instalador oficial de NeoForge para Minecraft ${mcVersion}.`);
  }

  const fileName = `neoforge-${neoBuild}-installer.jar`;
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${encodeURIComponent(
    neoBuild
  )}/${encodeURIComponent(fileName)}`;

  return {
    url,
    build: neoBuild,
    fileName,
    javaMajor: getRequiredJavaMajor(mcVersion),
  };
}

export async function installNeoforgeIntoServerDir(
  javaExePath: string,
  installerJarPath: string,
  serverDir: string,
  onLog?: (line: string) => void
): Promise<{ launchMode: "win_args"; targetRef: string }> {
  const localInstaller = path.join(serverDir, path.basename(installerJarPath));
  fs.copyFileSync(installerJarPath, localInstaller);

  const proc = Bun.spawn([javaExePath, "-jar", localInstaller, "--installServer"], {
    cwd: serverDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const readPipe = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLog?.(line);
      }
    }
  };

  await Promise.all([readPipe(proc.stdout), readPipe(proc.stderr)]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`El instalador oficial de NeoForge terminó con código ${exitCode}.`);
  }

  fs.rmSync(localInstaller, { force: true });

  const neoLibRoot = path.join(serverDir, "libraries", "net", "neoforged", "neoforge");
  if (fs.existsSync(neoLibRoot)) {
    const entries = fs.readdirSync(neoLibRoot).sort().reverse();
    for (const verDir of entries) {
      const winArgs = path.join(neoLibRoot, verDir, "win_args.txt");
      if (fs.existsSync(winArgs)) {
        const rel = path.relative(serverDir, winArgs).replace(/\\/g, "/");
        return { launchMode: "win_args", targetRef: `@${rel}` };
      }
    }
  }

  throw new Error("NeoForge se instaló pero no se encontró win_args.txt en libraries/.");
}
