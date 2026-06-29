"use strict";

const { Plugin, ItemView, WorkspaceLeaf, TFile, Notice, Modal, Setting } = require("obsidian");

const VIEW_TYPE = "txt-annotator-view";

const COLORS = [
  { id: "yellow",  label: "颜色1" },
  { id: "pink",    label: "颜色2" },
  { id: "blue",    label: "颜色3" },
  { id: "green",   label: "颜色4" },
  { id: "orange",  label: "颜色5" },
];

// 默认颜色配置
const DEFAULT_COLORS = {
  yellow: { bg: "#FFF9C4", text: "#5c4a00", alpha: "rgba(249, 168, 37, 0.15)" },
  pink:   { bg: "#FCE4EC", text: "#880e4f", alpha: "rgba(233, 30, 99, 0.15)"  },
  blue:   { bg: "#E3F2FD", text: "#01579b", alpha: "rgba(33, 150, 243, 0.15)" },
  green:  { bg: "#E8F5E9", text: "#1b5e20", alpha: "rgba(76, 175, 80, 0.15)"  },
  orange: { bg: "#FFF3E0", text: "#e65100", alpha: "rgba(255, 152, 0, 0.15)"  },
};

// ── Annotation Store ────────────────────────────────────────────
class AnnotationStore {
  constructor(app, txtPath, annotationFolder, plugin) {
    this.app = app;
    this.txtPath = txtPath;
    this.annotationFolder = annotationFolder;
    this.plugin = plugin;
  }

  getBaseName() {
    return this.txtPath.replace(/\\/g, "/").split("/").pop();
  }

  getJsonPath() {
    return `.obsidian/txt-annotator-data/${this.getBaseName()}.json`;
  }

  getMdPath() {
    const base = this.getBaseName().replace(/\.txt$/i, "");
    return `${this.annotationFolder}/${base}.md`;
  }

  async load() {
    const path = this.getJsonPath();
    try {
      if (!(await this.app.vault.adapter.exists(path))) return { annotations: [] };
      const text = await this.app.vault.adapter.read(path);
      return JSON.parse(text);
    } catch {
      return { annotations: [] };
    }
  }

  async save(data, style) {
    const folder = this.annotationFolder;
    try {
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
    } catch(e) { /* 已存在则忽略 */ }

    const jsonPath = this.getJsonPath();
    const json = JSON.stringify(data, null, 2);
    try {
      const jsonFolder = ".obsidian/txt-annotator-data";
      if (!(await this.app.vault.adapter.exists(jsonFolder))) {
        await this.app.vault.adapter.mkdir(jsonFolder);
      }
      await this.app.vault.adapter.write(jsonPath, json);
    } catch(e) {
      console.error("[TxtAnnotator] JSON save error:", e);
    }

    await this.saveMd(data, style);
  }

  async saveMd(data, style) {
    const bookName = this.getBaseName().replace(/\.txt$/i, "");
    const anns = [...data.annotations].sort((a, b) =>
      a.line !== b.line ? a.line - b.line : a.start - b.start
    );
    style = style || this.plugin?.settings?.noteStyle || "card";

    const lines = [];
    lines.push(`---`);
    lines.push(`source: ${this.getBaseName()}`);
    lines.push(`updated: ${new Date().toISOString().slice(0, 10)}`);
    lines.push(`---`);
    lines.push(``);
    lines.push(`# 笔记`);
    lines.push(``);

    if (anns.length === 0) {
      lines.push("_暂无划线_");
    } else if (style === "simple") {
      // 简洁版 - 使用 Callout
      for (const ann of anns) {
        const colorId = COLORS.find(c => c.id === ann.color) ? ann.color : "yellow";
        const hasNote = !!(ann.note && ann.note.trim());
        
        lines.push(`> [!txt-simple-${colorId}] ${ann.text}`);
        
        if (hasNote) {
          const noteLines = ann.note.split("\n");
          for (const nl of noteLines) {
            lines.push(`> <span class="txt-simple-note-line">${nl}</span>`);
          }
        }
        lines.push(``);
      }
    } else {
      // 卡片版 - 使用 Callout
      for (const ann of anns) {
        const hasNote = !!(ann.note && ann.note.trim());
        const colorId = COLORS.find(c => c.id === ann.color) ? ann.color : "yellow";
        const dt = ann.createdAt ? new Date(ann.createdAt) : new Date();
        const dtStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;

        // 用 callout type 本身区分有/无批注：Obsidian 的 callout 语法不支持
        // 往渲染出来的 DOM 上塞自定义 data 属性，所以用不同的 type 字符串
        // （txt-card-${colorId} vs txt-card-${colorId}-note）让 CSS 能分别设置图标。
        const calloutType = hasNote ? `txt-card-${colorId}-note` : `txt-card-${colorId}`;

        // 标题留空，只渲染图标；高亮文字放进 body 第一段。
        // 注意：callout 内的空行（单独一个 ">"）才会被 Markdown 解析成段落分隔，
        // 否则连续的 "> 文本" 行会被合并成同一个 <p>，导致 CSS 的
        // :first-child / :not(:first-child) 选择器完全分不出高亮和批注。
        lines.push(`> [!${calloutType}]`);
        lines.push(`> <span class="txt-card-highlight-text">　　${ann.text}</span>`);

        if (hasNote) {
          lines.push(`>`);
          const noteLines = ann.note.split("\n");
          // 批注整体在高亮文字（缩进2字符）的基础上再缩进2字符，即每行都缩进4字符；
          // 首行额外加一个圆点标记，与高亮文字形成视觉区分。
          noteLines.forEach((nl, i) => {
            const indent = "　　　　"; // 4 个全角空格 = 缩进4字符
            const prefix = i === 0 ? "• " : "　";  // 圆点后跟一个空格，对齐非首行的占位
            lines.push(`> <span class="txt-card-note-text">${indent}${prefix}${nl}</span>`);
          });
        }

        lines.push(`>`);
        lines.push(`> <hr class="txt-card-divider">`);
        lines.push(`> <span class="txt-card-timestamp">${dtStr}</span>`);
        lines.push(``);
      }
    }

    const mdContent = lines.join("\n");
    const mdPath = this.getMdPath();
    try {
      const mdFile = this.app.vault.getFileByPath(mdPath);
      if (mdFile) {
        await this.app.vault.modify(mdFile, mdContent);
      } else {
        await this.app.vault.create(mdPath, mdContent);
      }
    } catch(e) {
      const mdFile2 = this.app.vault.getFileByPath(mdPath);
      if (mdFile2) await this.app.vault.modify(mdFile2, mdContent);
    }
  }
}

