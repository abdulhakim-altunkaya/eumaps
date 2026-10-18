# Langas speech check: turns a short Latvian recording into text.
# Runs only inside the VPS (127.0.0.1:8765); the Express backend calls it.
# Start (pm2):  pm2 start ~/langas-asr/venv/bin/python --name langas-asr -- ~/eumaps/langas_asr/server.py
import os
import subprocess
import tempfile
import time

import numpy as np
import uvicorn
from fastapi import FastAPI, File, UploadFile
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("LANGAS_ASR_MODEL", "small")
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=4)
app = FastAPI()


def load_audio(path):
    # ffmpeg turns any recording (wav, mp3, ogg, m4a...) into 16 kHz mono sound for Whisper.
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path,
         "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(out, np.int16).astype(np.float32) / 32768.0


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


@app.post("/transcribe")
def transcribe(file: UploadFile = File(...)):
    data = file.file.read()
    if not data or len(data) > 2_000_000:
        return {"ok": False, "error": "bad size"}
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"
    # Temporary file is deleted as soon as the check is done; recordings are never kept.
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(data)
        f.flush()
        start = time.time()
        try:
            audio = load_audio(f.name)
        except subprocess.CalledProcessError:
            return {"ok": False, "error": "bad audio"}
        segments, _ = model.transcribe(
            audio,
            language="lv",
            beam_size=5,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    return {"ok": True, "text": text, "seconds": round(time.time() - start, 2)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, workers=1)
