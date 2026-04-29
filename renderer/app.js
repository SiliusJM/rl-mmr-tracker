'use strict';

/* ── State ── */
let running        = false;
let availableModes = [];           // last known list of mode objects from the API
let currentSelectedIds = [10, 11, 13, 28]; // mirrors config.selectedModeIds

/* ── DOM refs ── */
const btnToggle        = document.getElementById('btn-toggle');
const btnSettings      = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSave          = document.getElementById('btn-save');
const btnTest          = document.getElementById('btn-test');
const settingsOverlay  = document.getElementById('settings-overlay');
const statusDot        = document.getElementById('status-dot');
const statusLabel      = document.getElementById('status-label');
const logList          = document.getElementById('log-list');
const testResult       = document.getElementById('test-result');
const cardsSection     = document.getElementById('cards-section');
const recordSection    = document.getElementById('record-section');

/* ── Status ── */
function setStatus(state) {
  running = state === 'running';
  statusDot.className = `dot dot-${state}`;
  statusLabel.textContent = { off: 'Detenido', loading: 'Iniciando…', running: 'Activo' }[state] || 'Detenido';
  btnToggle.textContent = running ? '⏹ DETENER' : '▶ INICIAR';
  btnToggle.className   = `btn-toggle ${running ? 'stop' : 'start'}`;
  btnToggle.disabled    = state === 'loading';
}

/* ── Log ── */
function addLog({ msg, type = 'info', time = new Date().toLocaleTimeString() }) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
  logList.appendChild(entry);
  logList.scrollTop = logList.scrollHeight;
  while (logList.children.length > 200) logList.removeChild(logList.firstChild);
}

/* ── Rank cards ── */
function renderCards(modes, selectedIds) {
  cardsSection.innerHTML = '';
  for (const mode of modes) {
    const selected = selectedIds.includes(mode.id);
    const card = document.createElement('div');
    card.className = `mode-card${selected ? ' active' : ' dimmed'}`;
    const iconHtml  = mode.iconUrl ? `<img class="rank-icon" src="${mode.iconUrl}" alt="${mode.rank}">` : '';
    const badgeHtml = selected ? '' : '<div class="mode-badge">No en Twitch</div>';
    card.innerHTML = `
      <div class="mode-label">${mode.name}</div>
      ${iconHtml}
      <div class="mode-rank">${mode.rank}</div>
      <div class="mode-mmr">${mode.mmr} MMR</div>
      ${badgeHtml}
    `;
    cardsSection.appendChild(card);
  }
}

/* ── Settings ── */
function refreshModeChecklist(selectedIds) {
  const checklist = document.getElementById('modes-checklist');
  if (!checklist) return;
  if (availableModes.length === 0) {
    checklist.innerHTML = '<p class="hint">Inicia el tracker una vez para ver los modos disponibles.</p>';
    return;
  }
  checklist.innerHTML = '';
  for (const mode of availableModes) {
    const label = document.createElement('label');
    label.className = 'mode-check-label';
    const checked = (selectedIds || []).includes(mode.id) ? 'checked' : '';
    label.innerHTML = `<input type="checkbox" class="mode-check" data-id="${mode.id}" ${checked}><span>${mode.name}</span>`;
    checklist.appendChild(label);
  }
}

