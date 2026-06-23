import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { exportFlattenedXlsx, ExportProgressUpdate } from "../pipeline/exportXlsx";
import { generateFromXml } from "../pipeline/generate";

type OutputFormat = "priorsart" | "xlsx";
type RoleMode = "user" | "admin";

type UploadFile = {
  name: string;
  relativePath?: string;
  contentBase64: string;
};

type JobState = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  stage: string;
  outputFormat: OutputFormat;
  detail?: string;
  error?: string;
  outputFile?: string;
  tempDir?: string;
};

const PORT = Number(process.env.PORT ?? 4173);
const XLSX_EXPORT_ENABLED = process.env.PRIORSART_ALLOW_XLSX_EXPORT === "1";
const jobs = new Map<string, JobState>();

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PriorsArt Generator</title>
  <style>
    :root {
      --bg: #e6e8ee;
      --panel: #ffffff;
      --panel-soft: #f4f6fb;
      --text: #0f1f36;
      --muted: #5f708c;
      --accent: #2b73db;
      --accent-2: #1e5cb4;
      --danger: #cc3f4c;
      --border: #d5ddea;
      --shadow: 0 12px 30px rgba(15, 33, 64, 0.09);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", Tahoma, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 10% -10%, #ffffff 0%, rgba(255, 255, 255, 0) 45%),
        linear-gradient(180deg, #eceef4 0%, #e2e6ef 100%);
    }
    .wrap {
      max-width: 1240px;
      margin: 0 auto;
      padding: 18px;
    }
    .shell {
      background: #f7f8fb;
      border: 1px solid #cfd7e4;
      border-radius: 12px;
      box-shadow: var(--shadow);
      padding: 12px;
    }
    .viewer-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 4px 8px 12px;
      animation: rise 280ms ease-out both;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand img {
      height: 34px;
      width: auto;
      display: block;
    }
    .grid {
      display: grid;
      grid-template-columns: 1.3fr 0.7fr;
      gap: 16px;
      align-items: stretch;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px;
      box-shadow: 0 2px 8px rgba(20, 40, 80, 0.04);
    }
    .dropzone {
      border: 1.5px dashed #aac0e0;
      background: linear-gradient(180deg, #fafcff 0%, #f4f8ff 100%);
      border-radius: 8px;
      padding: 20px;
      min-height: 380px;
      display: grid;
      place-items: center;
      text-align: center;
      transition: 180ms ease;
    }
    .dropzone.dragover {
      border-color: var(--accent);
      background: linear-gradient(180deg, #edf5ff 0%, #e4f1ff 100%);
      transform: translateY(-1px);
    }
    .drop-title {
      font-size: 21px;
      font-weight: 700;
      margin: 8px 0;
    }
    .drop-copy { color: var(--muted); margin: 0; line-height: 1.5; font-size: 13px; }
    .drop-copy code {
      background: #eaf0fc;
      border: 1px solid #d2ddf2;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 12px;
      color: #173159;
    }
    .file-actions {
      margin-top: 16px;
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .files {
      margin-top: 16px;
      display: grid;
      gap: 8px;
      width: 100%;
      text-align: left;
    }
    .file-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 10px;
      border-radius: 8px;
      background: var(--panel-soft);
      border: 1px solid #d8e0ee;
      color: var(--text);
    }
    .file-row span { color: var(--muted); font-size: 12px; }
    .side {
      display: flex;
      flex-direction: column;
      gap: 16px;
      height: 100%;
    }
    .card-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      min-height: 30px;
    }
    .card-title h2 {
      margin: 0;
      font-size: 17px;
      letter-spacing: 0.01em;
      line-height: 1.2;
    }
    .card-title .subtle {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.2;
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 14px;
    }
    select, input[type="text"] {
      width: 100%;
      border-radius: 8px;
      border: 1px solid #cdd7ea;
      background: #fff;
      color: var(--text);
      padding: 11px 12px;
      outline: none;
    }
    select:focus, input[type="text"]:focus {
      border-color: #6da0e8;
      box-shadow: 0 0 0 3px rgba(49, 116, 214, 0.12);
    }
    .btn {
      width: 100%;
      border: 0;
      border-radius: 999px;
      padding: 10px 18px;
      font-weight: 700;
      color: #fff;
      background: #2563eb;
      cursor: pointer;
      transition: transform 160ms ease, opacity 160ms ease;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
    .btn-secondary {
      border: none;
      border-radius: 999px;
      padding: 10px 18px;
      font-weight: 700;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
    }
    .btn-secondary:hover {
      background: #1e4fc4;
    }
    .btn-secondary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .progress-wrap {
      display: grid;
      gap: 12px;
      flex: 1 1 auto;
      align-content: start;
    }
    .progress-wrap .download {
      margin-top: auto;
      align-self: start;
    }
    .progress-bar {
      height: 12px;
      border-radius: 999px;
      background: #e8eff9;
      overflow: hidden;
      border: 1px solid #cfdbef;
    }
    .progress-bar > div {
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent-2), var(--accent));
      transition: width 220ms ease;
    }
    .status {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 13px;
    }
    .status strong { color: var(--text); }
    .run-summary {
      display: grid;
      gap: 3px;
      padding: 10px;
      border-radius: 8px;
      border: 1px solid #d9e2f0;
      background: #f8fbff;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .run-summary strong {
      color: #193761;
      font-size: 13px;
    }
    .run-summary .meta {
      color: var(--muted);
    }
    .message {
      min-height: 20px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .message.error { color: var(--danger); }
    .download {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 18px;
      border-radius: 999px;
      background: #f2f4f8;
      border: none;
      color: #1a3766;
      text-decoration: none;
      font-weight: 700;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
      .side { height: auto; }
      .viewer-head {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="shell">
      <header class="viewer-head">
        <div class="brand">
          <img src="/PriorsArt1.png" alt="PriorsArt" />
        </div>
      </header>

      <div class="grid">
        <div class="card" id="inputCard">
          <div id="dropzone" class="dropzone">
            <div>
              <div class="drop-title">Drag and drop XML files here</div>
              <p class="drop-copy">Drop the XML files from the source folder, or pick a folder/file set with the buttons below.</p>
              <input id="fileInput" type="file" accept=".xml,.json" multiple style="display:none" />
              <input id="folderInput" type="file" accept=".xml,.json" multiple webkitdirectory style="display:none" />
              <div class="file-actions">
                <button id="pickFilesBtn" type="button" class="btn-secondary">Choose files</button>
                <button id="pickFolderBtn" type="button" class="btn-secondary">Choose folder</button>
              </div>
              <div id="files" class="files"></div>
            </div>
          </div>
        </div>

        <div class="side" id="rightColumn">
          <div class="card" id="buildSettingsCard">
            <div class="card-title">
              <h2>Build settings</h2>
              <div class="subtle">Saved locally</div>
            </div>
            <label>
              Role
              <select id="roleMode">
                <option value="user" selected>User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label id="adminKeyWrap" style="display:none">
              Admin access key
              <input id="adminKey" type="password" placeholder="Enter admin key" autocomplete="off" />
            </label>
            <label id="outputFormatWrap" style="display:none">
              Output format
              <select id="outputFormat">
                <option value="priorsart" selected>Contract compliant .priorsart</option>
                <option value="xlsx">Flattened .xlsx (admin only)</option>
              </select>
            </label>
            <label>
              Output file name
              <input id="outputName" type="text" value="" />
            </label>
            <label>
              Date order
              <select id="dateOrder">
                <option value="YMD" selected>YMD</option>
                <option value="MDY">MDY</option>
                <option value="DMY">DMY</option>
              </select>
            </label>
            <button id="goBtn" class="btn">Generate</button>
          </div>

          <div class="card progress-wrap">
            <div class="card-title">
              <h2>Progress</h2>
              <div class="subtle" id="progressHint">Waiting</div>
            </div>
            <div id="runSummary" class="run-summary">No completed run yet. The latest output summary will appear here after the first successful run.</div>
            <div class="status"><strong id="stage">Idle</strong><span id="percent">0%</span></div>
            <div class="progress-bar"><div id="bar"></div></div>
            <div id="message" class="message">Ready when you are.</div>
            <a id="download" class="download" href="#" style="display:none" download>Download output</a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const WEB_XLSX_ENABLED = ${XLSX_EXPORT_ENABLED ? "true" : "false"};
    const PREF_KEY = 'priorsart-web-prefs';
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    const pickFilesBtn = document.getElementById('pickFilesBtn');
    const pickFolderBtn = document.getElementById('pickFolderBtn');
    const filesEl = document.getElementById('files');
    const goBtn = document.getElementById('goBtn');
    const roleMode = document.getElementById('roleMode');
    const adminKeyWrap = document.getElementById('adminKeyWrap');
    const adminKey = document.getElementById('adminKey');
    const outputFormatWrap = document.getElementById('outputFormatWrap');
    const outputFormat = document.getElementById('outputFormat');
    const outputName = document.getElementById('outputName');
    const dateOrder = document.getElementById('dateOrder');
    const rightColumn = document.getElementById('rightColumn');
    const inputCard = document.getElementById('inputCard');
    const buildSettingsCard = document.getElementById('buildSettingsCard');
    const stageEl = document.getElementById('stage');
    const percentEl = document.getElementById('percent');
    const barEl = document.getElementById('bar');
    const messageEl = document.getElementById('message');
    const downloadEl = document.getElementById('download');
    const progressHintEl = document.getElementById('progressHint');
    const runSummaryEl = document.getElementById('runSummary');

    let selectedFiles = [];
    let pollTimer = null;
    let prefs = { roleMode: 'user', outputFormat: 'priorsart', outputName: '', dateOrder: 'YMD', lastRun: null };

    function currentDateStamp() {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mmm = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][now.getMonth()] || 'JAN';
      const yyyy = String(now.getFullYear());
      return dd + mmm + yyyy;
    }

    function defaultOutputName(format) {
      return format === 'xlsx'
        ? 'generated' + currentDateStamp() + '.xlsx'
        : 'generated' + currentDateStamp() + '.priorsart';
    }

    function isLegacyOutputName(value) {
      return /^processedData\.generated\.(xlsx|priorsart)$/i.test((value || '').trim());
    }

    function isGeneratedDateOutputName(value, format) {
      const ext = format === 'xlsx' ? 'xlsx' : 'priorsart';
      return new RegExp('^generated\\d{2}[A-Z]{3}\\d{4}\\.' + ext + '$', 'i').test((value || '').trim());
    }

    function setOutputNameDefault(format) {
      const next = defaultOutputName(format);
      outputName.value = next;
      prefs.outputName = next;
    }

    function normalizeOutputName(value, format) {
      const trimmed = (value || '').trim();
      const ext = format === 'xlsx' ? '.xlsx' : '.priorsart';
      if (!trimmed) return defaultOutputName(format);
      if (trimmed.toLowerCase().endsWith(ext)) return trimmed;
      return trimmed.replace(/\.(xlsx|priorsart)$/i, '') + ext;
    }

    function applyRoleAndFormatRules() {
      if (!WEB_XLSX_ENABLED) {
        outputFormat.value = 'priorsart';
      }

      const isAdmin = roleMode.value === 'admin';
      const canChooseXlsx = WEB_XLSX_ENABLED && isAdmin;
      outputFormat.querySelector('option[value="xlsx"]').disabled = !canChooseXlsx;
      outputFormatWrap.style.display = isAdmin ? '' : 'none';

      if (!canChooseXlsx && outputFormat.value === 'xlsx') {
        outputFormat.value = 'priorsart';
      }

      adminKeyWrap.style.display = 'none';
      outputName.value = normalizeOutputName(outputName.value, outputFormat.value);
      syncDropzoneHeight();
    }

    function syncDropzoneHeight() {
      const baseline = 380;
      if (!dropzone || !buildSettingsCard) {
        return;
      }

      // Reset before measuring so previous expansion does not lock future shrink.
      dropzone.style.minHeight = baseline + 'px';

      if (window.matchMedia('(max-width: 900px)').matches) {
        const settingsHeight = buildSettingsCard.getBoundingClientRect().height;
        const mobileTarget = Math.max(baseline, Math.ceil(settingsHeight));
        dropzone.style.minHeight = mobileTarget + 'px';
        return;
      }

      if (!rightColumn || !inputCard) {
        const settingsHeight = buildSettingsCard.getBoundingClientRect().height;
        const fallbackTarget = Math.max(baseline, Math.ceil(settingsHeight));
        dropzone.style.minHeight = fallbackTarget + 'px';
        return;
      }

      const rightHeight = Math.ceil(rightColumn.getBoundingClientRect().height);
      const cardStyles = window.getComputedStyle(inputCard);
      const cardVerticalPadding =
        Number.parseFloat(cardStyles.paddingTop || '0') + Number.parseFloat(cardStyles.paddingBottom || '0');
      const target = Math.max(baseline, Math.ceil(rightHeight - cardVerticalPadding));
      dropzone.style.minHeight = target + 'px';
    }

    function normalizeRun(value) {
      if (!value || typeof value !== 'object') return null;
      const item = value;
      const files = Array.isArray(item.files)
        ? item.files.filter((file) => typeof file === 'string' && file.trim())
        : [];
      return {
        signature: typeof item.signature === 'string' ? item.signature : files.join('|') + '|' + (typeof item.outputName === 'string' ? item.outputName : '') + '|' + (typeof item.outputFormat === 'string' ? item.outputFormat : 'priorsart') + '|' + (typeof item.dateOrder === 'string' ? item.dateOrder : 'YMD'),
        roleMode: item.roleMode === 'admin' ? 'admin' : 'user',
        outputFormat: item.outputFormat === 'xlsx' ? 'xlsx' : 'priorsart',
        outputName:
          typeof item.outputName === 'string' && item.outputName.trim()
            ? item.outputName
            : defaultOutputName(item.outputFormat === 'xlsx' ? 'xlsx' : 'priorsart'),
        dateOrder: ['YMD', 'MDY', 'DMY'].includes(item.dateOrder) ? item.dateOrder : 'YMD',
        files,
        rows: typeof item.rows === 'string' ? item.rows : '',
        stamp: typeof item.stamp === 'string' ? item.stamp : '',
      };
    }

    function summarizeFiles(files) {
      if (!files.length) return 'No files';
      if (files.length <= 3) return files.join(', ');
      return files.slice(0, 3).join(', ') + ' +' + (files.length - 3) + ' more';
    }

    function loadPrefs() {
      try {
        const raw = localStorage.getItem(PREF_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const parsedOutputFormat = parsed.outputFormat === 'xlsx' ? 'xlsx' : 'priorsart';
            prefs = {
              roleMode: parsed.roleMode === 'admin' ? 'admin' : prefs.roleMode,
              outputFormat: parsedOutputFormat,
              outputName: typeof parsed.outputName === 'string' && parsed.outputName.trim() ? parsed.outputName : defaultOutputName(parsedOutputFormat),
              dateOrder: ['YMD', 'MDY', 'DMY'].includes(parsed.dateOrder) ? parsed.dateOrder : prefs.dateOrder,
              lastRun: normalizeRun(parsed.lastRun),
            };
          }
        }
      } catch {
        // Ignore malformed local state.
      }
      roleMode.value = prefs.roleMode;
      outputFormat.value = prefs.outputFormat;
      outputName.value = prefs.outputName;
      dateOrder.value = prefs.dateOrder;
      applyRoleAndFormatRules();
      if (isLegacyOutputName(outputName.value) || !isGeneratedDateOutputName(outputName.value, outputFormat.value)) {
        setOutputNameDefault(outputFormat.value);
      }
      prefs.outputFormat = outputFormat.value;
      prefs.outputName = normalizeOutputName(outputName.value, outputFormat.value);
      outputName.value = prefs.outputName;
      savePrefs();
      renderSummary();
    }

    function savePrefs() {
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
      } catch {
        // Ignore storage quota and privacy mode failures.
      }
    }

    function addRecentRun(entry) {
      const stamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      const normalized = {
        ...entry,
        stamp,
      };
      prefs.lastRun = normalized;
      savePrefs();
      renderSummary();
    }

    function renderSummary() {
      if (!runSummaryEl) return;
      if (!prefs.lastRun) {
        runSummaryEl.innerHTML = '<strong>No completed run yet</strong><span class="meta">The latest output summary will appear here after the first successful run.</span>';
        return;
      }

      runSummaryEl.innerHTML =
        '<strong>' + escapeHtml(prefs.lastRun.outputName || defaultOutputName((prefs.lastRun.outputFormat || 'priorsart') === 'xlsx' ? 'xlsx' : 'priorsart')) + '</strong>' +
        '<span class="meta">' + escapeHtml((prefs.lastRun.outputFormat || 'priorsart') + ' · ' + (prefs.lastRun.files || []).length + ' file(s) · ' + (prefs.lastRun.dateOrder || 'YMD') + (prefs.lastRun.rows ? ' · ' + prefs.lastRun.rows : '')) + '</span>' +
        '<span class="meta">' + escapeHtml(summarizeFiles(prefs.lastRun.files || [])) + '</span>';
    }

    function renderFiles() {
      filesEl.innerHTML = selectedFiles.length
        ? selectedFiles
            .map(
              (f) =>
                '<div class="file-row"><div><strong>' +
                escapeHtml(f.webkitRelativePath || f.relativePath || f.name) +
                '</strong><span> ' +
                Math.round(f.size / 1024) +
                ' KB</span></div></div>'
            )
            .join('')
        : '<div class="file-row"><div><strong>No files selected</strong><span> drop files or click the area to browse</span></div></div>';
      progressHintEl.textContent = selectedFiles.length ? selectedFiles.length + ' file(s) ready' : 'Waiting';
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function setProgress(progress, stage, message) {
      const pct = Math.max(0, Math.min(100, Math.round(progress || 0)));
      barEl.style.width = pct + '%';
      percentEl.textContent = pct + '%';
      stageEl.textContent = stage || 'Working';
      messageEl.textContent = message || '';
      messageEl.classList.remove('error');
    }

    function setError(message) {
      messageEl.textContent = message;
      messageEl.classList.add('error');
    }

    async function fileToUpload(file) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const relativePath = typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.trim()
        ? file.webkitRelativePath
        : typeof file.relativePath === 'string' && file.relativePath.trim()
          ? file.relativePath
          : file.name;
      return { name: file.name, relativePath, contentBase64: btoa(binary) };
    }

    async function refreshJob(jobId) {
      const response = await fetch('/api/jobs/' + jobId);
      if (!response.ok) throw new Error('Failed to read job status');
      return response.json();
    }

    async function startJob() {
      if (!selectedFiles.length) {
        setError('Add at least one XML file first.');
        return;
      }

      goBtn.disabled = true;
      downloadEl.style.display = 'none';
      setProgress(2, 'Uploading files', 'Preparing source files...');

      const files = [];
      for (const file of selectedFiles) files.push(await fileToUpload(file));

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          outputName: outputName.value.trim(),
          dateOrder: dateOrder.value,
          outputFormat: outputFormat.value,
          roleMode: roleMode.value,
          adminKey: adminKey.value,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to start generation');
      }

      const { jobId } = await response.json();
      setProgress(8, 'Queued', 'Waiting for generation to begin...');

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const job = await refreshJob(jobId);
          setProgress(job.progress, job.stage, job.detail || job.error || '');
          if (job.status === 'done') {
            clearInterval(pollTimer);
            downloadEl.href = '/api/jobs/' + jobId + '/download';
            downloadEl.style.display = 'inline-flex';
            goBtn.disabled = false;
            setProgress(100, 'Done', 'Output is ready to download.');
            addRecentRun({
              signature: selectedFiles.map((file) => file.webkitRelativePath || file.relativePath || file.name).join('|') + '|' + outputName.value.trim() + '|' + outputFormat.value + '|' + dateOrder.value,
              roleMode: roleMode.value,
              outputFormat: outputFormat.value,
              outputName: outputName.value.trim(),
              dateOrder: dateOrder.value,
              files: selectedFiles.map((file) => file.webkitRelativePath || file.relativePath || file.name),
              rows: job.detail || '',
            });
          } else if (job.status === 'error') {
            clearInterval(pollTimer);
            goBtn.disabled = false;
            setError(job.error || 'Generation failed.');
          }
        } catch (error) {
          clearInterval(pollTimer);
          goBtn.disabled = false;
          setError(error.message || String(error));
        }
      }, 450);
    }

    dropzone.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.file-actions')) {
        return;
      }
      fileInput.click();
    });
    pickFilesBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      fileInput.click();
    });
    pickFolderBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (typeof window.showDirectoryPicker === 'function') {
        window.showDirectoryPicker().then(async (handle) => {
          const files = [];

          const collectFiles = async (directory, prefix) => {
            for await (const entry of directory.values()) {
              if (entry.kind === 'file') {
                const file = await entry.getFile();
                file.relativePath = prefix + file.name;
                files.push(file);
              } else if (entry.kind === 'directory') {
                await collectFiles(entry, prefix + entry.name + '/');
              }
            }
          };

          await collectFiles(handle, '');
          selectedFiles = files;
          renderFiles();
        }).catch(() => {
          // User cancelled folder selection.
        });
        return;
      }

      folderInput.click();
    });
    fileInput.addEventListener('change', () => {
      selectedFiles = Array.from(fileInput.files || []);
      renderFiles();
      syncDropzoneHeight();
    });
    folderInput.addEventListener('change', () => {
      selectedFiles = Array.from(folderInput.files || []);
      renderFiles();
      syncDropzoneHeight();
    });
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
      selectedFiles = Array.from(event.dataTransfer.files || []).filter((file) => /\.(xml|json)$/i.test(file.name));
      renderFiles();
    });
    outputName.addEventListener('input', () => {
      prefs.outputName = normalizeOutputName(outputName.value, outputFormat.value);
      outputName.value = prefs.outputName;
      savePrefs();
    });
    roleMode.addEventListener('change', () => {
      prefs.roleMode = roleMode.value;
      applyRoleAndFormatRules();
      prefs.outputFormat = outputFormat.value;
      prefs.outputName = normalizeOutputName(outputName.value, outputFormat.value);
      outputName.value = prefs.outputName;
      savePrefs();
    });
    outputFormat.addEventListener('change', () => {
      applyRoleAndFormatRules();
      prefs.outputFormat = outputFormat.value;
      setOutputNameDefault(outputFormat.value);
      savePrefs();
    });
    dateOrder.addEventListener('change', () => {
      prefs.dateOrder = dateOrder.value;
      savePrefs();
      syncDropzoneHeight();
    });
    goBtn.addEventListener('click', () => {
      startJob().catch((error) => {
        goBtn.disabled = false;
        setError(error.message || String(error));
      });
    });

    loadPrefs();
    renderFiles();
    syncDropzoneHeight();
    window.addEventListener('resize', syncDropzoneHeight);
  </script>
