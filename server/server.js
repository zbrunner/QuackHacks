require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { GoogleGenAI, Type } = require('@google/genai');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const app = express();
const port = process.env.PORT || 3000;
const project = process.env.GCLOUD_PROJECT || 'uoo-quackathon26eug-8212';
const location = process.env.GCLOUD_LOCATION || 'global';
const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const trackModelName = process.env.GEMINI_TRACK_MODEL || 'gemini-2.5-flash-lite';

const ai = new GoogleGenAI({
  vertexai: true,
  project,
  location,
});

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    detections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          matchedFor: { type: Type.STRING },
          matchConfidence: { type: Type.NUMBER },
          box: {
            type: Type.OBJECT,
            properties: {
              minX: { type: Type.NUMBER },
              minY: { type: Type.NUMBER },
              maxX: { type: Type.NUMBER },
              maxY: { type: Type.NUMBER },
            },
            required: ['minX', 'minY', 'maxX', 'maxY'],
          },
        },
        required: ['name', 'confidence', 'matchedFor', 'matchConfidence', 'box'],
      },
    },
  },
  required: ['detections'],
};

app.use(express.static(path.join(__dirname, 'public')));
app.use('/detect', express.raw({ type: 'image/jpeg', limit: '10mb' }));
app.use('/clean-list', express.json({ limit: '32kb' }));

