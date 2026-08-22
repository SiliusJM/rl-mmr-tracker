'use strict';

/**
 * Rocket League official Stats API listener.
 *
 * The game exposes a local TCP JSON stream when TAStatsAPI.ini is enabled.
 * We only consume lifecycle events here; normal MMR scraping remains in scraper.js.
 */

const net = require('net');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 49123;

let socket = null;
let reconnectTimer = null;
let stopped = true;
let buffer = '';
let handlers = new Map();
let options = {};

function emit(event, data) {
  const listeners = handlers.get(event) || [];
  for (const listener of listeners) {
    try { listener(data); } catch (err) {
      console.warn(`[RL Stats API] Error en listener ${event}:`, err.message);
    }
  }
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  // Keep an incomplete object for the next TCP chunk.
  if (depth > 0 && start >= 0) return { objects, remainder: text.slice(start) };
  return { objects, remainder: '' };
}

function processChunk(chunk) {
  buffer += chunk.toString('utf8');
  const parsed = extractJsonObjects(buffer);
  buffer = parsed.remainder;

  for (const raw of parsed.objects) {
    try {
      const envelope = JSON.parse(raw);
      const event = envelope?.Event;
      if (!event) continue;

      let data = envelope.Data;
      // Current builds expose Data as a JSON-encoded string.
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { /* keep raw value */ }
      }

      emit(event, data || {});
      emit('*', { event, data: data || {} });
    } catch (err) {
      console.warn('[RL Stats API] Paquete JSON invalido:', err.message);
    }
  }
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = Number(options.reconnectDelayMs) || 3000;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (stopped || socket) return;

  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port) || DEFAULT_PORT;
  const client = new net.Socket();
  socket = client;
  buffer = '';

  client.setNoDelay(true);
  client.setTimeout(Number(options.connectTimeoutMs) || 5000);

  client.on('connect', () => {
    client.setTimeout(0);
    console.log(`[RL Stats API] Conectado a ${host}:${port}`);
    emit('connected', { host, port });
  });

  client.on('data', processChunk);

  client.on('timeout', () => {
    client.destroy(new Error('Timeout conectando con Rocket League Stats API'));
  });

  client.on('error', err => {
    // ECONNREFUSED is expected when Rocket League is closed or Stats API is disabled.
    if (err.code !== 'ECONNREFUSED') {
      console.warn('[RL Stats API] Error:', err.message);
    }
    emit('error', err);
  });

  client.on('close', () => {
    if (socket === client) socket = null;
    emit('disconnected');
    scheduleReconnect();
  });

  client.connect(port, host);
}

function start(opts = {}) {
  stop();
  options = { ...opts };
  stopped = false;
  connect();
}

function stop() {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.destroy();
    socket = null;
  }
  buffer = '';
}

function on(event, listener) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(listener);
  return () => off(event, listener);
}

function off(event, listener) {
  const listeners = handlers.get(event);
  if (listeners) listeners.delete(listener);
}

function isConnected() {
  return !!socket && !socket.destroyed;
}

module.exports = { start, stop, on, off, isConnected };
