import {
  AlertCircle,
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileText,
  FileUp,
  Image,
  LogIn,
  LogOut,
  Trash2,
  Video
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const ATTACHMENTS_FOLDER = "BellaVita Calendario Allegati";
const HISTORY_KEY = "bellavita-linkbox-history";
const GOOGLE_AUTH_HINT_KEY = "bellavita-linkbox-google-auth";
const FANTASTICAL_URL = "x-fantastical3://";

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortDate(value) {
  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);

  if (isToday) return `oggi · ${time}`;
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function splitFileName(fileName) {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex <= 0) {
    return { base: fileName, extension: "" };
  }

  return {
    base: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex)
  };
}

function buildUploadName(originalName, customName) {
  const trimmedName = customName.trim();

  if (!trimmedName) return originalName;

  const { extension } = splitFileName(originalName);
  const customBase = extension && trimmedName.toLowerCase().endsWith(extension.toLowerCase())
    ? trimmedName.slice(0, -extension.length).trim()
    : trimmedName;

  return `${customBase || splitFileName(originalName).base}${extension}`;
}

function renameFile(file, fileName) {
  if (file.name === fileName) return file;
  return new File([file], fileName, {
    type: file.type,
    lastModified: file.lastModified
  });
}

function getFileKind(fileName = "") {
  const extension = splitFileName(fileName).extension.toLowerCase().replace(".", "");

  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (["mp4", "mov", "avi", "webm"].includes(extension)) return "video";
  if (["doc", "docx"].includes(extension)) return "doc";
  return "file";
}

function FileKindIcon({ name, size = 16 }) {
  const kind = getFileKind(name);

  if (kind === "image") return <Image size={size} />;
  if (kind === "pdf") return <FileText size={size} />;
  if (kind === "video") return <Video size={size} />;
  if (kind === "doc") return <FileText size={size} />;
  return <File size={size} />;
}