async function openSettings() {
  // Load config and modes cache in parallel for speed
  const [cfg, cached] = await Promise.all([
    window.tracker.loadConfig(),
    window.tracker.getModesCache(),
  ]);

  document.getElementById('cfg-platform').value = cfg.platform || 'epic';
  document.getElementById('cfg-username').value  = decodeURIComponent(cfg.username || '');
  document.getElementById('cfg-token').value     = cfg.streamElementsToken || '';
  document.getElementById('cfg-channelid').value = cfg.channelId || '';
  document.getElementById('cfg-command').value   = cfg.commandName || 'rango';
  document.getElementById('cfg-interval').value  = Math.round((cfg.pollInterval || 60000) / 1000);
  document.getElementById('cfg-show-record').checked = cfg.showRecord !== false;

  const selectedIds = cfg.selectedModeIds || [10, 11, 13, 28];

  // Use in-memory modes if available, fall back to on-disk cache
  if (availableModes.length === 0 && cached && cached.length > 0) {
    availableModes = cached;
  }

  refreshModeChecklist(selectedIds);

  testResult.className = 'test-result hidden';
  settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

function readSettingsForm() {
  const checked = [...document.querySelectorAll('.mode-check:checked')].map(el => parseInt(el.dataset.id, 10));
  return {
    platform:            document.getElementById('cfg-platform').value.trim(),
    username:            document.getElementById('cfg-username').value.trim(),
    streamElementsToken: document.getElementById('cfg-token').value.trim(),
    channelId:           document.getElementById('cfg-channelid').value.trim(),
    commandName:         document.getElementById('cfg-command').value.trim() || 'rango',
    pollInterval:        Math.max(30, parseInt(document.getElementById('cfg-interval').value, 10) || 60) * 1000,
    selectedModeIds:     checked.length > 0 ? checked : currentSelectedIds,
    showRecord:          document.getElementById('cfg-show-record').checked,
  };
}

async function saveSettings() {
  const cfg = readSettingsForm();
  if (!cfg.username)            { alert('Ingresa tu nombre de usuario en el juego.'); return; }
  if (!cfg.streamElementsToken) { alert('Ingresa tu StreamElements JWT Token.'); return; }
  if (!cfg.channelId)           { alert('Ingresa tu Channel ID de StreamElements.'); return; }
  await window.tracker.saveConfig(cfg);
  currentSelectedIds = cfg.selectedModeIds;
  addLog({ msg: 'Configuración guardada.', type: 'success' });
  if (availableModes.length > 0) renderCards(availableModes, currentSelectedIds);
  closeSettings();
  // If tracker is running, apply changes immediately without waiting for next cycle
  if (running) {
    addLog({ msg: 'Aplicando cambios al comando de Twitch...', type: 'info' });
    window.tracker.forcePoll();
  }
}

async function testConnection() {
  const cfg = readSettingsForm();
  if (!cfg.streamElementsToken || !cfg.channelId) {
    testResult.className   = 'test-result err';
    testResult.textContent = '✗ Completa el Token y el Channel ID antes de probar.';
    return;
  }
  testResult.className   = 'test-result';
  testResult.textContent = '⏳ Probando…';
  const ok = await window.tracker.testConnection({
    channelId:           cfg.channelId,
    streamElementsToken: cfg.streamElementsToken,
    commandName:         cfg.commandName,
  });
  testResult.className   = `test-result ${ok ? 'ok' : 'err'}`;
  testResult.textContent = ok
    ? '✔ Conexión exitosa con StreamElements.'
    : '✗ No se pudo conectar. Verifica el token y el Channel ID.';
}

/* ── Toggle eye (password field) ── */
document.getElementById('btn-eye-token').addEventListener('click', function () {
  const el = document.getElementById('cfg-token');
  if (el.type === 'password') { el.type = 'text';     this.textContent = '🙈'; }
  else                        { el.type = 'password'; this.textContent = '👁';  }
});

/* ── Tracker controls ── */
async function startTracker() {
  setStatus('loading');
  const ok = await window.tracker.startTracker();
  if (!ok) setStatus('off');
}

async function stopTracker() {
  await window.tracker.stopTracker();
  setStatus('off');
}

/* ── IPC listeners ── */
window.tracker.onLog(addLog);

window.tracker.onTrackerState(({ running: r }) => setStatus(r ? 'running' : 'off'));

window.tracker.onDataUpdate(({ modes, session, selectedModeIds, showRecord }) => {
  availableModes     = modes;
  currentSelectedIds = selectedModeIds || [10, 11, 13, 28];
  renderCards(modes, currentSelectedIds);

  // Only populate checklist if settings is open AND no checkboxes exist yet
  // (i.e. still showing placeholder). Never overwrite edits in progress.
  if (!settingsOverlay.classList.contains('hidden') &&
      !document.querySelector('.mode-check')) {
    refreshModeChecklist(currentSelectedIds);
  }
  if (showRecord) {
    recordSection.style.display = '';
    document.getElementById('record-wins').textContent   = session.wins;
    document.getElementById('record-losses').textContent = session.losses;
  } else {
    recordSection.style.display = 'none';
  }
});

/* ── Event listeners ── */
btnToggle.addEventListener('click', () => { if (running) stopTracker(); else startTracker(); });
btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
btnSave.addEventListener('click', saveSettings);
btnTest.addEventListener('click', testConnection);
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });

/* ── Init ── */
window.tracker.loadConfig().then(cfg => { currentSelectedIds = cfg.selectedModeIds || [10, 11, 13, 28]; });
window.tracker.getStatus().then(({ running, data }) => {
  if (running) setStatus('running');
  if (data) {
    availableModes     = data.modes;
    currentSelectedIds = data.selectedModeIds || [10, 11, 13, 28];
    renderCards(data.modes, currentSelectedIds);
    if (data.showRecord) {
      recordSection.style.display = '';
      document.getElementById('record-wins').textContent   = data.session.wins;
      document.getElementById('record-losses').textContent = data.session.losses;
    } else {
      recordSection.style.display = 'none';
    }
  }
});
addLog({ msg: 'Listo. Configura tu cuenta y presiona INICIAR.', type: 'info' });
