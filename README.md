# BellaVita LinkBox

Mini Drive personale mobile-first per caricare allegati nel Google Drive dell'utente e ottenere subito un link condivisibile da incollare in Fantastical o Google Calendar.

## Setup

1. Installa le dipendenze:

   ```bash
   npm install
   ```

2. Crea un progetto in Google Cloud Console.

3. Abilita Google Drive API.

4. Crea un OAuth Client ID di tipo Web application.

5. Aggiungi tra gli authorized JavaScript origins:

   ```text
   http://127.0.0.1:5173
   http://127.0.0.1:4173
   ```

   Per iPhone/PWA in produzione usa solo il dominio HTTPS reale dell'app.

6. Crea `.env` partendo da `.env.example`:

   ```bash
   VITE_GOOGLE_CLIENT_ID=il_tuo_client_id_google
   ```

## Avvio

Sviluppo:

```bash
npm run dev
```

Anteprima produzione:

```bash
npm run build
npm run preview
```

## Test V1

1. Apri l'app in HTTPS, oppure in locale su `http://127.0.0.1`.
2. Tocca `Login con Google`.
3. Tocca `Carica allegato`.
4. Scegli un PDF o una foto.
5. Controlla in Google Drive la cartella `BellaVita Calendario Allegati`.
6. Apri il link generato in una finestra privata per verificare che sia condivisibile.
7. Incolla il link nelle note di Fantastical.

L'app usa lo scope `drive.file`, crea la cartella se manca, carica con Drive `files.create`, rende il file leggibile con `permissions.create` e salva solo lo storico locale degli ultimi 20 file in `localStorage`.
