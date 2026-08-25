# RL MMR Tracker

Aplicacion de escritorio para streamers de Rocket League que rastrea tu MMR competitivo y actualiza el comando de tu bot de StreamElements automaticamente.

> Repositorio: https://github.com/SiliusJM/rl-mmr-tracker

---

## Caracteristicas

### Tracking de MMR y Rangos
- Muestra todos los modos clasificados de tu perfil (1v1, 2v2, 3v3, Rumble, Hoops, Dropshot, Snowday...)
- **Modos auto-detectados desde la API** -- si Psyonix agrega o elimina un modo, la app lo refleja automaticamente sin actualizaciones
- Contador de ganados/perdidos del dia (se resetea a medianoche)
- Soporte para temporadas anteriores (hasta 2 temporadas atras)
- **Deteccion inmediata del resultado de la partida** mediante la Stats API local de Rocket League
- **Vigilancia rapida de Tracker.gg despues de cada partida** para actualizar el MMR tan pronto como Tracker.gg publique el cambio

### Vista de Perfil Completo (OBS)
- **URL:** `http://localhost:3030/obs/profile`
- Estadisticas de la carrera: Tiros, Goles, Salvadas, Asistencias, MVPs, Ganados
- Rango mayor alcanzado en la temporada
- Vision general de todos tus modos ranqueados con rango, MMR, partidos jugados, racha y pico de MMR
- Actualizacion automatica cada 5 segundos

### Comando de Twitch Personalizable
Elige que informacion mostrar en tu chat:
- **Solo modos:** Muestra rangos y MMR
- **Solo estadisticas:** Muestra goles, tiros, salvadas, etc. de toda la carrera
- **Ambos:** Combinacion de modos + estadisticas

Selecciona exactamente que estadisticas incluir:
- ⚽ Goles
- 🎯 Tiros
- 🛡️ Salvadas
- 🤝 Asistencias
- ⭐ MVPs
- 🏆 Ganados

### Interfaz y Experiencia
- UI oscura con log de actividad en tiempo real
- Configuracion guardada localmente en `config.json` (no se sube a GitHub)
- Servidor OBS integrado para overlays personalizados
- Compatible con Epic Games, Steam, PlayStation y Xbox

---

## Inicio rapido

### Requisitos previos