const cleanListSchema = {
  type: Type.OBJECT,
  properties: {
    cleaned: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['cleaned'],
};

app.post('/clean-list', async (req, res) => {
  const items = Array.isArray(req.body?.items)
    ? req.body.items.filter((s) => typeof s === 'string' && s.trim())
    : [];

  if (items.length === 0) return res.json({ cleaned: [] });

  const prompt = `The following list was dictated by a user building a grocery list via speech-to-text. Some entries may be misheard, irrelevant filler, or rough descriptions. Your job:
- Convert vague or descriptive entries into the canonical product or brand name (e.g. "the orange cereal" -> "Cheerios", "milks" -> "milk").
- Remove entries that are clearly not grocery items (greetings, filler words, commands that leaked in like "start list" or "stop").
- Keep brand and specific product names as-is when given (e.g. "Heinz Ketchup" stays "Heinz Ketchup").
- Preserve the user's intent; do NOT invent items that weren't said.
- Output one entry per item, lowercase unless it's a proper brand name.

Items:
${items.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

  try {
    const result = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: cleanListSchema,
        temperature: 0,
      },
    });
    const parsed = JSON.parse(result.text || '{"cleaned":[]}');
    res.json({ cleaned: Array.isArray(parsed.cleaned) ? parsed.cleaned : [] });
  } catch (err) {
    console.error('clean-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/detect', async (req, res) => {
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'empty body, expected image/jpeg' });
  }

  const list = (req.header('X-Grocery-List') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const listText = list.length
    ? `The user's grocery list: ${list.map((s) => `"${s}"`).join(', ')}.

Each list entry may be either a specific product/brand ("Cheerios", "Heinz Ketchup") OR a category that should match any product in that category. Examples of category matching:
- "nutrition drink" matches BODYARMOR, Gatorade, Powerade, Vitamin Water, etc.
- "cereal" matches Cheerios, Froot Loops, Frosted Flakes, etc.
- "soda" matches Coca-Cola, Pepsi, Sprite, Dr Pepper, etc.
- "chips" matches Lay's, Doritos, Pringles, etc.
- "milk" matches any milk carton/jug regardless of brand.

For every detection you return, set matchedFor to the EXACT list entry from above that the item satisfies (copy it verbatim — same casing, same words). Include any item that plausibly matches (matchConfidence >= 0.4); skip anything weaker than that.`
    : `The user has not provided a grocery list. Identify any prominent grocery products visible by brand or product name. Set matchedFor to an empty string and matchConfidence to 0 for each detection.`;

  const prompt = `${listText}

For each item to return:
- name: the brand or specific product name visible on the package (e.g. "BODYARMOR", "Cheerios") if you can read it; otherwise the generic product ("apple", "milk carton").
- confidence: a number 0-1 indicating how sure you are you correctly identified the product itself.
- matchedFor: as specified above.
- matchConfidence: a number 0-1 indicating how strongly the detected product satisfies the matched list entry. Calibration guidance:
  - ~0.95: clear central example (e.g. BODYARMOR for "nutrition drink", Cheerios for "cereal").
  - ~0.60-0.80: borderline / category-edge (e.g. Celsius for "nutrition drink" — it's an energy/fitness drink that some would count, some wouldn't; chocolate milk for "milk").
  - ~0.40-0.55: tenuous match worth surfacing for user confirmation.
  - Anything weaker: do not include.
- box: axis-aligned bounding box in NORMALIZED coordinates where (0,0) is top-left and (1,1) is bottom-right. minX < maxX and minY < maxY.

If nothing relevant is visible, return an empty list.`;

  try {
    const result = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: req.body.toString('base64'),
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0,
      },
    });

    const raw = result.text;
    if (!raw) {
      return res.json({ objects: [] });
    }

    const parsed = JSON.parse(raw);
    const objects = (parsed.detections || []).map((d) => {
      const { minX, minY, maxX, maxY } = d.box;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const area = Math.max(0, (maxX - minX) * (maxY - minY));
      return {
        name: d.name,
        score: d.confidence,
        matchedFor: d.matchedFor || '',
        matchConfidence: typeof d.matchConfidence === 'number' ? d.matchConfidence : 0,
        box: { minX, minY, maxX, maxY },
        cx: centerX,
        cy: centerY,
        position: describePosition(centerX, centerY, area),
      };
    });

    res.json({ objects });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Fast tracking endpoint (flash-lite) for find mode ----
app.use('/track', express.raw({ type: 'image/jpeg', limit: '10mb' }));

const trackSchema = {
  type: Type.OBJECT,
  properties: {
    found: { type: Type.BOOLEAN },
    cx: { type: Type.NUMBER },
    cy: { type: Type.NUMBER },
    box: {
      type: Type.OBJECT,
      properties: {
        minX: { type: Type.NUMBER },
        minY: { type: Type.NUMBER },
        maxX: { type: Type.NUMBER },
        maxY: { type: Type.NUMBER },
      },
      required: ['minX', 'minY', 'maxX', 'maxY'],
    },
  },
  required: ['found'],
};

app.post('/track', async (req, res) => {
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'empty body, expected image/jpeg' });
  }
  const targetName = decodeURIComponent(req.header('X-Target-Name') || '');
  const targetCategory = decodeURIComponent(req.header('X-Target-Category') || '');
  const lastBox = req.header('X-Last-Box');

  if (!targetName) {
    return res.status(400).json({ error: 'X-Target-Name header required' });
  }

  let bboxHint = '';
  if (lastBox) {
    const parts = lastBox.split(',').map(parseFloat);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      const [minX, minY, maxX, maxY] = parts;
      bboxHint = ` It was last seen with bounding box (normalized 0-1): minX=${minX.toFixed(2)}, minY=${minY.toFixed(2)}, maxX=${maxX.toFixed(2)}, maxY=${maxY.toFixed(2)}.`;
    }
  }

  const prompt = `You are tracking a single specific item the user has already identified.

Target: "${targetName}"${targetCategory ? ` (category: "${targetCategory}")` : ''}.${bboxHint}

Find this EXACT same item in the current frame. The camera may have moved, so the item may now be in a different position.

Return:
- found: true ONLY if you can confidently see the same specific item from before
- if found: cx (center X, 0-1), cy (center Y, 0-1), and box {minX, minY, maxX, maxY} in normalized coordinates

Do NOT return a position for OTHER similar items in the frame (e.g. a different brand in the same category). Only the specific item the user is tracking. If the same item is not visible in this frame, return found=false and no box.`;

  try {
    const result = await ai.models.generateContent({
      model: trackModelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: req.body.toString('base64'),
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: trackSchema,
        temperature: 0,
      },
    });
    const parsed = JSON.parse(result.text || '{"found":false}');
    res.json(parsed);
  } catch (err) {
    console.error('track error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Read-text endpoint (OCR-style via Gemini) ----
app.use('/read-text', express.raw({ type: 'image/jpeg', limit: '10mb' }));

const readTextSchema = {
  type: Type.OBJECT,
  properties: { text: { type: Type.STRING } },
  required: ['text'],
};

app.post('/read-text', async (req, res) => {
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'empty body, expected image/jpeg' });
  }
  const prompt = `Read aloud the text printed on any package, label, or sign visible in this image. Return only the readable text itself — no descriptions, no commentary, no quotation marks. Combine multi-line text into a natural flowing sentence where it makes sense (e.g. product name followed by tagline followed by net weight). Skip decorative letters or text too small or blurry to read with confidence. If there is no readable text at all, return the single word "Nothing".`;
  try {
    const result = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: req.body.toString('base64'),
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: readTextSchema,
        temperature: 0,
      },
    });
    const parsed = JSON.parse(result.text || '{"text":""}');
    res.json({ text: (parsed.text || '').trim() });
  } catch (err) {
    console.error('read-text error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- TTS templates (read fresh on each request so edits apply without restart) ----
const TEMPLATES_PATH = path.join(__dirname, 'tts_messages.txt');

app.get('/templates', (req, res) => {
  try {
    const content = fs.readFileSync(TEMPLATES_PATH, 'utf8');
    const templates = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1);
      templates[key] = value;
    }
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- ElevenLabs TTS + STT proxies ----
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || '9BWtsMINqrJLrRacOk9x';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
const ELEVENLABS_STT_MODEL =
  process.env.ELEVENLABS_STT_MODEL || 'scribe_v1';

app.use('/speak', express.json({ limit: '32kb' }));
// /transcribe accepts EITHER multipart (FormData with field "audio") OR a
// raw audio body. Mobile clients should use multipart — it's much more
// reliable for file uploads on React Native.
const transcribeMiddleware = (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.startsWith('multipart/')) {
    return upload.single('audio')(req, res, next);
  }
  return express.raw({ type: () => true, limit: '20mb' })(req, res, next);
};

app.post('/transcribe', transcribeMiddleware, async (req, res) => {
  if (!ELEVENLABS_KEY) {
    return res
      .status(503)
      .json({ error: 'ELEVENLABS_API_KEY not set in .env' });
  }
  const audioBuffer = req.file?.buffer || req.body;
  const audioMime =
    req.file?.mimetype || req.headers['content-type'] || 'audio/mp4';
  if (!audioBuffer || audioBuffer.length === 0) {
    console.error('[transcribe] empty body');
    return res.status(400).json({ error: 'empty audio body' });
  }
  try {
    const ext = audioMime.includes('webm')
      ? 'webm'
      : audioMime.includes('wav')
      ? 'wav'
      : audioMime.includes('mp4') || audioMime.includes('m4a')
      ? 'm4a'
      : audioMime.includes('ogg')
      ? 'ogg'
      : 'm4a';

    const fd = new FormData();
    const blob = new Blob([audioBuffer], { type: audioMime });
    fd.append('file', blob, `audio.${ext}`);
    fd.append('model_id', ELEVENLABS_STT_MODEL);
    // Pin to English — without this, Scribe auto-detects language and will
    // confidently transcribe ambient noise as Korean/Chinese/etc.
    fd.append('language_code', 'eng');

    const response = await fetch(
      'https://api.elevenlabs.io/v1/speech-to-text',
      {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_KEY },
        body: fd,
      }
    );
    if (!response.ok) {
      const errText = await response.text();
      console.error('[transcribe] ElevenLabs error', response.status, errText);
      return res.status(response.status).json({ error: errText });
    }
    const data = await response.json();
    console.log(
      `[transcribe] ${audioBuffer.length}B ${audioMime} → ElevenLabs:`,
      JSON.stringify(data).slice(0, 500)
    );
    res.json({ text: data.text || '' });
  } catch (err) {
    console.error('[transcribe] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function generateSpeech(rawText) {
  if (!ELEVENLABS_KEY) {
    const err = new Error('ELEVENLABS_API_KEY not set in .env');
    err.status = 503;
    throw err;
  }
  const text = (rawText || '').toString().slice(0, 500).trim();
  if (!text) {
    const err = new Error('empty text');
    err.status = 400;
    throw err;
  }
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!response.ok) {
    const errText = await response.text();
    console.error('ElevenLabs error:', response.status, errText);
    const err = new Error(errText);
    err.status = response.status;
    throw err;
  }
  return Buffer.from(await response.arrayBuffer());
}

app.post('/speak', async (req, res) => {
  try {
    const buf = await generateSpeech(req.body?.text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET form so mobile clients can stream audio directly via a URL
// (avoids the round-trip of fetching a blob and saving to a temp file).
app.get('/speak', async (req, res) => {
  try {
    const buf = await generateSpeech(req.query.text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function describePosition(centerX, centerY, area) {
  const horizontal = centerX < 0.33 ? 'left' : centerX < 0.67 ? 'center' : 'right';
  const vertical = centerY < 0.33 ? 'top' : centerY < 0.67 ? 'middle' : 'bottom';
  const distance = area > 0.25 ? 'near' : area > 0.05 ? 'medium' : 'far';
  return { horizontal, vertical, distance };
}

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`model=${modelName} trackModel=${trackModelName} project=${project} location=${location}`);
  console.log(
    `elevenlabs=${ELEVENLABS_KEY ? 'configured' : 'NOT configured (set ELEVENLABS_API_KEY in .env)'}`
  );
});
