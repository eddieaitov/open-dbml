/* global CodeMirror */

// ─────────────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────────────
const isWeb = typeof window !== 'undefined' && window.__WEB_MODE__ === true;

const state = {
  currentFilePath: null,           // full path of open DBML file (null = new)
  currentFileDisplayName: null,    // display name (filename only, for web mode)
  currentContent: '',              // last-saved content (for dirty check)
  tables: {},                      // { tableName: { name, columns[], colMap{} } }
  refs: [],                        // [{ from: {table,col}, to: {table,col} }]
  positions: {},                   // { tableName: { x, y, color } }
  isDirty: false,
  autosaveEnabled: true,
  debounceTimer: null,
  parseTimer: null,
  autosaveTimer: null,
};

// ── Zoom & Pan state ──────────────────────────────────────────────
let schemaZoom = 1;
let schemaPanX = 0;
let schemaPanY = 0;
let isPanning = false;
let panStartX, panStartY, panStartPanX, panStartPanY;

// ─────────────────────────────────────────────────────────────────────────────
//  DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  title:        document.querySelector('title'),
  fileLabel:    $('#file-label'),
  statusBar:    $('#parse-status'),
  cursorPos:    $('#cursor-pos'),
  editorContainer: $('#editor-container'),
  schemaCanvas: $('#schema-canvas'),
  tablesContainer: $('#tables-container'),
  connectionsSvg: $('#connections-svg'),
  emptyMsg:     $('#empty-schema-msg'),
  resizeHandle: $('#resize-handle'),
  btnNew:       $('#btn-new'),
  btnRecent:    $('#btn-recent'),
  recentDropdown: $('#recent-dropdown'),
  btnOpen:      $('#btn-open'),
  btnSave:      $('#btn-save'),
  btnSaveAs:    $('#btn-saveas'),
  btnArrange:   $('#btn-arrange'),
  chkAutosave:  $('#chk-autosave'),
  zoomIndicator: $('#zoom-indicator'),
  editorPanel:  $('#editor-panel'),
  schemaPanel:  $('#schema-panel'),
};

// ─────────────────────────────────────────────────────────────────────────────
//  FILE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

let ipcRenderer, fs, pathMod;
if (!isWeb) {
  const electron = require('electron');
  ipcRenderer = electron.ipcRenderer;
  fs = require('fs');
  pathMod = require('path');
}

// ── Electron: file dialogs via IPC ─────────────────────────────────────
async function electronOpenFile() {
  const res = await ipcRenderer.invoke('dialog:openFile');
  if (res.canceled) return;
  loadFile(res.filePath, res.content);
}

async function electronSaveFile() {
  if (!state.currentFilePath) return electronSaveAsFile();
  const content = editor.getValue();
  const res = await ipcRenderer.invoke('dialog:saveFile', { content, filePath: state.currentFilePath });
  if (res.canceled) return;
  state.currentContent = content;
  state.currentFilePath = res.filePath;
  markClean();
  updateTitle();
}

async function electronSaveAsFile() {
  const content = editor.getValue();
  const res = await ipcRenderer.invoke('dialog:saveFile', { content, filePath: null });
  if (res.canceled) return;
  state.currentContent = content;
  state.currentFilePath = res.filePath;
  markClean();
  updateTitle();
  savePositions(); // save positions alongside new file
}

// ── Web: file via browser APIs ─────────────────────────────────────────
function webOpenFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.dbml,.txt,.sql';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const content = await file.text();
    loadFile(file.name, content);
  };
  input.click();
}

function webSaveAsFile() {
  const content = editor.getValue();
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.currentFileDisplayName || 'schema.dbml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  state.currentContent = content;
  markClean();
  updateTitle();
  savePositions();
}

async function webSaveFile() {
  // В браузере Save и Save As работают одинаково (всегда диалог сохранения)
  webSaveAsFile();
}

// ── Unified API ────────────────────────────────────────────────────────
const openFile  = isWeb ? webOpenFile  : electronOpenFile;
const saveFile  = isWeb ? webSaveFile  : electronSaveFile;
const saveAsFile = isWeb ? webSaveAsFile : electronSaveAsFile;

