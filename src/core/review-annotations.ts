import { getHtmlTagAttr } from "./html-meta.js";

const REVIEW_SENTINEL = "data-pubmd-review-annotations";

export function hasReviewAnnotationsOptIn(html: string): boolean {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = getHtmlTagAttr(tag[0], "name");

    if (
      name?.toLowerCase() !== "pubmd:comments" &&
      name?.toLowerCase() !== "pubmd:review"
    ) {
      continue;
    }

    return getHtmlTagAttr(tag[0], "content")?.toLowerCase() === "true";
  }

  return false;
}

export function applyReviewAnnotations(html: string, enabled: boolean): string {
  return enabled ? injectReviewAnnotations(html) : html;
}

export function injectReviewAnnotations(html: string): string {
  if (html.includes(REVIEW_SENTINEL)) {
    return html;
  }

  const withStyles = insertBeforeClosingTag(html, "head", REVIEW_STYLES);
  return insertBeforeClosingTag(withStyles, "body", buildReviewMarkup(html));
}

function buildReviewMarkup(sourceHtml: string): string {
  const exportSection = hasReviewExportSection(sourceHtml)
    ? ""
    : REVIEW_EXPORT_SECTION;

  return `${exportSection}
<div ${REVIEW_SENTINEL} class="pubmd-review-root">
  <div class="pubmd-review-layer" id="pubmdReviewLayer"></div>
  <div class="pubmd-review-hover" id="pubmdReviewHover" hidden>
    <div class="pubmd-review-hover-box" id="pubmdReviewHoverBox"></div>
    <div class="pubmd-review-hover-label" id="pubmdReviewHoverLabel">Click to comment</div>
  </div>
  <div class="pubmd-review-toolbar" id="pubmdReviewToolbar">
    <button id="pubmdReviewClear" type="button">Clear all</button>
  </div>
  <aside class="pubmd-review-drawer" id="pubmdReviewDrawer" aria-label="Review comments">
    <div class="pubmd-review-drawer-header">
      <strong>Comments</strong>
      <span id="pubmdReviewCount">0</span>
      <button class="pubmd-review-drawer-toggle" id="pubmdReviewDrawerToggle" type="button" aria-controls="pubmdReviewList" aria-expanded="true" aria-label="Collapse comments">›</button>
    </div>
    <div class="pubmd-review-list" id="pubmdReviewList"></div>
  </aside>
  <div class="pubmd-review-popup" id="pubmdReviewPopup" hidden>
    <div class="pubmd-review-quote" id="pubmdReviewQuote" hidden></div>
    <textarea id="pubmdReviewText" placeholder="What should change?"></textarea>
    <div class="pubmd-review-popup-actions">
      <button class="pubmd-review-popup-delete" id="pubmdReviewDelete" type="button" hidden>Delete</button>
      <button class="pubmd-review-popup-cancel" id="pubmdReviewCancel" type="button">Cancel</button>
      <button class="pubmd-review-popup-add" id="pubmdReviewAdd" type="button" disabled>Add</button>
    </div>
  </div>
</div>
${REVIEW_SCRIPT}`;
}

