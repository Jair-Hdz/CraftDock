import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WEB_DIST = path.join(ROOT, "dist", "web");
const EMBEDDED_FILE = path.join(ROOT, "server", "embeddedAssets.ts");
const OUT_EXE = path.join(ROOT, "dist", "CraftDock.exe");

const ORIGINAL_STUB = `// In dev mode, static files are served by Vite or dist/web on disk.
// During \`bun run build:exe\`, scripts/build-exe.ts temporarily replaces this module
// with embedded asset imports so everything packs inside CraftDock.exe.

export interface EmbeddedAsset {
  filePath: string;
  contentType: string;
}

export const EMBEDDED_ASSETS: Record<string, EmbeddedAsset> = {};
export const HAS_EMBEDDED_ASSETS = false;
`;

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
  };
  return map[ext] || "application/octet-stream";
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Comando falló (${code}): ${cmd.join(" ")}`);
  }
}

console.log("[build-exe] 1/3 Compilando frontend web con Vite...");
await run(["bunx", "vite", "build"]);

if (!fs.existsSync(WEB_DIST)) {
  throw new Error("No se generó dist/web.");
}

console.log("[build-exe] 2/3 Generando manifiesto de assets embebidos...");
const files = collectFiles(WEB_DIST);
const imports: string[] = [];
const mapEntries: string[] = [];

files.forEach((fullPath, idx) => {
  const relFromWeb = "/" + path.relative(WEB_DIST, fullPath).replace(/\\/g, "/");
  const relFromServer = path
    .relative(path.dirname(EMBEDDED_FILE), fullPath)
    .replace(/\\/g, "/");
  const varName = `asset_${idx}`;
  imports.push(`import ${varName} from "${relFromServer}" with { type: "file" };`);
  mapEntries.push(
    `  ${JSON.stringify(relFromWeb)}: { filePath: ${varName}, contentType: ${JSON.stringify(
      getContentType(fullPath)
    )} },`
  );
});

const generatedModule = `// Auto-generated during build-exe
${imports.join("\n")}

export interface EmbeddedAsset {
  filePath: string;
  contentType: string;
}

export const EMBEDDED_ASSETS: Record<string, EmbeddedAsset> = {
${mapEntries.join("\n")}
};
export const HAS_EMBEDDED_ASSETS = true;
`;

fs.writeFileSync(EMBEDDED_FILE, generatedModule, "utf-8");

try {
  console.log("[build-exe] 3/3 Compilando CraftDock.exe (standalone Windows x64)...");
  await run([
    "bun",
    "build",
    "--compile",
    "--target=bun-windows-x64",
    "server/index.ts",
    "--outfile",
    OUT_EXE,
  ]);
  const stat = fs.statSync(OUT_EXE);
  console.log(
    `[build-exe] ¡Listo! ${OUT_EXE} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`
  );
} finally {
  // Always restore dev stub so repo stays clean
  fs.writeFileSync(EMBEDDED_FILE, ORIGINAL_STUB, "utf-8");
}