function loadFile(filePath, content) {
  state.currentFilePath = isWeb ? null : filePath;
  state.currentFileDisplayName = isWeb ? filePath : (filePath ? pathMod.basename(filePath) : null);
  state.currentContent = content;
  editor.setValue(content);
  editor.clearHistory();
  markClean();
  updateTitle();
  loadPositions();
  parseAndRender();
  if (!isWeb && filePath) {
    updateLastFile(filePath);
    addRecentFile(filePath);
  }
}

function updateTitle() {
  const name = state.currentFileDisplayName
    || (state.currentFilePath ? pathMod.basename(state.currentFilePath) : null)
    || 'New File';
  const dirty = state.isDirty ? ' ●' : '';
  dom.fileLabel.textContent = `— ${name}${dirty}`;
  document.title = `${name}${dirty} — ui-db`;
}

function markClean() {
  state.isDirty = false;
  updateTitle();
}

function markDirty() {
  if (!state.isDirty) {
    state.isDirty = true;
    updateTitle();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  POSITION STORE
// ─────────────────────────────────────────────────────────────────────────────

function positionsPath() {
  if (isWeb) return null;
  if (!state.currentFilePath) return null;
  return state.currentFilePath + '.positions.json';
}

function loadPositions() {
  state.positions = {};
  if (isWeb) {
    try {
      const raw = localStorage.getItem('ui-db-positions');
      if (raw) state.positions = JSON.parse(raw);
    } catch (_) {}
  } else {
    const p = positionsPath();
    if (!p) return;
    try {
      if (fs.existsSync(p)) {
        state.positions = JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (_) {}
  }
}

function savePositions() {
  if (isWeb) {
    try {
      localStorage.setItem('ui-db-positions', JSON.stringify(state.positions));
    } catch (_) {}
  } else {
    const p = positionsPath();
    if (!p) return;
    try {
      fs.writeFileSync(p, JSON.stringify(state.positions, null, 2), 'utf-8');
    } catch (_) {}
  }
}

function getSavedPosition(tableName) {
  return state.positions[tableName] || null;
}

function setSavedPosition(tableName, x, y) {
  const existing = state.positions[tableName] || {};
  state.positions[tableName] = { ...existing, x, y };
  savePositions();
}

function removeSavedPosition(tableName) {
  delete state.positions[tableName];
  savePositions();
}

// ── App State (last file, recent files) ────────────────────────────
const APP_STATE_FILE = '.ui-db-state.json';

function appStatePath() {
  if (isWeb) return null;
  return pathMod.resolve(__dirname, '..', APP_STATE_FILE);
}

function loadAppState() {
  if (isWeb) {
    try { return JSON.parse(localStorage.getItem('ui-db-state') || '{}'); } catch { return {}; }
  }
  const fp = appStatePath();
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch {}
  return {};
}

function saveAppState(data) {
  if (isWeb) {
    try { localStorage.setItem('ui-db-state', JSON.stringify(data)); } catch {}
    return;
  }
  const fp = appStatePath();
  try { fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8'); } catch {}
}

function updateLastFile(filePath) {
  if (!filePath) return;
  const st = loadAppState();
  st.lastFile = filePath;
  saveAppState(st);
}

function addRecentFile(filePath) {
  if (!filePath || isWeb) return;
  const st = loadAppState();
  if (!st.recentFiles) st.recentFiles = [];
  // Remove duplicate
  st.recentFiles = st.recentFiles.filter(f => f !== filePath);
  // Add to front
  st.recentFiles.unshift(filePath);
  // Keep max 10
  if (st.recentFiles.length > 10) st.recentFiles.length = 10;
  saveAppState(st);
  renderRecentMenu();
}

function renderRecentMenu() {
  const menu = dom.recentDropdown;
  const st = loadAppState();
  const files = st.recentFiles || [];
  if (files.length === 0) {
    menu.innerHTML = '<div class="recent-empty">No recent files</div>';
    return;
  }
  menu.innerHTML = files.map(f =>
    `<div class="recent-item" data-path="${escapeHtml(f)}">${escapeHtml(pathMod.basename(f))}<span class="recent-path">${escapeHtml(f)}</span></div>`
  ).join('');
}

function getTableColor(tableName) {
  const pos = state.positions[tableName];
  return (pos && pos.color) || '#1f6feb';
}

function setTableColor(tableName, color) {
  if (!state.positions[tableName]) state.positions[tableName] = { x: 0, y: 0 };
  state.positions[tableName].color = color;
  savePositions();
}

// Palette: 16 pleasant colors
const TABLE_COLORS = [
  '#1f6feb', // blue (default)
  '#238636', // green
  '#d29922', // gold
  '#bd561d', // orange
  '#da3633', // red
  '#bc8cff', // purple
  '#39d2c0', // teal
  '#db61a2', // pink
  '#58a6ff', // light blue
  '#3fb950', // light green
  '#e3b341', // yellow
  '#f78166', // coral
  '#a371f7', // violet
  '#56d4dd', // cyan
  '#ff7b72', // salmon
  '#7ee787', // mint
];

// ── New file ────────────────────────────────────────────────────────
function newFile() {
  if (state.isDirty && !confirm('Discard unsaved changes and start a new schema?')) return;
  state.currentFilePath = null;
  state.currentFileDisplayName = null;
  state.currentContent = '';
  state.positions = {};
  editor.setValue('');
  editor.clearHistory();
  markClean();
  updateTitle();
  parseAndRender();
}

// ─────────────────────────────────────────────────────────────────────────────
//  DBML PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseDBML(text) {
  const tables = {};
  const refs = [];
  const errors = [];

  // ── Check unmatched braces ────────────────────────────────────────
  let depth = 0;
  let braceErrLine = -1;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; }
      else if (ch === '}') {
        depth--;
        if (depth < 0) { braceErrLine = i + 1; depth = 0; break; }
      }
    }
    if (braceErrLine > 0) break;
  }
  if (depth > 0) errors.push(`Unmatched opening brace { (missing })`);
  if (braceErrLine > 0) errors.push(`Extra closing brace } at line ${braceErrLine}`);

  // ── Remove comments ────────────────────────────────────────────────
  const clean = text.replace(/\/\/.*$/gm, '');

  // ── Match table blocks ─────────────────────────────────────────────
  const tableBlockRe = /Table\s+(\w[\w"]*)\s*\{([^}]*)\}/gi;
  let match;
  while ((match = tableBlockRe.exec(clean)) !== null) {
    const tableName = match[1].replace(/"/g, '');
    const body = match[2];
    const columns = [];

    const lines = body.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('Note') || line.startsWith('note')) {
        continue;
      }

      // Match: colName type [settings]
      const colRe = /^(\w[\w"]*)\s+([^\s\[\]]+)(?:\s+\[([^\]]*)\])?/;
      const cm = line.match(colRe);
      if (!cm) continue;

      const colName = cm[1].replace(/"/g, '');
      const colType = cm[2];
      const settings = (cm[3] || '').toLowerCase() + ' ' + (cm[3] || ''); // double for both-case checks

      const col = {
        name: colName,
        type: colType,
        pk: /\bpk\b/.test(settings),
        unique: /\bunique\b/.test(settings),
        notNull: /\bnot null\b/.test(settings),
        increment: /\bincrement\b/.test(settings),
        default: null,
        ref: null,
      };

      // default: `value`
      const defRe = /default:\s*`([^`]*)`/i;
      const dm = (cm[3] || '').match(defRe);
      if (dm) col.default = dm[1];

      // inline ref: ref: > target.table.col  or  ref: table.col
      const refRe = /ref:\s*[-]?\s*[>]?\s*(\w+)\.(\w+)/i;
      const rm = (cm[3] || '').match(refRe);
      if (rm) col.ref = { table: rm[1], column: rm[2] };

      columns.push(col);
    }

    tables[tableName] = { name: tableName, columns, colMap: {} };
    // Build column lookup
    for (const col of columns) {
      tables[tableName].colMap[col.name] = col;
    }
  }

  // ── Parse standalone refs:  Ref: from.col > to.col  ───────────────
  // Supports: Ref: table.col > table.col  and  Ref: table.col - table.col
  const refRe = /Ref:\s*(\w+)\.(\w+)\s*(?:[:0-9]*)\s*([<>]-?)\s*(\w+)\.(\w+)/gi;
  while ((match = refRe.exec(clean)) !== null) {
    refs.push({
      from: { table: match[1], column: match[2] },
      to:   { table: match[4], column: match[5] },
    });
  }

  // ── Also extract refs from inline column refs ──────────────────────
  for (const [tName, t] of Object.entries(tables)) {
    for (const col of t.columns) {
      if (col.ref) {
        refs.push({
          from: { table: tName, column: col.name },
          to:   col.ref,
        });
      }
    }
  }

  // ── Validate ref targets ──────────────────────────────────────────
  for (const ref of refs) {
    if (!tables[ref.from.table]) errors.push(`Undefined table "${ref.from.table}" in ref`);
    if (!tables[ref.to.table]) errors.push(`Undefined table "${ref.to.table}" in ref (used by ${ref.from.table})`);
  }

  return { tables, refs, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCHEMA VIEWER  (table cards + SVG connections)
// ─────────────────────────────────────────────────────────────────────────────

function renderSchema(tables, refs) {
  const container = dom.tablesContainer;
  const svg = dom.connectionsSvg;
  const emptyMsg = dom.emptyMsg;

  // Clear
  container.innerHTML = '';
  svg.innerHTML = '';

  const keys = Object.keys(tables);
  if (keys.length === 0) {
    emptyMsg.style.display = 'block';
    dom.btnArrange.style.display = 'none';
    return;
  }
  emptyMsg.style.display = 'none';
  dom.btnArrange.style.display = '';

  // ── Auto-assign positions for new tables ─────────────────────────
  const SPACING_X = 260;
  const SPACING_Y = 40;
  let col = 0, row = 0;
  const COLS = Math.max(1, Math.ceil(Math.sqrt(keys.length * 1.5)));

  const tableElements = {};

  for (const [name, table] of Object.entries(tables)) {
    const pos = getSavedPosition(name);
    let x, y;
    if (pos) {
      x = pos.x;
      y = pos.y;
    } else {
      x = 40 + col * SPACING_X;
      y = 24 + row * SPACING_Y;
      col++;
      if (col >= COLS) { col = 0; row++; }
    }

    const card = createTableCard(table);
    card.style.left = '0px';
    card.style.top  = '0px';
    card.style.transform = `translate(${x}px, ${y}px)`;
    container.appendChild(card);
    tableElements[name] = card;
  }

  // ── Draw connections ────────────────────────────────────────────────
  // Use a frame delay so card bounding rects are settled
  requestAnimationFrame(() => {
    drawConnections(refs, tableElements);
  });

  // Store for drag update
  renderState.tableElements = tableElements;
}

const renderState = { tableElements: {} };

function createTableCard(table) {
  const card = document.createElement('div');
  card.className = 'table-card';
  card.dataset.tableName = table.name;

  // Header
  const header = document.createElement('div');
  header.className = 'table-header';
  const color = getTableColor(table.name);
  header.style.background = color;
  header.innerHTML = `<span class="table-name">${escapeHtml(table.name)}</span>`;

  // Color swatch
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.background = color;
  swatch.title = 'Change table color';
  header.appendChild(swatch);

  // Color popup
  swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    showColorPopup(swatch, table.name, header);
  });

  card.appendChild(header);

  // Columns
  const colsDiv = document.createElement('div');
  colsDiv.className = 'table-columns';

  for (const col of table.columns) {
    const row = document.createElement('div');
    row.className = 'table-col';

    const nameEl = document.createElement('span');
    nameEl.className = 'col-name';
    nameEl.textContent = col.name;
    row.appendChild(nameEl);

    const typeEl = document.createElement('span');
    typeEl.className = 'col-type';
    typeEl.textContent = col.type;
    row.appendChild(typeEl);

    // Badges
    if (col.pk) {
      const badge = document.createElement('span');
      badge.className = 'col-badge badge-pk';
      badge.textContent = 'PK';
      row.appendChild(badge);
    }
    if (col.ref) {
      const badge = document.createElement('span');
      badge.className = 'col-badge badge-ref';
      badge.textContent = 'FK';
      row.appendChild(badge);
    }
    if (col.unique && !col.pk) {
      const badge = document.createElement('span');
      badge.className = 'col-badge badge-unq';
      badge.textContent = 'UQ';
      row.appendChild(badge);
    }
    if (col.notNull) {
      const badge = document.createElement('span');
      badge.className = 'col-badge badge-nn';
      badge.textContent = 'NN';
      row.appendChild(badge);
    }

    colsDiv.appendChild(row);
  }

  card.appendChild(colsDiv);

  // ── Drag setup ──────────────────────────────────────────────────────
  setupTableDrag(card, header);

  return card;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DRAG HANDLING
// ─────────────────────────────────────────────────────────────────────────────

function setupTableDrag(card, header) {
  let dragging = false;
  let startX, startY, startTX, startTY;

  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    card.classList.add('dragging');
    card.style.transition = 'none';

    const tx = parseTransformX(card);
    const ty = parseTransformY(card);
    startX = e.clientX;
    startY = e.clientY;
    startTX = tx;
    startTY = ty;
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nx = startTX + dx;
    const ny = startTY + dy;

    card.style.transform = `translate(${nx}px, ${ny}px)`;
    card.style.left = '0px';
    card.style.top  = '0px';

    // Redraw connections in real-time
    updateConnections();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    card.style.transition = '';

    const tx = parseTransformX(card);
    const ty = parseTransformY(card);
    const name = card.dataset.tableName;
    setSavedPosition(name, tx, ty);
  });
}

function parseTransformX(el) {
  const m = el.style.transform.match(/translate\(([-\d.]+)px/);
  return m ? parseFloat(m[1]) : 0;
}

function parseTransformY(el) {
  const m = el.style.transform.match(/translate\([-\d.]+px,\s*([-\d.]+)px\)/);
  return m ? parseFloat(m[1]) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SVG CONNECTION LINES
// ─────────────────────────────────────────────────────────────────────────────

function updateConnections() {
  drawConnections(state.refs, renderState.tableElements);
}

function drawConnections(refs, elements) {
  const svg = dom.connectionsSvg;
  svg.innerHTML = '';

  // Compute container offset once
  const canvasRect = dom.schemaCanvas.getBoundingClientRect();

  // Deduplicate ref pairs
  const seen = new Set();

  for (const ref of refs) {
    const key = [ref.from.table, ref.from.column, ref.to.table, ref.to.column].join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const fromEl = elements[ref.from.table];
    const toEl   = elements[ref.to.table];
    if (!fromEl || !toEl) continue;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect   = toEl.getBoundingClientRect();

    if (fromRect.width === 0 || toRect.width === 0) continue;

    // Anchor points (centers of facing edges)
    const fromCenter = {
      x: fromRect.left + fromRect.width / 2,
      y: fromRect.top + fromRect.height / 2,
    };
    const toCenter = {
      x: toRect.left + toRect.width / 2,
      y: toRect.top + toRect.height / 2,
    };

    const fromAnchor = getEdgeAnchor(fromRect, toCenter);
    const toAnchor   = getEdgeAnchor(toRect, fromCenter);

    const relFrom = {
      x: (fromAnchor.x - canvasRect.left - schemaPanX) / schemaZoom,
      y: (fromAnchor.y - canvasRect.top - schemaPanY) / schemaZoom,
    };
    const relTo = {
      x: (toAnchor.x - canvasRect.left - schemaPanX) / schemaZoom,
      y: (toAnchor.y - canvasRect.top - schemaPanY) / schemaZoom,
    };

    // SVG viewBox is the same as container size — use relative coords
    const cpx = Math.abs(relTo.x - relFrom.x) * 0.5;

    const d = `M ${relFrom.x} ${relFrom.y} C ${relFrom.x + cpx} ${relFrom.y}, ${relTo.x - cpx} ${relTo.y}, ${relTo.x} ${relTo.y}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.classList.add('connection-line');
    // Highlight ref column name in tooltip
    path.innerHTML = `<title>${ref.from.table}.${ref.from.column} → ${ref.to.table}.${ref.to.column}</title>`;
    svg.appendChild(path);

    // Small dot at end
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', relTo.x);
    dot.setAttribute('cy', relTo.y);
    dot.setAttribute('r', 3);
    dot.setAttribute('fill', '#58a6ff');
    dot.setAttribute('opacity', '0.6');
    svg.appendChild(dot);
  }
}

function getEdgeAnchor(rect, targetCenter) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = targetCenter.x - cx;
  const dy = targetCenter.y - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy + rect.height / 2 };

  // Intersection of line from center to target with rectangle edge
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let tx, ty;
  if (absDx * rect.height > absDy * rect.width) {
    // Hit left or right edge
    const signX = dx > 0 ? 1 : -1;
    tx = cx + signX * rect.width / 2;
    ty = cy + (dy / absDx) * rect.width / 2;
  } else {
    // Hit top or bottom edge
    const signY = dy > 0 ? 1 : -1;
    tx = cx + (dx / absDy) * rect.height / 2;
    ty = cy + signY * rect.height / 2;
  }

  // Clamp to rect bounds
  return {
    x: Math.max(rect.left, Math.min(rect.right, tx)),
    y: Math.max(rect.top, Math.min(rect.bottom, ty)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO-ARRANGE
// ─────────────────────────────────────────────────────────────────────────────

function autoArrange() {
  const keys = Object.keys(state.tables);
  if (keys.length === 0) return;
  const COLS = Math.max(1, Math.ceil(Math.sqrt(keys.length * 1.5)));
  const SPACING_X = 260;
  const SPACING_Y = 40;
  let col = 0, row = 0;

  for (const name of keys) {
    const card = renderState.tableElements[name];
    if (!card) continue;
    const x = 40 + col * SPACING_X;
    const y = 24 + row * SPACING_Y;
    card.style.transform = `translate(${x}px, ${y}px)`;
    setSavedPosition(name, x, y);
    col++;
    if (col >= COLS) { col = 0; row++; }
  }
  updateConnections();
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARSE + RENDER (triggered by editor changes)
// ─────────────────────────────────────────────────────────────────────────────

function parseAndRender() {
  const text = editor.getValue();
  const result = parseDBML(text);

  // ── Migrate positions for renamed tables ─────────────────────────
  if (result.errors.length === 0) {
    const oldTables = state.tables;
    const newTables = result.tables;
    // Build fingerprint map from old tables
    const oldByFingerprint = {};
    for (const [name, t] of Object.entries(oldTables)) {
      const fp = tableFingerprint(t);
      oldByFingerprint[fp] = name;
    }
    // For each new table without a saved position, look up by fingerprint
    for (const [newName, t] of Object.entries(newTables)) {
      if (state.positions[newName]) continue; // already has a saved position
      const fp = tableFingerprint(t);
      const oldName = oldByFingerprint[fp];
      if (oldName && oldName !== newName && state.positions[oldName]) {
        // Migrate position + color from old name to new name
        state.positions[newName] = state.positions[oldName];
        delete state.positions[oldName];
        savePositions();
      }
    }
  }

  state.tables = result.tables;
  state.refs = result.refs;

  if (result.errors.length > 0) {
    dom.statusBar.className = 'parse-err';
    dom.statusBar.textContent = `✗ ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? '…' : ''}`;
  } else {
    dom.statusBar.className = 'parse-ok';
    dom.statusBar.textContent = `✓ ${Object.keys(result.tables).length} tables, ${result.refs.length} refs`;
  }

  renderSchema(state.tables, state.refs);
}

// ─────────────────────────────────────────────────────────────────────────────
//  CODEMIRROR EDITOR
// ─────────────────────────────────────────────────────────────────────────────

const editor = CodeMirror(dom.editorContainer, {
  value: '',
  mode: 'text/x-mariadb',
  theme: 'dracula',
  lineNumbers: true,
  lineWrapping: false,
  tabSize: 2,
  indentUnit: 2,
  indentWithTabs: false,
  styleActiveLine: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  extraKeys: {
    'Ctrl-S': () => saveFile(),
    'Cmd-S': () => saveFile(),
    'Ctrl-O': () => openFile(),
    'Cmd-O': () => openFile(),
    'Shift-Cmd-S': () => saveAsFile(),
  },
});

editor.on('change', () => {
  markDirty();
  debounceParse();
  debounceAutosave();
});

editor.on('cursorActivity', () => {
  const cursor = editor.getCursor();
  dom.cursorPos.textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;
});

function debounceParse() {
  clearTimeout(state.parseTimer);
  state.parseTimer = setTimeout(parseAndRender, 400);
}

function debounceAutosave() {
  clearTimeout(state.autosaveTimer);
  if (!state.autosaveEnabled) return;
  if (!state.currentFilePath && isWeb) return;   // Web: save = download, never auto
  if (!state.currentFilePath && !isWeb) return;   // Desktop: new file, cannot auto-save
  state.autosaveTimer = setTimeout(() => {
    if (!state.isDirty) return;
    if (isWeb) return;
    saveFile();
  }, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESIZE HANDLE (editor / schema split)
// ─────────────────────────────────────────────────────────────────────────────

let resizing = false;

dom.resizeHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizing = true;
  dom.resizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
});

document.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const total = dom.editorPanel.parentElement.offsetWidth;
  const pct = Math.max(20, Math.min(80, (e.clientX / total) * 100));
  dom.editorPanel.style.flex = `0 0 ${pct}%`;
  dom.schemaPanel.style.flex = `0 0 ${100 - pct}%`;
});

document.addEventListener('mouseup', () => {
  if (resizing) {
    resizing = false;
    dom.resizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    // Redraw connections after layout settles
    setTimeout(updateConnections, 50);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ZOOM & PAN  (schema canvas)
// ─────────────────────────────────────────────────────────────────────────────

function applySchemaTransform() {
  const t = `translate(${schemaPanX}px, ${schemaPanY}px) scale(${schemaZoom})`;
  dom.tablesContainer.style.transform = t;
  dom.connectionsSvg.style.transform = t;
  updateZoomIndicator();
}

function updateZoomIndicator() {
  const pct = Math.round(schemaZoom * 100);
  dom.zoomIndicator.textContent = `${pct}%`;
  dom.zoomIndicator.classList.toggle('hidden', pct === 100 && schemaPanX === 0 && schemaPanY === 0);
}

// Zoom with mouse wheel
dom.schemaCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = dom.schemaCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const oldZoom = schemaZoom;
  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  schemaZoom = Math.max(0.2, Math.min(3, schemaZoom + delta));

  // Zoom toward cursor: keep the point under the mouse stable
  const localX = (mx - schemaPanX) / oldZoom;
  const localY = (my - schemaPanY) / oldZoom;
  schemaPanX = mx - localX * schemaZoom;
  schemaPanY = my - localY * schemaZoom;

  applySchemaTransform();
  updateConnections();
}, { passive: false });

// Pan by dragging empty canvas area
dom.schemaCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  // Don't start pan if clicking a table card or color popup
  if (e.target.closest('.table-card') || e.target.closest('.color-popup')) return;
  // Don't start pan from the panel header (above the canvas)
  if (!dom.schemaCanvas.contains(e.target)) return;

  isPanning = true;
  dom.schemaCanvas.classList.add('grabbing');
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartPanX = schemaPanX;
  panStartPanY = schemaPanY;
});

document.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  schemaPanX = panStartPanX + (e.clientX - panStartX);
  schemaPanY = panStartPanY + (e.clientY - panStartY);
  applySchemaTransform();
});

document.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false;
  dom.schemaCanvas.classList.remove('grabbing');
  // Redraw connections after pan settles
  updateConnections();
});

