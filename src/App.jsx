import { Camera, Copy, ExternalLink, FileUp, LogIn, LogOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const ATTACHMENTS_FOLDER = "BellaVita Calendario Allegati";
const HISTORY_KEY = "bellavita-linkbox-history";
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
  const [error, setError] = useState("");
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
            setError("");
            setStatus("Accesso Google completato.");
          }
        }
      });
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

  const canUpload = useMemo(() => token && !isUploading, [token, isUploading]);

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
    setToken("");
    setStatus("");
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    setError("");
    setManualCopy(false);
    setStatus("Caricamento in corso...");

    try {
      const folderId = await findOrCreateFolder(token);
      const uploaded = await uploadFileToDrive(file, token, folderId);
      await makeFileShareable(uploaded.id, token);

      const item = {
        id: uploaded.id,
        name: uploaded.name || file.name,
        link: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
        uploadedAt: uploaded.createdTime || new Date().toISOString()
      };

      const copied = await copyToClipboard(item.link);
      const nextHistory = [item, ...history.filter((entry) => entry.id !== item.id)].slice(0, 20);
      setLatestFile(item);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setManualCopy(!copied);
      setStatus(copied ? "Link copiato. Ora puoi incollarlo in Fantastical." : "Link pronto. Copialo con il pulsante qui sotto.");
    } catch (uploadError) {
      setError(uploadError.message || "Upload non riuscito.");
      setStatus("");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleCopy(link) {
    const copied = await copyToClipboard(link);
    setManualCopy(!copied);
    setStatus(copied ? "Link copiato. Ora puoi incollarlo in Fantastical." : "Copia manualmente il link dal campo.");
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Stato account">
        <div className="brand-mark">BV</div>
        {token ? (
          <button className="ghost-button" type="button" onClick={signOut}>
            <LogOut size={18} />
            Esci
          </button>
        ) : (
          <button className="ghost-button" type="button" onClick={signIn}>
            <LogIn size={18} />
            Google
          </button>
        )}
      </section>

      <section className="hero">
        <p className="eyebrow">Mini Drive personale</p>
        <h1>BellaVita LinkBox</h1>
      </section>

      <section className="upload-panel" aria-label="Caricamento allegato">
        {!token ? (
          <button className="primary-button" type="button" onClick={signIn}>
            <LogIn size={24} />
            Login con Google
          </button>
        ) : (
          <>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              onChange={handleFileSelected}
              accept=".pdf,.doc,.docx,image/*"
            />
            <input
              ref={photoInputRef}
              className="file-input"
              type="file"
              onChange={handleFileSelected}
              accept="image/*"
            />
            <div className="upload-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!canUpload}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp size={26} />
                {isUploading ? "Caricamento..." : "Carica allegato"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!canUpload}
                onClick={() => photoInputRef.current?.click()}
              >
                <Camera size={22} />
                Foto o galleria
              </button>
            </div>
          </>
        )}

        {status ? <p className="status-message">{status}</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
      </section>

      {latestFile ? (
        <section className="link-box" aria-label="Ultimo link generato">
          <label htmlFor="latest-link">Link Google Drive</label>
          <textarea id="latest-link" value={latestFile.link} readOnly rows={3} />
          {manualCopy ? <p className="manual-copy">Su iPhone/Safari seleziona il link e copialo manualmente.</p> : null}
          <div className="action-row">
            <button type="button" onClick={() => handleCopy(latestFile.link)}>
              <Copy size={18} />
              Copia link
            </button>
            <a href={FANTASTICAL_URL}>
              <ExternalLink size={18} />
              Apri Fantastical
            </a>
          </div>
        </section>
      ) : null}

      <section className="history-section" aria-label="Ultimi allegati">
        <h2>Ultimi allegati</h2>
        {history.length ? (
          <ul className="history-list">
            {history.map((item) => (
              <li key={item.id}>
                <div className="file-info">
                  <span>{item.name}</span>
                  <time dateTime={item.uploadedAt}>{formatDate(item.uploadedAt)}</time>
                </div>
                <div className="history-actions">
                  <button type="button" aria-label={`Copia link di ${item.name}`} onClick={() => handleCopy(item.link)}>
                    <Copy size={18} />
                  </button>
                  <a href={item.link} target="_blank" rel="noreferrer" aria-label={`Apri ${item.name}`}>
                    <ExternalLink size={18} />
                  </a>
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