// ── Note Modal ──────────────────────────────────────────────────
class NoteModal extends Modal {
  constructor(app, initialNote, onSave) {
    super(app);
    this.initialNote = initialNote || "";
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("txt-note-modal");
    contentEl.createEl("h3", { text: "添加批注", cls: "txt-modal-title" });

    const textarea = contentEl.createEl("textarea", { cls: "txt-modal-textarea" });
    textarea.value = this.initialNote;
    textarea.placeholder = "在此输入批注…";
    setTimeout(() => textarea.focus(), 50);

    const btnRow = contentEl.createDiv({ cls: "txt-modal-btns" });

    const cancelBtn = btnRow.createEl("button", { text: "取消", cls: "txt-modal-btn txt-modal-btn-cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = btnRow.createEl("button", { text: "保存", cls: "txt-modal-btn txt-modal-btn-save" });
    saveBtn.addEventListener("click", () => {
      this.onSave(textarea.value.trim());
      this.close();
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        this.onSave(textarea.value.trim());
        this.close();
      }
      if (e.key === "Escape") this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Main View ───────────────────────────────────────────────────
class TxtAnnotatorView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
    this.lines = [];
    this.data = { annotations: [] };
    this.store = null;
    this.popupEl = null;
    this.selection = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file ? this.file.basename : "TXT 阅读器"; }
  getIcon() { return "book-open"; }

  async onOpen() {
    this.containerEl.addClass("txt-annotator-root");
    this.injectColorVariables();
    this.buildUI();
  }

  // 注入 CSS 变量（实际逻辑放在插件层，这样设置面板改动后也能调用同一份逻辑刷新）
  injectColorVariables() {
    this.plugin.applyCssVariables();
  }

  buildUI() {
    const root = this.containerEl.children[1] || this.containerEl;
    root.empty();
    root.addClass("txt-annotator-container");

    this.headerEl = root.createDiv({ cls: "txt-header" });
    this.titleEl = this.headerEl.createDiv({ cls: "txt-title", text: "请打开一个 TXT 文件" });

    this.contentEl2 = root.createDiv({ cls: "txt-content" });
    this.contentEl2.addEventListener("mouseup", (e) => this.onMouseUp(e));
    this.contentEl2.addEventListener("touchend", (e) => this.onMouseUp(e));

    this._scrollTimer = null;
    this._closing = false;
    this.contentEl2.addEventListener("scroll", () => {
      if (this._closing) return;
      if (this._scrollTimer) clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(() => {
        if (!this._closing) this.saveScrollPosition();
      }, 1000);
    });

    document.addEventListener("mousedown", (e) => {
      if (this.popupEl && !this.popupEl.contains(e.target)) {
        this.dismissPopup();
      }
    });
  }

  async setState(state, result) {
    if (state?.file) {
      const file = this.app.vault.getFileByPath(state.file);
      if (file) await this.loadFile(file);
    }
  }

  getState() {
    return { file: this.file?.path };
  }

  async loadFile(file) {
    this.file = file;
    const annotationFolder = this.plugin.settings.annotationFolder;
    this.store = new AnnotationStore(this.app, file.path, annotationFolder, this);
    this.data = await this.store.load();

    const text = await this.app.vault.read(file);
    this.lines = text.split("\n");

    this.titleEl.setText(file.basename);
    this.injectColorVariables();
    this.render();

    setTimeout(async () => {
      const pos = await this.loadScrollPosition();
      if (pos > 0) {
        this.contentEl2.scrollTop = pos;
        setTimeout(() => {
          this.contentEl2.scrollTop = pos;
        }, 200);
      }
    }, 150);
  }

  render() {
    this.contentEl2.empty();
    this.dismissPopup();

    const fragment = document.createDocumentFragment();
    this.lines.forEach((line, lineIdx) => {
      const lineEl = document.createElement("div");
      lineEl.className = "txt-line";
      lineEl.dataset.line = String(lineIdx);

      if (line.trim() === "") {
        lineEl.addClass("txt-line-empty");
        lineEl.appendChild(document.createElement("br"));
      } else {
        this.renderLineWithAnnotations(lineEl, line, lineIdx);
      }

      fragment.appendChild(lineEl);
    });

    this.contentEl2.appendChild(fragment);
  }

  renderLineWithAnnotations(lineEl, line, lineIdx) {
    const anns = this.data.annotations
      .filter(a => a.line === lineIdx)
      .sort((a, b) => a.start - b.start);

    if (anns.length === 0) {
      lineEl.appendChild(document.createTextNode(line));
      return;
    }

    const colors = this.plugin.settings.colors || DEFAULT_COLORS;

    let cursor = 0;
    for (const ann of anns) {
      if (ann.start > cursor) {
        lineEl.appendChild(document.createTextNode(line.slice(cursor, ann.start)));
      }
      const end = Math.min(ann.end, line.length);
      const span = document.createElement("span");
      const colorId = COLORS.find(c => c.id === ann.color) ? ann.color : COLORS[0].id;
      const colorConfig = colors[colorId] || colors[COLORS[0].id];
      
      span.className = `txt-highlight txt-highlight-${colorId}`;
      span.style.backgroundColor = colorConfig.bg;
      span.style.color = colorConfig.text;
      span.dataset.annId = ann.id;
      span.textContent = line.slice(ann.start, end);

      if (ann.note) {
        span.addClass("txt-has-note");
        span.dataset.note = ann.note;
        const noteIcon = document.createElement("span");
        noteIcon.className = "txt-note-icon";
        noteIcon.textContent = "✎";
        span.appendChild(noteIcon);

        span.addEventListener("mouseenter", (e) => this.showNoteTooltip(e, ann));
        span.addEventListener("mouseleave", () => this.hideNoteTooltip());
      }

      span.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) {
          this.jumpToAnnotationInNote(ann);
        } else {
          this.showAnnotationMenu(e, ann);
        }
      });

      lineEl.appendChild(span);
      cursor = end;
    }

    if (cursor < line.length) {
      lineEl.appendChild(document.createTextNode(line.slice(cursor)));
    }
  }