</body>
</html>`;

async function ensureJobDir(jobId: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `priorsart-${jobId}-`));
}

function updateJob(jobId: string, patch: Partial<JobState>): void {
  const current = jobs.get(jobId);
  if (!current) {
    return;
  }
  jobs.set(jobId, { ...current, ...patch });
}

async function runJob(jobId: string, body: { files: UploadFile[]; outputName: string; dateOrder: string; outputFormat: OutputFormat }): Promise<void> {
  const tempDir = await ensureJobDir(jobId);
  updateJob(jobId, { status: "running", progress: 5, stage: "Writing uploaded files", tempDir });

  const writtenNames: string[] = [];
  for (const file of body.files) {
    const targetPath = path.join(tempDir, resolveUploadPath(file.relativePath, file.name));
    const buffer = Buffer.from(file.contentBase64, "base64");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
    writtenNames.push(path.basename(file.name));
  }

  const manifestName = writtenNames.find((name) => name.toLowerCase() === "xml-input.manifest.json") ?? writtenNames.find((name) => name.toLowerCase().endsWith(".json"));
  const manifestPath = manifestName ? path.join(tempDir, manifestName) : undefined;
  const outputName = normalizeOutputName(body.outputName, body.outputFormat);
  const outputFile = path.join(tempDir, outputName);
  const sourcePath = tempDir;

  try {
    if (body.outputFormat === "xlsx") {
      const result = await exportFlattenedXlsx({
        from: "xml",
        inputFile: sourcePath,
        outputFile,
        datePolicy: { defaultDateOrder: normalizeDateOrder(body.dateOrder) },
        ...(manifestPath ? { xmlConfigFile: manifestPath } : {}),
        onProgress: (update: ExportProgressUpdate) => {
          const patch: Partial<JobState> = {
            progress: update.progress,
            stage: update.stage,
          };
          if (update.detail !== undefined) {
            patch.detail = update.detail;
          }
          updateJob(jobId, patch);
        },
      });

      updateJob(jobId, {
        status: "done",
        progress: 100,
        stage: "Done",
        detail: `${result.rowCount} rows`,
        outputFile: result.outputFile,
      });
      return;
    }

    updateJob(jobId, { progress: 30, stage: "Reading XML canonical data" });
    const pkg = await generateFromXml({
      inputFile: sourcePath,
      outputFile,
      datePolicy: { defaultDateOrder: normalizeDateOrder(body.dateOrder) },
      ...(manifestPath ? { xmlConfigFile: manifestPath } : {}),
    });

    const counts = pkg.manifest.counts;
    const totalRows = counts.salesOrders + counts.assemblies + counts.demands + counts.supplies + counts.operations + counts.peggingLinks + counts.partCatalog;

    updateJob(jobId, {
      status: "done",
      progress: 100,
      stage: "Done",
      detail: `${totalRows} records`,
      outputFile,
    });
  } catch (error) {
    updateJob(jobId, {
      status: "error",
      progress: 100,
      stage: "Failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeDateOrder(value: string): "MDY" | "DMY" | "YMD" {
  if (value === "MDY" || value === "DMY" || value === "YMD") {
    return value;
  }
  return "YMD";
}

function normalizeOutputFormat(value: string | undefined): OutputFormat {
  return value === "xlsx" ? "xlsx" : "priorsart";
}

function currentDateStamp(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mmm = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][now.getMonth()] ?? "JAN";
  const yyyy = String(now.getFullYear());
  return `${dd}${mmm}${yyyy}`;
}

function normalizeOutputName(rawOutputName: string | undefined, format: OutputFormat): string {
  const fallback = format === "xlsx" ? `generated${currentDateStamp()}.xlsx` : `generated${currentDateStamp()}.priorsart`;
  const ext = format === "xlsx" ? ".xlsx" : ".priorsart";
  const raw = (rawOutputName ?? "").trim();
  const cleaned = raw ? raw.replace(/\.(xlsx|priorsart)$/i, "") : fallback.replace(/\.(xlsx|priorsart)$/i, "");
  return `${cleaned}${ext}`;
}

function resolveOutputContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

function hasAdminRights(roleMode: RoleMode, adminKey: string | undefined): boolean {
  void adminKey;
  return roleMode === "admin";
}

function resolveUploadPath(relativePath: string | undefined, fallbackName: string): string {
  const candidate = (relativePath && relativePath.trim() ? relativePath : fallbackName).replace(/\\/g, "/");
  const normalized = path.posix.normalize(candidate).replace(/^\/+/, "");
  const parts = normalized.split("/").filter((segment) => segment && segment !== "." && segment !== "..");
  if (!parts.length) {
    return path.basename(fallbackName);
  }
  if (parts.length === 1) {
    return parts[0] ?? path.basename(fallbackName);
  }
  return parts.slice(1).join("/") || path.basename(fallbackName);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/PriorsArt1.png") {
    try {
      const logoPath = path.resolve(process.cwd(), "PriorsArt1.png");
      const buffer = await fs.readFile(logoPath);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" });
      res.end(buffer);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Logo not found");
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/download")) {
    const jobId = url.pathname.split("/")[3] ?? "";
    if (!jobId) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Job not found");
      return;
    }
    const job = jobs.get(jobId);
    if (!job || job.status !== "done" || !job.outputFile) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Job is not ready");
      return;
    }

    try {
      const buffer = await fs.readFile(job.outputFile);
      res.writeHead(200, {
        "Content-Type": resolveOutputContentType(job.outputFile),
        "Content-Disposition": `attachment; filename="${path.basename(job.outputFile)}"`,
        "Content-Length": buffer.length,
      });
      res.end(buffer);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const jobId = url.pathname.split("/")[3] ?? "";
    if (!jobId) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Job not found" }));
      return;
    }
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Job not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(job));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    const chunks: Buffer[] = [];
    let total = 0;
    const maxBodySize = 300 * 1024 * 1024;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxBodySize) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          files?: UploadFile[];
          outputName?: string;
          dateOrder?: string;
          outputFormat?: string;
          roleMode?: string;
          adminKey?: string;
        };
        if (!Array.isArray(body.files) || body.files.length === 0) {
          throw new Error("At least one XML file is required.");
        }

        const roleMode: RoleMode = body.roleMode === "admin" ? "admin" : "user";
        const outputFormat = normalizeOutputFormat(body.outputFormat);
        if (outputFormat === "xlsx") {
          if (!XLSX_EXPORT_ENABLED) {
            throw new Error("XLSX export is disabled in this environment.");
          }
          if (!hasAdminRights(roleMode, body.adminKey)) {
            throw new Error("Admin rights are required for .xlsx output.");
          }
        }

        const jobId = crypto.randomUUID();
        jobs.set(jobId, {
          id: jobId,
          status: "queued",
          progress: 0,
          stage: "Queued",
          outputFormat,
        });

        void runJob(jobId, {
          files: body.files,
          outputName: body.outputName ?? "processedData.generated.priorsart",
          dateOrder: body.dateOrder ?? "YMD",
          outputFormat,
        });

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ jobId }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error instanceof Error ? error.message : String(error));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`PriorsArt web UI running at http://localhost:${PORT}`);
});