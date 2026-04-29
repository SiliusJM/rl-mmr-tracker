'use strict';

/**
 * StreamElements API Client
 *
 * Uses Node's built-in `https` module — zero external dependencies.
 *
 * Create flow: POST /kappa/v2/bot/commands/{channelId}
 * Update flow: POST → 409 → GET list → find _id → PUT /kappa/v2/bot/commands/{channelId}/{_id}
 *
 * Auth: Bearer token in Authorization header.
 */

const https = require('https');

/** Generic HTTPS request helper — returns { status, body } */
function httpsRequest(options, bodyData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('HTTPS timeout (15s)')); });
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

const AUTH_HEADERS = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Content-Type':  'application/json',
  'Accept':        'application/json',
});

/**
 * Fetch the internal _id for an existing command by name.
 * Returns the _id string or null.
 */
async function getCommandId(channelId, commandName, token) {
  const { status, body } = await httpsRequest({
    hostname: 'api.streamelements.com',
    path:     `/kappa/v2/bot/commands/${channelId}`,
    method:   'GET',
    headers:  { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });

  if (status !== 200) {
    console.error(`[ERROR] GET commands fallo — HTTP ${status}`);
    return null;
  }

  let list;
  try { list = JSON.parse(body); } catch { return null; }
  // Handle both bare array and { data: [...] } envelope
  if (list && !Array.isArray(list) && Array.isArray(list.data)) list = list.data;
  if (!Array.isArray(list)) { console.error('[ERROR] GET commands: respuesta inesperada'); return null; }

  const target = `!${commandName}`;
  const found  = list.find((c) => c.command === target || c.command === commandName);
  return found ? found._id : null;
}

/**
 * Update or create the StreamElements `!{commandName}` command.
 *
 * @param {string} channelId    - StreamElements channel ID
 * @param {string} commandName  - Command name WITHOUT the "!" prefix
 * @param {string} token        - StreamElements JWT Bearer token
 * @param {string} response     - New response text for the command
 * @returns {Promise<boolean>}  - true = success, false = API error
 */
async function updateCommand(channelId, commandName, token, response) {
  const payload = JSON.stringify({ command: `!${commandName}`, reply: response, enabled: true });
  const hdrs    = AUTH_HEADERS(token);
  hdrs['Content-Length'] = Buffer.byteLength(payload);

  // ── Try POST (create) ─────────────────────────────────────────────────────
  const post = await httpsRequest({
    hostname: 'api.streamelements.com',
    path:     `/kappa/v2/bot/commands/${channelId}`,
    method:   'POST',
    headers:  hdrs,
  }, payload);

  if (post.status >= 200 && post.status < 300) {
    console.log('[INFO] StreamElements actualizado correctamente (POST).');
    return true;
  }

  if (post.status !== 409) {
    console.error(`[ERROR] POST fallo — HTTP ${post.status} | ${post.body.substring(0, 200)}`);
    if (post.status === 401)
      console.error('[ERROR] Token invalido o expirado. Revisa config.json → streamElementsToken');
    return false;
  }

  // ── 409: command exists — GET its internal _id then PUT ──────────────────
  const commandId = await getCommandId(channelId, commandName, token);
  if (!commandId) {
    console.error('[ERROR] No se pudo obtener el _id del comando existente.');
    return false;
  }

  const put = await httpsRequest({
    hostname: 'api.streamelements.com',
    path:     `/kappa/v2/bot/commands/${channelId}/${commandId}`,
    method:   'PUT',
    headers:  hdrs,
  }, payload);

  if (put.status >= 200 && put.status < 300) {
    console.log('[INFO] StreamElements actualizado correctamente (PUT).');
    return true;
  }

  console.error(`[ERROR] PUT fallo — HTTP ${put.status} | ${put.body.substring(0, 200)}`);
  if (put.status === 401)
    console.error('[ERROR] Token invalido o expirado. Revisa config.json → streamElementsToken');
  return false;
}


/**
 * Sends a harmless test message to verify credentials and connectivity.
 * Called ONCE at startup before the polling loop begins.
 *
 * @param {string} channelId
 * @param {string} commandName
 * @param {string} token
 * @returns {Promise<boolean>}
 */
async function testStreamElementsConnection(channelId, commandName, token) {
  console.log('[INFO] Probando conexion con StreamElements...');

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.streamelements.com',
      path:     '/kappa/v2/channels/me',
      method:   'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[INFO] Test de conexion StreamElements: EXITOSO ✅');
          return resolve(true);
        }
        if (res.statusCode === 401) {
          console.error('[ERROR] Token invalido o expirado (401). Renueva streamElementsToken en config.json.');
        } else {
          console.error(`[ERROR] Test de conexion StreamElements: HTTP ${res.statusCode}`);
        }
        resolve(false);
      });
    });

    req.on('error', (err) => {
      console.error('[ERROR] Test de conexion StreamElements: Error de red —', err.message);
      resolve(false);
    });
    req.setTimeout(10000, () => {
      req.destroy();
      console.error('[ERROR] Test de conexion StreamElements: Timeout');
      resolve(false);
    });
    req.end();
  });
}

module.exports = { updateCommand, testStreamElementsConnection };