  // ── Selection & Popup ──────────────────────────────────────────
  onMouseUp(e) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim() === "") return;

    const range = sel.getRangeAt(0);
    const startNode = range.startContainer;
    const endNode = range.endContainer;

    const startLine = this.getLineEl(startNode);
    const endLine = this.getLineEl(endNode);

    if (!startLine || !endLine || startLine !== endLine) {
      return;
    }

    const lineIdx = parseInt(startLine.dataset.line);
    const lineText = this.lines[lineIdx];

    const startOffset = this.getTextOffset(startLine, range.startContainer, range.startOffset);
    const endOffset = this.getTextOffset(startLine, range.endContainer, range.endOffset);

    if (startOffset === null || endOffset === null || startOffset >= endOffset) return;

    const existingOnLine = this.data.annotations.filter(a => a.line === lineIdx);
    let snappedStart = startOffset;
    let snappedEnd = endOffset;
    for (const a of existingOnLine) {
      if (Math.abs(snappedStart - a.end) === 1) snappedStart = a.end;
      if (Math.abs(snappedEnd - a.start) === 1) snappedEnd = a.start;
    }
    if (snappedStart >= snappedEnd) return;

    this.selection = { lineIdx, start: snappedStart, end: snappedEnd, text: lineText.slice(snappedStart, snappedEnd) };

    const rect = range.getBoundingClientRect();
    this.showColorPopup(rect);
  }

  getLineEl(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && !el.classList.contains("txt-line")) {
      el = el.parentElement;
    }
    return el;
  }

  getTextOffset(lineEl, targetNode, targetOffset) {
    let offset = 0;
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === targetNode) {
        return offset + targetOffset;
      }
      offset += node.textContent.length;
    }
    return null;
  }

  showColorPopup(rect) {
    this.dismissPopup();

    const popup = document.createElement("div");
    popup.className = "txt-color-popup";
    this.popupEl = popup;

    const colors = this.plugin.settings.colors || DEFAULT_COLORS;

    const colorRow = document.createElement("div");
    colorRow.className = "txt-popup-colors";
    popup.appendChild(colorRow);
    for (const color of COLORS) {
      const btn = document.createElement("button");
      btn.className = `txt-color-btn txt-color-btn-${color.id}`;
      const c = colors[color.id] || colors[COLORS[0].id];
      btn.style.backgroundColor = c.bg;
      btn.style.borderColor = c.text;
      btn.title = color.label;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.addAnnotation(color.id, null);
      });
      colorRow.appendChild(btn);
    }

    const noteBtn = document.createElement("button");
    noteBtn.className = "txt-popup-note-btn";
    noteBtn.textContent = "✎ 批注";
    noteBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.dismissPopup();
      new NoteModal(this.app, "", (note) => {
        this.addAnnotation("yellow", note);
      }).open();
    });
    popup.appendChild(noteBtn);

    popup.style.position = "fixed";
    popup.style.visibility = "hidden";
    document.body.appendChild(popup);

    requestAnimationFrame(() => {
      const ph = popup.offsetHeight;
      const pw = popup.offsetWidth;
      let top = rect.top - ph - 8;
      let left = rect.left + rect.width / 2 - pw / 2;
      if (top < 8) top = rect.bottom + 8;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      popup.style.top = `${top}px`;
      popup.style.left = `${left}px`;
      popup.style.visibility = "visible";
      popup.style.opacity = "1";
    });
  }

  dismissPopup() {
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
  }

  showAnnotationMenu(e, ann) {
    e.preventDefault();
    this.dismissPopup();

    const popup = document.createElement("div");
    popup.className = "txt-color-popup txt-ann-menu";
    this.popupEl = popup;

    const colors = this.plugin.settings.colors || DEFAULT_COLORS;

    const colorRow = document.createElement("div");
    colorRow.className = "txt-popup-colors";
    popup.appendChild(colorRow);
    for (const color of COLORS) {
      const btn = document.createElement("button");
      btn.className = `txt-color-btn txt-color-btn-${color.id}` + (ann.color === color.id ? " txt-color-btn-active" : "");
      const c = colors[color.id] || colors[COLORS[0].id];
      btn.style.backgroundColor = c.bg;
      btn.style.borderColor = c.text;
      btn.title = color.label;
      btn.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ann.color = color.id;
        this.saveAndRender();
      });
      colorRow.appendChild(btn);
    }

    const noteBtn = document.createElement("button");
    noteBtn.className = "txt-popup-note-btn";
    noteBtn.textContent = ann.note ? "✎ 编辑批注" : "✎ 添加批注";
    noteBtn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      this.dismissPopup();
      new NoteModal(this.app, ann.note || "", (note) => {
        ann.note = note;
        this.saveAndRender();
      }).open();
    });
    popup.appendChild(noteBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "txt-popup-del-btn";
    delBtn.textContent = "✕ 删除高亮";
    delBtn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      this.data.annotations = this.data.annotations.filter(a => a.id !== ann.id);
      this.saveAndRender();
    });
    popup.appendChild(delBtn);

    popup.style.position = "fixed";
    popup.style.visibility = "hidden";
    document.body.appendChild(popup);

    requestAnimationFrame(() => {
      const ph = popup.offsetHeight;
      const pw = popup.offsetWidth;
      let top = e.clientY - ph - 8;
      let left = e.clientX - pw / 2;
      if (top < 8) top = e.clientY + 16;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      popup.style.top = `${top}px`;
      popup.style.left = `${left}px`;
      popup.style.visibility = "visible";
      popup.style.opacity = "1";
    });
  }

  // ── Note Tooltip ───────────────────────────────────────────────
  showNoteTooltip(e, ann) {
    this.hideNoteTooltip();
    const tip = document.createElement("div");
    tip.className = "txt-note-tooltip";
    tip.textContent = ann.note;
    document.body.appendChild(tip);
    this.tooltipEl = tip;

    const rect = e.target.getBoundingClientRect();
    tip.style.top = `${rect.bottom + window.scrollY + 6}px`;
    tip.style.left = `${rect.left + window.scrollX}px`;
  }

  hideNoteTooltip() {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }

  // ── Data Operations ────────────────────────────────────────────
  addAnnotation(colorId, note) {
    if (!this.selection) return;
    const { lineIdx, start, end, text } = this.selection;

    const existing = this.data.annotations.filter(a => a.line === lineIdx);
    const hasOverlap = existing.some(a => !(end <= a.start || start >= a.end));
    if (hasOverlap) {
      new Notice("该区域已有高亮，请先删除再添加");
      this.dismissPopup();
      window.getSelection()?.removeAllRanges();
      this.selection = null;
      return;
    }

    const ann = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      line: lineIdx,
      start,
      end,
      text,
      color: colorId,
      note: note || "",
      createdAt: new Date().toISOString(),
    };

    this.data.annotations.push(ann);
    this.saveAndRender();
    window.getSelection()?.removeAllRanges();
    this.selection = null;
  }

  async saveAndRender() {
    this.dismissPopup();
    const style = this.plugin?.settings?.noteStyle || "card";
    await this.store.save(this.data, style);
    const scrollTop = this.contentEl2?.scrollTop || 0;
    this.render();
    if (scrollTop > 0) {
      setTimeout(() => { this.contentEl2.scrollTop = scrollTop; }, 0);
    }
  }

  async jumpToAnnotationInNote(ann) {
    if (!this.store) return;
    const mdPath = this.store.getMdPath();
    const mdFile = this.app.vault.getFileByPath(mdPath);
    if (!mdFile) {
      new Notice("批注文件不存在，请先添加高亮后再试");
      return;
    }

    const mdText = await this.app.vault.read(mdFile);
    const mdLines = mdText.split("\n");
    let targetLine = -1;

    const escapedText = ann.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 简洁版：> [!txt-simple-COLOR] 高亮文字（文字在 callout 标题行内联）
    const simpleRe = new RegExp(`^>\\s*\\[!txt-simple-[^\\]]+\\]\\s*${escapedText}\\s*$`);

    // 卡片版：callout 标题行（> [!txt-card-COLOR]）单独一行，
    // 高亮文字在紧接的下一行 <span class="txt-card-highlight-text">　　文字</span>
    const cardHeaderRe = /^>\s*\[!txt-card-[^\]]+\]/;
    const cardTextRe = new RegExp(`^>\\s*<span[^>]*txt-card-highlight-text[^>]*>\\s*${escapedText}\\s*<\\/span>\\s*$`);

    for (let i = 0; i < mdLines.length; i++) {
      // 简洁版匹配
      if (simpleRe.test(mdLines[i])) {
        targetLine = i;
        break;
      }
      // 卡片版匹配：当前行是卡片 callout 标题，下一行包含高亮文字
      if (cardHeaderRe.test(mdLines[i]) && i + 1 < mdLines.length && cardTextRe.test(mdLines[i + 1])) {
        targetLine = i;
        break;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(mdFile, {
      eState: targetLine >= 0 ? { line: targetLine } : undefined
    });
    this.app.workspace.revealLeaf(leaf);
    if (targetLine >= 0) {
      new Notice("已跳转到笔记位置");
    }
  }

  getScrollKey() {
    return `.obsidian/txt-annotator-data/__scroll__${this.file?.path?.replace(/[\/\\]/g, "_") || ""}`;
  }

  async saveScrollPosition() {
    if (!this.file || !this.contentEl2) return;
    const pos = this.contentEl2.scrollTop;
    try {
      await this.app.vault.adapter.write(this.getScrollKey(), String(pos));
    } catch(e) { console.error("[TxtAnnotator] scroll save error:", e); }
  }

  async loadScrollPosition() {
    if (!this.file) return 0;
    try {
      const key = this.getScrollKey();
      if (!(await this.app.vault.adapter.exists(key))) return 0;
      const text = await this.app.vault.adapter.read(key);
      return parseFloat(text) || 0;
    } catch(e) { return 0; }
  }

  async onClose() {
    this._closing = true;
    if (this._scrollTimer) clearTimeout(this._scrollTimer);
    this.dismissPopup();
    this.hideNoteTooltip();
  }
}