function hasReviewExportSection(html: string): boolean {
  return (
    html.includes("data-pubmd-review-export") ||
    /id=(["'])pubmdReviewExport\1/i.test(html) ||
    /id=(["'])exportPrompt\1/i.test(html)
  );
}

function insertBeforeClosingTag(
  html: string,
  tagName: "body" | "head",
  insertion: string,
): string {
  const pattern = new RegExp(`</${tagName}>`, "i");
  const match = html.match(pattern);

  if (match?.index === undefined) {
    return `${html}
${insertion}`;
  }

  return `${html.slice(0, match.index)}${insertion}
${html.slice(match.index)}`;
}

const REVIEW_STYLES = `<style data-pubmd-review-style>
  .pubmd-review-root,
  .pubmd-review-export {
    display: none;
  }
  body.pubmd-review-active .pubmd-review-root,
  body.pubmd-review-active .pubmd-review-export {
    display: block;
  }
  body.pubmd-review-active main {
    cursor: crosshair;
  }
  body.pubmd-review-active a,
  body.pubmd-review-active button,
  body.pubmd-review-active textarea,
  body.pubmd-review-active input,
  body.pubmd-review-active select {
    cursor: pointer;
  }
  body.pubmd-review-drawer-space main {
    margin-right: 380px;
    max-width: none;
  }
  .pubmd-review-root {
    color-scheme: light;
    --pubmd-review-bg: #161616;
    --pubmd-review-fg: #ffffff;
    --pubmd-review-muted: rgba(255, 255, 255, 0.62);
    --pubmd-review-border: rgba(255, 255, 255, 0.12);
    --pubmd-review-accent: #ff8d28;
    --pubmd-review-target: #176b5c;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .pubmd-review-layer {
    position: absolute;
    inset: 0 0 auto;
    min-height: 100vh;
    pointer-events: none;
    z-index: 100000;
  }
  .pubmd-review-outline {
    position: absolute;
    border: 2px solid rgba(23, 107, 92, 0.72);
    background: rgba(23, 107, 92, 0.06);
    border-radius: 6px;
    pointer-events: none;
  }
  .pubmd-review-marker {
    position: absolute;
    width: 24px;
    height: 24px;
    transform: translate(-50%, -50%);
    border: 2px solid #ffffff;
    border-radius: 999px;
    background: var(--pubmd-review-accent);
    color: #ffffff;
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 800;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    pointer-events: auto;
  }
  .pubmd-review-marker.pubmd-review-pending {
    background: var(--pubmd-review-target);
  }
  .pubmd-review-marker-tip {
    position: absolute;
    top: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 140px;
    max-width: 240px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--pubmd-review-bg);
    color: var(--pubmd-review-fg);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--pubmd-review-border);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    text-align: left;
    font-weight: 400;
  }
  .pubmd-review-marker:hover .pubmd-review-marker-tip {
    opacity: 1;
    visibility: visible;
  }
  .pubmd-review-marker-quote {
    display: block;
    color: var(--pubmd-review-muted);
    font-size: 12px;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pubmd-review-marker-comment {
    display: block;
    color: var(--pubmd-review-fg);
    font-size: 13px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pubmd-review-hover[hidden],
  .pubmd-review-popup[hidden] {
    display: none;
  }
  .pubmd-review-hover-box {
    position: fixed;
    border: 2px solid rgba(255, 141, 40, 0.58);
    background: rgba(255, 141, 40, 0.07);
    border-radius: 5px;
    pointer-events: none;
    z-index: 100001;
  }
  .pubmd-review-hover-label {
    position: fixed;
    max-width: 260px;
    padding: 0.35rem 0.6rem;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.86);
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    z-index: 100002;
  }
  .pubmd-review-toolbar {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 100002;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 16px;
    background: var(--pubmd-review-bg);
    color: var(--pubmd-review-fg);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  }
  .pubmd-review-toolbar button,
  .pubmd-review-export button {
    border: 0;
    border-radius: 999px;
    padding: 7px 10px;
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    font: inherit;
    font-size: 12px;
    font-weight: 800;
  }
  .pubmd-review-popup {
    position: fixed;
    transform: translateX(-50%);
    width: min(300px, calc(100vw - 28px));
    padding: 0.75rem 1rem 14px;
    border-radius: 16px;
    background: var(--pubmd-review-bg);
    color: var(--pubmd-review-fg);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--pubmd-review-border);
    z-index: 100003;
  }
  .pubmd-review-quote {
    margin-bottom: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--pubmd-review-muted);
    font-size: 12px;
    font-style: italic;
    line-height: 1.45;
  }
  .pubmd-review-popup textarea {
    width: 100%;
    min-height: 64px;
    max-height: 180px;
    resize: none;
    overflow-y: hidden;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    padding: 0.5rem 0.625rem;
    background: rgba(255, 255, 255, 0.06);
    color: var(--pubmd-review-fg);
    outline: none;
    font: inherit;
    font-size: 13px;
    line-height: 1.45;
  }
  .pubmd-review-popup textarea:focus {
    border-color: var(--pubmd-review-accent);
  }
  .pubmd-review-popup textarea::placeholder {
    color: rgba(255, 255, 255, 0.38);
  }
  .pubmd-review-popup-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }
  .pubmd-review-popup button {
    border: 0;
    border-radius: 999px;
    padding: 0.4rem 0.875rem;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
  }
  .pubmd-review-popup-delete {
    margin-right: auto;
    background: transparent;
    color: rgba(255, 120, 120, 0.85);
  }
  .pubmd-review-popup-cancel {
    background: transparent;
    color: var(--pubmd-review-muted);
  }
  .pubmd-review-popup-add {
    background: var(--pubmd-review-accent);
    color: #ffffff;
  }
  .pubmd-review-popup-add:disabled {
    opacity: 0.42;
  }
  .pubmd-review-drawer {
    position: fixed;
    top: 14px;
    right: 14px;
    bottom: 86px;
    z-index: 100001;
    display: flex;
    flex-direction: column;
    width: min(348px, calc(100vw - 28px));
    border-radius: 18px;
    background: var(--pubmd-review-bg);
    color: var(--pubmd-review-fg);
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.32), 0 0 0 1px var(--pubmd-review-border);
    overflow: hidden;
  }
  .pubmd-review-drawer-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 14px 10px;
    border-bottom: 1px solid var(--pubmd-review-border);
  }
  .pubmd-review-drawer-header strong {
    color: #ffffff;
    font-size: 14px;
  }
  .pubmd-review-drawer-header span {
    color: var(--pubmd-review-muted);
    font-size: 12px;
  }
  .pubmd-review-drawer-toggle {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 999px;
    padding: 0;
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    font: inherit;
    font-size: 18px;
    line-height: 1;
  }
  .pubmd-review-drawer.pubmd-review-drawer-collapsed {
    top: 14px;
    right: 14px;
    bottom: auto;
    left: auto;
    width: auto;
    min-width: 156px;
    max-height: none;
  }
  .pubmd-review-drawer-collapsed .pubmd-review-list {
    display: none;
  }
  .pubmd-review-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 12px;
  }
  .pubmd-review-empty {
    color: var(--pubmd-review-muted);
    font-size: 13px;
    line-height: 1.45;
    padding: 8px 2px;
  }
  .pubmd-review-card {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.055);
    color: #ffffff;
    overflow: hidden;
  }
  .pubmd-review-card-main {
    display: block;
    width: 100%;
    min-width: 0;
    padding: 10px 72px 10px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
  }
  .pubmd-review-card-delete {
    position: absolute;
    right: 8px;
    top: 8px;
    height: 24px;
    border: 0;
    border-radius: 999px;
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
  }
  .pubmd-review-card-delete:hover {
    background: rgba(255, 56, 60, 0.18);
    color: #ff8080;
  }
  .pubmd-review-card-title {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-bottom: 5px;
  }
  .pubmd-review-card-number {
    color: var(--pubmd-review-accent);
    font-size: 12px;
    font-weight: 900;
  }
  .pubmd-review-card-target {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(255, 255, 255, 0.82);
    font-size: 12px;
    font-weight: 700;
  }
  .pubmd-review-card-quote {
    margin: 6px 0;
    padding-left: 8px;
    border-left: 2px solid var(--pubmd-review-accent);
    color: var(--pubmd-review-muted);
    font-size: 12px;
    font-style: italic;
    line-height: 1.35;
  }
  .pubmd-review-card-comment {
    margin: 0;
    color: #ffffff;
    font-size: 13px;
    line-height: 1.42;
    white-space: pre-wrap;
  }
  .pubmd-review-card-path {
    margin-top: 7px;
    color: rgba(255, 255, 255, 0.42);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pubmd-review-export {
    margin: 48px auto 120px;
    padding: 22px;
    max-width: 760px;
    border: 2px solid #176b5c;
    border-radius: 8px;
    background: #fffdf8;
    color: #1c2321;
  }
  .pubmd-review-export h2 {
    margin: 0 0 8px;
    font-size: 1.35rem;
  }
  .pubmd-review-export p {
    margin: 0 0 12px;
    color: #66706b;
  }
  .pubmd-review-export textarea {
    width: 100%;
    min-height: 240px;
    resize: vertical;
    border: 1px solid #d9d4ca;
    border-radius: 8px;
    padding: 10px;
    background: #ffffff;
    color: #1c2321;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 13px;
    line-height: 1.45;
  }
  .pubmd-review-export-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .pubmd-review-export-actions button {
    background: #176b5c;
  }
  .pubmd-review-copy-status {
    color: #66706b;
    font-size: 13px;
  }
  @media (min-width: 961px) {
    body.pubmd-review-drawer-space .pubmd-review-export {
      margin-right: 394px;
      margin-left: auto;
      width: min(760px, calc(100vw - 460px));
    }
  }
  @media (max-width: 960px) {
    body.pubmd-review-drawer-space main {
      margin-right: auto;
      max-width: 680px;
    }
    .pubmd-review-drawer {
      top: auto;
      right: 10px;
      left: 10px;
      bottom: 70px;
      width: auto;
      max-height: min(44vh, 360px);
    }
    .pubmd-review-toolbar {
      right: 10px;
      bottom: 10px;
      left: 10px;
      justify-content: center;
    }
    .pubmd-review-export {
      margin-left: 16px;
      margin-right: 16px;
    }
  }
</style>`;

const REVIEW_EXPORT_SECTION = `<section class="pubmd-review-export" id="pubmdReviewExport" data-pubmd-review-export>
  <h2>Comment export</h2>
  <p>Copy this prompt after adding comments. It includes the comment JSON and target provenance.</p>
  <textarea id="pubmdReviewExportPrompt" readonly></textarea>
  <div class="pubmd-review-export-actions">
    <button id="pubmdReviewCopyPrompt" type="button">Copy prompt</button>
    <span class="pubmd-review-copy-status" id="pubmdReviewCopyStatus"></span>
  </div>
</section>`;

const REVIEW_SCRIPT = `<script data-pubmd-review-script>
(function () {
  var STORAGE_KEY = "pubmd-review-annotations-v1";
  var memoryAnnotations = [];
  var annotations = [];
  var pendingAnnotation = null;
  var editingId = null;
  var suppressClickUntil = 0;
  var drawerCollapsed = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function syncDrawerState() {
    var drawer = byId("pubmdReviewDrawer");
    var toggle = byId("pubmdReviewDrawerToggle");
    drawer.classList.toggle("pubmd-review-drawer-collapsed", drawerCollapsed);
    toggle.setAttribute("aria-expanded", drawerCollapsed ? "false" : "true");
    toggle.setAttribute("aria-label", drawerCollapsed ? "Expand comments" : "Collapse comments");
    toggle.textContent = drawerCollapsed ? "‹" : "›";
    document.body.classList.toggle("pubmd-review-drawer-space", !drawerCollapsed && window.innerWidth >= 961);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" })[ch];
    });
  }

  function pageUrl() {
    return window.location.origin + window.location.pathname;
  }

  function storageKey() {
    return STORAGE_KEY + "::" + pageUrl();
  }

  function annotationArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function commentsEnabled() {
    try {
      var params = new URLSearchParams(window.location.search);
      var value = params.get("comments");
      return value === "1" || value === "true" || value === "yes";
    } catch (error) {
      return false;
    }
  }

  function loadAnnotations() {
    var key = storageKey();
    try {
      return annotationArray(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch (storageError) {
      try {
        var state = JSON.parse(window.name || "{}");
        return annotationArray(state[key]);
      } catch (nameError) {
        return memoryAnnotations;
      }
    }
  }

  function saveAnnotations() {
    var key = storageKey();
    var safeAnnotations = annotationArray(annotations);
    try {
      localStorage.setItem(key, JSON.stringify(safeAnnotations));
      return;
    } catch (storageError) {
      memoryAnnotations = safeAnnotations;
      try {
        var state = JSON.parse(window.name || "{}");
        state[key] = safeAnnotations;
        window.name = JSON.stringify(state);
      } catch (nameError) {
        try {
          var fallbackState = {};
          fallbackState[key] = safeAnnotations;
          window.name = JSON.stringify(fallbackState);
        } catch (finalError) {}
      }
    }
  }

  function nodeElement(node) {
    return !node ? null : node.nodeType === 1 ? node : node.parentElement;
  }

  function isReviewChrome(element) {
    return !element || Boolean(element.closest(".pubmd-review-root, .pubmd-review-export, .pubmd-review-marker, .pubmd-review-hover"));
  }

  function cssPath(element) {
    if (!element) return "body";
    var parts = [];
    var current = element;
    var stop = document.querySelector("main") || document.body;

    while (current && current !== document.body && current !== stop && current.nodeType === 1) {
      if (current.id) {
        parts.unshift("#" + current.id);
        return parts.join(" > ");
      }

      var tag = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (!parent) break;
      var sameTagSiblings = Array.prototype.filter.call(parent.children, function (child) {
        return child.tagName === current.tagName;
      });
      parts.unshift(
        sameTagSiblings.length > 1
          ? tag + ":nth-of-type(" + (sameTagSiblings.indexOf(current) + 1) + ")"
          : tag,
      );
      current = parent;
    }

    return (stop === document.body ? "body" : "main") + (parts.length ? " > " + parts.join(" > ") : "");
  }

  function closestContentElement(startElement, targetElement) {
    if (!startElement) return targetElement;
    return (
      startElement.closest("p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, table, figure") ||
      targetElement
    );
  }

  function closestAnnotationTarget(startElement) {
    if (!startElement || isReviewChrome(startElement)) return null;
    if (startElement.closest("button, textarea, select, input, a")) return null;
    return (
      startElement.closest("[data-pubmd-review-target], [data-review-target], p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, table, figure, section, article") ||
      startElement.closest("main") ||
      document.body
    );
  }

  function identifyElement(element) {
    if (!element) return "page";
    var tag = element.tagName.toLowerCase();
    var text = normalizeText(element.textContent || "");
    if (/^h[1-6]$/.test(tag)) return "heading: " + text.slice(0, 80);
    if (tag === "p") return "paragraph: " + text.slice(0, 80);
    if (tag === "li") return "list item: " + text.slice(0, 80);
    if (tag === "td" || tag === "th") return "table cell: " + text.slice(0, 80);
    if (tag === "table") return "table";
    if (tag === "blockquote") return "quote";
    if (tag === "pre") return "code block";
    return tag;
  }

  function hoverLabel(element) {
    if (!element) return "Click to comment";
    var tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return "Heading";
    if (tag === "p") return "Paragraph";
    if (tag === "li") return "List item";
    if (tag === "td" || tag === "th") return "Table cell";
    if (tag === "table") return "Table";
    if (tag === "blockquote") return "Quote";
    if (tag === "pre") return "Code block";
    return "Click to comment";
  }

  function nearestHeadingText(element) {
    var current = element;
    while (current && current !== document.body) {
      if (current.matches && current.matches("h1, h2, h3, h4, h5, h6")) {
        return normalizeText(current.textContent).slice(0, 120);
      }
      var heading = current.querySelector && current.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading) return normalizeText(heading.textContent).slice(0, 120);
      current = current.parentElement;
    }
    return document.title || "Page";
  }

  function reviewDataFor(element) {
    var data = {};
    var current = element;
    while (current && current !== document.body) {
      if (current.dataset) {
        Object.keys(current.dataset).forEach(function (key) {
          if (key.indexOf("review") === 0 && current.dataset[key] != null) {
            data[key] = current.dataset[key];
          }
        });
      }
      current = current.parentElement;
    }
    return data;
  }

  function textOffset(root, container, offset) {
    try {
      var range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(container, offset);
      return range.toString().length;
    } catch (error) {
      return null;
    }
  }

  function targetSelectorFor(element) {
    return element && element.id ? "#" + element.id : cssPath(element);
  }

  function makeCommonPayload(targetElement, contentElement, clientX, clientY, rect) {
    var targetSelector = targetSelectorFor(targetElement);
    var docY = clientY + window.scrollY;
    return {
      targetSelector: targetSelector,
      elementPath: cssPath(contentElement),
      elementLabel: identifyElement(contentElement),
      sectionTitle: nearestHeadingText(targetElement),
      targetData: reviewDataFor(targetElement),
      nearbyText: normalizeText((contentElement && (contentElement.innerText || contentElement.textContent)) || "").slice(0, 500),
      boundingBox: rect
        ? { x: rect.left, y: rect.top + window.scrollY, width: rect.width, height: rect.height }
        : null,
      x: (clientX / window.innerWidth) * 100,
      y: docY,
      clientX: clientX,
      clientY: clientY,
      publishedAnchor:
        targetElement && targetElement.id ? pageUrl() + "#" + targetElement.id : pageUrl(),
      pageUrl: pageUrl()
    };
  }

  function makeSelectionPayload() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    var selectedText = normalizeText(selection.toString()).slice(0, 1000);
    if (!selectedText) return null;
    var range = selection.getRangeAt(0);
    var startElement = nodeElement(range.startContainer);
    var endElement = nodeElement(range.endContainer);
    var targetElement = closestAnnotationTarget(startElement);
    if (!targetElement || !endElement || !targetElement.contains(endElement)) return null;
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    var contentElement = closestContentElement(startElement, targetElement);
    var payload = makeCommonPayload(targetElement, contentElement, rect.left + rect.width / 2, rect.bottom, rect);
    var start = textOffset(targetElement, range.startContainer, range.startOffset);
    var end = textOffset(targetElement, range.endContainer, range.endOffset);
    var targetText = targetElement.textContent || "";
    payload.selectedText = selectedText;
    payload.selection = {
      type: "text-selection",
      quote: selectedText,
      prefix: start == null ? "" : normalizeText(targetText.slice(Math.max(0, start - 160), start)),
      suffix: end == null ? "" : normalizeText(targetText.slice(end, end + 160)),
      offsetStart: start,
      offsetEnd: end,
      elementPath: payload.elementPath
    };
    return payload;
  }

  function makeClickPayload(event) {
    var clicked = event.target;
    if (!clicked || isReviewChrome(clicked)) return null;
    var targetElement = closestAnnotationTarget(clicked);
    if (!targetElement) return null;
    var contentElement = closestContentElement(clicked, targetElement);
    var rect = contentElement.getBoundingClientRect();
    var payload = makeCommonPayload(targetElement, contentElement, event.clientX, event.clientY, rect);
    payload.selection = { type: "element-click" };
    return payload;
  }

  function positionPopup(clientX, clientY) {
    var popup = byId("pubmdReviewPopup");
    var drawer = byId("pubmdReviewDrawer");
    var drawerRect = drawer ? drawer.getBoundingClientRect() : null;
    var rightEdge = drawerRect && window.innerWidth > 960 ? drawerRect.left - 14 : window.innerWidth - 14;
    var left = clamp(clientX, 150, Math.max(150, rightEdge - 150));
    popup.style.left = left + "px";
    if (clientY > window.innerHeight - 300) {
      popup.style.top = "auto";
      popup.style.bottom = Math.max(16, window.innerHeight - clientY + 18) + "px";
    } else {
      popup.style.bottom = "auto";
      popup.style.top = Math.max(16, clientY + 18) + "px";
    }
  }

  function openComposer(payload, existing) {
    if (!payload) return;
    hideHoverPreview();
    pendingAnnotation = payload;
    editingId = existing ? existing.id : null;
    var quote = byId("pubmdReviewQuote");
    var selectedText = payload.selectedText || (payload.selection && payload.selection.quote) || "";
    quote.hidden = !selectedText;
    quote.textContent = selectedText ? selectedText.slice(0, 220) : "";
    byId("pubmdReviewText").value = existing ? existing.comment : "";
    byId("pubmdReviewDelete").hidden = !existing;
    byId("pubmdReviewPopup").hidden = false;
    updateAddState();
    autoGrowText();
    positionPopup(payload.clientX, payload.clientY);
    renderMarkers();
    setTimeout(function () {
      byId("pubmdReviewText").focus();
    }, 0);
  }

  function closeComposer() {
    pendingAnnotation = null;
    editingId = null;
    byId("pubmdReviewPopup").hidden = true;
    renderMarkers();
  }

  function saveCurrentAnnotation() {
    if (!pendingAnnotation) return;
    var comment = byId("pubmdReviewText").value.trim();
    if (!comment) return;
    var now = new Date().toISOString();
    var existing = annotations.filter(function (item) {
      return item.id === editingId;
    })[0];
    var saved = Object.assign({}, pendingAnnotation, {
      id: editingId || "ann-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      comment: comment,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    });
    delete saved.clientX;
    delete saved.clientY;
    if (editingId) {
      annotations = annotations.map(function (item) {
        return item.id === editingId ? saved : item;
      });
    } else {
      annotations.push(saved);
    }
    saveAnnotations();
    closeComposer();
    renderAll();
  }

  function deleteAnnotationById(id) {
    annotations = annotations.filter(function (item) {
      return item.id !== id;
    });
    if (editingId === id) closeComposer();
    saveAnnotations();
    renderAll();
  }

  function elementUnderPointer(clientX, clientY) {
    var elements = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)];
    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      if (element && element.nodeType === 1 && !isReviewChrome(element)) return element;
    }
    return null;
  }

  function hideHoverPreview() {
    byId("pubmdReviewHover").hidden = true;
  }

  function renderHoverPreview(event) {
    if (pendingAnnotation) {
      hideHoverPreview();
      return;
    }
    var selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      hideHoverPreview();
      return;
    }
    var startElement = elementUnderPointer(event.clientX, event.clientY);
    if (!startElement) {
      hideHoverPreview();
      return;
    }
    var targetElement = closestAnnotationTarget(startElement);
    if (!targetElement) {
      hideHoverPreview();
      return;
    }
    var contentElement = closestContentElement(startElement, targetElement);
    var rect = contentElement.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      hideHoverPreview();
      return;
    }
    var hover = byId("pubmdReviewHover");
    var box = byId("pubmdReviewHoverBox");
    var label = byId("pubmdReviewHoverLabel");
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    label.textContent = hoverLabel(contentElement);
    label.style.left = clamp(event.clientX, 8, window.innerWidth - 140) + "px";
    label.style.top = Math.max(8, rect.top - 30) + "px";
    hover.hidden = false;
  }

  function renderMarkers() {
    var layer = byId("pubmdReviewLayer");
    layer.style.height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight) + "px";
    layer.innerHTML = "";
    var all = annotations.slice();
    if (pendingAnnotation && !editingId) {
      all.push(Object.assign({}, pendingAnnotation, { id: "pending", pending: true }));
    }
    all.forEach(function (ann, index) {
      if (ann.boundingBox) {
        var outline = document.createElement("div");
        outline.className = "pubmd-review-outline";
        outline.style.left = ann.boundingBox.x + "px";
        outline.style.top = ann.boundingBox.y + "px";
        outline.style.width = ann.boundingBox.width + "px";
        outline.style.height = ann.boundingBox.height + "px";
        layer.appendChild(outline);
      }
      var marker = document.createElement("button");
      marker.type = "button";
      marker.className = "pubmd-review-marker" + (ann.pending ? " pubmd-review-pending" : "");
      marker.textContent = ann.pending ? "+" : String(index + 1);
      marker.style.left = ann.x + "vw";
      marker.style.top = ann.y + "px";
      marker.setAttribute("aria-label", ann.pending ? "Pending annotation" : "Annotation " + (index + 1));
      if (!ann.pending) {
        var tip = document.createElement("span");
        tip.className = "pubmd-review-marker-tip";
        var quote = ann.selectedText
          ? '<span class="pubmd-review-marker-quote">' + escapeHtml(ann.selectedText) + "</span>"
          : "";
        tip.innerHTML = quote + '<span class="pubmd-review-marker-comment">' + escapeHtml(ann.comment) + "</span>";
        marker.appendChild(tip);
        marker.addEventListener("click", function (event) {
          event.stopPropagation();
          openComposer(Object.assign({}, ann, { clientX: event.clientX, clientY: event.clientY }), ann);
        });
      }
      layer.appendChild(marker);
    });
  }

  function renderComments() {
    var list = byId("pubmdReviewList");
    byId("pubmdReviewCount").textContent = String(annotations.length);
    if (!annotations.length) {
      list.innerHTML = '<p class="pubmd-review-empty">No comments yet. Select text or click a paragraph, list item, or table cell.</p>';
      return;
    }
    list.innerHTML = annotations
      .map(function (ann, index) {
        var quote = ann.selectedText
          ? '<p class="pubmd-review-card-quote">' + escapeHtml(ann.selectedText) + "</p>"
          : "";
        return '<article class="pubmd-review-card"><button class="pubmd-review-card-main" type="button" data-review-open-id="' +
          escapeHtml(ann.id) +
          '"><span class="pubmd-review-card-title"><span class="pubmd-review-card-number">' +
          (index + 1) +
          '</span><span class="pubmd-review-card-target">' +
          escapeHtml(ann.sectionTitle || ann.elementLabel || ann.targetSelector) +
          "</span></span>" +
          quote +
          '<p class="pubmd-review-card-comment">' +
          escapeHtml(ann.comment) +
          '</p><div class="pubmd-review-card-path">' +
          escapeHtml(ann.elementPath || ann.targetSelector) +
          '</div></button><button class="pubmd-review-card-delete" type="button" data-review-delete-id="' +
          escapeHtml(ann.id) +
          '">Delete</button></article>';
      })
      .join("");
    list.querySelectorAll("[data-review-open-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        var ann = annotations.filter(function (item) {
          return item.id === button.dataset.reviewOpenId;
        })[0];
        if (!ann) return;
        var target = document.querySelector(ann.targetSelector);
        if (target) target.scrollIntoView({ block: "center" });
      });
    });
    list.querySelectorAll("[data-review-delete-id]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        deleteAnnotationById(button.dataset.reviewDeleteId);
      });
    });
  }

  function buildPrompt() {
    return [
      "Use these comments to update the published page.",
      "",
      "Comment page: " + pageUrl(),
      "Comment count: " + annotations.length,
      "",
      "Each comment includes comment text, selectedText when present, selection quote/prefix/suffix/offsets, targetSelector, elementPath, nearbyText, boundingBox, x/y, publishedAnchor, pageUrl, createdAt, and updatedAt.",
      "",
      "Comments JSON:",
      JSON.stringify(annotations, null, 2),
      "",
      "Requested next action:",
      "1. Summarize comments by target.",
      "2. Apply or queue the requested edits.",
      "3. Preserve the recorded target provenance when making changes."
    ].join("\\n");
  }

  function renderPrompt() {
    var prompt = byId("pubmdReviewExportPrompt") || byId("exportPrompt");
    if (prompt) prompt.value = buildPrompt();
  }

  function copyPrompt() {
    renderPrompt();
    var prompt = byId("pubmdReviewExportPrompt") || byId("exportPrompt");
    var status = byId("pubmdReviewCopyStatus") || byId("copyStatus");
    if (!prompt) return;
    var value = prompt.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () {
          if (status) status.textContent = "Copied.";
        },
        function () {
          prompt.select();
          document.execCommand("copy");
          if (status) status.textContent = "Selected. Copy manually if needed.";
        },
      );
      return;
    }
    prompt.select();
    document.execCommand("copy");
    if (status) status.textContent = "Selected. Copy manually if needed.";
  }

  function updateAddState() {
    byId("pubmdReviewAdd").disabled = !byId("pubmdReviewText").value.trim();
  }

  function autoGrowText() {
    var textarea = byId("pubmdReviewText");
    var maxHeight = 180;
    textarea.style.height = "auto";
    var nextHeight = Math.min(maxHeight, Math.max(64, textarea.scrollHeight));
    textarea.style.height = nextHeight + "px";
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function renderAll() {
    renderMarkers();
    renderComments();
    renderPrompt();
  }

  if (!commentsEnabled()) {
    return;
  }

  annotations = loadAnnotations();

  document.addEventListener("mouseup", function () {
    setTimeout(function () {
      if (pendingAnnotation) return;
      var payload = makeSelectionPayload();
      if (!payload) return;
      suppressClickUntil = Date.now() + 350;
      openComposer(payload, null);
    }, 0);
  });

  document.addEventListener(
    "click",
    function (event) {
      if (pendingAnnotation) return;
      var selectionPayload = makeSelectionPayload();
      if (selectionPayload) {
        event.preventDefault();
        suppressClickUntil = Date.now() + 350;
        openComposer(selectionPayload, null);
        return;
      }
      if (Date.now() < suppressClickUntil) return;
      var payload = makeClickPayload(event);
      if (!payload) return;
      event.preventDefault();
      openComposer(payload, null);
    },
    true,
  );
  document.addEventListener("mousemove", renderHoverPreview, { passive: true });
  document.addEventListener("mouseleave", hideHoverPreview);
  window.addEventListener("resize", function () {
    syncDrawerState();
    hideHoverPreview();
    renderMarkers();
  });
  window.addEventListener(
    "scroll",
    function () {
      hideHoverPreview();
      renderMarkers();
    },
    true,
  );
  byId("pubmdReviewCancel").addEventListener("click", closeComposer);
  byId("pubmdReviewAdd").addEventListener("click", saveCurrentAnnotation);
  byId("pubmdReviewDelete").addEventListener("click", function () {
    if (editingId) deleteAnnotationById(editingId);
  });
  byId("pubmdReviewText").addEventListener("input", function () {
    updateAddState();
    autoGrowText();
  });
  byId("pubmdReviewText").addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer();
    }
  });
  byId("pubmdReviewClear").addEventListener("click", function () {
    if (!confirm("Delete all annotations in this page?")) return;
    annotations = [];
    saveAnnotations();
    closeComposer();
    renderAll();
  });
  byId("pubmdReviewDrawerToggle").addEventListener("click", function () {
    drawerCollapsed = !drawerCollapsed;
    syncDrawerState();
    hideHoverPreview();
    renderMarkers();
  });
  var copyButton = byId("pubmdReviewCopyPrompt") || byId("copyPrompt");
  if (copyButton) copyButton.addEventListener("click", copyPrompt);
  document.body.classList.add("pubmd-review-active");
  syncDrawerState();
  renderAll();
})();
</script>`;
