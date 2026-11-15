/**
 * BiliSum Client half.
 *
 * Mirrors how the Notes panel is wired: one entry in `sidebar.panellist` puts an
 * icon in the sidebar's upper panel list, and one `main` registration renders the
 * page in the central column. The shell owns the button, the label, and the panel
 * selection, so the two registrations share the id `bilisum`.
 *
 * The page talks to its own Host half over the routes `index.js` registers; no
 * Harness client package is imported.
 */

window.__ModuleLoader__.load({
  id: 'dsh-bilisum',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Shared sidebar id: the panel list id and the main slot key. */
    const PANEL_ID = 'bilisum';
    /** Locale namespace for this plugin's client dictionaries. */
    const NS = 'bilisum.panel';

    const CSS = `
.bilisum-shell {
  display: flex; flex-direction: column; width: 100%; height: 100%;
  min-width: 0; min-height: 0; overflow: hidden;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
}
.bilisum-top {
  display: flex; flex: none; align-items: center; gap: 10px; box-sizing: border-box;
  height: 48px; padding: 0 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
[data-platform='darwin'] .bilisum-top {
  height: calc(48px + var(--dsh-frame-top-clearance, 0px));
  padding-top: var(--dsh-frame-top-clearance, 0px);
}
.bilisum-top-title { margin: 0; font-size: 14px; font-weight: 600; }
.bilisum-top-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.bilisum-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.bilisum-content {
  display: flex; flex-direction: column; gap: 14px; min-width: 0;
  max-width: min(1080px, 100%); margin: 0 auto;
  padding: clamp(12px, 2.2vw, 26px) clamp(12px, 2.4vw, 28px) 48px;
}

.bilisum-page { display: flex; flex-direction: column; gap: 14px; }
.bilisum-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.bilisum-card {
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; min-width: 0;
  background: var(--dsw-alias-bg-layer-1); padding: 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.bilisum-card-log { padding: 0; gap: 0; }
.bilisum-log-head {
  display: flex; align-items: center; justify-content: flex-start; gap: 16px;
  min-height: 36px; padding: 0 14px;
}
.bilisum-log-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.bilisum-log-toggle {
  border: none; background: transparent; padding: 0; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.bilisum-log-toggle:hover { color: var(--dsw-alias-label-primary); }
.bilisum-card-log .bilisum-log { margin: 0 14px 12px; }
.bilisum-progress-inline {
  display: inline-flex; align-items: center; gap: 8px; transition: opacity .35s ease;
}
.bilisum-progress-inline.is-fading { opacity: 0; }
.bilisum-progress-text { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.bilisum-progress-track {
  height: 4px; border-radius: 2px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
}
.bilisum-progress-track-inline { width: 160px; height: 6px; border-radius: 3px; flex: none; }
.bilisum-progress-fill { display: block; height: 100%; border-radius: 3px; transition: width .2s ease; }
.bilisum-progress-fill-subtitles { background: var(--dsw-alias-brand-primary); }
.bilisum-progress-fill-downloads { background: var(--dsw-alias-state-success-primary); }
.bilisum-progress-fill-warn { background: var(--dsw-alias-state-warn-primary); }
.bilisum-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.bilisum-row-nowrap { flex-wrap: nowrap; min-width: 0; }
.bilisum-row-end { margin-left: auto; flex: 1 1 auto; justify-content: flex-end; }
.bilisum-link {
  border: none; background: transparent; padding: 0; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.bilisum-link:hover { color: var(--dsw-alias-label-primary); }
.bilisum-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.bilisum-muted { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.bilisum-input, .bilisum-textarea {
  box-sizing: border-box; font: inherit; font-size: 13px; min-width: 0;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; outline: none;
}
.bilisum-input-grow { flex: 1 1 260px; }
.bilisum-output-field {
  position: relative; display: flex; align-items: center;
  flex: 1 1 260px; min-width: 0;
}
.bilisum-output-field .bilisum-input { flex: 1 1 auto; width: 100%; padding-right: 68px; }
.bilisum-browse {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  height: 26px; padding: 0 10px; border: none; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.bilisum-browse:hover {
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
}
.bilisum-input:focus, .bilisum-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.bilisum-textarea { width: 100%; min-height: 132px; resize: vertical; line-height: 1.55; font-family: inherit; }
.bilisum-button {
  font: inherit; font-size: 13px; padding: 7px 16px; border-radius: 8px; cursor: pointer;
  border: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.bilisum-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.bilisum-button:disabled { opacity: .55; cursor: default; }
.bilisum-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.bilisum-button-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.bilisum-button-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: .92; }
.bilisum-button-quiet { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 10px; }
.bilisum-button-quiet:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.bilisum-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 0.5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.bilisum-badge-ok { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.bilisum-badge-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.bilisum-badge-error { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.bilisum-hint {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; padding: 0; border-radius: 50%; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; line-height: 1;
}
.bilisum-hint:hover, .bilisum-hint[aria-expanded='true'] {
  border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary);
}
.bilisum-hint:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.bilisum-help {
  display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.bilisum-help-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.bilisum-help-body { font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); white-space: pre-line; }
.bilisum-log {
  margin: 0; max-height: 300px; overflow-y: auto; background: var(--dsw-alias-bg-base);
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
  line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary);
  animation: bilisum-log-in .18s ease;
}
@keyframes bilisum-log-in { from { opacity: 0; } to { opacity: 1; } }
.bilisum-log-info { color: var(--dsw-alias-label-secondary); }
.bilisum-log-processing { color: var(--dsw-alias-brand-primary); }
.bilisum-log-success { color: var(--dsw-alias-state-success-primary); }
.bilisum-log-warning { color: var(--dsw-alias-state-warn-primary); }
.bilisum-log-error { color: var(--dsw-alias-state-error-primary); }
.bilisum-list { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-primary); }
.bilisum-list li { margin-bottom: 4px; }
.bilisum-pages {
  display: flex; flex-direction: column; gap: 2px; max-height: 288px; overflow-y: auto;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 6px; margin-top: 8px;
}
.bilisum-page-item {
  display: flex; align-items: center; gap: 8px; padding: 4px 6px;
  border-radius: 6px; font-size: 13px; line-height: 1.5; cursor: pointer;
}
.bilisum-page-item:hover { background: var(--dsw-alias-bg-layer-2); }
.bilisum-page-item input[type='checkbox'] { flex: none; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.bilisum-page-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bilisum-page-dur { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.bilisum-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.bilisum-series {
  display: block; min-width: 0; margin-bottom: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere; word-break: break-word;
}
.bilisum-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px;
  color: var(--dsw-alias-label-secondary); flex: 1 1 220px; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bilisum-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.bilisum-options { display: flex; flex-direction: column; gap: 6px; }
.bilisum-check input { margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.bilisum-check[aria-disabled='true'] { opacity: .55; cursor: default; }
.bilisum-select {
  font: inherit; font-size: 13px; padding: 5px 8px; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l1);
}
.bilisum-select:disabled { opacity: .55; cursor: default; }
.bilisum-item { margin-bottom: 8px; }
.bilisum-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%; flex: none;
  color: #ffffff; font-size: 12px; font-weight: 700; line-height: 1;
  box-shadow: 0 0 0 1px transparent;
}
.bilisum-mark-ok { background: #10b981; }
.bilisum-mark-bad { background: #f59e0b; }
.bilisum-mark-busy { background: var(--dsw-alias-brand-primary); }
.bilisum-settings { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 24px; }

/* Minimal tab switch: bare labels, one white capsule on the active item */
.bilisum-tabs {
  display: inline-flex; align-self: flex-start; gap: 4px;
  background: transparent; border: none; padding: 0;
  margin: 0 0 -6px;
}
.bilisum-tab {
  border-radius: 999px; padding: 4px 16px; border: 0.5px solid transparent;
  font: inherit; font-size: 13px; color: var(--dsw-alias-label-secondary);
  cursor: pointer; background: transparent; line-height: 1.4;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.bilisum-tab:hover { color: var(--dsw-alias-label-primary); }
.bilisum-tab.is-active {
  background: var(--dsw-alias-bg-overlay); border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary); font-weight: 500;
}

/* Shared action bar: primary button + task options on one line */
.bilisum-actions {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap; min-height: 36px;
}
.bilisum-actions-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.bilisum-actions-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: -2px; }
.bilisum-select-compact { height: 32px; padding: 0 8px; }

/* Search toolbar: custom dropdown, standalone input, small action button */
.bilisum-toolbar { display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0; }
.bilisum-selector { position: relative; flex: none; }
.bilisum-selector-trigger {
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: none; border-radius: 6px; padding: 6px 8px;
  font: inherit; font-size: 13px; color: var(--dsw-alias-label-secondary);
  cursor: pointer; transition: background .15s ease, color .15s ease;
}
.bilisum-selector-trigger:hover {
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
.bilisum-selector-caret { font-size: 10px; line-height: 1; opacity: .5; }
.bilisum-menu {
  position: absolute; top: 100%; left: 0; z-index: 100; min-width: 88px;
  margin-top: 4px; padding: 4px; border-radius: 8px;
  background: var(--dsw-alias-bg-overlay);
  border: 0.5px solid var(--dsw-alias-border-l1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.bilisum-menu-option {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px; border-radius: 4px; font-size: 13px; white-space: nowrap;
  color: var(--dsw-alias-label-primary); cursor: pointer;
}
.bilisum-menu-option:hover { background: var(--dsw-alias-bg-layer-2); }
.bilisum-menu-option.is-active { font-weight: 600; }
.bilisum-menu-check { color: var(--dsw-alias-brand-primary); font-size: 11px; }
.bilisum-toolbar-input {
  flex: 1 1 auto; min-width: 0; height: 32px; box-sizing: border-box; padding: 0 10px;
  font: inherit; font-size: 13px; border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); outline: none;
}
.bilisum-toolbar-input:focus { border-color: var(--dsw-alias-brand-primary); }
.bilisum-toolbar-search {
  flex: none; height: 32px; padding: 0 14px; border: none; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary);
  font: inherit; font-size: 13px; cursor: pointer;
  transition: background .15s ease, opacity .15s ease;
}
.bilisum-toolbar-search:hover:not(:disabled) { background: var(--dsw-alias-bg-overlay); }
.bilisum-toolbar-search:disabled { opacity: .5; cursor: default; }

/* Discover list */
.bilisum-discover { display: flex; flex-direction: column; gap: 10px; min-height: 260px; }
.bilisum-discover-list {
  display: flex; flex-direction: column; gap: 2px; max-height: 360px; overflow-y: auto;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 4px;
}
.bilisum-discover-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 8px; min-height: 56px; box-sizing: border-box;
}
.bilisum-discover-row:hover { background: var(--dsw-alias-bg-layer-2); }
.bilisum-discover-row .bilisum-button { min-width: 64px; justify-content: center; }
.bilisum-cover {
  width: 64px; height: 36px; border-radius: 4px; object-fit: cover; flex: none;
  background: var(--dsw-alias-bg-layer-2);
}
.bilisum-discover-main { flex: 1 1 auto; min-width: 0; }
.bilisum-discover-title {
  font-size: 13px; color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bilisum-discover-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }

@media (max-width: 760px) {
  .bilisum-content { padding: 12px 12px 32px; gap: 10px; }
  .bilisum-top-hint { display: none; }
  .bilisum-textarea { min-height: 96px; }
  .bilisum-log { max-height: 240px; }
  .bilisum-options .bilisum-select { flex: 1 1 auto; }
  .bilisum-button { padding: 7px 12px; }
  .bilisum-tabs { display: inline-flex; width: auto; }
  .bilisum-tab { flex: none; }
  .bilisum-cover { width: 48px; height: 27px; }
  .bilisum-discover-row { padding: 6px 8px; }
  .bilisum-actions { gap: 10px; }
  .bilisum-actions-right { margin-left: 0; }
  .bilisum-toolbar { flex-wrap: wrap; row-gap: 6px; }
  .bilisum-toolbar-input { flex: 1 1 140px; }
  .bilisum-toolbar-search { height: 30px; padding: 0 12px; }
}
`;

    /** Sidebar glyph; the shell supplies the size and owns the button chrome. */
    function PanelIcon({ size }) {
      const edge = Number.isFinite(size) ? size : 18;
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 36 36',
        fill: 'none',
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block' },
      },
      h('rect', {
        x: 3.5, y: 8.5, width: 16, height: 19, rx: 4,
        stroke: 'currentColor', strokeWidth: 2.4,
      }),
      h('path', { d: 'M9.2 14.4 L15.4 18 L9.2 21.6 Z', fill: 'currentColor' }),
      h('rect', { x: 23, y: 11, width: 10, height: 3, rx: 1.5, fill: 'currentColor', opacity: 0.85 }),
      h('rect', { x: 23, y: 17, width: 10, height: 3, rx: 1.5, fill: 'currentColor', opacity: 0.55 }),
      h('rect', { x: 23, y: 23, width: 7, height: 3, rx: 1.5, fill: 'currentColor', opacity: 0.3 }));
    }

    /** Dictionaries for the panel; the sidebar label follows the locale. */
    const DICTS = {
      en: {
        panel: 'BiliSum',
        title: 'Bilibili batch summaries',
        hint: 'Paste links → fetch subtitles → summarize in chat',
        description:
          'Paste one or more Bilibili links (BV/AV ids, b23.tv short links, or a whole share message). BiliSum fetches the metadata and subtitles, caches the transcripts, and hands them to the current session, which writes the Markdown report.',
        cookieLabel: 'Bilibili SESSDATA',
        cookieConfigured: 'Cookie configured',
        cookieMissing: 'Cookie missing — subtitles need a logged-in session',
        cookieInvalid: 'Cookie expired — sign in to Bilibili again',
        cookieUnverified: 'Cookie saved (not verified)',
        cookieHelpTitle: 'Where to get SESSDATA',
        cookieHelpShort: 'How to get SESSDATA',
        cookieHelpBody:
          '1. Sign in to bilibili.com in your browser\n2. Press F12 to open DevTools\n3. Open Application → Cookies → https://www.bilibili.com\n4. Find SESSDATA and copy its Value column (without the "SESSDATA=" prefix)\n5. Paste it above and press Save\n\nIt expires whenever you sign out or sign in on another device — copy a fresh one then.',
        cookieHelpClose: 'Got it',
        cookiePlaceholder: 'Paste the SESSDATA value from your Bilibili cookie',
        save: 'Save',
        clear: 'Clear',
        refresh: 'Refresh status',
        refreshPlugin: 'Refresh plugin',
        refreshPluginHint: 'Re-check the environment and cookie, and clear the log and results below',
        pythonLabel: 'Python worker',
        pythonOk: 'ready',
        pythonMissing: 'not found',
        linksLabel: 'Video links',
        linksPlaceholder:
          'Paste links or a whole share message here, for example:\n【标题】 https://b23.tv/xxxxxxx  BV1xx411c7mD',
        start: 'Start',
        subtitlesLabel: 'Extract subtitles (text)',
        needTask: 'Tick at least one task: subtitles or video download.',
        probing: 'Parsing…',
        chooseHint: 'Multi-part video detected — choose the parts to fetch:',
        seriesHint: 'Collection: {title} · {count} parts',
        selectAll: 'Select all',
        invert: 'Invert',
        startFetch: 'Fetch selected',
        cancel: 'Cancel',
        noSelection: 'Select at least one part first.',
        singleVideo: 'Fetches directly',
        selectedCount: '{count} selected',
        running: 'Fetching…',
        logsLabel: 'Execution log',
        emptyLog: 'No log yet.',
        videosLabel: 'Cached transcripts',
        failuresLabel: 'Failed',
        copyHint: 'Copy the prompt',
        copyPrompt: 'Summarize these fetched Bilibili videos',
        copied: 'Copied',
        needLinks: 'Paste at least one Bilibili link first.',
        handoff:
          'Transcripts are cached. Go back to the conversation and ask the agent to summarize them; it reads the cached files and writes bilibili_summaries/B站总结_*.md.',
        outputLabel: 'Output directory',
        outputChange: 'Change',
        outputEditTitle: 'Output directory',
        outputReset: 'Reset to default',
        outputResetHint: 'Leave it empty to fall back to the plugin folder.',
        browse: 'Browse',
        browseHint: 'Pick a folder in the system dialog',
        browseUnavailable: 'This environment cannot open a folder picker; type the path manually.',
        outputPersistHint: 'Applied for this session. Edit cordis.patch.yml to keep it after a restart.',
        openFolder: 'Open folder',
        openFile: 'Open',
        downloadLabel: 'Download video',
        qualityLabel: 'Quality',
        qAudio: 'Audio only',
        qualityHint: 'Video files are large (1080P ≈ 200 MB – 2 GB each); check free disk space.',
        downloadReady: 'Download ready',
        downloadUnavailable: 'Download unavailable',
        downloadsLabel: 'Downloaded videos',
        summary: 'Total {total} · done {ok} · failed {failed}',
        retry: 'Retry',
        retrying: 'Retrying…',
        retryAll: 'Retry all failed ({count})',
        retryHint: 'Download this item again',
        logExpand: 'Expand log ▼',
        logCollapse: 'Collapse log ▲',
        logCollapsedHint: 'Log collapsed — click Expand log to view',
        logCount: '{count} lines',
        subtitleTag: 'Subtitles',
        videoTag: 'Video',
        tabLinks: 'Video links',
        tabDiscover: 'Search videos',
        progressSubtitles: 'Subtitles',
        progressDownloads: 'Downloads',
        discoverKindPopular: 'Popular',
        discoverKindSearch: 'Search',
        discoverPlaceholder: 'Search Bilibili videos',
        discoverSearch: 'Search',
        discoverEmpty: 'Nothing loaded yet.',
        discoverMore: 'Load more',
        discoverPicked: '{count} selected',
        discoverStart: 'Start fetching',
        discoverAdd: 'Add',
        discoverAdded: 'Added ✓',
      },
      'zh-CN': {
        panel: 'BiliSum',
        title: 'B站视频批量总结',
        hint: '粘贴链接 → 抓字幕 → 回对话总结',
        description:
          '粘贴一个或多个 B站 链接（BV/AV 号、b23.tv 短链，或整段分享文案）。BiliSum 会抓取视频信息与字幕、缓存字幕文本，并交给当前会话生成 Markdown 总结报告。',
        cookieLabel: 'B站 SESSDATA',
        cookieConfigured: '已配置 Cookie',
        cookieMissing: '未配置 Cookie —— 无登录态拿不到字幕',
        cookieInvalid: 'Cookie 已失效，请重新登录 B站 后重新获取',
        cookieUnverified: 'Cookie 已保存（未校验）',
        cookieHelpTitle: '在哪里获取 SESSDATA',
        cookieHelpShort: '查看获取 SESSDATA 的步骤',
        cookieHelpBody:
          '1. 用浏览器登录 bilibili.com\n'
          + '2. 按 F12 打开开发者工具\n'
          + '3. 打开「应用 / Application」→「Cookies」→ https://www.bilibili.com\n'
          + '4. 找到 SESSDATA，复制「值 / Value」那一列（不要带 SESSDATA= 前缀）\n'
          + '5. 粘贴到上面的输入框，点「保存」\n\n'
          + '注意：退出登录、换设备登录都会让这个 Cookie 失效；失效后重新复制一次即可。',
        cookieHelpClose: '知道了',
        cookiePlaceholder: '粘贴 B站 Cookie 里的 SESSDATA 值',
        save: '保存',
        clear: '清除',
        refresh: '刷新状态',
        refreshPlugin: '刷新插件',
        refreshPluginHint: '重新校验环境与 Cookie，并清空下方执行日志与解析结果',
        pythonLabel: 'Python 环境',
        pythonOk: '可用',
        pythonMissing: '未找到',
        linksLabel: '视频链接',
        linksPlaceholder: '在这里粘贴链接或整段分享文案，例如：\n【标题】 https://b23.tv/xxxxxxx  BV1xx411c7mD',
        start: '开始解析',
        subtitlesLabel: '提取字幕（文本）',
        needTask: '请至少勾选一项：提取字幕 或 下载原视频。',
        probing: '解析中…',
        chooseHint: '检测到分P/合集视频，请勾选要抓取的分P：',
        seriesHint: '检测到合集：《{title}》，共 {count} 个视频',
        selectAll: '全选',
        invert: '反选',
        startFetch: '开始抓取所选',
        cancel: '取消',
        noSelection: '请至少勾选一个分P。',
        singleVideo: '直接抓取',
        selectedCount: '已选 {count} 个',
        running: '抓取中…',
        logsLabel: '执行日志',
        emptyLog: '暂无日志。',
        videosLabel: '已缓存字幕',
        failuresLabel: '解析失败',
        copyHint: '复制指令',
        copyPrompt: '请总结这些已抓取的B站视频',
        copied: '已复制',
        needLinks: '请先粘贴至少一个 B站 链接。',
        handoff:
          '字幕已缓存。回到对话里让我总结这些视频：我会读取缓存文件，并生成 bilibili_summaries/B站总结_*.md。',
        outputLabel: '输出目录',
        outputChange: '修改',
        outputEditTitle: '修改输出目录',
        outputReset: '恢复默认',
        outputResetHint: '留空则恢复为插件默认目录',
        browse: '浏览',
        browseHint: '在系统对话框中选择文件夹',
        browseUnavailable: '当前环境无法打开目录选择器，请手动输入路径。',
        outputPersistHint: '已对本会话生效；如需重启后保留，请修改 cordis.patch.yml。',
        openFolder: '打开文件夹',
        openFile: '打开',
        downloadLabel: '下载原视频',
        qualityLabel: '清晰度',
        qAudio: '仅音频',
        qualityHint: '视频文件较大（1080P 约 200MB～2GB/个），请确认磁盘空间充足。',
        downloadReady: '下载可用',
        downloadUnavailable: '下载不可用',
        downloadsLabel: '已下载视频',
        summary: '共 {total} 项 · 成功 {ok} · 失败 {failed}',
        retry: '重试',
        retrying: '重试中…',
        retryAll: '重试全部失败项（{count}）',
        retryHint: '重新下载此集',
        logExpand: '展开日志 ▼',
        logCollapse: '收起日志 ▲',
        logCollapsedHint: '日志已收起，点「展开日志」查看',
        logCount: '{count} 条',
        subtitleTag: '字幕',
        videoTag: '视频',
        tabLinks: '视频链接',
        tabDiscover: '搜索视频',
        progressSubtitles: '字幕',
        progressDownloads: '下载',
        discoverKindPopular: '热门',
        discoverKindSearch: '搜索',
        discoverPlaceholder: '输入关键词搜索 B 站视频',
        discoverSearch: '搜索',
        discoverEmpty: '暂无内容',
        discoverMore: '加载更多',
        discoverPicked: '已选 {count} 个',
        discoverStart: '开始抓取',
        discoverAdd: '加入',
        discoverAdded: '已加入 ✓',
      },
    };

    /** Dictionaries for every locale this namespace answers for. */
    const DICTS_BY_LOCALE = {
      en: DICTS.en,
      'zh-CN': DICTS['zh-CN'],
      zh: DICTS['zh-CN'],
    };

    async function callJson(url, init) {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`);
      }
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
      }
      return payload;
    }

    function levelClass(level) {
      const known = ['info', 'processing', 'success', 'warning', 'error'];
      return `bilisum-log-${known.includes(level) ? level : 'info'}`;
    }

    /** Seconds to `mm:ss` / `h:mm:ss` for the part list. */
    function formatDuration(seconds) {
      const total = Number(seconds);
      if (!Number.isFinite(total) || total <= 0) return '';
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = Math.floor(total % 60);
      const pad = (value) => String(value).padStart(2, '0');
      return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
    }

    /** Display label for one download quality id. */
    function qualityText(t, value) {
      if (value === '4k') return '4K';
      if (value === '1080p') return '1080P';
      if (value === '720p') return '720P';
      if (value === '480p') return '480P';
      return t('qAudio');
    }

    /** Megabytes from bytes, for the download list. */
    function megabytes(bytes) {
      const value = Number(bytes) || 0;
      if (value <= 0) return '';
      return value >= 1024 ** 3
        ? `${(value / 1024 ** 3).toFixed(2)} GB`
        : `${Math.round(value / 1024 ** 2)} MB`;
    }

    // ------------------------------------------------------------------
    // Console: status, Cookie, links, live log, results.
    // Rendered by the main panel and by the Settings page.
    // ------------------------------------------------------------------
    /**
     * The Client context captured at activation, so components can reach
     * optional services (such as the workspace directory picker) lazily.
     */
    let runtimeCtx = null;

    function BiliSumConsole({ t, showIntro }) {
      const [status, setStatus] = React.useState(null);
      const [statusError, setStatusError] = React.useState('');
      const [links, setLinks] = React.useState('');
      const [cookie, setCookie] = React.useState('');
      const [cookieDirty, setCookieDirty] = React.useState(false);
      const [jobId, setJobId] = React.useState('');
      const [logs, setLogs] = React.useState([]);
      const [result, setResult] = React.useState(null);
      const [running, setRunning] = React.useState(false);
      const [probing, setProbing] = React.useState(false);
      const [probes, setProbes] = React.useState([]);
      const [selection, setSelection] = React.useState({});
      const [error, setError] = React.useState('');
      const [copied, setCopied] = React.useState(false);
      const [hintOpen, setHintOpen] = React.useState(false);
      const [downloadEnabled, setDownloadEnabled] = React.useState(false);
      const [quality, setQuality] = React.useState('1080p');
      const [extractSubtitles, setExtractSubtitles] = React.useState(true);
      const [retryingKeys, setRetryingKeys] = React.useState([]);
      const [logOpen, setLogOpen] = React.useState(false);
      const [viewMode, setViewMode] = React.useState('links');
      const [progress, setProgress] = React.useState(null);
      const [progressFading, setProgressFading] = React.useState(false);
      const [discoverKind, setDiscoverKind] = React.useState('popular');
      const [discoverQuery, setDiscoverQuery] = React.useState('');
      const [discoverItems, setDiscoverItems] = React.useState([]);
      const [discoverPage, setDiscoverPage] = React.useState(0);
      const [discoverBusy, setDiscoverBusy] = React.useState(false);
      const [discoverError, setDiscoverError] = React.useState('');
      const [discoverPicked, setDiscoverPicked] = React.useState([]);
      const [discoverLoaded, setDiscoverLoaded] = React.useState(false);
      const [kindOpen, setKindOpen] = React.useState(false);
      const [outputEditing, setOutputEditing] = React.useState(false);
      const [outputDraft, setOutputDraft] = React.useState('');
      const [outputHint, setOutputHint] = React.useState('');
      const logRef = React.useRef(null);
      const offsetRef = React.useRef(0);
      const progressTimer = React.useRef(null);
      const kindRef = React.useRef(null);
      const queryRef = React.useRef(null);

      const loadStatus = React.useCallback(() => {
        let cancelled = false;
        setStatusError('');
        callJson('/bilisum/status')
          .then((payload) => {
            if (!cancelled) setStatus(payload);
          })
          .catch((err) => {
            if (!cancelled) setStatusError(err.message);
          });
        return () => {
          cancelled = true;
        };
      }, []);

      React.useEffect(() => loadStatus(), [loadStatus]);

      // Adopt whatever batch the Host still holds. The panel unmounts when the
      // user opens another sidebar entry, so the running job lives on in the
      // Host; this effect reattaches to its logs and, when finished, its result.
      const refreshJob = React.useCallback(async () => {
        try {
          const payload = await callJson('/bilisum/current');
          const job = payload?.job;
          if (!job) return;
          const serverLogs = Array.isArray(job.logs) ? job.logs : [];
          setLogs(serverLogs);
          offsetRef.current = serverLogs.length;
          if (job.status === 'running') {
            setRunning(true);
            setProbes([]);
            setJobId(job.jobId);
            return;
          }
          setRunning(false);
          setJobId('');
          setResult(job.result ?? null);
          setError(job.error ?? '');
          if (job.progress) settleProgress(job.progress);
        } catch {
          // No route or an empty Host simply means there is nothing to adopt.
        }
      }, []);

      React.useEffect(() => {
        void refreshJob();
      }, [refreshJob]);

      /**
       * Toolbar reset: re-validate the environment and Cookie, then wipe the
       * log, results and any pending selection so the panel starts clean.
       */
      const refreshPlugin = async () => {
        try {
          await callJson('/bilisum/reset', { method: 'POST', body: '{}' });
        } catch {
          // A Host without the route still clears the local view.
        }
        if (progressTimer.current) window.clearTimeout(progressTimer.current);
        setJobId('');
        setRunning(false);
        setProbing(false);
        setLogs([]);
        setResult(null);
        setError('');
        setProbes([]);
        setSelection({});
        setRetryingKeys([]);
        setProgress(null);
        setProgressFading(false);
        // The two inputs belong to this page, not to the Host, so clear them too.
        setCookie('');
        setCookieDirty(false);
        setLinks('');
        setDiscoverItems([]);
        setDiscoverPage(0);
        setDiscoverPicked([]);
        setDiscoverLoaded(false);
        setDiscoverError('');
        setDiscoverQuery('');
        setKindOpen(false);
        setOutputEditing(false);
        setOutputHint('');
        offsetRef.current = 0;
        setLogOpen(false);
        loadStatus();
      };

      /** Open the OS directory picker through the Client workspace service. */
      const pickOutputDir = async () => {
        const service = runtimeCtx?.get?.('uiWorkspace') ?? runtimeCtx?.uiWorkspace;
        if (!service || typeof service.pickDirectory !== 'function') {
          setOutputHint(t('browseUnavailable'));
          return;
        }
        try {
          const picked = await service.pickDirectory();
          if (typeof picked === 'string' && picked.trim()) {
            setOutputDraft(picked.trim());
            setOutputHint('');
          }
        } catch {
          setOutputHint(t('browseUnavailable'));
        }
      };

      /** Persist the chosen output directory (empty string = plugin default). */
      const saveOutput = async (value) => {
        try {
          const payload = await callJson('/bilisum/config', {
            method: 'POST',
            body: JSON.stringify({ outputDir: String(value ?? '').trim() }),
          });
          setOutputEditing(false);
          setOutputHint(payload?.persisted === false ? t('outputPersistHint') : '');
          await loadStatus();
        } catch (err) {
          setOutputHint(err.message);
        }
      };

      /** Show the finished progress line briefly, then fade it away. */
      const settleProgress = (next) => {
        setProgress(next);
        setProgressFading(false);
        if (progressTimer.current) window.clearTimeout(progressTimer.current);
        progressTimer.current = window.setTimeout(() => {
          setProgressFading(true);
          progressTimer.current = window.setTimeout(() => setProgress(null), 400);
        }, 2600);
      };

      // ------------------------------------------------------------------
      // Built-in B站 search / popular list
      // ------------------------------------------------------------------
      const loadDiscover = async ({ reset = false } = {}) => {
        const nextPage = reset ? 1 : discoverPage + 1;
        const params = new URLSearchParams({ kind: discoverKind, page: String(nextPage) });
        if (discoverKind === 'search') params.set('q', discoverQuery.trim());
        setDiscoverBusy(true);
        setDiscoverError('');
        try {
          const payload = await callJson(`/bilisum/discover?${params.toString()}`);
          const items = Array.isArray(payload.items) ? payload.items : [];
          setDiscoverItems((previous) => (reset ? items : [...previous, ...items]));
          setDiscoverPage(nextPage);
        } catch (err) {
          setDiscoverError(err.message);
        } finally {
          setDiscoverBusy(false);
        }
      };

      React.useEffect(() => {
        if (viewMode !== 'discover' || discoverLoaded) return;
        setDiscoverLoaded(true);
        void loadDiscover({ reset: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [viewMode, discoverLoaded]);

      React.useEffect(() => () => {
        if (progressTimer.current) window.clearTimeout(progressTimer.current);
      }, []);

      // Close the custom dropdown on any outside click or Escape.
      React.useEffect(() => {
        if (!kindOpen) return undefined;
        const onPointerDown = (event) => {
          if (kindRef.current && !kindRef.current.contains(event.target)) setKindOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setKindOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('mousedown', onPointerDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [kindOpen]);

      const togglePicked = (bvid) => setDiscoverPicked((previous) => (
        previous.includes(bvid)
          ? previous.filter((item) => item !== bvid)
          : [...previous, bvid]
      ));

      const startFromDiscover = () => {
        if (discoverPicked.length === 0) return;
        void parse(discoverPicked.join(' '));
      };

      /** Compact progress readout that lives inside the log header. */
      const progressInfo = progress
        ? (() => {
          const total = Math.max(1, Number(progress.total) || 0);
          const failed = Number(progress.failed) || 0;
          const finished = Math.min(total, (Number(progress.done) || 0) + failed);
          const percent = Math.min(100, Math.round((finished / total) * 100));
          const label = progress.phase === 'downloads' ? t('progressDownloads') : t('progressSubtitles');
          return {
            text: `${label} ${finished}/${total} · ${percent}%`,
            percent,
            fill: failed > 0 ? 'warn' : progress.phase === 'downloads' ? 'downloads' : 'subtitles',
          };
        })()
        : null;

      /**
       * Shared action bar: the primary button plus the task checkboxes and the
       * quality selector. Both tabs render it, so the options always exist and
       * always come from the same state.
       */
      const actionRow = ({ primary, onPrimary, busy, right }) => h(React.Fragment, null,
        h('div', { className: 'bilisum-actions' },
          h('button', {
            type: 'button',
            className: 'bilisum-button bilisum-button-primary',
            onClick: onPrimary,
            disabled: busy,
          }, primary),
          h('label', { className: 'bilisum-check' },
            h('input', {
              type: 'checkbox',
              checked: extractSubtitles,
              onChange: (event) => setExtractSubtitles(event.target.checked),
            }),
            h('span', null, t('subtitlesLabel'))),
          h('label', {
            className: 'bilisum-check',
            'aria-disabled': downloadReady ? 'false' : 'true',
            title: downloadReady ? '' : downloadReason,
          },
          h('input', {
            type: 'checkbox',
            checked: downloadEnabled && downloadReady,
            disabled: !downloadReady,
            onChange: (event) => setDownloadEnabled(event.target.checked),
          }),
          h('span', null, t('downloadLabel'))),
          h('select', {
            className: 'bilisum-select bilisum-select-compact',
            value: quality,
            disabled: !downloadReady || !downloadEnabled,
            onChange: (event) => setQuality(event.target.value),
            title: t('qualityLabel'),
          }, ['4k', '1080p', '720p', '480p', 'audio'].map((value) => h('option', {
            key: value,
            value,
          }, qualityText(t, value)))),
          right ? h('div', { className: 'bilisum-actions-right' }, right) : null,
        ),
        downloadEnabled && downloadReady
          ? h('span', { className: 'bilisum-actions-hint' }, t('qualityHint'))
          : null,
        !downloadReady && downloadReason
          ? h('span', { className: 'bilisum-actions-hint bilisum-log-error' }, downloadReason)
          : null,
      );

      React.useEffect(() => {
        if (!jobId) return undefined;
        let cancelled = false;
        let timer = null;

        const poll = async () => {
          try {
            const payload = await callJson(
              `/bilisum/poll?jobId=${encodeURIComponent(jobId)}&from=${offsetRef.current}`,
            );
            if (cancelled) return;
            if (Array.isArray(payload.logs) && payload.logs.length > 0) {
              offsetRef.current = payload.nextOffset ?? offsetRef.current;
              setLogs((previous) => [...previous, ...payload.logs]);
            }
            if (payload.progress) setProgress(payload.progress);
            if (payload.status !== 'running') {
              setRunning(false);
              if (payload.status === 'error') setError(payload.error || '抓取失败');
              if (payload.result) setResult(payload.result);
              if (payload.progress) settleProgress(payload.progress);
              // A finished batch drops its search picks so the list is reusable.
              setDiscoverPicked([]);
              return;
            }
            timer = setTimeout(poll, 500);
          } catch (err) {
            if (cancelled) return;
            setRunning(false);
            setError(err.message);
          }
        };

        timer = setTimeout(poll, 300);
        return () => {
          cancelled = true;
          if (timer) clearTimeout(timer);
        };
      }, [jobId]);

      React.useEffect(() => {
        if (!logOpen) return;
        const node = logRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      }, [logs, logOpen]);

      const saveCookie = async () => {
        try {
          setError('');
          const payload = await callJson('/bilisum/cookie', {
            method: 'POST',
            body: JSON.stringify({ sessdata: cookie.trim() }),
          });
          setCookieDirty(false);
          setStatus((previous) => ({
            ...(previous ?? {}),
            cookieConfigured: payload.cookieConfigured,
            cookieValid: payload.cookieValid,
          }));
        } catch (err) {
          setError(err.message);
        }
      };

      const clearCookie = async () => {
        try {
          setCookie('');
          await callJson('/bilisum/cookie', { method: 'POST', body: JSON.stringify({ sessdata: '' }) });
          setCookieDirty(false);
          setStatus((previous) => ({ ...(previous ?? {}), cookieConfigured: false }));
        } catch (err) {
          setError(err.message);
        }
      };

      const beginFetch = async (items) => {
        setError('');
        setLogs([]);
        setResult(null);
        setProbes([]);
        offsetRef.current = 0;
        if (progressTimer.current) window.clearTimeout(progressTimer.current);
        setProgressFading(false);
        const planned = items.reduce(
          (sum, item) => sum + (Array.isArray(item.pages) && item.pages.length > 0 ? item.pages.length : 1),
          0,
        );
        setProgress({ phase: 'subtitles', total: planned, done: 0, failed: 0, current: '' });
        setRunning(true);
        try {
          const payload = await callJson('/bilisum/start', {
            method: 'POST',
            body: JSON.stringify({
              ...(items.length > 0 ? { items } : { text: links }),
              subtitles: extractSubtitles,
              download: { enabled: downloadEnabled && downloadReady, quality },
            }),
          });
          setJobId(payload.jobId);
        } catch (err) {
          setRunning(false);
          setError(err.message);
        }
      };

      /** Resolve metadata first; multi-part videos stop here for selection. */
      const parse = async (textOverride) => {
        const source = typeof textOverride === 'string' && textOverride.trim() ? textOverride : links;
        if (!source.trim()) {
          setError(t('needLinks'));
          return;
        }
        if (!extractSubtitles && !(downloadEnabled && downloadReady)) {
          setError(t('needTask'));
          return;
        }
        setError('');
        setResult(null);
        setLogs([]);
        setProbes([]);
        setProbing(true);
        try {
          const payload = await callJson('/bilisum/probe', {
            method: 'POST',
            body: JSON.stringify({ text: source }),
          });
          const videos = Array.isArray(payload.videos) ? payload.videos : [];
          const failures = Array.isArray(payload.failures) ? payload.failures : [];
          if (videos.length === 0) {
            setProbing(false);
            setError(failures[0]?.message || '没有解析到可抓取的视频。');
            return;
          }
          const multi = videos.filter((video) => video.multi);
          if (multi.length === 0) {
            setProbing(false);
            await beginFetch(videos.map((video) => ({ kind: 'bvid', value: video.bvid, pages: [1] })));
            return;
          }
          // Default to the part the pasted link pointed at; every other part
          // stays unchecked until the user asks for it.
          const next = {};
          for (const video of multi) {
            const requested = Number(video.defaultPage) > 0 ? Number(video.defaultPage) : null;
            const known = video.pages.some((page) => page.page === requested);
            next[video.bvid] = [known ? requested : video.pages[0].page];
          }
          setSelection(next);
          setProbes(videos);
          setProbing(false);
        } catch (err) {
          setProbing(false);
          setError(err.message);
        }
      };

      const togglePage = (bvid, page) => setSelection((previous) => {
        const current = new Set(previous[bvid] ?? []);
        if (current.has(page)) current.delete(page);
        else current.add(page);
        return { ...previous, [bvid]: [...current].sort((left, right) => left - right) };
      });

      const setPages = (bvid, pages) => setSelection((previous) => ({ ...previous, [bvid]: pages }));

      const confirmSelection = async () => {
        const items = [];
        for (const video of probes) {
          if (!video.multi) {
            items.push({ kind: 'bvid', value: video.bvid, pages: [1] });
            continue;
          }
          const pages = selection[video.bvid] ?? [];
          if (pages.length > 0) items.push({ kind: 'bvid', value: video.bvid, pages });
        }
        if (items.length === 0) {
          setError(t('noSelection'));
          return;
        }
        await beginFetch(items);
      };

      const copyPrompt = async () => {
        const videos = result?.videos ?? [];
        const refs = videos
          .map((video) => `@${video.transcriptPath}`)
          .filter((ref) => ref.length > 1)
          .join('\n');
        const ids = videos.map((video) => video.bvid).join(' ');
        const text = [
          t('copyPrompt'),
          refs,
          ids ? `（BV号：${ids}）` : '',
          '请读取上面的字幕文件，逐条总结后用 bilisum_write_report 输出报告。',
        ].filter(Boolean).join('\n');
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setError(text);
        }
      };

      /** Ask the Host to reveal a path in the OS file manager. */
      const reveal = async (target) => {
        if (!target) return;
        try {
          setError('');
          await callJson('/bilisum/open', {
            method: 'POST',
            body: JSON.stringify({ path: target }),
          });
        } catch (err) {
          setError(err.message);
        }
      };

      /** Merge transcript rows with their download outcome, keyed by item key. */
      const merged = React.useMemo(() => {
        if (!result) return [];
        /** @type {Map<string, any>} */
        const byKey = new Map();
        for (const video of result.videos ?? []) {
          const key = video.key ?? video.bvid;
          byKey.set(key, { ...video, key });
        }
        const attach = (item, status) => {
          const key = item.key ?? item.bvid;
          const row = byKey.get(key) ?? {
            key,
            title: item.title,
            bvid: item.bvid,
            page: item.page,
            pageCount: item.pageCount,
          };
          row.download = { status, ...item };
          byKey.set(key, row);
        };
        for (const item of result.downloads ?? []) attach(item, 'success');
        for (const item of result.downloadFailures ?? []) attach(item, 'failed');
        return [...byKey.values()];
      }, [result]);

      const failedKeys = merged
        .filter((row) => row.download?.status === 'failed')
        .map((row) => row.key);
      const downloadOk = merged.filter((row) => row.download?.status === 'success').length;
      const downloadRows = merged.filter((row) => row.download).length;
      // When a download was requested the line counts downloads; otherwise it
      // reports the transcript rows that actually ran.
      const summaryTotal = downloadRows > 0 ? downloadRows : merged.length;
      const summaryOk = downloadRows > 0 ? downloadOk : merged.length;
      const summaryFailed = summaryTotal - summaryOk;

      /** Re-download the failed items and fold the fresh outcome into the list. */
      const retry = async (keys) => {
        if (keys.length === 0) return;
        setError('');
        setRetryingKeys((previous) => [...new Set([...previous, ...keys])]);
        try {
          await callJson('/bilisum/retry', {
            method: 'POST',
            body: JSON.stringify({ keys }),
          });
        } catch (err) {
          setRetryingKeys((previous) => previous.filter((key) => !keys.includes(key)));
          setError(err.message);
          return;
        }
        for (let attempt = 0; attempt < 400; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          try {
            const payload = await callJson('/bilisum/current');
            const job = payload?.job;
            if (job?.result) setResult(job.result);
            const still = (job?.retrying ?? []).filter((key) => keys.includes(key));
            setRetryingKeys(still);
            if (still.length === 0) break;
          } catch {
            break;
          }
        }
        setRetryingKeys((previous) => previous.filter((key) => !keys.includes(key)));
      };

      const rowStatus = (row) => {
        if (retryingKeys.includes(row.key)) return 'retrying';
        const status = row.download?.status;
        if (status === 'success' || status === 'failed') return status;
        // A row without a download record only means "waiting" when this batch
        // actually asked for downloads; otherwise the extract itself succeeded.
        return result?.downloadRequested === true ? 'pending' : 'ok';
      };

      const configured = status?.cookieConfigured === true;
      const cookieOk = configured && status?.cookieValid === true;
      const cookieBad = configured && status?.cookieValid === false;
      const cookieBadge = !configured
        ? { className: 'bilisum-badge bilisum-badge-warn', text: t('cookieMissing') }
        : cookieOk
          ? { className: 'bilisum-badge bilisum-badge-ok', text: t('cookieConfigured') }
          : cookieBad
            ? { className: 'bilisum-badge bilisum-badge-error', text: t('cookieInvalid') }
            : { className: 'bilisum-badge', text: t('cookieUnverified') };
      const pythonOk = Boolean(status?.python?.ok);
      const downloadReady = Boolean(status?.download?.ready);
      const downloadReason = status?.download?.reason || '';

      return h('div', { className: 'bilisum-page' },
        showIntro ? h('p', { className: 'bilisum-desc' }, t('description')) : null,

        h('div', { className: 'bilisum-row' },
          h('button', {
            type: 'button',
            className: 'bilisum-button bilisum-button-quiet',
            title: t('refreshPluginHint'),
            onClick: refreshPlugin,
          }, t('refreshPlugin')),
          h('span', { className: 'bilisum-label' }, t('cookieLabel')),
          h('span', { className: cookieBadge.className }, cookieBadge.text),
          h('button', {
            type: 'button',
            className: 'bilisum-hint',
            title: t('cookieHelpShort'),
            'aria-label': t('cookieHelpShort'),
            'aria-expanded': hintOpen ? 'true' : 'false',
            onClick: () => setHintOpen((open) => !open),
          }, '!'),
          h('span', { className: 'bilisum-label' }, t('pythonLabel')),
          h('span', {
            className: `bilisum-badge ${pythonOk ? 'bilisum-badge-ok' : 'bilisum-badge-error'}`,
          }, pythonOk ? t('pythonOk') : t('pythonMissing')),
          h('span', {
            className: `bilisum-badge ${downloadReady ? 'bilisum-badge-ok' : 'bilisum-badge-error'}`,
            title: downloadReason || t('downloadLabel'),
          }, downloadReady ? t('downloadReady') : t('downloadUnavailable')),
          status?.outputDir
            ? h('div', { className: 'bilisum-row bilisum-row-end' },
              h('span', { className: 'bilisum-label' }, t('outputLabel')),
              h('span', { className: 'bilisum-path', title: status.outputDir }, status.outputDir),
              h('button', {
                type: 'button',
                className: 'bilisum-link',
                onClick: () => {
                  setOutputDraft(status.outputDir);
                  setOutputHint('');
                  setOutputEditing(true);
                },
              }, t('outputChange')),
              status.isCustomOutput
                ? h('button', {
                  type: 'button',
                  className: 'bilisum-link',
                  onClick: () => void saveOutput(''),
                }, t('outputReset'))
                : null,
              h('button', {
                type: 'button',
                className: 'bilisum-button bilisum-button-quiet',
                onClick: () => reveal(status.outputDir),
              }, t('openFolder')))
            : null,
          statusError ? h('span', { className: 'bilisum-code bilisum-log-error' }, statusError) : null,
        ),

        outputEditing
          ? h('div', { className: 'bilisum-card' },
            h('span', { className: 'bilisum-label' }, t('outputEditTitle')),
            h('div', { className: 'bilisum-row' },
              h('div', { className: 'bilisum-output-field' },
                h('input', {
                  className: 'bilisum-input',
                  value: outputDraft,
                  spellCheck: false,
                  placeholder: t('outputResetHint'),
                  onChange: (event) => setOutputDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') void saveOutput(outputDraft);
                    if (event.key === 'Escape') setOutputEditing(false);
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'bilisum-browse',
                  title: t('browseHint'),
                  onClick: () => void pickOutputDir(),
                }, t('browse'))),
              h('button', {
                type: 'button',
                className: 'bilisum-button bilisum-button-primary',
                onClick: () => void saveOutput(outputDraft),
              }, t('save')),
              h('button', {
                type: 'button',
                className: 'bilisum-button',
                onClick: () => setOutputEditing(false),
              }, t('cancel'))),
            h('span', { className: 'bilisum-muted' }, t('outputResetHint')),
          )
          : null,

        outputHint ? h('span', { className: 'bilisum-muted bilisum-log-error' }, outputHint) : null,

        hintOpen
          ? h('div', { className: 'bilisum-help' },
            h('span', { className: 'bilisum-help-title' }, t('cookieHelpTitle')),
            h('span', { className: 'bilisum-help-body' }, t('cookieHelpBody')),
            h('div', { className: 'bilisum-row' },
              h('button', {
                type: 'button',
                className: 'bilisum-button bilisum-button-quiet',
                onClick: () => setHintOpen(false),
              }, t('cookieHelpClose')))
          )
          : null,

        h('div', { className: 'bilisum-card' },
          h('div', { className: 'bilisum-row' },
            h('input', {
              className: 'bilisum-input bilisum-input-grow',
              type: 'password',
              value: cookie,
              placeholder: t('cookiePlaceholder'),
              spellCheck: false,
              onChange: (event) => {
                setCookie(event.target.value);
                setCookieDirty(true);
              },
            }),
            h('button', {
              type: 'button',
              className: 'bilisum-button',
              onClick: saveCookie,
              disabled: !cookieDirty || !cookie.trim(),
            }, t('save')),
            h('button', {
              type: 'button',
              className: 'bilisum-button',
              onClick: clearCookie,
              disabled: !cookieOk && !cookie,
            }, t('clear')),
          ),
        ),

        h('div', { className: 'bilisum-tabs', role: 'tablist' },
          h('button', {
            type: 'button',
            role: 'tab',
            className: `bilisum-tab${viewMode === 'links' ? ' is-active' : ''}`,
            'aria-selected': viewMode === 'links' ? 'true' : 'false',
            onClick: () => setViewMode('links'),
          }, t('tabLinks')),
          h('button', {
            type: 'button',
            role: 'tab',
            className: `bilisum-tab${viewMode === 'discover' ? ' is-active' : ''}`,
            'aria-selected': viewMode === 'discover' ? 'true' : 'false',
            onClick: () => setViewMode('discover'),
          }, t('tabDiscover')),
        ),

        h('div', {
          className: 'bilisum-card bilisum-discover',
          style: { display: viewMode === 'discover' ? 'flex' : 'none' },
        },
        h('div', { className: 'bilisum-toolbar' },
          h('div', { className: 'bilisum-selector', ref: kindRef },
            h('button', {
              type: 'button',
              className: 'bilisum-selector-trigger',
              'aria-haspopup': 'listbox',
              'aria-expanded': kindOpen ? 'true' : 'false',
              onClick: () => setKindOpen((open) => !open),
            },
            h('span', null, discoverKind === 'search' ? t('discoverKindSearch') : t('discoverKindPopular')),
            h('span', { className: 'bilisum-selector-caret', 'aria-hidden': 'true' }, '▼')),
            kindOpen
              ? h('div', { className: 'bilisum-menu', role: 'listbox' },
                ['popular', 'search'].map((value) => h('div', {
                  key: value,
                  role: 'option',
                  'aria-selected': discoverKind === value ? 'true' : 'false',
                  className: `bilisum-menu-option${discoverKind === value ? ' is-active' : ''}`,
                  onClick: () => {
                    setDiscoverKind(value);
                    setKindOpen(false);
                    if (value === 'search') window.setTimeout(() => queryRef.current?.focus(), 0);
                  },
                },
                h('span', null, value === 'search' ? t('discoverKindSearch') : t('discoverKindPopular')),
                discoverKind === value
                  ? h('span', { className: 'bilisum-menu-check', 'aria-hidden': 'true' }, '✓')
                  : null)))
              : null,
          ),
          h('input', {
            className: 'bilisum-toolbar-input',
            ref: queryRef,
            placeholder: t('discoverPlaceholder'),
            value: discoverQuery,
            disabled: discoverKind !== 'search',
            onChange: (event) => setDiscoverQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && discoverKind === 'search') void loadDiscover({ reset: true });
            },
          }),
          h('button', {
            type: 'button',
            className: 'bilisum-toolbar-search',
            disabled: discoverBusy || discoverKind !== 'search',
            onClick: () => void loadDiscover({ reset: true }),
          }, t('discoverSearch')),
        ),
        discoverError
          ? h('span', { className: 'bilisum-muted bilisum-log-error' }, discoverError)
          : null,
        h('div', { className: 'bilisum-discover-list' },
          discoverItems.length === 0
            ? h('span', { className: 'bilisum-discover-empty bilisum-muted' },
              discoverBusy ? t('probing') : t('discoverEmpty'))
            : discoverItems.map((item) => h('div', {
              key: item.bvid,
              className: 'bilisum-discover-row',
            },
            item.cover
              ? h('img', { className: 'bilisum-cover', src: item.cover, alt: '', loading: 'lazy' })
              : h('span', { className: 'bilisum-cover' }),
            h('div', { className: 'bilisum-discover-main' },
              h('div', { className: 'bilisum-discover-title', title: item.title }, item.title),
              h('div', { className: 'bilisum-discover-meta' },
                `${item.up}${item.duration ? ` · ${formatDuration(item.duration)}` : ''}`),
            ),
            h('button', {
              type: 'button',
              className: `bilisum-button${discoverPicked.includes(item.bvid) ? ' bilisum-button-quiet' : ''}`,
              onClick: () => togglePicked(item.bvid),
            }, discoverPicked.includes(item.bvid) ? t('discoverAdded') : t('discoverAdd')),
            )),
        ),
        actionRow({
          primary: t('discoverStart'),
          onPrimary: startFromDiscover,
          busy: running || discoverPicked.length === 0,
          right: h(React.Fragment, null,
            discoverPicked.length > 0
              ? h('span', { className: 'bilisum-muted' },
                t('discoverPicked').replace('{count}', String(discoverPicked.length)))
              : null,
            h('button', {
              type: 'button',
              className: 'bilisum-button bilisum-button-quiet',
              disabled: discoverBusy,
              onClick: () => void loadDiscover({}),
            }, t('discoverMore'))),
        }),
        ),

        h('div', {
          className: 'bilisum-card',
          style: { display: viewMode === 'links' ? 'flex' : 'none' },
        },
          h('span', { className: 'bilisum-label' }, t('linksLabel')),
          h('textarea', {
            className: 'bilisum-textarea',
            value: links,
            placeholder: t('linksPlaceholder'),
            spellCheck: false,
            onChange: (event) => setLinks(event.target.value),
          }),
          actionRow({
            primary: probing ? t('probing') : running ? t('running') : t('start'),
            onPrimary: () => void parse(),
            busy: running || probing,
          }),
          error ? h('span', { className: 'bilisum-log-error bilisum-muted' }, error) : null,
        ),

        probes.length > 0
          ? h('div', { className: 'bilisum-card' },
            h('span', { className: 'bilisum-label' }, t('chooseHint')),
            probes.filter((video) => video.multi).map((video) => h('div', { key: video.bvid },
              h('div', { className: 'bilisum-series' },
                t('seriesHint')
                  .replace('{title}', video.seriesTitle || video.title)
                  .replace('{count}', String(video.pages.length))),
              h('div', { className: 'bilisum-row bilisum-row-nowrap' },
                h('span', { className: 'bilisum-muted' },
                  t('selectedCount').replace('{count}', String((selection[video.bvid] ?? []).length))),
                h('button', {
                  type: 'button',
                  className: 'bilisum-button bilisum-button-quiet',
                  onClick: () => setPages(video.bvid, video.pages.map((page) => page.page)),
                }, t('selectAll')),
                h('button', {
                  type: 'button',
                  className: 'bilisum-button bilisum-button-quiet',
                  onClick: () => {
                    const all = video.pages.map((page) => page.page);
                    const current = selection[video.bvid] ?? [];
                    setPages(video.bvid, all.filter((page) => !current.includes(page)));
                  },
                }, t('invert')),
              ),
              h('div', { className: 'bilisum-pages' },
                video.pages.map((page) => h('label', { key: page.page, className: 'bilisum-page-item' },
                  h('input', {
                    type: 'checkbox',
                    checked: (selection[video.bvid] ?? []).includes(page.page),
                    onChange: () => togglePage(video.bvid, page.page),
                  }),
                  h('span', { className: 'bilisum-page-title' }, `[P${page.page}] ${page.part || video.title}`),
                  h('span', { className: 'bilisum-page-dur' }, formatDuration(page.duration)),
                )),
              ),
            )),
            probes.filter((video) => !video.multi).length > 0
              ? h('span', { className: 'bilisum-muted' },
                `${t('singleVideo')}：${probes.filter((video) => !video.multi).map((video) => video.title).join('、')}`)
              : null,
            h('div', { className: 'bilisum-row' },
              h('button', {
                type: 'button',
                className: 'bilisum-button bilisum-button-primary',
                onClick: confirmSelection,
              }, t('startFetch')),
              h('button', {
                type: 'button',
                className: 'bilisum-button',
                onClick: () => {
                  setProbes([]);
                  setSelection({});
                },
              }, t('cancel')),
            ),
          )
          : null,

        h('div', { className: 'bilisum-card bilisum-card-log' },
          h('div', { className: 'bilisum-log-head' },
            h('span', { className: 'bilisum-log-title' }, t('logsLabel')),
            h('span', { className: 'bilisum-muted' }, t('logCount').replace('{count}', String(logs.length))),
            h('button', {
              type: 'button',
              className: 'bilisum-log-toggle',
              'aria-expanded': logOpen ? 'true' : 'false',
              onClick: () => setLogOpen((open) => !open),
            }, logOpen ? t('logCollapse') : t('logExpand')),
            progressInfo
              ? h('span', { className: `bilisum-progress-inline${progressFading ? ' is-fading' : ''}` },
                h('span', { className: 'bilisum-progress-text' }, progressInfo.text),
                h('span', { className: 'bilisum-progress-track bilisum-progress-track-inline' },
                  h('span', {
                    className: `bilisum-progress-fill bilisum-progress-fill-${progressInfo.fill}`,
                    style: { width: `${progressInfo.percent}%` },
                  })))
              : null,
          ),
          logOpen
            ? h('pre', { className: 'bilisum-log', ref: logRef },
              logs.length === 0
                ? h('span', { className: 'bilisum-muted' }, t('emptyLog'))
                : logs.map((entry, index) => h('div', {
                  key: `${entry.at}-${index}`,
                  className: levelClass(entry.level),
                }, `[${String(entry.level ?? 'info').toUpperCase()}] ${entry.message}`)))
            : null,
        ),

        result
          ? h('div', { className: 'bilisum-card' },
            merged.length > 0
              ? h('div', { className: 'bilisum-row' },
                h('span', { className: 'bilisum-label' },
                  t('summary')
                    .replace('{total}', String(summaryTotal))
                    .replace('{ok}', String(summaryOk))
                    .replace('{failed}', String(summaryFailed))),
                failedKeys.length > 0
                  ? h('button', {
                    type: 'button',
                    className: 'bilisum-button bilisum-button-quiet',
                    disabled: retryingKeys.length > 0,
                    onClick: () => retry(failedKeys),
                  }, t('retryAll').replace('{count}', String(failedKeys.length)))
                  : null,
              )
              : null,
            merged.length > 0
              ? h('ul', { className: 'bilisum-list' },
                merged.map((row) => h('li', { key: row.key, className: 'bilisum-item' },
                  h('div', { className: 'bilisum-row' },
                    h('span', {
                      className: `bilisum-mark bilisum-mark-${rowStatus(row) === 'success' ? 'ok' : rowStatus(row) === 'failed' ? 'bad' : 'busy'}`,
                      title: row.download?.message ?? '',
                    }, rowStatus(row) === 'success' ? '✓' : rowStatus(row) === 'failed' ? '✕' : '⋯'),
                    h('span', null, `${row.title} · ${row.up ?? ''} · ${row.pubdate ?? ''}`),
                    rowStatus(row) === 'failed'
                      ? h('button', {
                        type: 'button',
                        className: 'bilisum-button bilisum-button-quiet',
                        title: t('retryHint'),
                        onClick: () => retry([row.key]),
                      }, t('retry'))
                      : null,
                    rowStatus(row) === 'retrying'
                      ? h('span', { className: 'bilisum-muted' }, t('retrying'))
                      : null,
                  ),
                  h('div', { className: 'bilisum-row' },
                    h('span', { className: 'bilisum-code' },
                      `${row.bvid}${Number(row.pageCount) > 1 ? ` P${row.page}` : ''} · ${row.chars ?? 0} 字`),
                    row.download?.status === 'success'
                      ? h('span', { className: 'bilisum-code' },
                        `${megabytes(row.download.bytes)} · ${row.download.vcodec ?? ''}`)
                      : null,
                  ),
                  row.transcriptPath
                    ? h('div', { className: 'bilisum-row' },
                      h('span', { className: 'bilisum-muted' }, `${t('subtitleTag')}：`),
                      h('span', { className: 'bilisum-path', title: row.transcriptPath }, row.transcriptPath),
                      h('button', {
                        type: 'button',
                        className: 'bilisum-button bilisum-button-quiet',
                        onClick: () => reveal(row.transcriptPath),
                      }, t('openFile')))
                    : null,
                  row.download?.path
                    ? h('div', { className: 'bilisum-row' },
                      h('span', { className: 'bilisum-muted' }, `${t('videoTag')}：`),
                      h('span', { className: 'bilisum-path', title: row.download.path }, row.download.path),
                      h('button', {
                        type: 'button',
                        className: 'bilisum-button bilisum-button-quiet',
                        onClick: () => reveal(row.download.path),
                      }, t('openFile')))
                    : null,
                  row.download?.status === 'failed'
                    ? h('div', { className: 'bilisum-muted bilisum-log-error' }, row.download.message ?? '')
                    : null,
                )),
              )
              : null,
            result.failures.length > 0
              ? h('div', null,
                h('span', { className: 'bilisum-label' }, `${t('failuresLabel')}（${result.failures.length}）`),
                h('ul', { className: 'bilisum-list' },
                  result.failures.map((failure, index) => h('li', { key: `${failure.link}-${index}` },
                    `${failure.link} — ${failure.message}`,
                  )),
                ),
              )
              : null,
            result.videos.length > 0
              ? h('p', { className: 'bilisum-desc' }, t('handoff'))
              : null,
            result.videos.length > 0
              ? h('div', { className: 'bilisum-row' },
                h('button', {
                  type: 'button',
                  className: 'bilisum-button',
                  onClick: copyPrompt,
                }, copied ? t('copied') : t('copyHint')),
              )
              : null,
          )
          : null,
      );
    }

    /** Central-column page selected by the sidebar panel entry. */
    function BiliSumMainPage({ t }) {
      return h('section', { className: 'bilisum-shell', 'aria-label': t('title') },
        h('style', { key: 'bilisum-css' }, CSS),
        h('header', { className: 'bilisum-top' },
          h('h1', { className: 'bilisum-top-title' }, t('title')),
          h('span', { className: 'bilisum-top-hint' }, t('hint')),
        ),
        h('div', { className: 'bilisum-scroll' },
          h('div', { className: 'bilisum-content' },
            h(BiliSumConsole, { t }),
          ),
        ),
      );
    }

    /** Settings section kept as the configuration entry. */
    function BiliSumSettingsPage({ t }) {
      return h('div', { className: 'bilisum-settings' },
        h('style', { key: 'bilisum-css' }, CSS),
        h(BiliSumConsole, { t, showIntro: true }),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = Object.entries(DICTS_BY_LOCALE).map(([locale, dict]) => {
            try {
              return ctx.locale.register(NS, locale, dict);
            } catch {
              return () => {};
            }
          });
          return () => {
            for (const dispose of disposers) {
              try {
                dispose();
              } catch {
                // already removed
              }
            }
          };
        }, 'bilisum: dictionaries');

        const t = ctx.locale.bind(NS);
        runtimeCtx = ctx;

        // Sidebar panel entry: the shell owns the button, tooltip, label, and the
        // selection. Its id is the `main` slot key below.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          locale: NS,
          label: () => t('panel'),
        }, PanelIcon));

        // Central page rendered when that entry is selected.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, (props) => h(BiliSumMainPage, { t: props?.t ?? t })));

        // Configuration entry that stays inside Settings.
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: PANEL_ID,
          order: 40,
          locale: NS,
          label: () => t('panel'),
        }, (props) => h(BiliSumSettingsPage, { t: props?.t ?? t })));
      },
    };
  },
});