- [Node.js v18 o superior](https://nodejs.org)
- Una cuenta de [StreamElements](https://streamelements.com) con el bot activado en tu canal

### Primer uso

1. Clona el repositorio:
   ```bash
   git clone https://github.com/SiliusJM/rl-mmr-tracker.git
   cd rl-mmr-tracker
   ```
2. Ejecuta **`Iniciar.bat`**. La primera vez instalara automaticamente las dependencias.
3. Abre **Configuracion**, completa los datos y guarda.
4. Configura la **Rocket League Stats API** siguiendo la seccion correspondiente.
5. Presiona **INICIAR**.

> Tambien puedes usar `npm install` y luego `npm start`.

---

## Configuracion de Rocket League Stats API

La deteccion inmediata de victorias y derrotas utiliza la Stats API local de Rocket League. Esto permite publicar el resultado de la partida en StreamElements sin esperar a que Tracker.gg actualice el MMR.

### Archivo de configuracion

En Windows, abre:

```text
C:\Users\SILIUS\Documents\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini
```

> Si tu usuario de Windows tiene otro nombre, sustituye `SILIUS`.

El archivo debe contener al menos:

```ini
[TAGame.MatchStatsExporter_TA]
Port=49123
WebPort=49124
PacketSendRate=10

[IniVersion]
0=1785885193.000000
```

**Importante:** `PacketSendRate=0` desactiva la Stats API. Usa un valor positivo como `10` para que RL MMR Tracker pueda detectar el final de la partida.

### Despues de modificar el archivo

1. Cierra completamente Rocket League.
2. Guarda `TAStatsAPI.ini`.
3. Abre Rocket League nuevamente.
4. Inicia RL MMR Tracker.
5. Verifica que aparezca:
   ```text
   Rocket League Stats API conectada. Deteccion de fin de partida activa.
   ```

No es necesario cambiar `Port=49123` ni `WebPort=49124` salvo que tengas una configuracion diferente de forma intencionada.

### Que hace la Stats API?

Cuando termina una partida, Rocket League informa el resultado al tracker mediante la conexion local. El programa puede actualizar inmediatamente `📊 Hoy: X Ganados - Y Perdidos`. Tracker.gg sigue consultandose por separado para obtener el nuevo MMR.

---

## Guia de configuracion

### 1. Cuenta de juego

| Campo | Que poner |
|---|---|
| Plataforma | `Epic Games`, `Steam`, `PSN` o `Xbox Live` |
| Nombre de usuario | Tu nombre exacto en Rocket League |

### 2. StreamElements

1. Ve a [streamelements.com](https://streamelements.com) e inicia sesion.
2. Abre **Mi Cuenta / Channel settings / Channels**.
3. Copia el **JWT Token**.
4. Copia el **Account ID / Channel ID** del canal donde esta activo el bot.

> Mezclar el Account ID de una plataforma con el bot activo en otra puede causar errores de conexion.

### 3. Comando de chat

Indica el nombre del comando que usaran los viewers, por ejemplo `rangoo` para `!rangoo`.

---

## Intervalos de actualizacion y rendimiento

El intervalo normal por defecto es de **10 segundos**. Se mantiene un minimo de 5 segundos y un maximo de 30 segundos para limitar la frecuencia de consultas normales a Tracker.gg.

Durante una partida, la app no necesita consultar continuamente Tracker.gg para saber si ganaste o perdiste: Rocket League Stats API informa el final de la partida. Al terminar, se activa una vigilancia especifica de Tracker.gg para detectar el nuevo MMR.

### Vigilancia post-partida

Las consultas rapidas se realizan con este esquema:

```text
2 / 2 / 4 / 4 / 7 / 7 / 12 / 12 / 20 / 20 / 30 / 30 / 45 / 45 / 60 / 90 / 120 / 180 / 240 / 300s
```

El proceso se detiene inmediatamente cuando Tracker.gg publica el nuevo MMR. Si no hay cambio, continua hasta un maximo de 5 minutos.

Durante esta vigilancia se pausa temporalmente el polling normal para evitar consultas duplicadas.

### Resultados reales de las 22 partidas probadas

Se realizaron **22 partidas reales de prueba**. La siguiente tabla toma como referencia la hora de `🏁 Fin de partida detectado` y la hora de `📈 MMR confirmado por Tracker.gg`.

| Partida | Resultado | Tiempo hasta MMR |
| -------: | :-------- | ---------------: |
| 1 | 🏆 Victoria (+9) | **4 min 06 s** |
| 2 | 🏆 Victoria (+9) | 3 s |
| 3 | ❌ Derrota (-9) | 3 s |
| 4 | 🏆 Victoria (+9) | 3 s |
| 5 | ❌ Derrota (-9) | **1 min 14 s** |
| 6 | 🏆 Victoria (+9) | 10 s |
| 7 | ❌ Derrota (-10) | 2 s |
| 8 | 🏆 Victoria (+10) | 3 s |
| 9 | ❌ Derrota (-9) | 2 s |
| 10 | 🏆 Victoria (+9) | **42 s** |
| 11 | 🏆 Victoria (+9) | **2 min 37 s** |
| 12 | ❌ Derrota (-9) | **31 s** |
| 13 | ❌ Derrota (-10) | 3 s |
| 14 | ❌ Derrota (-9) | 3 s |
| 15 | ❌ Derrota (-19) | 3 s |
| 16 | ❌ Derrota (-9) | 3 s |
| 17 | ❌ Derrota (-9) | 2 s |
| 18 | 🏆 Victoria (+9) | 3 s |
| 19 | 🏆 Victoria (+9) | 2 s |
| 20 | ❌ Derrota (-9) | 30 s |
| 21 | ❌ Derrota (-18) | 3 s |
| 22 | 🏆 Victoria (+8) | 3 s |

### Resumen de las 22 pruebas

- **Minimo observado:** 2 segundos.
- **Mayoria de partidas:** 2-3 segundos.
- **Muchas partidas:** dentro de los primeros 10 segundos.
- Casos mas lentos observados: **31 s**, **42 s**, **1 min 14 s**, **2 min 37 s** y **4 min 06 s**.
- El resultado Ganado/Perdido se publica **inmediatamente al terminar la partida**, sin depender del retraso de Tracker.gg.
- Cuando Tracker.gg ya tiene publicado el nuevo MMR, el tracker normalmente lo detecta en las primeras consultas.
- Cuando Tracker.gg todavia no lo ha publicado, la vigilancia continua automaticamente hasta 5 minutos.

> Estos tiempos son observaciones de pruebas reales y no una garantia de tiempo fijo. El tiempo de actualizacion del MMR depende de cuando Tracker.gg publique el nuevo resultado.

### Resumen practico

| Dato | Comportamiento observado |
|---|---|
| 🏁 Fin de partida | Inmediato |
| 🏆 Victoria / ❌ Derrota | Inmediato, antes de Tracker.gg |
| 📊 Contador diario | Inmediato |
| 📈 MMR de Tracker.gg | Generalmente 2-10 s, pero puede tardar mas |
| ⏱️ Vigilancia maxima | **5 minutos** |

### Mensajes al terminar una partida

La consola mantiene estos mensajes propios del resultado inmediato:

```text
🏁 Fin de partida detectado.
❌ Derrota detectada desde Rocket League.
📡 Publicando resultado en StreamElements...
✅ Resultado Ganado/Perdido actualizado en StreamElements.
```

Para una victoria, el segundo mensaje sera:

```text
🏆 Victoria detectada desde Rocket League.
```

Los mensajes de las consultas de Tracker.gg permanecen sin cambios.

### Consumo de recursos

El tracker esta disenado para correr en segundo plano sin afectar tu juego ni tu internet.

| Recurso | Consumo aproximado |
|---|---|
| **RAM** | ~180-250 MB (Electron + Chromium headless) |
| **CPU** | <1% en reposo. Pico de 5-10% durante el scraping |
| **Red** | Depende del scraping y de las consultas post-partida |
| **Disco** | Escritura local de configuracion y cache |

Las consultas rapidas post-partida son temporales y se detienen cuando Tracker.gg publica el MMR o al llegar a 5 minutos.

---

## Sobre los modos

Los modos se detectan automaticamente desde Tracker.gg. Si Psyonix agrega o elimina un modo, la app lo refleja en el siguiente ciclo.

---

## Ejemplo del comando en chat

### Solo Modos
```text
🚀 Ranked Doubles 2v2: Champion II (1197) | Ranked Standard 3v3: Champion I (1162) | 📊 Hoy: 4 Ganados - 1 Perdidos
```

### Solo Estadisticas
```text
🚀 ⚽ 15,325 Goles | 🎯 34,176 Tiros | 🛡️ 13,818 Salvadas | 🤝 7,134 Asistencias
```

### Ambos
```text
🚀 Ranked Doubles 2v2: Champion II (1197) | ⚽ 15,325 Goles | 🎯 34,176 Tiros | 📊 Hoy: 4 Ganados - 1 Perdidos
```

---

## OBS Overlays

### Vista de Perfil Completo
**URL:** `http://localhost:3030/obs/profile`

Muestra:
- Estadisticas de carrera
- Rango mayor alcanzado
- Todos los modos ranqueados

**Configuracion en OBS:**
1. Fuentes → + → Fuente de navegador
2. URL: `http://localhost:3030/obs/profile`
3. Tamaño recomendado: 1200×900 px

### Otras vistas
Abre:
```text
http://localhost:3030
```

El puerto por defecto es `3030` y puede cambiarse desde Configuracion → OBS Overlay.

---

## Limitaciones Importantes

### Estadisticas por Temporada

Las estadisticas mostradas (Tiros, Goles, Salvadas, Asistencias, MVPs, Ganados) son de toda la carrera (lifetime), no solo de la temporada actual.

**Lo que SI esta disponible por temporada:**
- Partidos jugados
- Racha de victorias/derrotas
- Pico de MMR alcanzado
- Rango actual

**Lo que NO esta disponible por temporada:**
- Tiros
- Goles
- Salvadas
- Tiempo jugado
- % de victorias exacto

Esto depende de las APIs publicas disponibles.

---

## Estructura del proyecto

```text
rl-mmr-tracker/
├── main.js                    # Proceso principal de Electron
├── preload.js                 # Puente IPC seguro
├── scraper.js                 # Scraper de tracker.gg
├── streamElements.js          # Cliente API de StreamElements
├── sessionTracker.js          # Contador de ganados/perdidos
├── rlStatsApi.js              # Listener local de Rocket League Stats API
├── obs-server.js              # Servidor HTTP para overlays de OBS
├── renderer/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── assets/
│   └── screenshots/
├── Iniciar.bat
├── package.json
└── .gitignore
```

> **Seguridad:** `config.json` contiene datos de configuracion y tokens locales y esta en `.gitignore`.

---

## Construir instalador .exe

```bash
npm run dist
```

El instalador aparece en la carpeta `dist/`.

---

## Licencia

MIT