async function driveRequest(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `Google Drive ha risposto con errore ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function findOrCreateFolder(token) {
  const query = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${ATTACHMENTS_FOLDER.replaceAll("'", "\\'")}'`,
    "trashed=false"
  ].join(" and ");

  const search = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`,
    token
  );

  if (search.files?.[0]?.id) return search.files[0].id;

  const folder = await driveRequest("https://www.googleapis.com/drive/v3/files?fields=id,name", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: ATTACHMENTS_FOLDER,
      mimeType: "application/vnd.google-apps.folder"
    })
  });

  return folder.id;
}

async function uploadFileToDrive(file, token, folderId) {
  const metadata = {
    name: file.name,
    parents: [folderId]
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  return driveRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,createdTime",
    token,
    {
      method: "POST",
      body: form
    }
  );
}

async function makeFileShareable(fileId, token) {
  await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "anyone",
      role: "reader"
    })
  });
}

async function copyToClipboard(text) {
  if (!navigator.clipboard?.writeText) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [token, setToken] = useState("");
  const [history, setHistory] = useState(readHistory);
  const [latestFile, setLatestFile] = useState(null);
  const [status, setStatus] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const hasRequestedSilentLoginRef = useRef(false);
  const tokenClientRef = useRef(null);
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);

  const isConfigured = Boolean(CLIENT_ID && !CLIENT_ID.includes("incolla_qui"));

  useEffect(() => {
    if (!isConfigured) return;

    const setupGoogle = () => {
      if (!window.google?.accounts?.oauth2) return false;
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.access_token) {
            setToken(response.access_token);
            localStorage.setItem(GOOGLE_AUTH_HINT_KEY, "yes");
            setError("");
            setStatus("Accesso Google completato.");
          } else if (response.error) {
            localStorage.removeItem(GOOGLE_AUTH_HINT_KEY);
          }
        }
      });

      if (!hasRequestedSilentLoginRef.current && localStorage.getItem(GOOGLE_AUTH_HINT_KEY) === "yes") {
        hasRequestedSilentLoginRef.current = true;
        tokenClientRef.current.requestAccessToken({ prompt: "" });
      }

      return true;
    };

    if (setupGoogle()) return;
    const timer = window.setInterval(() => {
      if (setupGoogle()) window.clearInterval(timer);
    }, 250);

    return () => window.clearInterval(timer);
  }, [isConfigured]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!status) return undefined;

    const timer = window.setTimeout(() => {
      setStatus("");
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [status]);

  const canSelectFile = useMemo(() => token && !isUploading, [token, isUploading]);
  const finalUploadName = selectedFile ? buildUploadName(selectedFile.name, attachmentName) : "";
  const terminalMode = error ? "error" : isUploading ? "uploading" : latestFile ? "done" : "idle";

  function signIn() {
    setError("");
    if (!isConfigured) {
      setError("Configura prima VITE_GOOGLE_CLIENT_ID nel file .env.");
      return;
    }
    tokenClientRef.current?.requestAccessToken({ prompt: "consent" });
  }

  function signOut() {
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => {});
    }
    localStorage.removeItem(GOOGLE_AUTH_HINT_KEY);
    setToken("");
    setStatus("");
    setShowLogoutConfirm(false);
  }

  function selectFile(file) {
    if (!file) return;

    setSelectedFile(file);
    setAttachmentName("");
    setError("");
    setManualCopy(false);
    setStatus("File selezionato. Puoi rinominarlo o caricarlo subito.");
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    selectFile(file);
  }

  function handleDragOver(event) {
    event.preventDefault();
    if (!token || isUploading) return;
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);

    if (!token || isUploading) return;
    selectFile(event.dataTransfer.files?.[0]);
  }

  async function handleUploadSelectedFile() {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(60);
    setError("");
    setManualCopy(false);
    setStatus("Caricamento in corso...");

    try {
      const fileForDrive = renameFile(selectedFile, finalUploadName);
      const folderId = await findOrCreateFolder(token);
      const uploaded = await uploadFileToDrive(fileForDrive, token, folderId);
      await makeFileShareable(uploaded.id, token);
      setUploadProgress(100);

      const item = {
        id: uploaded.id,
        name: uploaded.name || fileForDrive.name,
        link: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
        uploadedAt: uploaded.createdTime || new Date().toISOString()
      };

      const copied = await copyToClipboard(item.link);
      const nextHistory = [item, ...history.filter((entry) => entry.id !== item.id)].slice(0, 20);
      setLatestFile(item);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setSelectedFile(null);
      setAttachmentName("");
      setManualCopy(!copied);
      setStatus(copied ? "Link copiato. Ora puoi incollarlo in Fantastical." : "Link pronto. Copialo con il pulsante qui sotto.");
      window.setTimeout(() => setUploadProgress(0), 300);
    } catch (uploadError) {
      setError(uploadError.message || "Upload non riuscito.");
      setStatus("");
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleCopy(link) {
    const copied = await copyToClipboard(link);
    setManualCopy(!copied);
    setStatus(copied ? "Link copiato. Ora puoi incollarlo in Fantastical." : "Copia manualmente il link dal campo.");
  }

  async function handleHistoryCopy(item) {
    const copied = await copyToClipboard(item.link);

    if (copied) {
      setCopiedHistoryId(item.id);
      window.setTimeout(() => setCopiedHistoryId(""), 1800);
    }

    setStatus(copied ? "link copiato negli appunti" : "Copia manualmente il link.");
  }

  function handleRemoveFromHistory(fileId) {
    const nextHistory = history.filter((item) => item.id !== fileId);
    setHistory(nextHistory);
    saveHistory(nextHistory);
    setDeleteConfirmId("");
    setStatus("Allegato rimosso dall'elenco. Il file resta su Google Drive.");
  }

  if (!token) {
    return (
      <main className="app-shell login-shell">
        <section className="terminal-block" aria-label="Sessione">
          <div className="terminal-bar">
            <span className="dot red" />
            <span className="dot amber" />
            <span className="dot green" />
            <span>linkbox --session</span>
          </div>
          <div className="terminal-body">
            <div><span className="term-info">[!!]</span> sessione non trovata</div>
            <div><span className="term-warn">{"[>>]"}</span> autenticazione richiesta</div>
            <div><span className="term-dim">&gt;</span> --login google to continue<span className="cursor" /></div>
          </div>
        </section>
        <section className="login-content">
          <h1>link<span>box</span></h1>
          <p>// Mini Drive personale</p>
          <button className="login-button" type="button" onClick={signIn}>
            <span>G</span>
            → login con google
          </button>
          {error ? <p className="login-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Stato account">
        <div className="brand-lockup">
          <div className="brand-mark">BV</div>
          <p className="brand-name">link<span>box</span></p>
        </div>
        <div className="topbar-actions">
          <span className="version-pill">v1.0 · BETA</span>
          {showLogoutConfirm ? (
            <div className="inline-confirm">
              <span>esci?</span>
              <button type="button" onClick={signOut}>sì</button>
              <button type="button" onClick={() => setShowLogoutConfirm(false)}>annulla</button>
            </div>
          ) : (
            <button className="avatar-button" type="button" onClick={() => setShowLogoutConfirm(true)}>
              BV
            </button>
          )}
        </div>
      </header>

      <section className="terminal-block" aria-label="Sessione">
        <div className="terminal-bar">
          <span className="dot red" />
          <span className="dot amber" />
          <span className="dot green" />
          <span>linkbox --session</span>
        </div>
        <div className="terminal-body">
          <div><span className="term-ok">[OK]</span> Google Drive: connesso</div>
          <div><span className="term-ok">[OK]</span> Autenticazione: completata</div>
          <div><span className="term-warn">{"[>>]"}</span> File caricati: {history.length}</div>
          <div><span className="term-info">[!!]</span> Link condivisibile: attivo</div>
          {terminalMode === "uploading" ? (
            <div><span className="term-warn">{"[>>]"}</span> Caricamento in corso...</div>
          ) : terminalMode === "error" ? (
            <div><span className="term-error">[ERR]</span> Upload fallito: {error}</div>
          ) : terminalMode === "done" ? (
            <>
              <div><span className="term-ok">[OK]</span> Upload completato · link pronto</div>
              <div><span className="term-dim">&gt;</span> drop file or --select to upload<span className="cursor" /></div>
            </>
          ) : (
            <div><span className="term-dim">&gt;</span> drop file or --select to upload<span className="cursor" /></div>
          )}
        </div>
      </section>

      <section
        className={`hero-card ${isDragging ? "is-dragging" : ""}`}
        aria-label="Caricamento allegato"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="hero-top">
          <h1>Carica.<br /><span>Ottieni il link.</span></h1>
          <span className="hero-tag">DRIVE READY</span>
        </div>
        <p className="hero-subtitle">
          <span>//</span> Trascina un file o seleziona<br />
          <span>//</span> Link condivisibile in 1 tocco
        </p>
        <button className="hero-cta" type="button" disabled={!canSelectFile} onClick={() => fileInputRef.current?.click()}>
          <FileUp size={16} />
          --upload file
        </button>
        <div className="progress-track">
          <div style={{ width: `${uploadProgress}%` }} />
        </div>
      </section>

      <section className="stats-row" aria-label="Statistiche">
        <div className="stat-card amber">
          <span>FILE CARICATI</span>
          <strong>{history.length}</strong>
          <small>su Google Drive</small>
        </div>
        <div className="stat-card green">
          <span>LINK ATTIVI</span>
          <strong>{history.length}</strong>
          <small>condivisibili</small>
        </div>
      </section>

      <section className="method-section" aria-label="Metodo di caricamento">
        <h2>// Metodo di caricamento</h2>
        <input
          ref={photoInputRef}
          className="file-input"
          type="file"
          onChange={handleFileSelected}
          accept="image/*"
        />
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          onChange={handleFileSelected}
          accept="*/*"
        />
        <div className="method-list">
          <button type="button" disabled={!canSelectFile} onClick={() => photoInputRef.current?.click()}>
            <span className="method-number">01</span>
            <span className="method-body">
              <strong>foto_o_galleria()</strong>
              <small>Seleziona dal rullino del dispositivo</small>
            </span>
            <span className="method-tag photo">FOTO</span>
            <ChevronRight size={14} />
          </button>
          <button type="button" disabled={!canSelectFile} onClick={() => fileInputRef.current?.click()}>
            <span className="method-number">02</span>
            <span className="method-body">
              <strong>scegli_file()</strong>
              <small>PDF, immagini, video, documenti</small>
            </span>
            <span className="method-tag file">FILE</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </section>

      {selectedFile ? (
        <section className="selected-file-bar" aria-label="File selezionato">
          <div className={`file-type-icon ${getFileKind(selectedFile.name)}`}>
            <FileKindIcon name={selectedFile.name} />
          </div>
          <div className="selected-file-content">
            <input
              aria-label="Nome allegato"
              type="text"
              value={attachmentName}
              onChange={(event) => setAttachmentName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder={splitFileName(selectedFile.name).base}
              autoComplete="off"
              disabled={isUploading}
            />
            <p className="selected-file-hint">pronto al caricamento</p>
            <p className="final-name">nome finale: {finalUploadName}</p>
          </div>
          <button
            className="exec-button"
            type="button"
            disabled={isUploading}
            onClick={handleUploadSelectedFile}
          >
            <ArrowRight size={13} />
            exec
          </button>
        </section>
      ) : null}

      {(status || error) ? (
        <section className={`toast-wrap ${error ? "is-error" : ""}`} aria-live="polite">
          {error ? <AlertCircle size={14} /> : <Check size={14} />}
          <span>{error || status}</span>
          {!error && latestFile ? (
            <a href={latestFile.link} target="_blank" rel="noreferrer">apri →</a>
          ) : null}
        </section>
      ) : null}

      {latestFile ? (
        <section className="link-box" aria-label="Ultimo link generato">
          <label htmlFor="latest-link">// Link Google Drive</label>
          <textarea id="latest-link" value={latestFile.link} readOnly rows={3} />
          {manualCopy ? <p className="manual-copy">Su iPhone/Safari seleziona il link e copialo manualmente.</p> : null}
          <div className="action-row">
            <button type="button" onClick={() => handleCopy(latestFile.link)}>
              <Copy size={14} />
              Copia link
            </button>
            <a href={FANTASTICAL_URL}>
              <ExternalLink size={14} />
              Apri Fantastical
            </a>
          </div>
        </section>
      ) : null}

      <section className="history-section" aria-label="Ultimi allegati">
        <div className="section-header">
          <h2>// Recenti</h2>
          <span>{history.length} file</span>
        </div>
        {history.length ? (
          <ul className="history-list">
            {history.map((item, index) => (
              <li key={item.id}>
                <span className="row-number">{String(index + 1).padStart(2, "0")}</span>
                <div className={`history-file-icon ${getFileKind(item.name)}`}>
                  <FileKindIcon name={item.name} size={14} />
                </div>
                <div className="file-info">
                  <span>{item.name}</span>
                  <time dateTime={item.uploadedAt}>{formatShortDate(item.uploadedAt)}</time>
                </div>
                <div className="history-actions">
                  {deleteConfirmId === item.id ? (
                    <div className="delete-confirm">
                      <span>elimina?</span>
                      <button type="button" onClick={() => handleRemoveFromHistory(item.id)}>sì</button>
                      <button type="button" onClick={() => setDeleteConfirmId("")}>no</button>
                    </div>
                  ) : (
                    <>
                      <button
                        className={copiedHistoryId === item.id ? "is-copied" : ""}
                        type="button"
                        aria-label={`Copia link di ${item.name}`}
                        onClick={() => handleHistoryCopy(item)}
                      >
                        {copiedHistoryId === item.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <a href={item.link} target="_blank" rel="noreferrer" aria-label={`Apri ${item.name}`}>
                        <ExternalLink size={14} />
                      </a>
                      <button
                        className="delete-history-button"
                        type="button"
                        aria-label={`Rimuovi ${item.name} dall'elenco`}
                        onClick={() => setDeleteConfirmId(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">Nessun allegato caricato.</p>
        )}
      </section>
    </main>
  );
}
