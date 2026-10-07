const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// flash-lite: lowest-latency model, no extended "thinking" step needed for
// a straight transcription/translation task. Inline base64 audio skips the
// Files API upload round-trip entirely, which is the biggest latency win.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const TRANSCRIBE_PROMPT = 'Transcribe the speech in this audio clip. ' +
  'If the speech is not in English, translate it into English. ' +
  'Respond with only the English text and nothing else - no notes, no language labels. ' +
  'If there is no discernible speech, respond with an empty string.';

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

// Transcription endpoint (Gemini)
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    }

    const base64Audio = req.file.buffer.toString('base64');

    const geminiResponse = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            // Audio must precede the instruction - Gemini follows trailing
            // text instructions far more reliably than leading ones here.
            parts: [
              { inline_data: { mime_type: 'audio/webm', data: base64Audio } },
              { text: TRANSCRIBE_PROMPT },
            ],
          },
        ],
      }),
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini transcription error:', data.error?.message || data);
      return res.status(502).json({
        error: 'Transcription failed',
        details: data.error?.message || 'Unknown Gemini API error',
      });
    }

    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    res.json({ text });
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(500).json({ error: 'Transcription failed', details: error.message });
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
