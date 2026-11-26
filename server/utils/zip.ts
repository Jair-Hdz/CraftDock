import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import yauzl from "yauzl";
import { resolveSafeChildPath } from "./paths";

export interface ZipEntrySource {
  sourcePath: string;
  archiveName: string;
  isDirectory?: boolean;
}

export async function createZipArchive(
  destZipPath: string,
  entries: ZipEntrySource[],
  extraBuffers?: Array<{ name: string; content: string | Buffer }>
): Promise<number> {
  fs.mkdirSync(path.dirname(destZipPath), { recursive: true });

  return new Promise<number>((resolve, reject) => {
    const output = fs.createWriteStream(destZipPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    output.on("close", () => resolve(archive.pointer()));
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);

    for (const entry of entries) {
      if (!fs.existsSync(entry.sourcePath)) continue;
      const stat = fs.statSync(entry.sourcePath);
      if (entry.isDirectory ?? stat.isDirectory()) {
        archive.directory(entry.sourcePath, entry.archiveName);
      } else {
        archive.file(entry.sourcePath, { name: entry.archiveName });
      }
    }

    if (extraBuffers) {
      for (const item of extraBuffers) {
        archive.append(item.content, { name: item.name });
      }
    }

    archive.finalize();
  });
}

export async function extractZipArchive(
  zipPath: string,
  destDir: string,
  options?: { stripTopLevelDir?: boolean; filter?: (entryName: string) => boolean }
): Promise<string[]> {
  fs.mkdirSync(destDir, { recursive: true });

  return new Promise<string[]>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        return reject(err || new Error("No se pudo abrir el archivo ZIP."));
      }

      const extracted: string[] = [];

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const rawName = entry.fileName.replace(/\\/g, "/");
        if (options?.filter && !options.filter(rawName)) {
          zipfile.readEntry();
          return;
        }

        let targetRel = rawName;
        if (options?.stripTopLevelDir) {
          const slashIdx = targetRel.indexOf("/");
          if (slashIdx === -1) {
            zipfile.readEntry();
            return;
          }
          targetRel = targetRel.slice(slashIdx + 1);
          if (!targetRel) {
            zipfile.readEntry();
            return;
          }
        }

        let safeTarget: string;
        try {
          safeTarget = resolveSafeChildPath(destDir, targetRel);
        } catch (secErr) {
          zipfile.close();
          return reject(
            new Error(`Archivo ZIP rechazado por seguridad (Zip-Slip): ${entry.fileName}`)
          );
        }

        if (/\/$/.test(rawName)) {
          fs.mkdirSync(safeTarget, { recursive: true });
          zipfile.readEntry();
          return;
        }

        fs.mkdirSync(path.dirname(safeTarget), { recursive: true });
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            zipfile.close();
            return reject(streamErr || new Error("Error leyendo entrada ZIP"));
          }

          const writeStream = fs.createWriteStream(safeTarget);
          readStream.pipe(writeStream);
          writeStream.on("finish", () => {
            extracted.push(targetRel);
            zipfile.readEntry();
          });
          writeStream.on("error", (wErr) => {
            zipfile.close();
            reject(wErr);
          });
        });
      });

      zipfile.on("end", () => resolve(extracted));
      zipfile.on("error", reject);
    });
  });
}

export async function readZipEntryText(zipPath: string, entryName: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        return reject(err || new Error("No se pudo abrir el archivo ZIP."));
      }

      let found = false;
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const normalized = entry.fileName.replace(/\\/g, "/");
        if (normalized === entryName) {
          found = true;
          zipfile.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) {
              zipfile.close();
              return reject(sErr || new Error("Error leyendo archivo del ZIP"));
            }
            const chunks: Buffer[] = [];
            stream.on("data", (c) => chunks.push(Buffer.from(c)));
            stream.on("end", () => {
              zipfile.close();
              resolve(Buffer.concat(chunks).toString("utf-8"));
            });
            stream.on("error", (e) => {
              zipfile.close();
              reject(e);
            });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on("end", () => {
        if (!found) resolve(null);
      });
      zipfile.on("error", reject);
    });
  });
}

export function isZipMagicBytes(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}
