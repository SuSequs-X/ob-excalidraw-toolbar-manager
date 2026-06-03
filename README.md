# Excalidraw Toolbar Manager

> An Obsidian plugin for managing Excalidraw pinned script toolbar buttons: read `pinnedScripts`, customize button titles, bind titles to toolbar buttons, reorder pinned scripts, and safely write changes back to Excalidraw `data.json` with automatic backups.

<img width="412" height="1242" alt="image" src="https://github.com/user-attachments/assets/fb3e18bb-2ebe-4f39-807b-a487ade477f2" />


## Overview

**Excalidraw Toolbar Manager** is designed for users who heavily use the [Obsidian Excalidraw plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) and pin many Excalidraw scripts to the right-side toolbar.

When many scripts are pinned, the default toolbar can become difficult to identify visually. This plugin reads Excalidraw's `pinnedScripts` list from `data.json`, then displays a custom title under each corresponding toolbar button.

The plugin does **not** replace Excalidraw's native buttons and does **not** intercept button clicks. It only enhances the visual display and optionally helps reorder `pinnedScripts` safely.

## Core Features

### 1. Read Excalidraw `pinnedScripts`

The plugin reads Excalidraw's configuration file:

```text
.obsidian/plugins/obsidian-excalidraw-plugin/data.json
```

and extracts:

```json
"pinnedScripts": []
```

These pinned scripts correspond to the script buttons shown in Excalidraw's right-side toolbar.

### 2. Bind titles to toolbar button blocks

Each title is bound directly to its corresponding toolbar button block.

The visual structure is:

```text
Toolbar button block
├─ native Excalidraw button icon
└─ custom title label
```

This means the title follows the button when the toolbar layout changes. The plugin does not create floating labels detached from the original button.

### 3. Skip default toolbar buttons

The first two toolbar buttons are Excalidraw default buttons and do not correspond to `pinnedScripts`.

By default, the plugin skips the first 2 button blocks:

```text
Button 1: default button, no title
Button 2: default button, no title
Button 3: pinnedScripts[0]
Button 4: pinnedScripts[1]
```

The first two buttons keep the same block layout as the other buttons, but no title text is displayed. This prevents title misalignment.

### 4. Customize button display names

You can customize the display name for each pinned script without renaming the actual script file.

For example:

```text
Original script file: Add unorder list.md
Custom display name: 无序列表
```

### 5. Drag to reorder pinned scripts

The plugin supports drag-and-drop reordering of the pinned script list.

Important distinction:

* Dragging changes the plugin's current `pinnedScripts` list.
* Excalidraw's native toolbar order is only changed after you explicitly write the new order back to `data.json`.
* The plugin does not use CSS `order` to fake visual sorting, because that can cause the displayed title and actual button function to mismatch.

### 6. Safe write-back to `data.json`

When writing changes back to Excalidraw's `data.json`, the plugin creates a backup first.

Backups are stored in:

```text
.obsidian/plugins/excalidraw-toolbar-manager/backups/
```

Backup filename format:

```text
data.json.bak.<timestamp>.json
```

Only the latest 10 backup versions are kept. Older backups are automatically removed.

### 7. RGB / color picker support

Color settings support both manual CSS color values and a native color picker.

Supported examples:

```css
#ffffff
rgb(255, 255, 255)
rgba(255, 255, 255, 0.85)
transparent
var(--text-muted)
```

You can customize:

* title text color
* title background color
* title border color
* button block background color
* button block border color

## Installation

### Manual installation

1. Download the latest release zip.
2. Extract it into your Obsidian vault:

```text
<your-vault>/.obsidian/plugins/excalidraw-toolbar-manager/
```

The folder should contain:

```text
excalidraw-toolbar-manager/
├─ manifest.json
├─ main.js
├─ styles.css
└─ README.md
```

3. Restart Obsidian.
4. Open **Settings → Community plugins**.
5. Enable **Excalidraw Toolbar Manager**.

## Basic Usage

### Step 1: Confirm the Excalidraw `data.json` path

Default path:

```text
.obsidian/plugins/obsidian-excalidraw-plugin/data.json
```

If your Excalidraw plugin folder is different, set the path manually in the plugin settings.

### Step 2: Read pinned scripts

Click:

```text
Read pinnedScripts
```

The plugin will load the current Excalidraw pinned script list.

### Step 3: Customize button names

Go to the button list and enter custom display names.

Example:

```text
Invert colors.md → 反转颜色
LatexEditor.md → LaTeX 编辑器
show outline.md → 显示大纲
```

### Step 4: Adjust title and block styles

You can customize:

* title font size
* title width
* title text color
* title background color
* title border
* title-to-icon distance
* button block padding
* button block border
* toolbar column layout

### Step 5: Optional: reorder buttons

Drag the script list to reorder.

To apply this order to Excalidraw's native toolbar, click:

```text
Write back to data.json
```

The plugin will create a backup before writing.

## Design Principles

### Title binding instead of floating labels

The title is bound to the original Excalidraw button block, so it stays aligned with the correct button.

### No CSS fake sorting

The plugin does not use CSS `order` to visually reorder buttons. Fake visual sorting may cause the button title and actual Excalidraw function to mismatch.

### Safe data writing

The plugin only writes to `data.json` when the user explicitly chooses to do so. Before writing, it creates a backup and keeps the latest 10 backups.

## Backup Policy

Backups are stored here:

```text
.obsidian/plugins/excalidraw-toolbar-manager/backups/
```

The plugin keeps the latest 10 backups.

Example:

```text
backups/
├─ data.json.bak.2026-06-03T05-36-12-000Z.json
├─ data.json.bak.2026-06-03T05-40-21-000Z.json
└─ ...
```

## Compatibility Notes

This plugin depends on Excalidraw's pinned script toolbar structure.

If Excalidraw changes its internal DOM structure or the location of `pinnedScripts`, this plugin may need an update.

The plugin assumes:

* the first two right-side toolbar buttons are default Excalidraw buttons;
* pinned script buttons start after those default buttons;
* the order of pinned script buttons follows `pinnedScripts` in `data.json`.

## Recommended Workflow

```text
1. Read pinnedScripts
2. Customize display names
3. Adjust title and block style
4. Drag reorder only if needed
5. Write back to data.json only when you want Excalidraw's native order to change
```

## Safety Notes

Before writing to `data.json`, the plugin creates a backup.

Still, it is recommended to keep your Obsidian vault under version control or regular backup if you frequently modify plugin configuration files.

## License

MIT License

## Credits

This plugin is designed for users of the Obsidian Excalidraw plugin.

Excalidraw Toolbar Manager is not affiliated with or officially maintained by the Excalidraw plugin author.
