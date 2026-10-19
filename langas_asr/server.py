# Langas speech check: turns a short Latvian recording into text.
# Runs only inside the VPS (127.0.0.1:8765); the Express backend calls it.
# Start (pm2):  LANGAS_ASR_MODEL=small pm2 start ~/langas-asr/venv/bin/python --name langas-asr -- ~/eumaps/langas_asr/server.py
import os
import subprocess
import tempfile
import time

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("LANGAS_ASR_MODEL", "small")
MAX_BYTES = 2_000_000
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


def run_whisper(data, suffix):
    if not data or len(data) > MAX_BYTES:
        return {"ok": False, "error": "bad size"}
    # Temporary file is deleted as soon as the check is done; recordings are never kept.
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(data)
        f.flush()
        start = time.time()
        try:
            audio = load_audio(f.name)
        except subprocess.CalledProcessError:
            return {"ok": False, "error": "bad audio"}
        # Silence or almost silence: answer at once, don't run Whisper.
        if audio.size == 0 or float(np.abs(audio).max()) < 0.01:
            return {"ok": True, "text": "", "seconds": round(time.time() - start, 2)}
        audio = audio[: 16000 * 8]  # never more than 8 seconds
        segments, _ = model.transcribe(
            audio,
            language="lv",
            beam_size=5,
            vad_filter=True,  # skip the silent parts
            vad_parameters=dict(min_silence_duration_ms=300),
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    return {"ok": True, "text": text, "seconds": round(time.time() - start, 2)}


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


# For manual tests with curl:  curl -F file=@word.mp3 http://127.0.0.1:8765/transcribe
@app.post("/transcribe")
def transcribe(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"
    return run_whisper(file.file.read(), suffix)


# Used by the Express backend: the request body is the raw recording.
@app.post("/transcribe_raw")
async def transcribe_raw(request: Request):
    data = await request.body()
    return await run_in_threadpool(run_whisper, data, ".wav")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, workers=1)