// ─────────────────────────────────────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function tableFingerprint(table) {
  return table.columns.map(c =>
    `${c.name}:${c.type}:${c.pk ? 'PK':''}:${c.ref ? c.ref.table+'.'+c.ref.column : ''}`
  ).join('|');
}

function darkenColor(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgb(${Math.round(r*0.5)},${Math.round(g*0.5)},${Math.round(b*0.5)})`;
}

function showColorPopup(anchor, tableName, headerEl) {
  // Remove existing popup
  const old = document.querySelector('.color-popup');
  if (old) old.remove();

  const popup = document.createElement('div');
  popup.className = 'color-popup';

  const current = getTableColor(tableName);

  for (const c of TABLE_COLORS) {
    const opt = document.createElement('div');
    opt.className = 'color-option' + (c === current ? ' selected' : '');
    opt.style.background = c;
    opt.dataset.color = c;
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      setTableColor(tableName, c);
      headerEl.style.background = c;
      anchor.style.background = c;
      document.querySelector('.color-popup')?.remove();
    });
    popup.appendChild(opt);
  }

  document.body.appendChild(popup);

  // Position popup near swatch
  const rect = anchor.getBoundingClientRect();
  popup.style.left = Math.max(4, rect.right - 120) + 'px';
  popup.style.top = (rect.bottom + 4) + 'px';

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', closePopup, { once: true });
  }, 0);
  function closePopup() { popup.remove(); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EVENT BINDING
// ─────────────────────────────────────────────────────────────────────────────

dom.btnNew.addEventListener('click', newFile);

// Recent files dropdown
function toggleRecentDropdown() {
  renderRecentMenu();
  dom.recentDropdown.classList.toggle('hidden');
}
dom.btnRecent.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleRecentDropdown();
});
dom.recentDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.recent-item');
  if (!item) return;
  const fp = item.dataset.path;
  if (!fp) return;
  dom.recentDropdown.classList.add('hidden');
  // If unsaved, ask
  if (state.isDirty && !confirm('Discard unsaved changes and open this file?')) return;
  // Open the recent file
  if (isWeb) return;
  try {
    const content = fs.readFileSync(fp, 'utf-8');
    loadFile(fp, content);
  } catch (err) {
    dom.statusBar.className = 'parse-err';
    dom.statusBar.textContent = `✗ Failed to open: ${err.message}`;
  }
});
// Close dropdown on click outside
document.addEventListener('click', () => {
  dom.recentDropdown.classList.add('hidden');
});
// Prevent click on button from closing (already stopped)
// But allow re-opening by toggling

dom.btnOpen.addEventListener('click', openFile);
dom.btnSave.addEventListener('click', saveFile);
dom.btnSaveAs.addEventListener('click', saveAsFile);
dom.btnArrange.addEventListener('click', autoArrange);

dom.chkAutosave.addEventListener('change', () => {
  state.autosaveEnabled = dom.chkAutosave.checked;
});

// Keyboard shortcuts (when not in editor)
document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === 'n') {
    e.preventDefault();
    newFile();
  }
  if (meta && e.key === 'o') {
    e.preventDefault();
    openFile();
  }
  if (meta && e.key === 's' && !e.shiftKey) {
    e.preventDefault();
    saveFile();
  }
  if (meta && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    saveAsFile();
  }
});

// Warn on exit if unsaved
window.addEventListener('beforeunload', (e) => {
  if (state.isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Connections redrawn automatically after zoom/pan transforms

// Re-draw connections on resize
window.addEventListener('resize', () => {
  setTimeout(updateConnections, 100);
});

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────

// Start with a basic example
const DEFAULT_DBML = `// ui-db — DBML Schema Editor
// Drag tables on the right panel to arrange them visually
// Positions are saved automatically

Table users {
  id integer [pk, increment]
  username varchar(100) [not null, unique]
  email varchar(255) [not null]
  full_name varchar(200)
  created_at timestamp [default: \`now()\`]
}

Table posts {
  id integer [pk, increment]
  title varchar(255) [not null]
  body text
  user_id integer [not null, ref: > users.id]
  created_at timestamp [default: \`now()\`]
}

Table comments {
  id integer [pk, increment]
  post_id integer [ref: > posts.id]
  user_id integer [ref: > users.id]
  content text [not null]
  created_at timestamp [default: \`now()\`]
}

Ref: comments.user_id > users.id
Ref: comments.post_id > posts.id
`;

editor.setValue(DEFAULT_DBML);
state.currentContent = DEFAULT_DBML;
markClean();
updateTitle();
parseAndRender();

// Auto-open last file (skip in web mode)
if (!isWeb) {
  const st = loadAppState();
  if (st.lastFile) {
    try {
      if (fs.existsSync(st.lastFile)) {
        const content = fs.readFileSync(st.lastFile, 'utf-8');
        loadFile(st.lastFile, content);
      }
    } catch (_) { /* file may have been deleted */ }
  }
}

// Hide Recent button in web mode
if (isWeb && dom.btnRecent) dom.btnRecent.style.display = 'none';