// ── Plugin ──────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  annotationFolder: "Annotations",
  noteStyle: "card",
  timestampSize: "12px",
  timestampColor: "var(--text-muted)",
  highlightFontSize: "18px",
  highlightFontWeight: "normal",
  highlightFontFamily: "var(--font-text)",
  highlightColor: "var(--text-normal)",
  noteFontSize: "14px",
  noteFontWeight: "normal",
  noteFontFamily: "var(--font-text)",
  noteColor: "var(--text-muted)",
  noteLineHeight: "1.6",
  cardBgColorNoNote: "", // 留空则跟随系统默认背景 var(--background-primary)
  cardBgColorNote: "",   // 留空则跟随系统默认背景 var(--background-primary)
  dividerColor: "var(--background-modifier-border)",
  colors: JSON.parse(JSON.stringify(DEFAULT_COLORS)),
};

class TxtAnnotatorPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.applyCssVariables();

    this.registerView(VIEW_TYPE, (leaf) => new TxtAnnotatorView(leaf, this));

    this.registerExtensions(["txt"], VIEW_TYPE);

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        const seen = new Map();
        for (const leaf of leaves) {
          const path = leaf.view?.file?.path;
          if (!path) continue;
          if (seen.has(path)) {
            leaf.detach();
          } else {
            seen.set(path, leaf);
          }
        }
      })
    );

    this.addSettingTab(new TxtAnnotatorSettingTab(this.app, this));

    this.addCommand({
      id: "open-txt-annotator",
      name: "打开 TXT 阅读器",
      callback: () => this.activateView(),
    });
  }

  // 把设置里的字体/颜色/时间戳配置写成全局 CSS 变量。
  // 之前这段逻辑只在打开 TXT 文件（onOpen / loadFile）时跑一次，
  // 设置面板的 onChange 只是把值存进 settings.json，从来没有重新调用它，
  // 所以改了设置但已打开的视图/笔记完全看不到变化，必须重开文件才生效。
  // 现在把它挪到插件层，并在 saveSettings() 里统一调用，
  // 这样设置面板任何一项改动都会立刻反映到已经打开的内容里。
  applyCssVariables() {
    const settings = this.settings;
    const colors = settings.colors || DEFAULT_COLORS;

    const lines = [":root {"];
    for (const colorId of Object.keys(colors)) {
      const c = colors[colorId];
      lines.push(`  --txt-color-${colorId}-bg: ${c.bg};`);
      lines.push(`  --txt-color-${colorId}-text: ${c.text};`);
      lines.push(`  --txt-color-${colorId}-border: ${c.border};`);
      lines.push(`  --txt-color-${colorId}-alpha: ${c.alpha};`);
    }

    // 高亮文字设置
    lines.push(`  --txt-highlight-font-size: ${settings.highlightFontSize || '18px'};`);
    lines.push(`  --txt-highlight-font-weight: ${settings.highlightFontWeight || 'normal'};`);
    lines.push(`  --txt-highlight-font-family: ${settings.highlightFontFamily || 'var(--font-text)'};`);
    lines.push(`  --txt-highlight-color: ${settings.highlightColor || 'var(--text-normal)'};`);

    // 批注文字设置
    lines.push(`  --txt-note-font-size: ${settings.noteFontSize || '14px'};`);
    lines.push(`  --txt-note-font-weight: ${settings.noteFontWeight || 'normal'};`);
    lines.push(`  --txt-note-font-family: ${settings.noteFontFamily || 'var(--font-text)'};`);
    lines.push(`  --txt-note-color: ${settings.noteColor || 'var(--text-muted)'};`);
    lines.push(`  --txt-note-line-height: ${settings.noteLineHeight || '1.6'};`);

    // 时间戳设置
    lines.push(`  --txt-timestamp-size: ${settings.timestampSize || '12px'};`);
    lines.push(`  --txt-timestamp-color: ${settings.timestampColor || 'var(--text-muted)'};`);

    // 卡片版分割线颜色
    lines.push(`  --txt-divider-color: ${settings.dividerColor || 'var(--background-modifier-border)'};`);
    lines.push("}");

    // 卡片背景颜色：仅高亮 / 带批注 两组，分别可整体覆盖卡片背景，
    // 留空则跟随系统默认背景。图标颜色始终跟随各高亮颜色自身的 text 色，不在此处覆盖。
    if (settings.cardBgColorNoNote) {
      lines.push(`.callout[data-callout^="txt-card-"]:not([data-callout$="-note"]) {`);
      lines.push(`  background: ${settings.cardBgColorNoNote} !important;`);
      lines.push(`}`);
    }
    if (settings.cardBgColorNote) {
      lines.push(`.callout[data-callout$="-note"] {`);
      lines.push(`  background: ${settings.cardBgColorNote} !important;`);
      lines.push(`}`);
    }

    // 用专属 <style> 标签承载这些变量，而不是直接写 document.documentElement.style。
    // inline style 在某些渲染上下文里可能传不过去，且重启后容易看起来"复位"；
    // <style> 标签内容随 onload 重新整段写入，更稳定可靠。
    let styleEl = document.getElementById("txt-annotator-dynamic-vars");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "txt-annotator-dynamic-vars";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = lines.join("\n");
  }

  onunload() {
    const styleEl = document.getElementById("txt-annotator-dynamic-vars");
    if (styleEl) styleEl.remove();
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length) {
      this.app.workspace.revealLeaf(leaves[0]);
    } else {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.colors || typeof this.settings.colors !== 'object') {
      this.settings.colors = JSON.parse(JSON.stringify(DEFAULT_COLORS));
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyCssVariables();
  }
}

