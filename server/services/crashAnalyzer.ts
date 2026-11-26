import fs from "node:fs";
import path from "node:path";
import type { CrashDiagnosis } from "../../shared/types";

const CLASS_FILE_TO_JAVA: Record<number, number> = {
  52: 8,
  55: 11,
  61: 17,
  65: 21,
  69: 25,
};

export function analyzeCrashLogs(
  consoleLines: string[],
  serverDir?: string
): CrashDiagnosis | null {
  let combinedText = consoleLines.slice(-250).join("\n");

  // Also inspect the newest crash-report file if generated in the last 30 seconds
  if (serverDir) {
    const crashDir = path.join(serverDir, "crash-reports");
    if (fs.existsSync(crashDir)) {
      try {
        const files = fs
          .readdirSync(crashDir)
          .map((f) => ({
            name: f,
            full: path.join(crashDir, f),
            mtime: fs.statSync(path.join(crashDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);

        if (files[0] && Date.now() - files[0].mtime < 60_000) {
          const reportHead = fs.readFileSync(files[0].full, "utf-8").slice(0, 4000);
          combinedText = `${combinedText}\n${reportHead}`;
        }
      } catch {
        // ignore unreadable crash folder
      }
    }
  }

  if (!combinedText.trim()) return null;

  // 1. Port already in use
  const portMatch = combinedText.match(
    /(FAILED TO BIND TO PORT|Address already in use|Perhaps a server is already running on that port|Failed to bind to port)/i
  );
  if (portMatch) {
    return {
      code: "PORT_IN_USE",
      title: "El puerto de red ya está ocupado",
      explanation:
        "Otro servidor o programa en tu PC ya está usando este puerto. Podemos asignarle automáticamente un puerto libre.",
      severity: "error",
      matchedLine: portMatch[0],
      quickAction: {
        type: "assign_free_port",
        label: "Asignar puerto libre automáticamente",
      },
    };
  }

  // 2. Unsupported Java class version
  const classVerMatch = combinedText.match(
    /UnsupportedClassVersionError.*class file version (\d+)\.0/i
  );
  if (classVerMatch) {
    const classMajor = Number(classVerMatch[1]);
    const neededJava = CLASS_FILE_TO_JAVA[classMajor] || (classMajor >= 69 ? 25 : classMajor >= 65 ? 21 : 17);
    return {
      code: "WRONG_JAVA_VERSION",
      title: `Versión de Java incompatible (necesita Java ${neededJava})`,
      explanation: `Este archivo .jar fue compilado para Java ${neededJava}, pero el servidor intentó arrancarlo con otra versión.`,
      severity: "error",
      matchedLine: classVerMatch[0],
      quickAction: {
        type: "switch_java",
        label: `Cambiar automáticamente a Java ${neededJava}`,
        payload: { javaMajor: neededJava },
      },
    };
  }

  // 3. EULA not accepted
  const eulaMatch = combinedText.match(/You need to agree to the EULA in order to run the server/i);
  if (eulaMatch) {
    return {
      code: "EULA_REQUIRED",
      title: "Falta aceptar el EULA de Minecraft",
      explanation:
        "Mojang exige aceptar los términos de uso (eula.txt) antes de arrancar un servidor Java.",
      severity: "warning",
      matchedLine: eulaMatch[0],
      quickAction: {
        type: "accept_eula",
        label: "Aceptar EULA automáticamente",
      },
    };
  }

  // 4. Out of memory
  const oomMatch = combinedText.match(
    /(java\.lang\.OutOfMemoryError|Could not reserve enough space for|Insufficient memory for the Java Runtime Environment)/i
  );
  if (oomMatch) {
    return {
      code: "OUT_OF_MEMORY",
      title: "El servidor se quedó sin memoria RAM",
      explanation:
        "El mundo o los mods necesitaron más RAM de la asignada actualmente (o tu PC no tenía suficiente memoria libre en ese momento).",
      severity: "error",
      matchedLine: oomMatch[0],
      quickAction: {
        type: "increase_ram",
        label: "Subir RAM (+1 GB en zona segura)",
        payload: { deltaMb: 1024 },
      },
    };
  }

  // 5. Missing Fabric / Forge mod dependency
  const fabricDepMatch = combinedText.match(
    /Install ([a-zA-Z0-9_-]+),|Mod '([^']+)' requires .*? of ([a-zA-Z0-9_-]+)|requires any version of ([a-zA-Z0-9_-]+), which is missing/i
  );
  const forgeDepMatch = combinedText.match(
    /Mod (\S+) requires (\S+) (\S+) or above|Missing or unsupported mandatory dependencies:[\s\S]*?Mod ID: '([^']+)'/i
  );
  if (fabricDepMatch || forgeDepMatch) {
    const missingMod =
      fabricDepMatch?.[1] ||
      fabricDepMatch?.[3] ||
      fabricDepMatch?.[4] ||
      forgeDepMatch?.[2] ||
      forgeDepMatch?.[4] ||
      "fabric-api";
    return {
      code: "MISSING_MOD_DEPENDENCY",
      title: `Falta un mod obligatorio: ${missingMod}`,
      explanation: `Uno de tus mods necesita "${missingMod}" para poder arrancar. Puedes buscarlo e instalarlo directo desde Modrinth.`,
      severity: "error",
      matchedLine: (fabricDepMatch || forgeDepMatch)?.[0],
      quickAction: {
        type: "search_modrinth",
        label: `Buscar "${missingMod}" en Modrinth`,
        payload: { query: missingMod },
      },
    };
  }

  // 6. Duplicate mods
  const dupModMatch = combinedText.match(
    /(Duplicate mods found|Found duplicate mod|Mod ID '([^']+)' appears in multiple files)/i
  );
  if (dupModMatch) {
    return {
      code: "DUPLICATE_MODS",
      title: "Hay mods repetidos en la carpeta mods/",
      explanation:
        "Tienes dos versiones del mismo mod instaladas a la vez. Desactiva o elimina la versión repetida.",
      severity: "error",
      matchedLine: dupModMatch[0],
      quickAction: {
        type: "open_mods",
        label: "Abrir pestaña Mods / Plugins",
      },
    };
  }

  // 7. World session lock
  const lockMatch = combinedText.match(/(Failed to check session lock|session\.lock)/i);
  if (lockMatch) {
    return {
      code: "WORLD_LOCKED",
      title: "El mundo está bloqueado por otro proceso",
      explanation:
        "Parece que otro servidor Java sigue abierto usando esta misma carpeta del mundo. Cierra procesos duplicados e intenta de nuevo.",
      severity: "error",
      matchedLine: lockMatch[0],
    };
  }

  // Generic crash fallback if non-zero exit happened
  const genericErr = consoleLines
    .slice(-40)
    .reverse()
    .find((l) => /(Exception|Error|FATAL|Failed to start)/i.test(l));

  return {
    code: "UNKNOWN_CRASH",
    title: "El servidor se cerró inesperadamente",
    explanation:
      "Revisa las últimas líneas de la consola o los archivos en crash-reports/ para ver el detalle exacto.",
    severity: "error",
    matchedLine: genericErr,
  };
}
