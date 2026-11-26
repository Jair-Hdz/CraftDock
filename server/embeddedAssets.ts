// In dev mode, static files are served by Vite or dist/web on disk.
// During `bun run build:exe`, scripts/build-exe.ts temporarily replaces this module
// with embedded asset imports so everything packs inside CraftDock.exe.

export interface EmbeddedAsset {
  filePath: string;
  contentType: string;
}

export const EMBEDDED_ASSETS: Record<string, EmbeddedAsset> = {};
export const HAS_EMBEDDED_ASSETS = false;
