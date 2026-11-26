import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createZipArchive } from "../server/utils/zip";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const EXE_PATH = path.join(DIST_DIR, "CraftDock.exe");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const VERSION = PKG.version || "1.0.0";
const ZIP_NAME = `CraftDock-v${VERSION}-Windows-x64.zip`;
const ZIP_PATH = path.join(DIST_DIR, ZIP_NAME);

if (!fs.existsSync(EXE_PATH)) {
  console.log("[package] CraftDock.exe no existe aún; compilando primero...");
  const buildProc = Bun.spawn(["bun", "scripts/build-exe.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await buildProc.exited;
  if (code !== 0) {
    throw new Error(`Fallo compilando CraftDock.exe (código ${code}).`);
  }
}

console.log("[package] Calculando SHA-256 de CraftDock.exe...");
const exeBytes = fs.readFileSync(EXE_PATH);
const exeSha256 = crypto.createHash("sha256").update(exeBytes).digest("hex");

const leemeTxt = [
  "====================================================================",
  `  CRAFTDOCK v${VERSION} — Gestor Local de Servidores Minecraft (Windows)`,
  "====================================================================",
  "",
  "¡Gracias por usar CraftDock!",
  "Con esta app puedes crear, editar y compartir servidores de Minecraft",
  "Java (Vanilla, Paper, Fabric, Forge, .jar propios), Bedrock oficial",
  "y Crossplay (Java + Bedrock juntos) directo desde tu PC en Windows.",
  "",
  "--------------------------------------------------------------------",
  "1. COMO EMPEZAR (3 PASOS)",
  "--------------------------------------------------------------------",
  "1) Extrae TODOS los archivos de este ZIP en una carpeta (por ejemplo,",
  "   en tu Escritorio o Documentos; no lo ejecutes dentro del ZIP).",
  "2) Haz doble clic en CraftDock.exe.",
  "3) Se abrirá automáticamente tu navegador en http://127.0.0.1:3847",
  "",
  "NO necesitas instalar Java, Node.js, Bun ni Docker por tu cuenta.",
  "CraftDock descarga automáticamente la versión exacta de Java que",
  "necesita cada servidor (Java 8, 17, 21 o 25) desde Eclipse Adoptium.",
  "",
  "--------------------------------------------------------------------",
  "2. AVISOS NORMALES DE WINDOWS LA PRIMERA VEZ",
  "--------------------------------------------------------------------",
  "- SmartScreen ('Windows protegió su PC'):",
  "  Como es una app independiente sin firma comercial de pago, Windows",
  "  muestra este aviso la primera vez. Haz clic en:",
  "  'Más información' -> 'Ejecutar de todas formas'.",
  "",
  "- Firewall de Windows:",
  "  Al encender tu primer servidor de Minecraft, Windows preguntará si",
  "  permites acceso a la red. Elige 'Permitir acceso'.",
  "",
  "--------------------------------------------------------------------",
  "3. COMO JUGAR CON AMIGOS DE OTROS LADOS DEL PAIS",
  "--------------------------------------------------------------------",
  "- Tus amigos NO necesitan descargar CraftDock.exe para entrar a tu",
  "  servidor, solo su Minecraft normal.",
  "- Dentro de CraftDock, entra a 'Conexión Remota (playit.gg)',",
  "  instala y enciende el agente con 1 clic y vincula tu cuenta gratis.",
  "- No tienes que abrir puertos en tu router ni dar tu IP real.",
  "- Usa el botón 'Invitar Amigos' para copiar el mensaje listo para",
  "  pegar en Discord o WhatsApp.",
  "",
  "--------------------------------------------------------------------",
  "4. DONDE SE GUARDAN TUS MUNDOS Y COMO CERRAR SIN CORROMPERLOS",
  "--------------------------------------------------------------------",
  "- Tus servidores, mundos, .jar y respaldos se guardan en:",
  "  %LOCALAPPDATA%\\CraftDock",
  "- Para cerrar todo sin dañar mundos, ve a 'Ajustes y Sistema' y usa",
  "  el botón 'Cerrar CraftDock Seguro' (envía save-all y stop antes de",
  "  salir).",
  "",
  "--------------------------------------------------------------------",
  "5. SEGURIDAD, PRIVACIDAD Y TRANSPARENCIA",
  "--------------------------------------------------------------------",
  "- Solo local: el panel web escucha únicamente en 127.0.0.1 (tu PC).",
  "  Nadie desde internet o tu Wi-Fi puede acceder a tu panel.",
  "- IP oculta: al usar playit.gg tu IP residencial no se expone y no",
  "  abres puertos en tu router.",
  "- Fuentes oficiales verificadas: CraftDock no incluye archivos",
  "  modificados ni piratas; descarga directo desde Mojang (SHA-1),",
  "  PaperMC v3 (SHA-256), Fabric Meta, Forge Maven, GeyserMC,",
  "  Minecraft.net (Bedrock), Modrinth (SHA-1), Eclipse Adoptium y",
  "  GitHub Releases oficial de playit.gg.",
  "- Sin telemetría ni permisos de Administrador.",
  "- Seguridad en archivos y ZIPs: protege contra Path Traversal y",
  "  Zip-Slip (ningún archivo puede salirse de la carpeta del servidor).",
  "- Consejo si usas modo No-Premium (online-mode=false): activa la",
  "  Whitelist o instala un plugin de contraseña (AuthMe/LoginSecurity)",
  "  desde Modrinth para proteger cuentas OP.",
  "- Consejo sobre mods/.jar personalizados: sube solo archivos .jar",
  "  de fuentes confiables (como Modrinth).",
  "",
  "--------------------------------------------------------------------",
  "6. REQUISITOS DEL SISTEMA",
  "--------------------------------------------------------------------",
  "- Windows 10 o Windows 11 (64 bits)",
  "- Conexión a internet para descargar motores, Java y usar playit.gg",
  "- Recomendado: 8 GB de RAM o más",
  "",
].join("\r\n");

const sha256Sums = [
  `# Verificación de integridad SHA-256 — CraftDock v${VERSION}`,
  "# En PowerShell puedes comprobarlo con: Get-FileHash .\\CraftDock.exe -Algorithm SHA256",
  `${exeSha256}  CraftDock.exe`,
  "",
].join("\r\n");

const licenciaTxt = [
  `CraftDock v${VERSION} — Aviso Legal y Licencias`,
  "================================================",
  "",
  "1. Aviso de no afiliación:",
  "   CraftDock es una herramienta independiente y NO es un producto oficial",
  "   de Minecraft ni está aprobada ni asociada con Mojang AB o Microsoft.",
  "",
  "2. EULA de Minecraft:",
  "   Al crear y ejecutar servidores de Minecraft mediante CraftDock,",
  "   el usuario acepta cumplir el Acuerdo de Licencia de Usuario Final",
  "   (EULA) de Mojang disponible en: https://aka.ms/MinecraftEULA",
  "",
  "3. Componentes descargados de terceros:",
  "   Los archivos de servidor (Vanilla, Paper, Fabric, Forge, Geyser,",
  "   Floodgate, Bedrock), runtimes de Java (Eclipse Temurin / Adoptium),",
  "   mods/plugins (Modrinth) y el agente de túnel (playit.gg) son",
  "   descargados directamente desde sus proveedores oficiales y se rigen",
  "   por las licencias de sus respectivos autores.",
  "",
].join("\r\n");

console.log(`[package] Empaquetando ${ZIP_NAME}...`);
const zipBytes = await createZipArchive(
  ZIP_PATH,
  [
    {
      sourcePath: EXE_PATH,
      archiveName: "CraftDock/CraftDock.exe",
      isDirectory: false,
    },
  ],
  [
    { name: "CraftDock/LEEME.txt", content: leemeTxt },
    { name: "CraftDock/SHA256SUMS.txt", content: sha256Sums },
    { name: "CraftDock/AVISO_LEGAL.txt", content: licenciaTxt },
  ]
);

console.log(
  `[package] ¡Paquete listo! ${ZIP_PATH} (${(zipBytes / (1024 * 1024)).toFixed(1)} MB)`
);
console.log(`[package] SHA-256 CraftDock.exe: ${exeSha256}`);
