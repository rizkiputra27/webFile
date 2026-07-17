// api/index.js
// Express app configured to run as a single Vercel Serverless Function.
// Handles: /admin (serves admin page), /api/login, /api/files (GET + POST),
// and / (serves the public index page).

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// ---------------------------------------------------------------------------
// CONFIG — replace these placeholders with your own values (or use env vars)
// ---------------------------------------------------------------------------
const ADMIN_PASSWORD = 'admin123';
const JSONBIN_BIN_ID = 'YOUR_BIN_ID_HERE';       // <-- placeholder: JSONBin Bin ID
const JSONBIN_API_KEY = 'YOUR_MASTER_KEY_HERE';  // <-- placeholder: JSONBin X-Master-Key

const JSONBIN_BASE_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const JSONBIN_HEADERS = {
  'Content-Type': 'application/json',
  'X-Master-Key': JSONBIN_API_KEY,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the current array of files stored in the JSONBin bin.
 * JSONBin wraps the stored value inside `record`.
 */
async function getFilesFromBin() {
  const res = await fetch(`${JSONBIN_BASE_URL}/latest`, {
    method: 'GET',
    headers: JSONBIN_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`JSONBin GET failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  // data.record is the actual JSON we stored (should be an array of files).
  const record = data.record;
  return Array.isArray(record) ? record : [];
}

/**
 * Overwrite the JSONBin bin with a new array of files.
 * JSONBin's PUT expects the raw array/object directly as the body
 * (not wrapped in { record: ... }).
 */
async function saveFilesToBin(filesArray) {
  const res = await fetch(JSONBIN_BASE_URL, {
    method: 'PUT',
    headers: JSONBIN_HEADERS,
    body: JSON.stringify(filesArray),
  });

  if (!res.ok) {
    throw new Error(`JSONBin PUT failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Extract a Google Drive file/folder ID from a variety of common link formats:
 *  - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *  - https://drive.google.com/open?id=FILE_ID
 *  - https://drive.google.com/uc?id=FILE_ID
 *  - https://drive.google.com/drive/folders/FOLDER_ID
 */
function extractDriveId(link) {
  if (!link) return null;

  // /file/d/FILE_ID/... or /folders/FOLDER_ID
  const pathMatch = link.match(/\/(?:file\/d|folders)\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];

  // ?id=FILE_ID (query param style)
  const queryMatch = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];

  return null;
}

/**
 * Given a raw Google Drive link, return:
 *  - downloadUrl: direct-download link for files, or the original link for folders
 *  - type: "file" | "folder" | "link" (fallback if we can't parse an ID)
 */
function buildDownloadInfo(rawLink) {
  const isFolder = rawLink.includes('/folders/');
  const fileId = extractDriveId(rawLink);

  if (isFolder) {
    // Folders can't be turned into a direct-download link — keep as-is.
    return { downloadUrl: rawLink, type: 'folder' };
  }

  if (fileId) {
    return {
      downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      type: 'file',
    };
  }

  // Couldn't parse an ID — fall back to the original link so nothing breaks.
  return { downloadUrl: rawLink, type: 'link' };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Serve the admin page (the page itself is just a login + upload form;
// the actual password check happens via /api/login and /api/files POST).
app.get('/admin', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'admin.html'));
});

// Serve the public landing page.
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Simple password check used by the admin page before allowing uploads.
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};

  if (password === ADMIN_PASSWORD) {
    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ success: false, message: 'Incorrect password' });
});

// GET /api/files — public, returns the full list of shared files.
app.get('/api/files', async (req, res) => {
  try {
    const files = await getFilesFromBin();
    res.status(200).json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch files', details: err.message });
  }
});

// POST /api/files — admin only. Body: { password, filename, driveLink }
app.post('/api/files', async (req, res) => {
  try {
    const { password, filename, driveLink } = req.body || {};

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!filename || !driveLink) {
      return res.status(400).json({ error: 'filename and driveLink are required' });
    }

    const { downloadUrl, type } = buildDownloadInfo(driveLink.trim());

    const newFile = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      filename: filename.trim(),
      downloadUrl,
      type,
    };

    const existingFiles = await getFilesFromBin();
    const updatedFiles = [...existingFiles, newFile];

    await saveFilesToBin(updatedFiles);

    res.status(201).json({ success: true, file: newFile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save file', details: err.message });
  }
});

// (Optional) DELETE /api/files/:id — admin only, handy for removing entries.
app.delete('/api/files/:id', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const existingFiles = await getFilesFromBin();
    const updatedFiles = existingFiles.filter((f) => f.id !== id);

    await saveFilesToBin(updatedFiles);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete file', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Export for Vercel (treats this file as a serverless function handler).
// Also allow running locally with `node api/index.js` for quick testing.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = app;
