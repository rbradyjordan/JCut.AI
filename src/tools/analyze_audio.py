#!/usr/bin/env python3
import sys
import os
import argparse
import json
import subprocess
import numpy as np

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MPL_CACHE_DIR = os.path.join(PROJECT_ROOT, ".cache", "matplotlib")
os.makedirs(MPL_CACHE_DIR, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", MPL_CACHE_DIR)

# Try to import audioflux
try:
    import audioflux as af
    HAS_AUDIOFLUX = True
except ImportError:
    HAS_AUDIOFLUX = False

def load_audio(file_path, target_sr=11025, duration_limit=60):
    """
    Decodes audio to mono PCM float32 samples using ffmpeg.
    Caps length to duration_limit seconds for performance.
    """
    # Look for JCut local ffmpeg first
    ffmpeg_local = os.path.join(PROJECT_ROOT, "bin", "ffmpeg")
    
    ffmpeg_bin = ffmpeg_local if os.path.exists(ffmpeg_local) else "ffmpeg"
    
    cmd = [
        ffmpeg_bin, "-y", "-v", "quiet",
        "-t", str(duration_limit),
        "-i", file_path,
        "-ac", "1", "-ar", str(target_sr),
        "-f", "s16le", "-"
    ]
    
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        raw, _ = proc.communicate()
        if not raw:
            return None, 0
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        duration = len(samples) / target_sr
        return samples, duration
    except Exception as e:
        sys.stderr.write(f"ffmpeg error: {str(e)}\n")
        return None, 0

def probe_duration(file_path):
    """
    Probes true full duration using ffprobe.
    """
    ffprobe_local = os.path.join(PROJECT_ROOT, "bin", "ffprobe")
    ffprobe_bin = ffprobe_local if os.path.exists(ffprobe_local) else "ffprobe"
    
    cmd = [
        ffprobe_bin, "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0", file_path
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return float(out) if out else 0.0
    except:
        return 0.0

def detect_key_and_features(samples, sr):
    """
    Uses audioflux CQT/Chroma features to perform template matching key detection.
    """
    if not HAS_AUDIOFLUX:
        return "C Major", None

    try:
        # Ensure we have enough samples
        if len(samples) < sr:
            return "C Major", None
            
        # Audioflux chroma_cqt or object-oriented CQT
        # For simplicity and robustness across audioflux versions, we use CQT object if available
        # otherwise functional chroma_cqt.
        chroma = None
        try:
            cqt_obj = af.CQT(num=84, samplate=sr)
            cqt_arr = cqt_obj.cqt(samples)
            # Take magnitude of CQT
            cqt_mag = np.abs(cqt_arr)
            chroma = cqt_obj.chroma(cqt_mag)
        except Exception as ex:
            # Fallback to functional API
            try:
                chroma = af.chroma_cqt(samples, samplate=sr)
            except:
                pass
                
        if chroma is None or chroma.size == 0:
            return "C Major", None

        # chroma shape is usually (12, frames)
        if len(chroma.shape) > 1 and chroma.shape[0] == 12:
            mean_chroma = np.mean(chroma, axis=1)
        elif len(chroma.shape) > 1 and chroma.shape[1] == 12:
            mean_chroma = np.mean(chroma, axis=0)
        else:
            mean_chroma = np.zeros(12)
            
        # Krumhansl-Kessler templates
        major_template = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_template = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
        
        notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        
        best_score = -1.0
        best_key = "C Major"
        
        # Mean center chroma vector
        mc = mean_chroma - np.mean(mean_chroma)
        mc_norm = np.linalg.norm(mc)
        if mc_norm > 0:
            for i in range(12):
                t_maj = np.roll(major_template, i)
                t_min = np.roll(minor_template, i)
                
                t_maj_c = t_maj - np.mean(t_maj)
                t_min_c = t_min - np.mean(t_min)
                
                denom_maj = mc_norm * np.linalg.norm(t_maj_c)
                denom_min = mc_norm * np.linalg.norm(t_min_c)
                
                if denom_maj > 0:
                    score_maj = np.dot(mc, t_maj_c) / denom_maj
                    if score_maj > best_score:
                        best_score = score_maj
                        best_key = f"{notes[i]} Major"
                        
                if denom_min > 0:
                    score_min = np.dot(mc, t_min_c) / denom_min
                    if score_min > best_score:
                        best_score = score_min
                        best_key = f"{notes[i]} Minor"
                        
        return best_key, mean_chroma.tolist()
    except Exception as e:
        sys.stderr.write(f"Key detection failed: {str(e)}\n")
        return "C Major", None

def analyze_beats_and_tempo(samples, sr):
    """
    Rhythm analysis. Computes frame envelope, onset strength, autocorrelation
    for tempo, and phase-aligns the beat grid.
    """
    # Analysis specs matching beats.ts
    hop_length = 256
    fps = sr / hop_length
    
    # Per-frame RMS energy envelope
    frames = len(samples) // hop_length
    envelope = np.zeros(frames, dtype=np.float32)
    for i in range(frames):
        chunk = samples[i * hop_length : (i + 1) * hop_length]
        envelope[i] = np.sqrt(np.mean(chunk ** 2))
        
    # Onset strength (half-wave rectified energy rise)
    onset = np.zeros(frames, dtype=np.float32)
    for i in range(1, frames):
        diff = envelope[i] - envelope[i - 1]
        onset[i] = diff if diff > 0 else 0.0
        
    # Estimate tempo via autocorrelation (60 - 180 BPM)
    min_bpm, max_bpm = 60, 180
    min_lag = int(round((60 / max_bpm) * fps))
    max_lag = int(round((60 / min_bpm) * fps))
    
    best_lag = min_lag
    best_score = -1.0
    
    mean_onset = np.mean(onset)
    onset_c = onset - mean_onset
    
    for lag in range(min_lag, max_lag + 1):
        if len(onset_c) - lag <= 0:
            continue
        score = np.dot(onset_c[lag:], onset_c[:-lag]) / (len(onset_c) - lag)
        if score > best_score:
            best_score = score
            best_lag = lag
            
    zero_lag = np.dot(onset_c, onset_c) / (len(onset_c) or 1)
    confidence = (best_score / zero_lag) if zero_lag > 0 else 0.0
    confidence = max(0.0, min(1.0, confidence))
    
    bpm = (60.0 * fps) / best_lag
    
    # Octave correction
    if bpm < 100:
        half_lag = int(round(best_lag / 2))
        if half_lag >= min_lag:
            # Helper to find maximum mean energy on grid
            def energy_on_grid(period):
                best_mean = 0.0
                for offset in range(period):
                    grid_hits = onset[offset::period]
                    if len(grid_hits) > 0:
                        m = np.mean(grid_hits)
                        if m > best_mean:
                            best_mean = m
                return best_mean
            
            full_grid_energy = energy_on_grid(best_lag)
            half_grid_energy = energy_on_grid(half_lag)
            if half_grid_energy >= full_grid_energy * 1.05:
                best_lag = half_lag
                bpm = (60.0 * fps) / best_lag
                
    bpm = round(bpm, 1)
    confidence = round(confidence, 2)
    
    # Phase-align beat grid
    best_offset = 0
    best_sum = -1.0
    for offset in range(best_lag):
        grid_sum = np.sum(onset[offset::best_lag])
        if grid_sum > best_sum:
            best_sum = grid_sum
            best_offset = offset
            
    beats = []
    for idx in range(best_offset, len(onset), best_lag):
        beats.append(round(idx / fps, 3))
        
    # Smooth energy envelope for low/mid/high sections
    win = int(round(fps))
    smooth = np.zeros(frames, dtype=np.float32)
    acc = 0.0
    for i in range(frames):
        acc += envelope[i]
        if i >= win:
            acc -= envelope[i - win]
        smooth[i] = acc / min(i + 1, win)
        
    sorted_smooth = sorted(smooth)
    n_frames = len(sorted_smooth)
    lo_thresh = sorted_smooth[int(n_frames * 0.33)] if n_frames > 0 else 0.0
    hi_thresh = sorted_smooth[int(n_frames * 0.66)] if n_frames > 0 else 0.0
    
    def get_level(v):
        if v < lo_thresh: return "low"
        if v > hi_thresh: return "high"
        return "mid"
        
    sections = []
    cur_start = 0.0
    cur_level = get_level(smooth[0]) if len(smooth) > 0 else "mid"
    min_len = int(round(fps * 4)) # 4 seconds minimum
    
    for i in range(1, len(smooth)):
        l = get_level(smooth[i])
        if l != cur_level and (i - int(cur_start * fps)) >= min_len:
            end_t = round(i / fps, 2)
            label = "drop / chorus" if cur_level == "high" else "intro / breakdown" if cur_level == "low" else "verse / build"
            sections.append({
                "start": round(cur_start, 2),
                "end": end_t,
                "energy": cur_level,
                "label": label
            })
            cur_start = end_t
            cur_level = l
            
    # Add final section
    end_t = round(len(smooth) / fps, 2)
    label = "drop / chorus" if cur_level == "high" else "intro / breakdown" if cur_level == "low" else "verse / build"
    sections.append({
        "start": round(cur_start, 2),
        "end": end_t,
        "energy": cur_level,
        "label": label
    })
    
    return bpm, confidence, beats, sections

def detect_silence(samples, sr, threshold_db=-40.0, min_silence_seconds=0.3,
                   pre_buffer_seconds=0.1, post_buffer_seconds=0.1):
    """
    Scan a PCM audio signal for silent regions using RMS energy thresholding.
    Returns a list of {start, end} regions (in seconds) that fall below the dB
    threshold for at least min_silence_seconds. Pre/post buffers shrink the
    removed region to preserve natural speech rhythm at cut edges.

    Algorithm mirrors AutoPod's Jump Cut Editor:
      - Frame audio into 10ms windows, compute RMS per frame
      - Convert RMS -> dB (20*log10); frames below threshold = silent
      - Cluster consecutive silent frames into regions >= min_silence_seconds
      - Contract each region by pre_buffer from the start and post_buffer from the end
        so the surrounding speech sounds natural (avoids clipping the first consonant)
    """
    hop = int(sr * 0.01)  # 10ms frames
    if hop < 1:
        hop = 1
    frames = len(samples) // hop
    frame_db = np.full(frames, -96.0, dtype=np.float32)
    for i in range(frames):
        chunk = samples[i * hop: (i + 1) * hop]
        rms = np.sqrt(np.mean(chunk ** 2)) if len(chunk) > 0 else 0.0
        frame_db[i] = 20.0 * np.log10(max(rms, 1e-10))

    fps = sr / hop
    min_frames = int(round(min_silence_seconds * fps))
    pre_frames = int(round(pre_buffer_seconds * fps))
    post_frames = int(round(post_buffer_seconds * fps))

    silent_regions = []
    in_silence = False
    silence_start = 0
    for i, db in enumerate(frame_db):
        if db < threshold_db:
            if not in_silence:
                in_silence = True
                silence_start = i
        else:
            if in_silence:
                in_silence = False
                length = i - silence_start
                if length >= min_frames:
                    start_f = silence_start + pre_frames
                    end_f = i - post_frames
                    if end_f > start_f:
                        silent_regions.append({
                            "start_seconds": round(start_f / fps, 3),
                            "end_seconds": round(end_f / fps, 3),
                            "duration_seconds": round((end_f - start_f) / fps, 3),
                        })
    # Handle trailing silence
    if in_silence:
        length = frames - silence_start
        if length >= min_frames:
            start_f = silence_start + pre_frames
            end_f = frames - post_frames
            if end_f > start_f:
                silent_regions.append({
                    "start_seconds": round(start_f / fps, 3),
                    "end_seconds": round(end_f / fps, 3),
                    "duration_seconds": round((end_f - start_f) / fps, 3),
                })

    return silent_regions


def analyze_rms_envelope(samples, sr, hop_length=256):
    """
    Return per-frame RMS envelope in dB for multi-track speaker comparison.
    Fallback when Silero VAD is unavailable.
    """
    fps = sr / hop_length
    frames = len(samples) // hop_length
    envelope_db = []
    for i in range(frames):
        chunk = samples[i * hop_length: (i + 1) * hop_length]
        rms = np.sqrt(np.mean(chunk ** 2)) if len(chunk) > 0 else 0.0
        envelope_db.append(round(float(20.0 * np.log10(max(rms, 1e-10))), 2))
    return envelope_db, round(fps, 4)


# Silero VAD requires 16kHz input. Window size = 512 samples → 32ms per frame.
_SILERO_SR = 16000
_SILERO_HOP = 512   # samples per frame at 16kHz
_SILERO_FPS = _SILERO_SR / _SILERO_HOP  # ~31.25 fps

_silero_model = None
_silero_loaded = False


def _load_silero():
    """Lazy-load Silero VAD. Returns model or None on failure."""
    global _silero_model, _silero_loaded
    if _silero_loaded:
        return _silero_model
    _silero_loaded = True
    try:
        import torch
        model, _ = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            trust_repo=True,
            verbose=False,
        )
        model.eval()
        _silero_model = model
    except Exception as e:
        sys.stderr.write(f"Silero VAD load failed: {e}\n")
        _silero_model = None
    return _silero_model


def load_audio_16k(file_path, duration_limit=None):
    """Decode audio to mono 16kHz PCM float32 for Silero VAD."""
    ffmpeg_local = os.path.join(PROJECT_ROOT, "bin", "ffmpeg")
    ffmpeg_bin = ffmpeg_local if os.path.exists(ffmpeg_local) else "ffmpeg"
    cmd = [ffmpeg_bin, "-y", "-v", "quiet"]
    if duration_limit:
        cmd += ["-t", str(duration_limit)]
    cmd += ["-i", file_path, "-ac", "1", "-ar", str(_SILERO_SR), "-f", "s16le", "-"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        raw, _ = proc.communicate()
        if not raw:
            return None
        return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception as e:
        sys.stderr.write(f"ffmpeg 16k decode error: {e}\n")
        return None


def analyze_vad_envelope(file_path, duration_limit=None):
    """
    Run Silero VAD on an audio file and return per-frame speech probabilities
    (0.0–1.0) at ~31.25 fps. This replaces RMS envelope for speaker detection:
    - Silero distinguishes speech from music, noise, and silence
    - RMS cannot: a loud but silent background music track defeats it entirely
    - 2MB model, CPU-only, ~5ms/s of audio on Apple Silicon

    Returns (probs: list[float], fps: float) or falls back to RMS on failure.
    """
    import torch

    model = _load_silero()
    if model is None:
        # Graceful fallback to RMS
        samples_11k = load_audio(file_path, duration_limit=duration_limit or 3600)[0]
        if samples_11k is None:
            return [], 43.0
        rms_db, fps = analyze_rms_envelope(samples_11k, 11025)
        # Convert dB to a 0–1 "speech probability" proxy: sigmoid-like mapping.
        # -35dB → ~0 (silence floor), -10dB → ~1 (clear speech).
        def db_to_prob(db):
            clamped = max(-60.0, min(0.0, db))
            return round(float((clamped + 60.0) / 60.0), 3)
        return [db_to_prob(d) for d in rms_db], fps

    true_dur = probe_duration(file_path)
    limit = duration_limit or (int(true_dur) + 5 if true_dur > 0 else 3600)
    samples = load_audio_16k(file_path, duration_limit=limit)
    if samples is None or len(samples) == 0:
        return [], _SILERO_FPS

    wav = torch.from_numpy(samples)
    probs_out = []

    # Process in 512-sample windows. Silero resets per-call context with
    # model.reset_states(); we call it once before the loop.
    model.reset_states()
    num_frames = len(samples) // _SILERO_HOP
    for i in range(num_frames):
        chunk = wav[i * _SILERO_HOP: (i + 1) * _SILERO_HOP]
        if len(chunk) < _SILERO_HOP:
            chunk = torch.nn.functional.pad(chunk, (0, _SILERO_HOP - len(chunk)))
        with torch.no_grad():
            speech_prob = model(chunk, _SILERO_SR).item()
        probs_out.append(round(float(speech_prob), 4))

    return probs_out, round(_SILERO_FPS, 4)


def main():
    parser = argparse.ArgumentParser(description="JCut.AI AudioFlux Music Analysis Bridge")
    parser.add_argument("--file", required=True, help="Path to audio/video file")
    parser.add_argument("--mode", default="beats",
                        choices=["beats", "silence", "envelope"],
                        help="Analysis mode")
    # Silence detection params
    parser.add_argument("--threshold-db", type=float, default=-40.0,
                        help="dB level below which audio is considered silent (default -40)")
    parser.add_argument("--min-silence", type=float, default=0.3,
                        help="Minimum silence duration in seconds to detect (default 0.3)")
    parser.add_argument("--pre-buffer", type=float, default=0.1,
                        help="Seconds to keep before a silence region (default 0.1)")
    parser.add_argument("--post-buffer", type=float, default=0.1,
                        help="Seconds to keep after a silence region (default 0.1)")
    # Envelope params
    parser.add_argument("--files", nargs="+",
                        help="Multiple audio files for multi-track envelope comparison")
    args = parser.parse_args()

    if args.mode == "silence":
        if not os.path.exists(args.file):
            print(json.dumps({"ok": False, "error": f"File not found: {args.file}"}))
            sys.exit(1)
        true_duration = probe_duration(args.file)
        samples, analyzed_seconds = load_audio(args.file, duration_limit=int(true_duration) + 5)
        if samples is None or len(samples) == 0:
            print(json.dumps({"ok": False, "error": "Could not decode audio."}))
            sys.exit(1)
        regions = detect_silence(
            samples, 11025,
            threshold_db=args.threshold_db,
            min_silence_seconds=args.min_silence,
            pre_buffer_seconds=args.pre_buffer,
            post_buffer_seconds=args.post_buffer,
        )
        total_removed = sum(r["duration_seconds"] for r in regions)
        print(json.dumps({
            "ok": True,
            "mode": "silence",
            "duration_seconds": round(true_duration, 2),
            "threshold_db": args.threshold_db,
            "min_silence_seconds": args.min_silence,
            "pre_buffer_seconds": args.pre_buffer,
            "post_buffer_seconds": args.post_buffer,
            "silence_count": len(regions),
            "total_removed_seconds": round(total_removed, 2),
            "silent_regions": regions,
        }, indent=2))
        return

    if args.mode == "envelope":
        # Multi-track speaker detection — Silero VAD probabilities (0–1 per frame),
        # with RMS dB fallback if Silero isn't available.
        # Silero advantages over RMS:
        #   - Distinguishes speech from music, noise, claps, room tone
        #   - Returns clean 0/1 probability — no dB threshold to tune
        #   - Same model weight (~2MB) works for all languages and mic types
        files = args.files or [args.file]
        tracks = []
        try:
            import torch  # noqa — only needed for Silero path
            _silero_available = True
        except ImportError:
            _silero_available = False

        for f in files:
            if not os.path.exists(f):
                tracks.append({"file": f, "ok": False, "error": "File not found"})
                continue
            true_dur = probe_duration(f)
            if true_dur <= 0:
                tracks.append({"file": f, "ok": False, "error": "Could not probe duration"})
                continue

            if _silero_available:
                # Primary path: Silero VAD speech probabilities at ~31.25 fps
                probs, fps = analyze_vad_envelope(f, duration_limit=int(true_dur) + 5)
                tracks.append({
                    "file": f,
                    "ok": True,
                    "duration_seconds": round(true_dur, 2),
                    "fps": fps,
                    "envelope_db": probs,   # values are 0–1 speech prob, not dB
                    "vad_mode": "silero",
                })
            else:
                # Fallback: RMS dB
                samples, _ = load_audio(f, duration_limit=int(true_dur) + 5)
                if samples is None or len(samples) == 0:
                    tracks.append({"file": f, "ok": False, "error": "Could not decode"})
                    continue
                envelope_db, fps = analyze_rms_envelope(samples, 11025)
                tracks.append({
                    "file": f,
                    "ok": True,
                    "duration_seconds": round(true_dur, 2),
                    "fps": fps,
                    "envelope_db": envelope_db,
                    "vad_mode": "rms",
                })
        print(json.dumps({"ok": True, "mode": "envelope", "tracks": tracks}, indent=2))
        return

    # Default: beats mode
    if not os.path.exists(args.file):
        print(json.dumps({"ok": False, "error": f"File not found: {args.file}"}))
        sys.exit(1)

    samples, analyzed_seconds = load_audio(args.file)
    if samples is None or len(samples) == 0:
        print(json.dumps({"ok": False, "error": "Could not decode audio file."}))
        sys.exit(1)

    true_duration = probe_duration(args.file)
    if true_duration <= 0:
        true_duration = analyzed_seconds

    # 1. Key detection via AudioFlux Chroma-CQT
    key, chroma_vector = detect_key_and_features(samples, 11025)

    # 2. Beats, BPM, confidence & sections
    bpm, confidence, beats, sections = analyze_beats_and_tempo(samples, 11025)

    # 3. Extrapolate beats across full song
    extrapolated = False
    period_seconds = 60.0 / bpm if bpm > 0 else 0.0
    if period_seconds > 0 and len(beats) >= 2 and true_duration > analyzed_seconds:
        next_beat = beats[-1] + period_seconds
        while next_beat <= true_duration:
            beats.append(round(next_beat, 3))
            next_beat += period_seconds
        extrapolated = True

    downbeats = [b for idx, b in enumerate(beats) if idx % 4 == 0]

    result = {
        "ok": True,
        "audioflux_used": HAS_AUDIOFLUX,
        "key": key,
        "bpm": float(bpm),
        "confidence": float(confidence),
        "duration_seconds": round(true_duration, 2),
        "analyzed_seconds": round(analyzed_seconds, 2),
        "beats_extrapolated": extrapolated,
        "beat_count": len(beats),
        "sections": sections,
        "downbeats_seconds": [float(x) for x in downbeats],
        "beats_seconds": [float(x) for x in beats]
    }

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
