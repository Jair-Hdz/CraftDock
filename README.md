# CraftDock

**Gestor local de servidores de Minecraft para Windows 10/11** empaquetado en un único ejecutable (`CraftDock.exe`), pensado para gamers que quieren crear, editar y compartir servidores con amigos de todo el país sin abrir puertos del router ni instalar Java manualmente.

> **Descarga directa para Windows:** Ve a [**Releases**](https://github.com/Jair-Hdz/CraftDock/releases/latest), descarga `CraftDock-v1.0.0-Windows-x64.zip`, descomprímelo y abre `CraftDock.exe`.

---

## Características principales

- **Todos los motores oficiales + `.jar` propios:** Java Vanilla, Paper (plugins), **Crossplay Java + Bedrock (Paper + Geyser + Floodgate en 1 clic)**, Fabric, Forge, Bedrock oficial de Windows y **Biblioteca de `.JAR`** para reutilizar versiones o subir tu propio `.jar` (Purpur, Spigot, Mohist, etc.).
- **Java automático (Adoptium Temurin):** Descarga e instala de forma portable la versión exacta de Java según la versión de Minecraft (**Java 8, 17, 21 y 25** para `26.x`).
- **Conexión remota gratuita (`playit.gg`):** Túnel TCP (Java) y UDP (Bedrock/Crossplay) integrado sin configurar el router ni exponer tu IP real. Tus amigos no instalan nada.
- **Edición visual completa:** `server.properties` con controles claros (incluyendo modo **Premium / No-Premium**), selector de RAM con semáforo según la RAM real de tu PC, ícono `server-icon.png` (recorte automático 64×64), consola en vivo, monitor de recursos y gestión de jugadores (OP, kick, ban, whitelist).
- **Mods, Plugins y Modpacks:** Arrastrar `.jar`, activar/desactivar, buscador e instalación directa desde **Modrinth**, importación de `.mrpack` y exportación de pack `.zip` listo para pasarle a tus amigos.
- **Biblioteca / Explorador de archivos con editor integrado:** Navega, crea, sube, renombra y edita archivos de configuración (`.properties`, `.yml`, `.json`, `.toml`, `.mcfunction`, etc.) con **CodeMirror 6** (`Ctrl+S`).
- **Seguridad para tus mundos:** Respaldos en 1 clic, respaldos automáticos anti-desastres antes de cambiar `.jar` o restaurar, cierre seguro (`save-all` + `stop`), auto-apagado sin jugadores y **detector inteligente de errores** en español.

---

## Seguridad y Privacidad

- **Panel 100% local (`127.0.0.1`):** El panel web solo responde en tu propia PC; nadie desde internet ni tu Wi-Fi puede acceder a él.
- **Sin telemetría ni permisos de Administrador:** Corre como usuario normal y guarda todo en `%LOCALAPPDATA%\CraftDock`.
- **Descargas directas de fuentes oficiales:** Mojang (SHA-1), PaperMC Fill API v3 (SHA-256), Fabric Meta v2, Forge Maven, GeyserMC v2, Minecraft.net CDN, Modrinth API v2 (SHA-1), Eclipse Adoptium v3 y GitHub Releases oficial de `playit-cloud/playit-agent`.
- **Protección contra Path Traversal y Zip-Slip:** Ningún archivo o extracción `.zip`/`.mrpack` puede salirse de la carpeta del servidor.
- **Verificable de punta a punta:** Puedes auditar todo el código en este repositorio y compilar tu propio `CraftDock.exe` con `bun run build:exe`.

---

## Desarrollo y Compilación desde Código Fuente

Requisitos para compilar (los usuarios finales de `CraftDock.exe` **no** necesitan nada de esto):
- [Bun](https://bun.sh/) v1.2+ en Windows 10/11 x64

```powershell
# 1. Instalar dependencias
bun install

# 2. Modo desarrollo (Backend + Vite)
bun run dev

# 3. Verificación de tipos y pruebas automatizadas
bun run typecheck
bun test

# 4. Compilar ejecutable standalone dist/CraftDock.exe
bun run build:exe

# 5. Generar paquete de distribución ZIP con LEEME y SHA256SUMS
bun run package:zip
```

---

## Aviso Legal

CraftDock es un proyecto independiente y **no** es un producto oficial de Minecraft ni está aprobado ni asociado con Mojang AB o Microsoft. Al crear servidores aceptas el [EULA de Minecraft](https://aka.ms/MinecraftEULA).