// ── Settings Tab ────────────────────────────────────────────────
class TxtAnnotatorSettingTab extends require("obsidian").PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    // 辅助：为 Setting 控件区添加「色块 picker + 文字输入框」组合
    // 当值为 CSS 变量（var(...)）时，picker 显示灰色占位，文字框仍正常编辑
    const addColorPickerToSetting = (setting, initValue, onChange) => {
      const wrap = setting.controlEl.createDiv({ cls: "txt-settings-color-row" });

      const picker = wrap.createEl("input", { type: "color" });
      picker.className = "txt-settings-color-picker";
      const isCssVar = (v) => typeof v === "string" && v.trim().startsWith("var(");
      // 色块始终可点击：当前值是 CSS 变量（或留空）时，色块只是显示一个中性灰占位，
      // 一旦用户点色块选色，就视为「换成具体颜色」，直接覆盖原值。
      picker.value = isCssVar(initValue) ? "#888888" : (initValue || "#888888");
      picker.title = isCssVar(initValue) ? "当前使用 CSS 变量，点击色块将替换为具体颜色" : "";

      const textEl = wrap.createEl("input", { type: "text" });
      textEl.className = "txt-settings-color-text";
      textEl.value = initValue || "";
      textEl.placeholder = initValue || "";

      // picker → text（色块永远可操作）
      picker.addEventListener("input", () => {
        textEl.value = picker.value;
        picker.title = "";
        onChange(picker.value);
      });
      // text → picker（仅当值是合法 hex 时同步预览色，但不影响 picker 是否可点）
      textEl.addEventListener("input", () => {
        const v = textEl.value.trim();
        const isHex = /^#[0-9a-fA-F]{3,6}$/.test(v);
        if (isHex) {
          picker.value = v;
          picker.title = "";
        } else {
          picker.title = isCssVar(v) ? "当前使用 CSS 变量，点击色块将替换为具体颜色" : "";
        }
      });
      textEl.addEventListener("change", () => {
        onChange(textEl.value.trim() || "");
      });
    };

    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TXT Annotator 设置" });

    // ── 基本设置 ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "基本设置" });

    new Setting(containerEl)
      .setName("批注存储文件夹")
      .setDesc("批注 Markdown 文件存放的文件夹路径（相对于 vault 根目录）")
      .addText((text) =>
        text
          .setPlaceholder("Annotations")
          .setValue(this.plugin.settings.annotationFolder)
          .onChange(async (value) => {
            this.plugin.settings.annotationFolder = value.trim() || "Annotations";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("批注笔记风格")
      .setDesc("选择批注 Markdown 文件的显示风格")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("simple", "简洁版")
          .addOption("card", "卡片版")
          .setValue(this.plugin.settings.noteStyle)
          .onChange(async (value) => {
            this.plugin.settings.noteStyle = value;
            await this.plugin.saveSettings();
          })
      );

    // ── 颜色设置 ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "高亮颜色自定义" });
    containerEl.createEl("p", { 
      text: "自定义每种高亮颜色的显示效果。修改后需要重新打开 TXT 文件才能生效。",
      cls: "setting-item-description"
    });

    const colors = this.plugin.settings.colors || DEFAULT_COLORS;
    const colorIds = ["yellow", "pink", "blue", "green", "orange"];
    const colorLabels = { yellow: "颜色1", pink: "颜色2", blue: "颜色3", green: "颜色4", orange: "颜色5" };

    for (const colorId of colorIds) {
      const color = colors[colorId] || DEFAULT_COLORS[colorId];
      const label = colorLabels[colorId];

      const colorSetting = new Setting(containerEl)
        .setName(`${label}`)

      const colorContainer = document.createElement("div");
      colorContainer.className = "txt-settings-color-container";

      // 辅助函数：创建一行（label + color picker + text input）
      const makeRow = (labelText, initValue) => {
        const row = document.createElement("div");
        row.className = "txt-settings-color-row";

        const label = document.createElement("span");
        label.textContent = labelText;
        label.className = "txt-settings-color-label";

        const picker = document.createElement("input");
        picker.type = "color";
        picker.value = initValue;
        picker.className = "txt-settings-color-picker";

        const text = document.createElement("input");
        text.type = "text";
        text.value = initValue;
        text.className = "txt-settings-color-text";

        row.appendChild(label);
        row.appendChild(picker);
        row.appendChild(text);
        return { row, picker, text };
      };

      const bg     = makeRow("背景色:", color.bg);
      const txt    = makeRow("文字色:", color.text);
      

      // 保持变量名兼容下方 saveColor 逻辑
      const bgInput = bg.picker,     bgText     = bg.text;
      const textInput = txt.picker,  textText   = txt.text;
      

      colorContainer.appendChild(bg.row);
      colorContainer.appendChild(txt.row);
      

      // 保存颜色变化
      const saveColor = () => {
        const newBg = bgInput.value || bgText.value;
        const newText = textInput.value || textText.value;

        color.bg = newBg;
        color.text = newText;

       
        const hexToRgb = (hex) => {
          const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
          return r ? `${parseInt(r[1],16)}, ${parseInt(r[2],16)}, ${parseInt(r[3],16)}` : "249, 168, 37";
        };
        color.alpha = `rgba(${hexToRgb(newBg)}, 0.15)`;

        this.plugin.settings.colors[colorId] = color;
        this.plugin.saveSettings();
      };

      bgInput.addEventListener("input", () => {
        bgText.value = bgInput.value;
        saveColor();
      });
      
      bgText.addEventListener("change", () => {
        bgInput.value = bgText.value;
        saveColor();
      });
      
      textInput.addEventListener("input", () => {
        textText.value = textInput.value;
        saveColor();
      });
      
      textText.addEventListener("change", () => {
        textInput.value = textText.value;
        saveColor();
      });
      

      colorSetting.controlEl.appendChild(colorContainer);
    }

    // 重置颜色按钮
    new Setting(containerEl)
      .setName("重置颜色")
      .setDesc("恢复所有颜色到默认值")
      .addButton(button => {
        button.setButtonText("重置");
        button.setCta();
        button.onClick(async () => {
          this.plugin.settings.colors = JSON.parse(JSON.stringify(DEFAULT_COLORS));
          await this.plugin.saveSettings();
          this.display();
          new Notice("颜色已重置为默认值");
        });
      });


    // 高亮文字设置组
    containerEl.createEl("h4", { text: "高亮文字", cls: "txt-settings-h4" });

    new Setting(containerEl)
      .setName("高亮文字字号")
      .addText((text) =>
        text
          .setPlaceholder("18px")
          .setValue(this.plugin.settings.highlightFontSize)
          .onChange(async (value) => {
            this.plugin.settings.highlightFontSize = value || "18px";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("高亮文字粗细")
      .setDesc("normal、bold、500、600 等")
      .addText((text) =>
        text
          .setPlaceholder("normal")
          .setValue(this.plugin.settings.highlightFontWeight)
          .onChange(async (value) => {
            this.plugin.settings.highlightFontWeight = value || "normal";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("高亮文字字体")
      .setDesc("系统中可用的字体")
      .addText((text) =>
        text
          .setPlaceholder("var(--font-text)")
          .setValue(this.plugin.settings.highlightFontFamily)
          .onChange(async (value) => {
            this.plugin.settings.highlightFontFamily = value || "var(--font-text)";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("高亮文字颜色")
      .then(setting => {
        addColorPickerToSetting(setting,
          this.plugin.settings.highlightColor,
          async (value) => {
            this.plugin.settings.highlightColor = value || "var(--text-normal)";
            await this.plugin.saveSettings();
          }
        );
      });

    // 批注文字设置组
    containerEl.createEl("h4", { text: "批注文字", cls: "txt-settings-h4" });

    new Setting(containerEl)
      .setName("批注文字字号")
      .addText((text) =>
        text
          .setPlaceholder("14px")
          .setValue(this.plugin.settings.noteFontSize)
          .onChange(async (value) => {
            this.plugin.settings.noteFontSize = value || "14px";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("批注文字粗细")
      .setDesc("normal、bold、500、600 等")
      .addText((text) =>
        text
          .setPlaceholder("normal")
          .setValue(this.plugin.settings.noteFontWeight)
          .onChange(async (value) => {
            this.plugin.settings.noteFontWeight = value || "normal";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("批注文字字体")
      .setDesc("系统中可用的字体")
      .addText((text) =>
        text
          .setPlaceholder("var(--font-text)")
          .setValue(this.plugin.settings.noteFontFamily)
          .onChange(async (value) => {
            this.plugin.settings.noteFontFamily = value || "var(--font-text)";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("批注文字颜色")
      .then(setting => {
        addColorPickerToSetting(setting,
          this.plugin.settings.noteColor,
          async (value) => {
            this.plugin.settings.noteColor = value || "var(--text-muted)";
            await this.plugin.saveSettings();
          }
        );
      });

    new Setting(containerEl)
      .setName("批注文字行高")
      .addText((text) =>
        text
          .setPlaceholder("1.6")
          .setValue(this.plugin.settings.noteLineHeight)
          .onChange(async (value) => {
            this.plugin.settings.noteLineHeight = value || "1.6";
            await this.plugin.saveSettings();
          })
      );

    // ── 时间戳设置 ────────────────────────────────────────────
    containerEl.createEl("h3", { text: "时间戳设置" });

    new Setting(containerEl)
      .setName("时间戳字号")
      .setDesc("卡片版笔记中时间戳的字号")
      .addText((text) =>
        text
          .setPlaceholder("12px")
          .setValue(this.plugin.settings.timestampSize)
          .onChange(async (value) => {
            this.plugin.settings.timestampSize = value || "12px";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("时间戳颜色")
      .setDesc("卡片版笔记中时间戳的颜色")
      .then(setting => {
        addColorPickerToSetting(setting,
          this.plugin.settings.timestampColor,
          async (value) => {
            this.plugin.settings.timestampColor = value || "var(--text-muted)";
            await this.plugin.saveSettings();
          }
        );
      });

    // ── 卡片版背景 / 分割线 ──────────────────────────────────────
    containerEl.createEl("h4", { text: "卡片背景与分割线", cls: "txt-settings-h4" });
    containerEl.createEl("p", {
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("仅高亮卡片 - 背景颜色")
      .setDesc("没有批注、只标记了高亮的卡片颜色（留空则跟随系统默认）")
      .then(setting => {
        addColorPickerToSetting(setting,
          this.plugin.settings.cardBgColorNoNote,
          async (value) => {
            this.plugin.settings.cardBgColorNoNote = value || "";
            await this.plugin.saveSettings();
          }
        );
      });

    new Setting(containerEl)
      .setName("带批注卡片 - 背景颜色")
      .setDesc("带有批注文字的卡片颜色（留空则跟随系统默认）")
      .then(setting => {
        addColorPickerToSetting(setting,
          this.plugin.settings.cardBgColorNote,
          async (value) => {
            this.plugin.settings.cardBgColorNote = value || "";
            await this.plugin.saveSettings();
          }
        );
      });

    new Setting(containerEl)
      .setName("分割线颜色")
      .setDesc("卡片版笔记中，高亮文字/批注与时间戳之间的分割线颜色")
      .then(setting => {
        addColorPickerToSetting(setting,
          this.plugin.settings.dividerColor,
          async (value) => {
            this.plugin.settings.dividerColor = value || "var(--background-modifier-border)";
            await this.plugin.saveSettings();
          }
        );
      });

    // 重置所有设置按钮
    new Setting(containerEl)
      .setName("重置所有设置")
      .setDesc("恢复所有设置到默认值（包括颜色、字体等）")
      .addButton(button => {
        button.setButtonText("重置所有");
        button.onClick(async () => {
          const defaultSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
          this.plugin.settings = defaultSettings;
          await this.plugin.saveSettings();
          this.display();
          new Notice("所有设置已重置为默认值");
        });
      });
  }
}

module.exports = TxtAnnotatorPlugin;