'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tracker', {
  loadConfig:     ()    => ipcRenderer.invoke('load-config'),
  saveConfig:     (cfg) => ipcRenderer.invoke('save-config', cfg),
  testConnection: (cfg) => ipcRenderer.invoke('test-connection', cfg),
  startTracker:   ()    => ipcRenderer.invoke('start-tracker'),
  stopTracker:    ()    => ipcRenderer.invoke('stop-tracker'),
  getStatus:      ()    => ipcRenderer.invoke('get-status'),
  getModesCache:  ()    => ipcRenderer.invoke('get-modes-cache'),
  forcePoll:      ()    => ipcRenderer.invoke('force-poll'),

  onLog:          (cb) => ipcRenderer.on('log',           (_e, d) => cb(d)),
  onTrackerState: (cb) => ipcRenderer.on('tracker-state', (_e, d) => cb(d)),
  onDataUpdate:   (cb) => ipcRenderer.on('data-update',   (_e, d) => cb(d)),
});
