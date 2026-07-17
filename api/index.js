const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// Sajikan file statis dari folder public
app.use(express.static(path.join(__dirname, '../public')));

// Konfigurasi JSONBin (Masukkan ID dan Key kamu)
const BIN_ID = '$2a$10$RuHmWMlay8IR8zzI/vZ.deL2xeX1Z7wmYzJ43N.nHSMeXrFuAjiQi'; 
const API_KEY = '$2a$10$RuHmWMlay8IR8zzI/vZ.deL2xeX1Z7wmYzJ43N.nHSMeXrFuAjiQi'; 

// Route untuk halaman admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Mengambil semua file dari JSONBin
app.get('/api/files', async (req, res) => {
    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: { 'X-Master-Key': API_KEY }
        });
        const data = await response.json();
        res.json(data.record || []);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data' });
    }
});

// Mengupload file baru ke JSONBin
app.post('/api/upload', async (req, res) => {
    const { password, filename, gdriveLink } = req.body;

    // Cek Password (password-nya adalah: admin123)
    if (password !== 'admin123') {
        return res.status(401).json({ error: 'Password salah!' });
    }

    // Ekstrak ID dari Link Google Drive (Bisa deteksi berbagai format)
    const idMatch = gdriveLink.match(/(?:file\/d\/|open\?id=|uc\?id=|drive\/folders\/)([^/&?]+)/);
    
    if (!idMatch) {
        return res.status(400).json({ error: 'Format link Google Drive tidak valid.' });
    }

    const fileId = idMatch[1];
    const isFolder = gdriveLink.includes('folders/');
    
    // Jika folder, biarkan link asli. Jika file, ubah ke direct download.
    const downloadUrl = isFolder 
        ? gdriveLink 
        : `https://drive.google.com/uc?export=download&id=${fileId}`;

    const newFile = {
        id: Date.now().toString(),
        filename: filename,
        downloadUrl: downloadUrl,
        type: isFolder ? 'Folder' : 'File'
    };

    try {
        // Ambil data lama dulu
        const getRes = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: { 'X-Master-Key': API_KEY }
        });
        let data = await getRes.json();
        let files = data.record || [];

        // Tambahkan file baru
        files.push(newFile);

        // Simpan kembali ke JSONBin
        await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': API_KEY
            },
            body: JSON.stringify(files)
        });

        res.json({ message: 'File berhasil ditambahkan!', file: newFile });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menyimpan data' });
    }
});

module.exports = app;