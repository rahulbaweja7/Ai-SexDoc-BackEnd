const express = require('express');
const router = express.Router();

// ElevenLabs voice IDs
const VOICES = {
  female: 'EXAVITQu4vr4xnSDxMaL', // Bella — warm, very natural female
  male:   'pNInz6obpgDQGcFmaJgB',  // Adam — deep, natural male
};

router.post('/', async (req, res) => {
  const { text, voice = 'female' } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'TTS not configured' });

  const voiceId = VOICES[voice] || VOICES.female;
  console.log('[TTS] request — voice:', voice, 'voiceId:', voiceId, 'textLen:', text.length);

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.slice(0, 1000),
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.40, similarity_boost: 0.80, style: 0.45, use_speaker_boost: true },
        }),
      }
    );

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error('[TTS] ElevenLabs error', upstream.status, err);
      return res.status(upstream.status).json({ error: err });
    }

    const audioBuffer = await upstream.arrayBuffer();
    console.log('[TTS] success — bytes:', audioBuffer.byteLength);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('[TTS]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
