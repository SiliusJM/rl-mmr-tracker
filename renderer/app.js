'use strict';

/* ── State ── */
let running        = false;
let availableModes = [];
let currentSelectedIds = [10, 11, 13, 28];

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
const prev1Section     = document.getElementById('prev1-section');
const prev2Section     = document.getElementById('prev2-section');
const prev1Cards       = document.getElementById('prev1-cards');
const prev2Cards       = document.getElementById('prev2-cards');

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
function renderCards(container, modes, selectedIds, dimClass) {
  container.innerHTML = '';
  for (const mode of modes) {
    const selected = selectedIds.includes(mode.id);
    const card = document.createElement('div');
    const cls  = dimClass || (selected ? 'active' : 'dimmed');
    card.className = `mode-card ${cls}`;
    const iconHtml  = mode.iconUrl ? `<img class="rank-icon" src="${mode.iconUrl}" alt="${mode.rank}">` : '';
    const badgeHtml = (!dimClass && !selected) ? '<div class="mode-badge">No en Twitch</div>' : '';
    card.innerHTML = `
      <div class="mode-label">${mode.name}</div>
      ${iconHtml}
      <div class="mode-rank">${mode.rank}</div>
      <div class="mode-mmr">${mode.mmr} MMR</div>
      ${badgeHtml}
    `;
    container.appendChild(card);
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
  const [cfg, cached, obsInfo] = await Promise.all([
    window.tracker.loadConfig(),
    window.tracker.getModesCache(),
    window.tracker.getObsInfo(),
  ]);

  document.getElementById('cfg-platform').value  = cfg.platform || 'epic';
  document.getElementById('cfg-username').value   = decodeURIComponent(cfg.username || '');
  document.getElementById('cfg-token').value      = cfg.streamElementsToken || '';
  document.getElementById('cfg-channelid').value  = cfg.channelId || '';
  document.getElementById('cfg-command').value    = cfg.commandName || 'rango';
  document.getElementById('cfg-interval').value   = Math.round((cfg.pollInterval || 60000) / 1000);
  document.getElementById('cfg-show-record').checked = cfg.showRecord !== false;
  document.getElementById('cfg-show-prev1').checked  = cfg.showPrevSeason1 !== false;
  document.getElementById('cfg-show-prev2').checked  = cfg.showPrevSeason2 === true;
  document.getElementById('cfg-obs-port').value      = obsInfo.port || cfg.obsPort || 3030;
  document.getElementById('cfg-obs-enabled').checked = cfg.obsEnabled !== false;

  // Nuevas opciones de Twitch
  document.getElementById('cfg-twitch-format').value = cfg.twitchCommandFormat || 'modes';
  document.getElementById('cfg-twitch-show-stats').checked = cfg.twitchShowStats || false;
  
  // Checkbox de estadísticas
  const statsToShow = cfg.twitchStatsToShow || [];
  document.querySelectorAll('.stat-check').forEach(cb => {
    cb.checked = statsToShow.includes(cb.dataset.stat);
  });
  
  // Mostrar/ocultar selector de stats
  toggleStatsSelector();

  // OBS index URL
  const obsPort = obsInfo.port || cfg.obsPort || 3030;
  const obsUrl  = `http://localhost:${obsPort}`;
  const obsLink = document.getElementById('obs-index-link');
  if (obsLink) {
    obsLink.href        = obsUrl;
    obsLink.textContent = obsUrl;
  }

  const selectedIds = cfg.selectedModeIds || [10, 11, 13, 28];
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
  const statsChecked = [...document.querySelectorAll('.stat-check:checked')].map(el => el.dataset.stat);
  
  return {
    platform:            document.getElementById('cfg-platform').value.trim(),
    username:            document.getElementById('cfg-username').value.trim(),
    streamElementsToken: document.getElementById('cfg-token').value.trim(),
    channelId:           document.getElementById('cfg-channelid').value.trim(),
    commandName:         document.getElementById('cfg-command').value.trim() || 'rango',
    pollInterval:        Math.max(30, parseInt(document.getElementById('cfg-interval').value, 10) || 60) * 1000,
    selectedModeIds:     checked.length > 0 ? checked : currentSelectedIds,
    showRecord:          document.getElementById('cfg-show-record').checked,
    showPrevSeason1:     document.getElementById('cfg-show-prev1').checked,
    showPrevSeason2:     document.getElementById('cfg-show-prev2').checked,
    obsPort:             Math.max(1024, Number.parseInt(document.getElementById('cfg-obs-port').value, 10) || 3030),
    obsEnabled:          document.getElementById('cfg-obs-enabled').checked,
    twitchCommandFormat: document.getElementById('cfg-twitch-format').value,
    twitchShowStats:     document.getElementById('cfg-twitch-show-stats').checked,
    twitchStatsToShow:   statsChecked,
  };
}

async function saveSettings() {
  const cfg = readSettingsForm();
  if (!cfg.username)            { alert('Ingresa tu nombre de usuario en el juego.'); return; }
  if (!cfg.streamElementsToken) { alert('Ingresa tu StreamElements JWT Token.'); return; }
  if (!cfg.channelId)           { alert('Ingresa tu Channel ID de StreamElements.'); return; }
  currentSelectedIds = cfg.selectedModeIds;
  closeSettings();

  await window.tracker.saveConfig(cfg);
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

/* ── Toggle stats selector ── */
function toggleStatsSelector() {
  const showStats = document.getElementById('cfg-twitch-show-stats').checked;
  const format = document.getElementById('cfg-twitch-format').value;
  const statsGroup = document.getElementById('stats-selector-group');
  const statsToggleGroup = document.getElementById('twitch-stats-toggle-group');
  const statsCheckbox = document.getElementById('cfg-twitch-show-stats');
  
  // Si el formato es "modes", deshabilitar el checkbox y ocultar todo
  if (format === 'modes') {
    if (statsCheckbox) {
      statsCheckbox.disabled = true;
      statsCheckbox.checked = false;
    }
    if (statsToggleGroup) {
      statsToggleGroup.style.opacity = '0.5';
      statsToggleGroup.style.pointerEvents = 'none';
    }
    if (statsGroup) {
      statsGroup.style.display = 'none';
    }
  } else {
    // Habilitar el checkbox para otros formatos
    if (statsCheckbox) {
      statsCheckbox.disabled = false;
    }
    if (statsToggleGroup) {
      statsToggleGroup.style.opacity = '1';
      statsToggleGroup.style.pointerEvents = 'auto';
    }
    // Mostrar selector solo si showStats está marcado
    if (statsGroup) {
      statsGroup.style.display = (showStats && (format === 'stats' || format === 'both')) ? '' : 'none';
    }
  }
}

document.getElementById('cfg-twitch-show-stats').addEventListener('change', toggleStatsSelector);
document.getElementById('cfg-twitch-format').addEventListener('change', toggleStatsSelector);

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

/* ── Season section helper ── */
function applySeasonSection(section, cardsEl, modes, selectedIds, cssClass, visible) {
  if (!section) return;
  section.classList.toggle('hidden', !visible);
  if (visible && modes) renderCards(cardsEl, modes, selectedIds, cssClass);
}

window.tracker.onDataUpdate(({ modes, prevSeason1, prevSeason2, session, selectedModeIds, showRecord, showPrevSeason1, showPrevSeason2 }) => {
  try {
    availableModes     = modes;
    currentSelectedIds = selectedModeIds || [10, 11, 13, 28];

    renderCards(cardsSection, modes, currentSelectedIds, null);

    applySeasonSection(prev1Section, prev1Cards, prevSeason1, currentSelectedIds, 'prev1',
      showPrevSeason1 && Array.isArray(prevSeason1) && prevSeason1.length > 0);
    applySeasonSection(prev2Section, prev2Cards, prevSeason2, currentSelectedIds, 'prev2',
      showPrevSeason2 && Array.isArray(prevSeason2) && prevSeason2.length > 0);

    if (!settingsOverlay.classList.contains('hidden') && !document.querySelector('.mode-check')) {
      refreshModeChecklist(currentSelectedIds);
    }

    const sec = document.getElementById('record-section');
    if (sec) {
      sec.style.display = showRecord ? '' : 'none';
      if (showRecord) {
        document.getElementById('record-wins').textContent   = session.wins;
        document.getElementById('record-losses').textContent = session.losses;
      }
    }
  } catch (err) {
    console.error('[onDataUpdate]', err);
  }
});

/* ── Event listeners ── */
document.getElementById('btn-clear-log').addEventListener('click', () => { logList.innerHTML = ''; });
btnToggle.addEventListener('click', () => { if (running) stopTracker(); else startTracker(); });
btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
btnSave.addEventListener('click', saveSettings);
btnTest.addEventListener('click', testConnection);
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });

