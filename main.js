const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
  enabled: true,
  excalidrawPluginId: 'obsidian-excalidraw-plugin',
  dataJsonPath: '',
  pinnedScriptsText: '[]',
  autoReadOnLoad: true,
  showNativeTitle: true,
  leadingDefaultButtons: 2,
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

class ExcalidrawToolbarManager extends Plugin {
  async onload() {
    this.settings = deepMerge(DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.displayNames || typeof this.settings.displayNames !== 'object') this.settings.displayNames = {};

    this.styleEl = document.createElement('style');
    this.styleEl.id = 'excalidraw-toolbar-manager-style';
    document.head.appendChild(this.styleEl);

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
.excalidraw .tray-misc-tools-container{
  --etm-rows:${safeNum(l.rows, 5)};
  --etm-iconH:${safeNum(l.itemH, 30)}px;
  --etm-titleH:${titleH}px;
  --etm-titleDistance:${dist}px;
  --etm-cellH:calc(var(--etm-iconH) + var(--etm-titleDistance) + var(--etm-titleH) + ${safeNum(l.blockPaddingY, 3) * 2}px);
  --etm-vGap:${safeNum(l.vGap, 14)}px;
  --etm-colW:${safeNum(l.colW, 86)}px;
  --etm-colGap:${safeNum(l.colGap, 10)}px;
  --etm-maxW:${safeNum(l.maxW, 430)}px;
  --etm-moveUp:${safeNum(l.moveUp, 60)}px;
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
.excalidraw .tray-misc-tools-container,
.excalidraw .App-menu__right{overflow:visible !important;}
.excalidraw .tray-misc-tools-container{margin-top:calc(var(--etm-moveUp) * -1) !important;}
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu{
  display:flex !important;
  flex-flow:column wrap !important;
  align-content:flex-start !important;
  row-gap:var(--etm-vGap) !important;
  column-gap:var(--etm-colGap) !important;
  height:calc(var(--etm-rows) * var(--etm-cellH) + (var(--etm-rows) - 1) * var(--etm-vGap)) !important;
  max-width:var(--etm-maxW) !important;
  overflow-x:hidden !important;
  overflow-y:visible !important;
  background-image:none !important;
}
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-title],
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-skipped-default]{
  flex:0 0 var(--etm-cellH) !important;
  height:var(--etm-cellH) !important;
  width:var(--etm-colW) !important;
  margin:0 !important;
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
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-title]::after,
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-skipped-default]::after{
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
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-skipped-default]::after{
  content:"" !important;
  visibility:hidden !important;
}
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-title]:hover,
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-skipped-default]:hover{
  transform:scale(var(--etm-zoom)) !important;
  z-index:10 !important;
}
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-title]:has(input:checked),
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-skipped-default]:has(input:checked){
  transform:scale(var(--etm-zoom)) !important;
  z-index:8 !important;
}
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-title] .ToolIcon__icon,
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-skipped-default] .ToolIcon__icon{
  flex:0 0 var(--etm-iconH) !important;
  height:var(--etm-iconH) !important;
  width:100% !important;
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
}
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-title] .ToolIcon__icon svg,
.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon[data-etm-skipped-default] .ToolIcon__icon svg{
  width:var(--etm-iconSize) !important;
  height:var(--etm-iconSize) !important;
  display:block !important;
}`;
  }

  clearButtonAttrs() {
    document.querySelectorAll('.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon').forEach(el => {
      el.removeAttribute('data-etm-title');
      el.removeClass?.('etm-managed-button');
      el.removeAttribute('data-etm-skipped-default');
      el.style.removeProperty('order');
      if (el.getAttribute('data-etm-managed-title') === 'true') {
        el.removeAttribute('title');
        el.removeAttribute('data-etm-managed-title');
      }
    });
  }

  applyButtonAttrs() {
    this.clearButtonAttrs();
    if (!this.settings.enabled) return;
    const pinned = this.getPinnedScripts();
    const buttons = Array.from(document.querySelectorAll('.excalidraw .tray-misc-tools-container > .ExcalidrawObsidianMenu > label.ToolIcon'));
    const offset = Math.max(0, safeNum(this.settings.leadingDefaultButtons, 2));
    for (let j = 0; j < Math.min(offset, buttons.length); j++) {
      buttons[j].setAttribute('data-etm-skipped-default', 'true');
      buttons[j].removeAttribute('data-etm-title');
      buttons[j].addClass?.('etm-managed-button');
    }
    const count = Math.min(Math.max(0, buttons.length - offset), pinned.length);
    for (let i = 0; i < count; i++) {
      const btn = buttons[i + offset];
      const path = pinned[i];
      const name = this.getDisplayName(path);
      btn.setAttribute('data-etm-title', name);
      btn.addClass?.('etm-managed-button');
      if (this.settings.showNativeTitle) {
        btn.setAttribute('title', name);
        btn.setAttribute('data-etm-managed-title', 'true');
      }
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
    el.createEl('p', { text: '按 Excalidraw 原生 pinnedScripts 顺序绑定标题；支持拖拽调整 pinnedScripts 列表，但不使用视觉 order 重排，避免按钮功能错位。' });
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
