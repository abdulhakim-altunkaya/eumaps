const axios = require("axios");
const FormData = require("form-data");

function similarity(a, b) {
  const clean = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  const A = clean(a).split(/\s+/), B = clean(b).split(/\s+/);
  let dp = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const next = [i];
    for (let j = 1; j <= B.length; j++)
      next[j] = A[i - 1] === B[j - 1] ? dp[j - 1] : 1 + Math.min(dp[j - 1], dp[j], next[j - 1]);
    dp = next;
  }
  return Math.max(0, 1 - dp[B.length] / Math.max(A.length, B.length, 1));
}

async function scorePronunciation(audio, expected) {
if (process.env.LANGAS_SPEECH_ENABLED !== "true" || !process.env.LANGAS_SPEECH_URL)
    return { enabled: false, score: null, transcript: null };

  const form = new FormData();
  form.append("audio", audio, { filename: "recording.wav", contentType: "audio/wav" });
  form.append("language", "lv");

  const response = await axios.post(process.env.LANGAS_SPEECH_URL, form, {
    headers: form.getHeaders(),
    timeout: 120000,
    maxBodyLength: 5 * 1024 * 1024
  });

  const transcript = String(response.data.transcript || "");
  return {
    enabled: true,
    transcript,
    score: Math.round(similarity(transcript, expected) * 100)
  };
}

module.exports = { scorePronunciation };