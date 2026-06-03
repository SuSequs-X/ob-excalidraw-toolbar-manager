const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
  enabled: true,
  excalidrawPluginId: 'obsidian-excalidraw-plugin',
  dataJsonPath: '',
  pinnedScriptsText: '[]',
  autoReadOnLoad: true,
  showNativeTitle: true,
  leadingDefaultButtons: 2,
  buttonSelectorMode: 'auto',
  customButtonSelector: '',
  buttonSelectorsText: [
    '.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon',
    '.excalidraw .tray-misc-tools-container .ToolIcon',
    '.excalidraw [class*="ExcalidrawObsidianMenu"] .ToolIcon',
    '.excalidraw .App-menu__right .tray-misc-tools-container .ToolIcon',
    '.App-menu__right .tray-misc-tools-container .ToolIcon',
    '.tray-misc-tools-container .ToolIcon',
    '.excalidraw .App-menu__right .ToolIcon',
    '.App-menu__right .ToolIcon',
    '.excalidraw .ToolIcon',
    '.excalidraw button[aria-label]',
    '.excalidraw [role="button"]'
  ].join('\n'),
  stripExtension: true,
  stripNumericPrefix: false,
  displayNames: {},
  layout: {
    rows: 5,
    itemH: 30,
    vGap: 14,
    colW: 86,
    colGap: 10,
    maxW: 430,
    moveUp: 60,
    zoom: 1.25,
    iconSize: 30,
    blockRadius: 8,
    blockPaddingX: 4,
    blockPaddingY: 3,
    blockBgColor: 'transparent',
    blockBorderColor: 'transparent',
    blockBorderWidth: 0,
    titleDistance: 4,
    titleFontSize: 10,
    titleWidth: 82,
    titleMaxLines: 1,
    titleTextColor: 'var(--text-muted)',
    titleBgColor: 'transparent',
    titleBorderColor: 'transparent',
    titleBorderWidth: 0,
    titlePaddingX: 2,
    titlePaddingY: 1
  }
};

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) out[key] = deepMerge(target[key] || {}, source[key]);
    else out[key] = source[key];
  }
  return out;
}
function basename(path) { return String(path || '').split('/').pop() || String(path || ''); }
function cleanName(path, settings) {
  let name = basename(path);
  if (settings.stripExtension) name = name.replace(/\.md$/i, '');
  if (settings.stripNumericPrefix) name = name.replace(/^\s*\d+[\s._-]+/, '');
  return name.trim() || basename(path);
}
function safeNum(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function cssValue(value, fallback) { return String(value || fallback || '').trim().replace(/[;{}]/g, ''); }
function cssToHex(value, fallback = '#ffffff') {
  const v = String(value || '').trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return v;
  const short = v.match(/^#([0-9a-f]{3})$/i);
  if (short) return '#' + short[1].split('').map(c => c + c).join('');
  const rgb = v.match(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    const toHex = n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }
  return fallback;
}
function hexToRgbText(hex) {
  const normalized = cssToHex(hex, '#ffffff').replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
function uniqueStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr || []) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function safeQueryAll(selector) {
  try { return Array.from(document.querySelectorAll(selector)); }
  catch { return []; }
}
function commonParent(nodes) {
  if (!nodes.length) return null;
  const firstParent = nodes[0].parentElement;
  if (firstParent && nodes.every(n => n.parentElement === firstParent)) return firstParent;
  return firstParent || null;
}

function visibleElement(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  return rect.width > 0 && rect.height > 0;
}
function parentScoreHint(parent) {
  const cls = String(parent?.className || '');
  let score = 0;
  if (/ExcalidrawObsidianMenu|tray-misc-tools-container|misc-tools|script|pinned/i.test(cls)) score -= 80;
  if (/App-menu__right/i.test(cls)) score -= 30;
  if (/layer|canvas|library|sidebar|popover|modal|Island/i.test(cls)) score += 80;
  if (!parent || parent === document.body || parent === document.documentElement) score += 300;
  return score;
}

function chooseEffectiveOffset(count, pinnedCount, configuredOffset) {
  const candidates = uniqueStrings([configuredOffset, 2, 1, 0, 3, 4].map(String)).map(Number);
  let best = { offset: configuredOffset, diff: Number.POSITIVE_INFINITY, penalty: 0 };
  for (const offset of candidates) {
    if (!Number.isFinite(offset) || offset < 0 || count < offset) continue;
    const bindable = count - offset;
    const diff = Math.abs(bindable - pinnedCount);
    const penalty = offset === configuredOffset ? 0 : 6;
    if (diff + penalty < best.diff + best.penalty) best = { offset, diff, penalty };
  }
  return best;
}

function groupNodesByParent(nodes) {
  const map = new Map();
  nodes.filter(visibleElement).forEach(node => {
    const parent = node.parentElement;
    if (!parent) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(node);
  });
  return Array.from(map.entries()).map(([parent, nodes]) => ({ parent, nodes }));
}

class ExcalidrawToolbarManager extends Plugin {
  async onload() {
    this.settings = deepMerge(DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.displayNames || typeof this.settings.displayNames !== 'object') this.settings.displayNames = {};

    this.styleEl = document.createElement('style');
    this.styleEl.id = 'excalidraw-toolbar-manager-style';
    document.head.appendChild(this.styleEl);
    this.lastDetection = null;

    this.addSettingTab(new ExcalidrawToolbarManagerSettingTab(this.app, this));

    this.addCommand({
      id: 'read-pinned-scripts',
      name: 'Read Excalidraw pinnedScripts',
      callback: async () => { await this.readPinnedScripts(true); this.applyAll(); }
    });

    this.addCommand({
      id: 'apply-toolbar-title-blocks',
      name: 'Apply toolbar title blocks',
      callback: () => this.applyAll()
    });

    this.addCommand({
      id: 'write-pinned-scripts-order',
      name: 'Write pinnedScripts order to Excalidraw data.json',
      callback: async () => this.writePinnedScriptsToDataJson()
    });

    this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleApply()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleApply()));

    this.observer = new MutationObserver(() => this.scheduleApply());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.register(() => this.observer?.disconnect());

    if (this.settings.autoReadOnLoad) await this.readPinnedScripts(false);
    await this.saveData(this.settings);
    this.applyAll();
  }

  onunload() {
    this.styleEl?.remove();
    this.clearButtonAttrs();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyAll();
  }

  getDataJsonPath() {
    return (this.settings.dataJsonPath || '').trim() || `${this.app.vault.configDir}/plugins/${this.settings.excalidrawPluginId}/data.json`;
  }

  getBackupDir() {
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/backups`;
  }

  async ensureBackupDir() {
    const adapter = this.app.vault.adapter;
    const dir = this.getBackupDir();
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    return dir;
  }

  async createDataJsonBackup(rawDataJson) {
    const adapter = this.app.vault.adapter;
    const dir = await this.ensureBackupDir();
    const backupPath = `${dir}/data.json.bak.${timestampForFile()}.json`;
    await adapter.write(backupPath, rawDataJson);
    await this.pruneDataJsonBackups(10);
    return backupPath;
  }

  async pruneDataJsonBackups(keep = 10) {
    const adapter = this.app.vault.adapter;
    const dir = this.getBackupDir();
    if (!(await adapter.exists(dir))) return;
    const listed = await adapter.list(dir);
    const backups = (listed.files || [])
      .filter(file => /\/data\.json\.bak\..+\.json$/.test(file))
      .sort((a, b) => b.localeCompare(a));
    for (const file of backups.slice(keep)) {
      try { await adapter.remove(file); } catch (err) { console.warn('Failed to remove old backup', file, err); }
    }
  }

  async readPinnedScripts(showNotice = true) {
    try {
      const path = this.getDataJsonPath();
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) {
        if (showNotice) new Notice(`未找到 data.json：${path}`);
        return [];
      }
      const raw = await adapter.read(path);
      const data = JSON.parse(raw);
      const pinned = Array.isArray(data.pinnedScripts) ? uniqueStrings(data.pinnedScripts) : [];
      this.settings.pinnedScriptsText = JSON.stringify(pinned, null, 2);
      await this.saveData(this.settings);
      if (showNotice) new Notice(`已读取 pinnedScripts：${pinned.length} 个`);
      return pinned;
    } catch (err) {
      console.error(err);
      if (showNotice) new Notice(`读取失败：${err.message}`);
      return [];
    }
  }

  getPinnedScripts() {
    try {
      const value = JSON.parse(this.settings.pinnedScriptsText || '[]');
      return Array.isArray(value) ? uniqueStrings(value) : [];
    } catch {
      return [];
    }
  }

  setPinnedScripts(paths) {
    this.settings.pinnedScriptsText = JSON.stringify(uniqueStrings(paths), null, 2);
  }

  addPath(path) {
    const p = String(path || '').trim();
    if (!p) return false;
    const pinned = this.getPinnedScripts();
    if (!pinned.includes(p)) pinned.push(p);
    this.setPinnedScripts(pinned);
    return true;
  }

  removePath(path) {
    this.setPinnedScripts(this.getPinnedScripts().filter(p => p !== path));
    delete this.settings.displayNames[path];
  }

  movePath(fromIndex, toIndex) {
    const pinned = this.getPinnedScripts();
    if (fromIndex < 0 || fromIndex >= pinned.length || toIndex < 0 || toIndex >= pinned.length || fromIndex === toIndex) return;
    const [item] = pinned.splice(fromIndex, 1);
    pinned.splice(toIndex, 0, item);
    this.setPinnedScripts(pinned);
  }

  movePathBefore(fromIndex, toIndex) {
    const pinned = this.getPinnedScripts();
    if (fromIndex < 0 || fromIndex >= pinned.length || toIndex < 0 || toIndex >= pinned.length || fromIndex === toIndex) return;
    const [item] = pinned.splice(fromIndex, 1);
    const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
    pinned.splice(adjusted, 0, item);
    this.setPinnedScripts(pinned);
  }

  async writePinnedScriptsToDataJson() {
    try {
      const path = this.getDataJsonPath();
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) {
        new Notice(`未找到 data.json：${path}`);
        return;
      }
      const raw = await adapter.read(path);
      const data = JSON.parse(raw);
      const backup = await this.createDataJsonBackup(raw);
      data.pinnedScripts = this.getPinnedScripts();
      await adapter.write(path, JSON.stringify(data, null, 2));
      await this.saveData(this.settings);
      new Notice(`已写回 pinnedScripts 顺序；备份已保存到 backups（仅保留最近 10 个）：${backup}`);
    } catch (err) {
      console.error(err);
      new Notice(`写回失败：${err.message}`);
    }
  }

  getDisplayName(path) {
    const custom = this.settings.displayNames?.[path];
    return (typeof custom === 'string' && custom.trim()) ? custom.trim() : cleanName(path, this.settings);
  }

  scheduleApply() {
    window.clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => this.applyAll(), 80);
  }

  applyAll() {
    this.applyStyle();
    this.applyButtonAttrs();
  }

  applyStyle() {
    if (!this.styleEl) return;
    const s = this.settings;
    const l = s.layout;
    if (!s.enabled) {
      this.styleEl.textContent = '';
      return;
    }

    const maxLines = safeNum(l.titleMaxLines, 1);
    const fontSize = safeNum(l.titleFontSize, 10);
    const padY = safeNum(l.titlePaddingY, 1);
    const borderW = safeNum(l.titleBorderWidth, 0);
    const dist = safeNum(l.titleDistance, 4);
    const lineHeight = 1.15;
    const titleH = Math.ceil(maxLines * fontSize * lineHeight + padY * 2 + borderW * 2);
    const white = maxLines > 1 ? 'normal' : 'nowrap';
    const clamp = maxLines > 1 ? `display:-webkit-box !important;-webkit-line-clamp:${maxLines};-webkit-box-orient:vertical;` : '';

    this.styleEl.textContent = `
.excalidraw .tray-misc-tools-container,
.excalidraw .App-menu__right{overflow:visible !important;}
.etm-toolbar-container{
  display:grid !important;
  grid-auto-flow:column !important;
  grid-template-rows:repeat(var(--etm-rows), var(--etm-cellH)) !important;
  grid-auto-columns:var(--etm-colW) !important;
  row-gap:${safeNum(l.vGap, 14)}px !important;
  column-gap:${safeNum(l.colGap, 10)}px !important;
  align-content:start !important;
  justify-content:start !important;
  overflow:visible !important;
  max-width:${safeNum(l.maxW, 430)}px !important;
}
.excalidraw .tray-misc-tools-container{
  --etm-rows:${safeNum(l.rows, 5)};
  --etm-iconH:${safeNum(l.itemH, 30)}px;
  --etm-titleH:${titleH}px;
  --etm-titleDistance:${dist}px;
  --etm-cellH:calc(var(--etm-iconH) + var(--etm-titleDistance) + var(--etm-titleH) + ${safeNum(l.blockPaddingY, 3) * 2}px);
  --etm-colW:${safeNum(l.colW, 86)}px;
  --etm-zoom:${safeNum(l.zoom, 1.25)};
  --etm-iconSize:${safeNum(l.iconSize, 30)}px;
  --etm-radius:${safeNum(l.blockRadius, 8)}px;
  --etm-blockPaddingX:${safeNum(l.blockPaddingX, 4)}px;
  --etm-blockPaddingY:${safeNum(l.blockPaddingY, 3)}px;
  --etm-blockBg:${cssValue(l.blockBgColor, DEFAULT_SETTINGS.layout.blockBgColor)};
  --etm-blockBorder:${safeNum(l.blockBorderWidth, 0)}px solid ${cssValue(l.blockBorderColor, DEFAULT_SETTINGS.layout.blockBorderColor)};
  --etm-titleFontSize:${fontSize}px;
  --etm-titleWidth:${safeNum(l.titleWidth, 82)}px;
  --etm-titleText:${cssValue(l.titleTextColor, DEFAULT_SETTINGS.layout.titleTextColor)};
  --etm-titleBg:${cssValue(l.titleBgColor, DEFAULT_SETTINGS.layout.titleBgColor)};
  --etm-titleBorder:${borderW}px solid ${cssValue(l.titleBorderColor, DEFAULT_SETTINGS.layout.titleBorderColor)};
  --etm-titlePaddingX:${safeNum(l.titlePaddingX, 2)}px;
  --etm-titlePaddingY:${padY}px;
}
.etm-unmanaged-button{
  grid-column:var(--etm-controlColumn) !important;
  width:var(--etm-colW) !important;
  min-height:var(--etm-cellH) !important;
  height:var(--etm-cellH) !important;
  box-sizing:border-box !important;
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
  align-self:start !important;
  justify-self:center !important;
  padding:var(--etm-blockPaddingY) var(--etm-blockPaddingX) !important;
  overflow:visible !important;
}
.etm-unmanaged-button .ToolIcon__icon{
  height:var(--etm-iconH) !important;
  width:100% !important;
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
}
.etm-unmanaged-button svg{
  width:var(--etm-iconSize) !important;
  height:var(--etm-iconSize) !important;
}

.etm-managed-button[data-etm-title],
.etm-managed-button[data-etm-skipped-default]{
  min-height:var(--etm-cellH) !important;
  width:var(--etm-colW) !important;
  box-sizing:border-box !important;
  display:flex !important;
  flex-direction:column !important;
  align-items:center !important;
  justify-content:flex-start !important;
  padding:var(--etm-blockPaddingY) var(--etm-blockPaddingX) !important;
  background:var(--etm-blockBg) !important;
  border:var(--etm-blockBorder) !important;
  border-radius:var(--etm-radius) !important;
  transition:transform 0.18s ease,box-shadow 0.18s ease !important;
  transform:scale(1);
  transform-origin:center;
  will-change:transform;
  position:relative !important;
  z-index:1;
  overflow:visible !important;
}
.etm-managed-button[data-etm-title]::after,
.etm-managed-button[data-etm-skipped-default]::after{
  content:attr(data-etm-title);
  position:static !important;
  display:block !important;
  flex:0 0 auto !important;
  width:var(--etm-titleWidth);
  max-width:var(--etm-titleWidth);
  margin-top:var(--etm-titleDistance);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:${white};
  ${clamp}
  text-align:center;
  line-height:${lineHeight};
  font-size:var(--etm-titleFontSize);
  color:var(--etm-titleText);
  background:var(--etm-titleBg);
  border:var(--etm-titleBorder);
  border-radius:var(--etm-radius);
  padding:var(--etm-titlePaddingY) var(--etm-titlePaddingX);
  pointer-events:none;
  box-sizing:border-box;
}
.etm-managed-button[data-etm-skipped-default]::after{
  content:"" !important;
  visibility:hidden !important;
}
.etm-managed-button[data-etm-title]:hover,
.etm-managed-button[data-etm-skipped-default]:hover{
  transform:scale(var(--etm-zoom)) !important;
  z-index:10 !important;
}
.etm-managed-button[data-etm-title]:has(input:checked),
.etm-managed-button[data-etm-skipped-default]:has(input:checked){
  transform:scale(var(--etm-zoom)) !important;
  z-index:8 !important;
}
.etm-managed-button[data-etm-title] .ToolIcon__icon,
.etm-managed-button[data-etm-skipped-default] .ToolIcon__icon{
  flex:0 0 var(--etm-iconH) !important;
  height:var(--etm-iconH) !important;
  width:100% !important;
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
}
.etm-managed-button[data-etm-title] .ToolIcon__icon svg,
.etm-managed-button[data-etm-skipped-default] .ToolIcon__icon svg{
  width:var(--etm-iconSize) !important;
  height:var(--etm-iconSize) !important;
  display:block !important;
}
.etm-managed-button[data-etm-title] > svg,
.etm-managed-button[data-etm-skipped-default] > svg{
  width:var(--etm-iconSize) !important;
  height:var(--etm-iconSize) !important;
}
`;
  }

  clearButtonAttrs() {
    document.querySelectorAll('.etm-managed-button, .etm-toolbar-container, .etm-unmanaged-button').forEach(el => {
      el.classList?.remove('etm-managed-button', 'etm-toolbar-container', 'etm-unmanaged-button');
      el.style?.removeProperty('--etm-scriptCols');
      el.style?.removeProperty('--etm-controlColumn');
      el.removeAttribute?.('data-etm-title');
      el.removeAttribute?.('data-etm-skipped-default');
      el.style?.removeProperty('order');
      if (el.getAttribute?.('data-etm-managed-title') === 'true') {
        el.removeAttribute('title');
        el.removeAttribute('data-etm-managed-title');
      }
    });
  }

  getButtonSelectors() {
    const selectors = [];
    if (this.settings.buttonSelectorMode === 'custom' && this.settings.customButtonSelector?.trim()) {
      selectors.push(this.settings.customButtonSelector.trim());
    }
    const configured = String(this.settings.buttonSelectorsText || '').split('\n').map(s => s.trim()).filter(Boolean);
    selectors.push(...configured);
    return uniqueStrings(selectors);
  }

  scanButtonCandidates() {
    const pinnedCount = this.getPinnedScripts().length;
    const configuredOffset = Math.max(0, safeNum(this.settings.leadingDefaultButtons, 2));
    const candidates = [];

    this.getButtonSelectors().forEach(selector => {
      const allNodes = safeQueryAll(selector).filter(visibleElement);
      const groups = groupNodesByParent(allNodes);

      groups.forEach((group, groupIndex) => {
        const count = group.nodes.length;
        const parent = group.parent;
        const parentClass = String(parent?.className || '').slice(0, 160);
        const parentTag = parent?.tagName || '';
        const offsetInfo = chooseEffectiveOffset(count, pinnedCount, configuredOffset);
        const effectiveOffset = offsetInfo.offset;
        const expected = pinnedCount + effectiveOffset;
        const base = count >= effectiveOffset ? Math.abs((count - effectiveOffset) - pinnedCount) : 10000;
        const broadPenalty = /\.excalidraw\s+\.ToolIcon|\[role="button"\]|button\[aria-label\]/.test(selector) ? 60 : 0;
        const score = base + offsetInfo.penalty + parentScoreHint(parent) + broadPenalty;
        candidates.push({
          selector,
          groupIndex,
          count,
          expected,
          configuredOffset,
          effectiveOffset,
          bindableCount: Math.max(0, count - effectiveOffset),
          score,
          parentTag,
          parentClass,
          sample: group.nodes.slice(0, 3).map(n => `${n.tagName}.${String(n.className || '').slice(0, 60)}`).join(' | '),
          nodes: group.nodes,
          parent
        });
      });

      // Also keep a fallback candidate when selector returns nodes but no useful same-parent group.
      if (allNodes.length && !groups.length) {
        candidates.push({ selector, groupIndex: -1, count: allNodes.length, expected: pinnedCount + configuredOffset, configuredOffset, effectiveOffset: configuredOffset, bindableCount: Math.max(0, allNodes.length - configuredOffset), score: 99999, parentTag: '', parentClass: '', sample: '', nodes: allNodes, parent: commonParent(allNodes) });
      }
    });

    return candidates
      .filter(c => c.count > 0)
      .sort((a, b) => a.score - b.score || Math.abs(a.count - a.expected) - Math.abs(b.count - b.expected) || b.count - a.count);
  }

  detectButtons() {
    const candidates = this.scanButtonCandidates();
    const best = candidates.find(c => c.count >= Math.min(c.expected, 1));
    if (!best) {
      this.lastDetection = { selector: '', groupIndex: -1, count: 0, expected: this.getPinnedScripts().length + Math.max(0, safeNum(this.settings.leadingDefaultButtons, 2)), candidates };
      return { buttons: [], container: null, detection: this.lastDetection };
    }
    this.lastDetection = { ...best, candidates };
    return { buttons: best.nodes || [], container: best.parent || null, detection: this.lastDetection };
  }


  applyButtonAttrs() {
    this.clearButtonAttrs();
    if (!this.settings.enabled) return;
    const pinned = this.getPinnedScripts();
    const { buttons, container } = this.detectButtons();
    const offset = Math.max(0, safeNum(this.lastDetection?.effectiveOffset, safeNum(this.settings.leadingDefaultButtons, 2)));
    const count = Math.min(Math.max(0, buttons.length - offset), pinned.length);
    const managed = new Set();

    for (let j = 0; j < Math.min(offset, buttons.length); j++) {
      const btn = buttons[j];
      btn.setAttribute('data-etm-skipped-default', 'true');
      btn.removeAttribute('data-etm-title');
      btn.classList?.add('etm-managed-button');
      managed.add(btn);
    }

    for (let i = 0; i < count; i++) {
      const btn = buttons[i + offset];
      const path = pinned[i];
      const name = this.getDisplayName(path);
      btn.setAttribute('data-etm-title', name);
      btn.classList?.add('etm-managed-button');
      managed.add(btn);
      if (this.settings.showNativeTitle) {
        btn.setAttribute('title', name);
        btn.setAttribute('data-etm-managed-title', 'true');
      }
    }

    if (container) {
      const rows = Math.max(1, safeNum(this.settings.layout.rows, 5));
      const scriptCols = Math.max(1, Math.ceil((offset + count) / rows));
      container.classList?.add('etm-toolbar-container');
      container.style?.setProperty('--etm-scriptCols', String(scriptCols));
      container.style?.setProperty('--etm-controlColumn', String(scriptCols + 1));
      Array.from(container.children || []).forEach(child => {
        if (!managed.has(child)) child.classList?.add('etm-unmanaged-button');
      });
    }
  }
}

class ExcalidrawToolbarManagerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.active = 'basic';
  }

  display() {
    const el = this.containerEl;
    el.empty();
    el.addClass('excalidraw-toolbar-manager-settings');
    el.createEl('h2', { text: 'Excalidraw Toolbar Manager' });
    el.createEl('p', { text: '按 Excalidraw 原生 pinnedScripts 顺序绑定标题；脚本按钮恢复多列网格，右侧锁定/手掌等原生控制按钮放入独立控制列，避免被挤到底部。' });
    this.tabs(el);
    const body = el.createDiv({ cls: 'etm-tab-content' });
    if (this.active === 'basic') this.basic(body);
    if (this.active === 'buttons') this.buttons(body);
    if (this.active === 'layout') this.layout(body);
    if (this.active === 'title') this.title(body);
  }

  tabs(el) {
    const list = [['basic', '⚙️ 基础设置'], ['buttons', '📌 按钮名称与排序'], ['layout', '📐 按钮块布局'], ['title', '🏷️ 标题样式']];
    const bar = el.createDiv({ cls: 'etm-tabs' });
    for (const [id, name] of list) {
      const btn = bar.createEl('button', { text: name, cls: `etm-tab ${this.active === id ? 'is-active' : ''}` });
      btn.addEventListener('click', () => { this.active = id; this.display(); });
    }
  }

  basic(el) {
    const s = this.plugin.settings;
    el.createEl('h3', { text: '⚙️ 基础设置' });
    new Setting(el).setName('启用插件').addToggle(t => t.setValue(s.enabled).onChange(async v => { s.enabled = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName('Excalidraw data.json path').setDesc('留空则按插件 ID 自动推导。').addText(t => t.setValue(s.dataJsonPath || '').setPlaceholder('.obsidian/plugins/obsidian-excalidraw-plugin/data.json').onChange(async v => { s.dataJsonPath = v.trim(); await this.plugin.saveSettings(); this.display(); }));
    el.createDiv({ cls: 'etm-path-hint', text: `当前读取路径：${this.plugin.getDataJsonPath()}` });
    new Setting(el).setName('Excalidraw plugin ID').addText(t => t.setValue(s.excalidrawPluginId).onChange(async v => { s.excalidrawPluginId = v.trim() || DEFAULT_SETTINGS.excalidrawPluginId; await this.plugin.saveSettings(); }));
    new Setting(el).setName('启动时自动读取 pinnedScripts').addToggle(t => t.setValue(s.autoReadOnLoad).onChange(async v => { s.autoReadOnLoad = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName('显示原生 title tooltip').addToggle(t => t.setValue(s.showNativeTitle).onChange(async v => { s.showNativeTitle = v; await this.plugin.saveSettings(); }));
    new Setting(el)
      .setName('跳过前 N 个默认按钮（默认 2）')
      .setDesc('Excalidraw 右侧功能栏第 1、第 2 个是默认按钮，不属于 pinnedScripts。这里默认跳过 2 个；这两个按钮不会设置标题，也不会套用标题块样式。')
      .addText(t => t.setValue(String(s.leadingDefaultButtons ?? 2)).onChange(async v => {
        const n = Number(v);
        s.leadingDefaultButtons = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 2;
        await this.plugin.saveSettings();
      }));
    new Setting(el)
      .setName('按钮选择器模式')
      .setDesc('auto 会按候选选择器并按父容器分组自动匹配，避免误选 Excalidraw 原生控制按钮；custom 使用下面的手动选择器。')
      .addDropdown(d => d.addOption('auto', '自动匹配').addOption('custom', '手动选择器').setValue(s.buttonSelectorMode || 'auto').onChange(async v => {
        s.buttonSelectorMode = v;
        await this.plugin.saveSettings();
        this.display();
      }));
    new Setting(el)
      .setName('手动按钮选择器')
      .setDesc('当自动匹配失败时填写。例：.excalidraw .ToolIcon')
      .addText(t => t.setValue(s.customButtonSelector || '').setPlaceholder('.excalidraw .ToolIcon').onChange(async v => {
        s.customButtonSelector = v.trim();
        await this.plugin.saveSettings();
      }));
  }

  buttons(el) {
    const s = this.plugin.settings;
    el.createEl('h3', { text: '📌 按钮名称' });
    el.createDiv({ cls: 'etm-help', text: '拖拽调整的是 pinnedScripts 列表本身；插件不会用 CSS order 做视觉排序。若要让 Excalidraw 原生顺序同步，点击“写回 data.json”。' });
    new Setting(el).setName('读取 / 写回 pinnedScripts').addButton(b => b.setButtonText('Read').setCta().onClick(async () => { await this.plugin.readPinnedScripts(true); this.display(); })).addButton(b => b.setButtonText('Apply').onClick(() => this.plugin.applyAll())).addButton(b => b.setButtonText('写回 data.json').setWarning().onClick(async () => { await this.plugin.writePinnedScriptsToDataJson(); this.display(); }));
    new Setting(el).setName('名称去掉 .md 后缀').addToggle(t => t.setValue(s.stripExtension).onChange(async v => { s.stripExtension = v; await this.plugin.saveSettings(); this.display(); }));
    new Setting(el).setName('名称去掉数字前缀').addToggle(t => t.setValue(s.stripNumericPrefix).onChange(async v => { s.stripNumericPrefix = v; await this.plugin.saveSettings(); this.display(); }));
    this.nameList(el);
    const details = el.createEl('details');
    details.createEl('summary', { text: '查看 / 编辑 Pinned Scripts JSON（不排序）' });
    const ta = details.createEl('textarea', { cls: 'etm-json' });
    ta.value = s.pinnedScriptsText || '[]';
    ta.addEventListener('change', async () => { s.pinnedScriptsText = ta.value; await this.plugin.saveSettings(); this.display(); });
  }

  nameList(el) {
    const list = el.createDiv({ cls: 'etm-list' });
    const items = this.plugin.getPinnedScripts();
    if (!items.length) { list.createDiv({ cls: 'etm-help', text: '暂无按钮。请先读取 pinnedScripts。' }); return; }
    items.forEach((path, index) => {
      const row = list.createDiv({ cls: 'etm-row' });
      row.setAttr('draggable', 'true');
      row.dataset.index = String(index);

      const handle = row.createDiv({ cls: 'etm-handle', text: '☰' });
      handle.setAttr('title', '拖拽排序');

      const info = row.createDiv();
      info.createDiv({ cls: 'etm-title', text: `${String(index + 1).padStart(2, '0')} · ${this.plugin.getDisplayName(path)}` });
      info.createDiv({ cls: 'etm-subtitle', text: path });

      const input = row.createEl('input', { cls: 'etm-name-input', type: 'text' });
      input.value = this.plugin.settings.displayNames[path] || '';
      input.placeholder = cleanName(path, this.plugin.settings);
      input.addEventListener('change', async () => {
        const value = input.value.trim();
        if (value) this.plugin.settings.displayNames[path] = value;
        else delete this.plugin.settings.displayNames[path];
        await this.plugin.saveSettings();
        this.display();
      });

      const actions = row.createDiv({ cls: 'etm-actions' });
      actions.createEl('button', { text: '↑' }).addEventListener('click', async () => {
        this.plugin.movePath(index, index - 1);
        await this.plugin.saveSettings();
        this.display();
      });
      actions.createEl('button', { text: '↓' }).addEventListener('click', async () => {
        this.plugin.movePath(index, index + 1);
        await this.plugin.saveSettings();
        this.display();
      });
      actions.createEl('button', { text: '重置名' }).addEventListener('click', async () => { delete this.plugin.settings.displayNames[path]; await this.plugin.saveSettings(); this.display(); });
      actions.createEl('button', { text: '移除' }).addEventListener('click', async () => { this.plugin.removePath(path); await this.plugin.saveSettings(); this.display(); });

      row.addEventListener('dragstart', e => {
        this.dragIndex = index;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        row.addClass('is-dragging');
      });
      row.addEventListener('dragend', () => {
        this.dragIndex = null;
        row.removeClass('is-dragging');
        list.querySelectorAll('.is-drag-over').forEach(node => node.removeClass('is-drag-over'));
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.addClass('is-drag-over');
      });
      row.addEventListener('dragleave', () => row.removeClass('is-drag-over'));
      row.addEventListener('drop', async e => {
        e.preventDefault();
        row.removeClass('is-drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = index;
        this.plugin.movePathBefore(Number.isFinite(from) ? from : this.dragIndex, to);
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  layout(el) {
    el.createEl('h3', { text: '📐 按钮块布局' });
    this.num(el, '每列按钮数量', 'rows', 1, 40, 1);
    this.num(el, '图标区域高度', 'itemH', 16, 90, 1);
    this.num(el, '按钮块纵向间距', 'vGap', 0, 60, 1);
    this.num(el, '按钮块宽度', 'colW', 40, 220, 1);
    this.num(el, '列间距', 'colGap', 0, 100, 1);
    this.num(el, '最大宽度', 'maxW', 60, 1400, 1);
    this.num(el, '整体上移', 'moveUp', -200, 400, 1);
    this.num(el, '悬停放大倍数', 'zoom', 1, 3, 0.05);
    this.num(el, '图标尺寸', 'iconSize', 12, 100, 1);
    this.num(el, '按钮块圆角', 'blockRadius', 0, 40, 1);
    this.num(el, '按钮块左右内边距', 'blockPaddingX', 0, 30, 1);
    this.num(el, '按钮块上下内边距', 'blockPaddingY', 0, 30, 1);
    this.color(el, '按钮块背景色', 'blockBgColor', 'transparent / rgba(...) / var(...)');
    this.color(el, '按钮块边框颜色', 'blockBorderColor', 'transparent / #888 / var(...)');
    this.num(el, '按钮块边框宽度', 'blockBorderWidth', 0, 8, 1);
  }

  title(el) {
    el.createEl('h3', { text: '🏷️ 标题样式' });
    el.createDiv({ cls: 'etm-help', text: '标题绑定在按钮块下方，是原按钮的附属显示内容；插件不会改变按钮顺序。' });
    this.num(el, '标题与图标距离', 'titleDistance', 0, 40, 1);
    this.num(el, '标题字号', 'titleFontSize', 6, 28, 1);
    this.num(el, '标题宽度', 'titleWidth', 30, 260, 1);
    this.num(el, '标题最大行数', 'titleMaxLines', 1, 4, 1);
    this.num(el, '标题左右内边距', 'titlePaddingX', 0, 20, 1);
    this.num(el, '标题上下内边距', 'titlePaddingY', 0, 20, 1);
    this.num(el, '标题边框宽度', 'titleBorderWidth', 0, 8, 1);
    this.color(el, '标题文字颜色', 'titleTextColor', '#fff / rgba(...) / var(...)');
    this.color(el, '标题背景色', 'titleBgColor', 'transparent / rgba(...) / var(...)');
    this.color(el, '标题边框颜色', 'titleBorderColor', 'transparent / #888 / var(...)');
    this.sample(el);
  }

  sample(el) {
    const l = this.plugin.settings.layout;
    const sample = el.createDiv({ cls: 'etm-style-sample' });
    sample.style.background = cssValue(l.blockBgColor, DEFAULT_SETTINGS.layout.blockBgColor);
    sample.style.border = `${safeNum(l.blockBorderWidth, 0)}px solid ${cssValue(l.blockBorderColor, DEFAULT_SETTINGS.layout.blockBorderColor)}`;
    sample.style.borderRadius = `${safeNum(l.blockRadius, 8)}px`;
    sample.style.width = `${safeNum(l.colW, 86)}px`;
    sample.createDiv({ cls: 'etm-style-sample-icon', text: '⬚' });
    const title = sample.createDiv({ cls: 'etm-style-sample-title', text: '示例按钮名称' });
    title.style.color = cssValue(l.titleTextColor, DEFAULT_SETTINGS.layout.titleTextColor);
    title.style.background = cssValue(l.titleBgColor, DEFAULT_SETTINGS.layout.titleBgColor);
    title.style.border = `${safeNum(l.titleBorderWidth, 0)}px solid ${cssValue(l.titleBorderColor, DEFAULT_SETTINGS.layout.titleBorderColor)}`;
    title.style.marginTop = `${safeNum(l.titleDistance, 4)}px`;
  }



  num(el, name, key, min, max, step) {
    const l = this.plugin.settings.layout;
    new Setting(el).setName(name)
      .addSlider(sl => sl.setLimits(min, max, step).setValue(Number(l[key])).setDynamicTooltip().onChange(async v => { l[key] = v; await this.plugin.saveSettings(); }))
      .addText(t => t.setValue(String(l[key])).onChange(async v => { const n = Number(v); if (!Number.isFinite(n)) return; l[key] = n; await this.plugin.saveSettings(); }));
  }

  color(el, name, key, ph) {
    const l = this.plugin.settings.layout;
    const setting = new Setting(el).setName(name).setDesc(`支持 CSS 颜色：${ph}；点击颜色条会拾取并写入 rgb(r, g, b)，文本框也可手动输入 rgba(...)。`);
    let comp;
    setting.addText(t => { comp = t; t.setPlaceholder(ph).setValue(String(l[key] || '')).onChange(async v => { l[key] = cssValue(v.trim() || DEFAULT_SETTINGS.layout[key], DEFAULT_SETTINGS.layout[key]); await this.plugin.saveSettings(); this.display(); }); });
    const picker = setting.controlEl.createEl('input', { cls: 'etm-color-picker', type: 'color' });
    picker.value = cssToHex(l[key], cssToHex(DEFAULT_SETTINGS.layout[key], '#ffffff'));
    picker.addEventListener('input', async () => {
      l[key] = hexToRgbText(picker.value);
      comp?.setValue(l[key]);
      await this.plugin.saveSettings();
    });
    const sw = setting.controlEl.createDiv({ cls: 'etm-color-swatch' });
    sw.style.background = cssValue(l[key], DEFAULT_SETTINGS.layout[key]);
    setting.addButton(b => b.setButtonText('rgba').onClick(async () => { l[key] = 'rgba(255,255,255,.85)'; comp.setValue(l[key]); await this.plugin.saveSettings(); this.display(); }));
    setting.addButton(b => b.setButtonText('Reset').onClick(async () => { l[key] = DEFAULT_SETTINGS.layout[key]; await this.plugin.saveSettings(); this.display(); }));
  }
}

module.exports = ExcalidrawToolbarManager;
