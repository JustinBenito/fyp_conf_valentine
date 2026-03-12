const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const fs = require('fs');
const os = require('os');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable gzip compression for all responses
app.use(compression({
  filter: (req, res) => {
    // Compress everything except already compressed files
    if (req.path.match(/\.(glb|png|jpg|jpeg|gif|webp)$/i)) {
      return false; // These are already compressed
    }
    return compression.filter(req, res);
  },
  level: 6 // Balanced compression level
}));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Multer for handling file uploads (in memory)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Serve static files with caching for 3D models
app.use(express.static(path.join(__dirname), {
  maxAge: '1d', // Cache static files for 1 day
  setHeaders: (res, filePath) => {
    // Long cache for 3D model files (FBX, GLB, GLTF)
    if (filePath.match(/\.(fbx|glb|gltf)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
    }
    // Enable compression hint
    if (filePath.match(/\.(fbx|glb|gltf|json)$/i)) {
      res.setHeader('Content-Encoding', 'identity');
    }
  }
}));

// ISL Gloss conversion proxy (avoids CORS issues)
app.post('/api/convert', async (req, res) => {
  try {
    const { sentence } = req.body;
    if (!sentence) {
      return res.status(400).json({ error: 'No sentence provided' });
    }

    const response = await fetch('https://isl2gloss.justinbenito.com/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence })
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Gloss conversion error:', error.message);
    res.status(500).json({ error: 'Conversion failed', details: error.message });
  }
});

// Transcription endpoint
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  let tempFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Write buffer to temp file (OpenAI SDK needs a file path)
    tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.webm`);
    fs.writeFileSync(tempFilePath, req.file.buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'gpt-4o-transcribe',
    });

    res.json({ text: transcription.text });
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(500).json({ error: 'Transcription failed', details: error.message });
  } finally {
    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  ISL Translator Server Started!`);
  console.log(`========================================`);
  console.log(`  Open: http://localhost:${PORT}`);
  console.log(`  `);
  console.log(`  DO NOT use VS Code Live Server!`);
  console.log(`  The API only works on this port.`);
  console.log(`========================================\n`);
});
