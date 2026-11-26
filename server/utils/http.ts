import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CRAFTDOCK_USER_AGENT =
  "CraftDock/1.0.0 (Windows Local Minecraft Manager; https://github.com/craftdock)";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchJson<T>(
  url: string,
  options?: { browserUa?: boolean; headers?: Record<string, string>; timeoutMs?: number }
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": options?.browserUa ? BROWSER_USER_AGENT : CRAFTDOCK_USER_AGENT,
        Accept: "application/json",
        ...options?.headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status} al consultar ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DownloadOptions {
  url: string;
  destPath: string;
  expectedSha1?: string;
  expectedSha256?: string;
  browserUa?: boolean;
  onProgress?: (downloadedBytes: number, totalBytes: number, percent: number) => void;
}

export async function downloadFile(options: DownloadOptions): Promise<{
  sizeBytes: number;
  sha256: string;
}> {
  fs.mkdirSync(path.dirname(options.destPath), { recursive: true });
  const tempPath = `${options.destPath}.part-${Date.now()}`;

  const res = await fetch(options.url, {
    headers: {
      "User-Agent": options.browserUa ? BROWSER_USER_AGENT : CRAFTDOCK_USER_AGENT,
    },
    redirect: "follow",
  });

  if (!res.ok || !res.body) {
    throw new Error(`No se pudo descargar ${options.url} (HTTP ${res.status})`);
  }

  const totalBytes = Number(res.headers.get("content-length") || 0);
  const sha1Hash = crypto.createHash("sha1");
  const sha256Hash = crypto.createHash("sha256");

  const fileStream = fs.createWriteStream(tempPath);
  const reader = res.body.getReader();
  let downloaded = 0;
  let lastReport = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const buf = Buffer.from(value);
      sha1Hash.update(buf);
      sha256Hash.update(buf);
      downloaded += buf.length;

      if (!fileStream.write(buf)) {
        await new Promise<void>((resolve) => fileStream.once("drain", resolve));
      }

      const now = Date.now();
      if (options.onProgress && (now - lastReport > 150 || downloaded === totalBytes)) {
        lastReport = now;
        const percent =
          totalBytes > 0 ? Math.min(100, Math.round((downloaded / totalBytes) * 100)) : 50;
        options.onProgress(downloaded, totalBytes, percent);
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve());
      fileStream.on("error", reject);
    });

    const actualSha1 = sha1Hash.digest("hex");
    const actualSha256 = sha256Hash.digest("hex");

    if (options.expectedSha1 && actualSha1.toLowerCase() !== options.expectedSha1.toLowerCase()) {
      throw new Error(
        `Verificación SHA-1 falló para ${path.basename(options.destPath)} (esperado ${options.expectedSha1}, obtenido ${actualSha1})`
      );
    }
    if (
      options.expectedSha256 &&
      actualSha256.toLowerCase() !== options.expectedSha256.toLowerCase()
    ) {
      throw new Error(
        `Verificación SHA-256 falló para ${path.basename(options.destPath)}`
      );
    }

    fs.renameSync(tempPath, options.destPath);
    options.onProgress?.(downloaded, totalBytes || downloaded, 100);
    return { sizeBytes: downloaded, sha256: actualSha256 };
  } catch (err) {
    try {
      fileStream.destroy();
    } catch {
      // ignore
    }
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
    throw err;
  }
}

export async function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