// OBS copy button
const btnCopyObs = document.getElementById('btn-copy-obs');
if (btnCopyObs) {
  btnCopyObs.addEventListener('click', () => {
    const link = document.getElementById('obs-index-link');
    if (link) {
      navigator.clipboard.writeText(link.href).catch(() => {});
      btnCopyObs.textContent = '✔';
      setTimeout(() => { btnCopyObs.textContent = '📋'; }, 1500);
    }
  });
}

/* ── Init ── */
window.tracker.loadConfig().then(cfg => { currentSelectedIds = cfg.selectedModeIds || [10, 11, 13, 28]; });
window.tracker.getStatus().then(({ running: r, data }) => {
  if (r) setStatus('running');
  if (data) {
    availableModes     = data.modes;
    currentSelectedIds = data.selectedModeIds || [10, 11, 13, 28];
    renderCards(cardsSection, data.modes, currentSelectedIds, null);
    const sec = document.getElementById('record-section');
    if (sec) {
      sec.style.display = data.showRecord ? '' : 'none';
      if (data.showRecord && data.session) {
        document.getElementById('record-wins').textContent   = data.session.wins;
        document.getElementById('record-losses').textContent = data.session.losses;
      }
    }
  }
});
addLog({ msg: 'Listo. Configura tu cuenta y presiona INICIAR.', type: 'info' });
