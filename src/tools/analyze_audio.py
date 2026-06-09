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

def main():
    parser = argparse.ArgumentParser(description="JCut.AI AudioFlux Music Analysis Bridge")
    parser.add_argument("--file", required=True, help="Path to audio/video file")
    args = parser.parse_args()
    
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
