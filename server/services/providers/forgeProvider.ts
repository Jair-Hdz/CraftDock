import fs from "node:fs";
import path from "node:path";
import type { RemoteVersionOption } from "../../../shared/types";
import { fetchJson } from "../../utils/http";
import { getRequiredJavaMajor } from "../systemInfo";

const FORGE_PROMOTIONS_URL =
  "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json";

interface ForgePromotions {
  homepage: string;
  promos: Record<string, string>;
}

let cachedPromos: { data: ForgePromotions; fetchedAt: number } | null = null;

async function getPromotions(): Promise<ForgePromotions> {
  if (cachedPromos && Date.now() - cachedPromos.fetchedAt < 10 * 60_000) {
    return cachedPromos.data;
  }
  const data = await fetchJson<ForgePromotions>(FORGE_PROMOTIONS_URL);
  cachedPromos = { data, fetchedAt: Date.now() };
  return data;
}

export function parseForgePromotions(promos: Record<string, string>): RemoteVersionOption[] {
  const byMc = new Map<string, { recommended?: string; latest?: string }>();

  for (const [key, forgeVer] of Object.entries(promos)) {
    const match = key.match(/^(.+)-(recommended|latest)$/);
    if (!match) continue;
    const [, mcVersion, kind] = match;
    const entry = byMc.get(mcVersion) || {};
    if (kind === "recommended") entry.recommended = forgeVer;
    if (kind === "latest") entry.latest = forgeVer;
    byMc.set(mcVersion, entry);
  }

  const options: RemoteVersionOption[] = [];
  for (const [mcVersion, info] of byMc.entries()) {
    const builds = Array.from(
      new Set([info.recommended, info.latest].filter(Boolean) as string[])
    );
    options.push({
      mcVersion,
      releaseType: info.recommended ? "recommended" : "latest",
      builds,
      javaMajor: getRequiredJavaMajor(mcVersion),
    });
  }

  // Sort newest MC version first
  options.sort((a, b) => compareMcVersionDesc(a.mcVersion, b.mcVersion));
  return options;
}

function compareMcVersionDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

export async function listForgeVersions(): Promise<RemoteVersionOption[]> {
  const promos = await getPromotions();
  return parseForgePromotions(promos.promos).slice(0, 60);
}

export async function resolveForgeDownload(
  mcVersion: string,
  requestedBuild?: string
): Promise<{
  url: string;
  build: string;
  fileName: string;
  javaMajor: number;
}> {
  const promos = await getPromotions();
  const forgeBuild =
    (requestedBuild && requestedBuild !== "latest" ? requestedBuild : null) ||
    promos.promos[`${mcVersion}-recommended`] ||
    promos.promos[`${mcVersion}-latest`];

  if (!forgeBuild) {
    throw new Error(`No se encontró instalador oficial de Forge para Minecraft ${mcVersion}.`);
  }

  const fullVer = `${mcVersion}-${forgeBuild}`;
  const fileName = `forge-${fullVer}-installer.jar`;
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${encodeURIComponent(
    fullVer
  )}/${encodeURIComponent(fileName)}`;

  return {
    url,
    build: forgeBuild,
    fileName,
    javaMajor: getRequiredJavaMajor(mcVersion),
  };
}

/**
 * Runs `java -jar forge-installer.jar --installServer` silently inside the server folder
 * and detects whether Forge generated modern `@libraries/.../win_args.txt` (1.17+) or classic `.jar` (<=1.16.5).
 */
export async function installForgeIntoServerDir(
  javaExePath: string,
  installerJarPath: string,
  serverDir: string,
  onLog?: (line: string) => void
): Promise<{ launchMode: "win_args" | "jar"; targetRef: string }> {
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
    throw new Error(`El instalador oficial de Forge terminó con código ${exitCode}.`);
  }

  // Clean up installer jar after installation
  fs.rmSync(localInstaller, { force: true });

  // Detect modern 1.17+ win_args.txt
  const forgeLibRoot = path.join(serverDir, "libraries", "net", "minecraftforge", "forge");
  if (fs.existsSync(forgeLibRoot)) {
    const entries = fs.readdirSync(forgeLibRoot);
    for (const verDir of entries) {
      const winArgs = path.join(forgeLibRoot, verDir, "win_args.txt");
      if (fs.existsSync(winArgs)) {
        const rel = path.relative(serverDir, winArgs).replace(/\\/g, "/");
        return { launchMode: "win_args", targetRef: `@${rel}` };
      }
    }
  }

  // Fallback for classic Forge <= 1.16.5
  const jarFiles = fs
    .readdirSync(serverDir)
    .filter((f) => f.endsWith(".jar") && f.toLowerCase().includes("forge") && !f.includes("installer"));
  if (jarFiles.length > 0) {
    return { launchMode: "jar", targetRef: jarFiles[0] };
  }

  throw new Error("Forge se instaló pero no se detectó el lanzador (win_args.txt ni forge.jar).");
}
