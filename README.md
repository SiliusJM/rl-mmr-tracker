# RL MMR Tracker

Aplicacion de escritorio para streamers de Rocket League que rastrea tu MMR competitivo y actualiza el comando de tu bot de StreamElements automaticamente.

> Repositorio: https://github.com/SiliusJM/rl-mmr-tracker

---

## Capturas

| Tracker activo | Configuracion | Resultado en Twitch |
|---|---|---|
| ![Tracker](assets/screenshots/tracker-activo.png) | ![Configuracion](assets/screenshots/configuracion.png) | ![Twitch](assets/screenshots/twitch-chat.png) |

> Para ver las capturas en GitHub se encuentra dentro de la carpeta `assets/screenshots/`.

---

## Caracteristicas

- Muestra todos los modos clasificados de tu perfil (1v1, 2v2, 3v3, Rumble, Hoops, Dropshot, Snowday...)
- **Modos auto-detectados desde la API** -- si Psyonix agrega o elimina un modo, la app lo refleja automaticamente sin actualizaciones
- Selecciona que modos se incluyen en el comando de Twitch
- Contador de ganados/perdidos del dia (se resetea a medianoche)
- UI oscura con log de actividad en tiempo real
- Configuracion guardada localmente en `config.json` (no se sube a GitHub)

---

## Inicio rapido (despues de `git clone`)

### Requisitos previos

- [Node.js v18 o superior](https://nodejs.org) -- solo esto es necesario.
- Una cuenta de [StreamElements](https://streamelements.com) con el bot activado en tu canal.

### Primer uso

1. Clona el repositorio:
   ```bash
   git clone https://github.com/SiliusJM/rl-mmr-tracker.git
   cd rl-mmr-tracker
   ```
2. Haz doble clic en **`Iniciar.bat`**.
   - La primera vez detecta que `node_modules/` no existe y ejecuta `npm install` automaticamente (puede tardar 1-2 minutos dependiendo de tu internet).
   - Las siguientes veces abre la app directamente.
3. Haz clic en **Configuracion**, completa los campos y guarda.
4. Presiona **INICIAR**.
5. Despues del primer ciclo abre **Configuracion**, selecciona los modos que quieres en tu chat y guarda.

> Si prefieres la linea de comandos: `npm install` una sola vez, luego `npm start` cada vez.

---

## Guia de configuracion

### 1. Cuenta de juego

| Campo | Que poner |
|---|---|
| Plataforma | `Epic Games`, `Steam`, `PSN` o `Xbox Live` |
| Nombre de usuario | Tu nombre exacto en Rocket League (ej: `SILIUS XIX YT`). Los espacios se incluyen. |

### 2. StreamElements -- Twitch o YouTube

StreamElements funciona tanto si vinculaste Twitch como YouTube. Cada plataforma tiene su propio Channel ID dentro de StreamElements.

1. Ve a [streamelements.com](https://streamelements.com) e inicia sesion.
2. Haz clic en tu avatar (arriba a la derecha) -> **Mi Cuenta** o **Channel settings** -> pestana **Channels**.
3. **JWT Token:** copialo desde la columna JWT Token. Empieza con `eyJ...`
4. **Account ID / Channel ID:** copialo desde la columna Account ID (ej: `69f239c3...`).
   - Si tienes Twitch Y YouTube vinculados, asegurate de copiar los datos del canal donde tienes el bot de StreamElements **activo**, no el otro.

> **Importante:** mezclar el Account ID de una plataforma con el bot activo en la otra causa error de conexion aunque el JWT Token sea correcto.

### 3. Comando de chat

- **Nombre:** el comando que usaran los viewers (ej: `rangoo` -> el viewer escribe `!rangoo`).
- El tracker actualiza ese comando automaticamente en cada ciclo.

---

## Uso de recursos y rendimiento

El tracker esta disenado para correr en segundo plano sin afectar tu juego ni tu internet.

| Recurso | Consumo aproximado |
|---|---|
| **RAM** | ~180-250 MB (Electron + Chromium en modo headless) |
| **CPU** | <1% en reposo. Pico de 5-10% durante ~3-5 segundos por ciclo de actualizacion |
| **Red** | ~0.5-2 MB por ciclo (carga la pagina del perfil en tracker.gg) |
| **Disco** | Sin escritura continua. Solo guarda `config.json` al cambiar configuracion |

**Impacto real en streaming/gaming: ninguno.**
- El navegador corre headless (sin ventana visible) y solo se activa durante el scraping.
- El intervalo minimo es de 30 segundos; con 60 segundos (por defecto) el consumo es casi imperceptible.
- No interfiere con OBS, Rocket League ni con el ancho de banda de tu partida.

---

## Sobre los modos -- se actualiza si Psyonix agrega o elimina alguno?

**Si, completamente automatico.** El programa no tiene ninguna lista de modos escrita en el codigo. En cada ciclo consulta la API de tracker.gg y lee los modos disponibles en ese momento. Esto significa:

- Si Psyonix **elimina** un modo (ej. Snowday deja de tener ranked), desaparece solo de la app.
- Si Psyonix **agrega** un modo nuevo, aparece en la app en el siguiente ciclo sin actualizar nada.
- Los modos que no hayas jugado o que no aparezcan en tu perfil simplemente no se muestran.

**No requiere mantenimiento del codigo.**

---

## Ejemplo del comando en chat

```
Ranked Standard 3v3: Diamond III - Division I (994) | Hoy: 3 Ganados - 1 Perdidos
```

---

## Nota sobre el intervalo de actualizacion

El "Update in 3:18" que ves en tracker.gg es el cache del **sitio web**, no el de esta app. La app consulta la API en el intervalo que configures (60 segundos por defecto, minimo 30 s).

### Cuanto tarda en actualizarse el contador de Ganados/Perdidos?

El contador de **📊 Partidos de hoy** en la UI y en el comando de chat se actualiza en cada ciclo de polling:

- Con el intervalo por defecto de **60 segundos**, el contador puede tardar hasta **60 s** en reflejar el resultado de una partida.
- El minimo configurable es **30 segundos**.
- El contador detecta cambios comparando el MMR de cada modo entre ciclos: si sube es victoria, si baja es derrota.
- Se resetea automaticamente a medianoche (cambio de dia).

---

## Estructura del proyecto

```
rl-mmr-tracker/
├── main.js                    # Proceso principal de Electron
├── preload.js                 # Puente IPC seguro (contextBridge)
├── scraper.js                 # Scraper de tracker.gg (puppeteer-extra + stealth)
├── streamElements.js          # Cliente API de StreamElements
├── sessionTracker.js          # Contador de ganados/perdidos
├── renderer/
│   ├── index.html             # UI principal
│   ├── app.js                 # Logica del frontend
│   └── style.css              # Tema oscuro
├── assets/
│   └── screenshots/           # Capturas para el README (agrega las tuyas aqui)
├── Iniciar.bat                # Lanzador Windows (auto-instala dependencias la primera vez)
├── package.json
└── .gitignore                 # config.json y tokens no se suben
```

> **Seguridad:** `config.json` (contiene nombre de usuario, JWT Token y Channel ID) esta en `.gitignore` y nunca se sube a los repositorios. Cada usuario configura sus propios datos localmente.

---

## Construir instalador .exe (opcional)

```bash
npm run dist
```

El instalador aparece en la carpeta `dist/`.

---

## Licencia

MIT