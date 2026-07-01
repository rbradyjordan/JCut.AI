#!/usr/bin/env python3
import sys
import os
import argparse
import json
import subprocess
import numpy as np
import tempfile

try:
    import torch
    import torchvision.transforms as transforms
    from PIL import Image
    HAS_SHOT_MODEL_DEPS = True
except ImportError:
    HAS_SHOT_MODEL_DEPS = False

try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

SHOT_MODEL = None
SHOT_MODEL_ERROR = None
SHOT_LABELS = {
    0: "Close-up (CU)",
    1: "Extreme Close-up (ECU)",
    2: "Full Shot (FS)",
    3: "Long Shot (LS)",
    4: "Medium Shot (MS)",
}

def project_root():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(script_dir, "..", ".."))

def shot_model_path():
    return os.path.join(project_root(), "third_party", "Shot_Type_Classification", "models", "Pytorch_Classification_50ep.pt")

def load_shot_model():
    global SHOT_MODEL, SHOT_MODEL_ERROR
    if SHOT_MODEL is not None or SHOT_MODEL_ERROR is not None:
        return SHOT_MODEL
    if not HAS_SHOT_MODEL_DEPS:
        SHOT_MODEL_ERROR = "torch/torchvision/Pillow not installed"
        return None
    model_path = shot_model_path()
    if not os.path.exists(model_path):
        SHOT_MODEL_ERROR = f"model not found: {model_path}"
        return None
    try:
        SHOT_MODEL = torch.load(model_path, map_location=torch.device("cpu"), weights_only=False)
        SHOT_MODEL.eval()
        return SHOT_MODEL
    except Exception as e:
        SHOT_MODEL_ERROR = str(e)
        return None

def classify_frame_with_model(frame_bgr):
    model = load_shot_model()
    if model is None:
        return None
    image = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    data_transformation = transforms.Compose([
        transforms.ToTensor(),
        transforms.Resize((128, 128)),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])
    images = data_transformation(image)
    with torch.no_grad():
        pred = model(images.view([1, 3, 128, 128]))
        probs = torch.softmax(pred, dim=1)[0]
        idx = int(torch.argmax(probs).item())
        return {
            "type": SHOT_LABELS.get(idx, "Medium Shot (MS)"),
            "confidence": round(float(probs[idx].item()), 3),
            "index": idx,
        }

def probe_metadata(file_path):
    """
    Probes video metadata using ffprobe.
    """
    root = project_root()
    ffprobe_local = os.path.join(root, "bin", "ffprobe")
    ffprobe_bin = ffprobe_local if os.path.exists(ffprobe_local) else "ffprobe"
    
    cmd = [
        ffprobe_bin, "-v", "quiet",
        "-select_streams", "v:0",
        "-show_entries", "stream=duration,width,height,r_frame_rate",
        "-of", "json", file_path
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode("utf-8")
        data = json.loads(out)
        stream = data.get("streams", [{}])[0]
        
        duration = float(stream.get("duration", 0.0))
        width = int(stream.get("width", 0))
        height = int(stream.get("height", 0))
        
        # Frame rate parsing (e.g. "30000/1001" or "24")
        fps_str = stream.get("r_frame_rate", "30/1")
        if "/" in fps_str:
            num, den = map(int, fps_str.split("/"))
            fps = num / den if den > 0 else 30.0
        else:
            fps = float(fps_str) if fps_str else 30.0
            
        return {"duration": duration, "width": width, "height": height, "fps": fps}
    except Exception as e:
        sys.stderr.write(f"ffprobe error: {str(e)}\n")
        return {"duration": 0.0, "width": 0, "height": 0, "fps": 30.0}

def classify_shot_type(file_path, metadata):
    """
    Analyzes composition of video frames. Prefers the vendored sssabet shot-type model
    when the local Python deps are installed; otherwise falls back to a lightweight
    heuristic classifier so the command still works.
    """
    if not HAS_OPENCV:
        return {
            "shot_type": "Medium Shot (MS)",
            "confidence": 0.5,
            "center_focus_ratio": 1.0,
            "overall_edge_density": 0.04,
            "frame_analyses": [],
            "model_used": False,
        }

    try:
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            return {"error": "Could not open video file."}
            
        duration = metadata["duration"]
        if duration <= 0:
            # Fallback
            cap.release()
            return {"shot_type": "Medium Shot (MS)", "confidence": 0.5}
            
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # Analyze 5 frames evenly spaced
        sample_indices = np.linspace(total_frames * 0.1, total_frames * 0.9, 5, dtype=int)
        
        frame_results = []
        model_results = []

        for idx in sample_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if not ret:
                continue
                
            # Resize for speed and standard comparison
            h, w = frame.shape[:2]
            scale_w = 400
            scale_h = int(h * (scale_w / w))
            small = cv2.resize(frame, (scale_w, scale_h))
            
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            # Edge detection
            edges = cv2.Canny(gray, 50, 150)
            
            total_pixels = scale_w * scale_h
            edge_pixels = cv2.countNonZero(edges)
            overall_density = edge_pixels / total_pixels
            
            # Center region (approx 1/3 in width and height)
            cx1, cx2 = int(scale_w * 0.3), int(scale_w * 0.7)
            cy1, cy2 = int(scale_h * 0.3), int(scale_h * 0.7)
            center_edges = cv2.countNonZero(edges[cy1:cy2, cx1:cx2])
            center_pixels = (cx2 - cx1) * (cy2 - cy1)
            center_density = center_edges / center_pixels
            
            # Outer / background region
            outer_edges = edge_pixels - center_edges
            outer_pixels = total_pixels - center_pixels
            outer_density = outer_edges / outer_pixels if outer_pixels > 0 else 0.0
            
            # Ratio of center focus
            focus_ratio = center_density / outer_density if outer_density > 0 else center_density
            
            model_pred = classify_frame_with_model(frame)
            if model_pred is not None:
                ftype = model_pred["type"]
                model_conf = model_pred["confidence"]
                model_results.append(model_pred)
            else:
                if overall_density > 0.08:
                    ftype = "Long Shot (LS)"
                elif overall_density < 0.015:
                    ftype = "Extreme Close-up (ECU)"
                elif focus_ratio > 2.2 and outer_density < 0.025:
                    ftype = "Close-up (CU)"
                elif focus_ratio > 1.5:
                    ftype = "Full Shot (FS)"
                elif overall_density > 0.05:
                    ftype = "Medium Shot (MS)"
                else:
                    ftype = "Medium Shot (MS)"
                model_conf = None

            frame_results.append({
                "time": round((idx / total_frames) * duration, 2),
                "type": ftype,
                "overall_density": round(overall_density, 4),
                "focus_ratio": round(focus_ratio, 3),
                **({"model_confidence": model_conf} if model_conf is not None else {})
            })
            
        cap.release()
        
        if not frame_results:
            return {"shot_type": "Medium Shot (MS)", "confidence": 0.5}
            
        # Tally results
        counts = {}
        for r in frame_results:
            counts[r["type"]] = counts.get(r["type"], 0) + 1
            
        # Determine dominant type
        dominant = max(counts, key=counts.get)
        confidence = counts[dominant] / len(frame_results)

        avg_density = np.mean([r["overall_density"] for r in frame_results])
        avg_ratio = np.mean([r["focus_ratio"] for r in frame_results])
        avg_model_conf = np.mean([r["confidence"] for r in model_results]) if model_results else None

        return {
            "shot_type": dominant,
            "confidence": round(float(avg_model_conf), 2) if avg_model_conf is not None else round(confidence, 2),
            "center_focus_ratio": round(avg_ratio, 2),
            "overall_edge_density": round(avg_density, 3),
            "frame_analyses": frame_results,
            "model_used": avg_model_conf is not None,
            **({"model_error": SHOT_MODEL_ERROR} if SHOT_MODEL_ERROR else {})
        }
    except Exception as e:
        sys.stderr.write(f"Shot classification failed: {str(e)}\n")
        return {"shot_type": "Medium Shot (MS)", "confidence": 0.5, "error": str(e), "model_used": False}

def analyze_motion_curve(file_path, metadata):
    """
    Quality of Cut Timing: decodes frames sequentially (downsampled), combines
    frame differencing with dense optical flow magnitude, then finds when the
    camera settles and when motion peaks for cut-on-action timing.
    """
    if not HAS_OPENCV:
        # Return fallback mock motion curve
        dur = metadata["duration"] or 10.0
        return {
            "camera_settle_seconds": 0.0,
            "motion_peaks_seconds": [round(dur * 0.3, 2), round(dur * 0.7, 2)],
            "motion_curve": [{"time": t, "motion": 0.1} for t in np.linspace(0, dur, 10)],
            "note": "OpenCV not installed, returning mock curve"
        }
        
    try:
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            return {"error": "Could not open video file."}
            
        duration = metadata["duration"]
        fps = metadata["fps"]
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # Sample at ~5 fps to speed up analysis
        step = max(1, int(round(fps / 5.0)))
        
        prev_gray = None
        motion_points = []
        
        for idx in range(0, total_frames, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if not ret:
                continue
                
            h, w = frame.shape[:2]
            small = cv2.resize(frame, (160, 120)) # ultra small for fast delta
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            
            t = round(idx / fps, 2)
            
            if prev_gray is not None:
                diff = cv2.absdiff(gray, prev_gray)
                mean_diff = np.mean(diff) / 255.0
                flow = cv2.calcOpticalFlowFarneback(
                    prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0
                )
                mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                mean_flow = float(np.mean(mag))
                motion_score = (mean_flow * 0.65) + (float(mean_diff) * 0.35 * 10.0)
                motion_points.append({
                    "time": t,
                    "motion": round(motion_score, 4),
                    "flow": round(mean_flow, 4),
                    "delta": round(float(mean_diff), 4),
                })

            prev_gray = gray
            
        cap.release()
        
        if not motion_points:
            return {"camera_settle_seconds": 0.0, "motion_peaks_seconds": []}
            
        motions = [p["motion"] for p in motion_points]
        avg_motion = np.mean(motions)
        std_motion = np.std(motions)
        
        # 1. Find camera settle (first point where motion drops below average and stays low)
        settle_t = 0.0
        # Look for a window of 1.5 seconds where motion is consistently low
        window_size = int(round(1.5 * 5.0)) # ~1.5 seconds at 5fps
        for i in range(len(motions) - window_size):
            window = motions[i : i + window_size]
            # Settle threshold: below average + 0.2*std
            thresh = avg_motion + 0.2 * std_motion
            if all(v < thresh for v in window):
                # Camera has settled
                settle_t = motion_points[i]["time"]
                break
                
        # 2. Find motion peaks (local maxima clearly above average + 1.2*std)
        peaks = []
        peak_thresh = avg_motion + 1.2 * std_motion
        for i in range(1, len(motions) - 1):
            v = motions[i]
            if v > peak_thresh and v > motions[i - 1] and v > motions[i + 1]:
                peaks.append(motion_points[i]["time"])
                
        return {
            "camera_settle_seconds": round(settle_t, 2),
            "motion_peaks_seconds": [round(p, 2) for p in peaks[:4]], # cap at 4 peaks
            "motion_curve": motion_points[:100], # truncate curve length in JSON response
            "motion_method": "frame-diff+optical-flow",
        }
    except Exception as e:
        sys.stderr.write(f"Motion analysis failed: {str(e)}\n")
        return {"camera_settle_seconds": 0.0, "motion_peaks_seconds": [], "error": str(e)}

def detect_faces(file_path, metadata, sample_fps=2.0, max_frames=120):
    """
    Detect faces/subjects in a video clip and return per-frame subject positions
    as normalized (0..1) coordinates. Used by sequence-social-clips to bias
    auto-reframe transforms so faces stay in frame during aspect ratio changes.

    Strategy (all local, no cloud API):
      1. OpenCV Haar Cascade (built-in, fast, no model download required)
      2. If no faces found, fall back to center (0.5, 0.5)

    Returns:
      frames: [{time_seconds, face_count, subject_x, subject_y}]
      summary: {mean_x, mean_y, face_detected}  — clip-level average for quick reframe
    """
    if not HAS_OPENCV:
        return {
            "ok": False,
            "error": "OpenCV not installed — install opencv-python in the venv",
            "frames": [],
            "summary": {"mean_x": 0.5, "mean_y": 0.5, "face_detected": False},
        }

    # Load Haar Cascade from OpenCV's built-in data.
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    if not os.path.exists(cascade_path):
        return {
            "ok": False,
            "error": f"Haar cascade not found at {cascade_path}",
            "frames": [],
            "summary": {"mean_x": 0.5, "mean_y": 0.5, "face_detected": False},
        }

    face_cascade = cv2.CascadeClassifier(cascade_path)
    duration = metadata.get("duration", 0)
    if duration <= 0:
        return {
            "ok": False, "error": "Invalid duration",
            "frames": [], "summary": {"mean_x": 0.5, "mean_y": 0.5, "face_detected": False},
        }

    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        return {
            "ok": False, "error": "Could not open video",
            "frames": [], "summary": {"mean_x": 0.5, "mean_y": 0.5, "face_detected": False},
        }

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_interval = max(1, int(round(native_fps / sample_fps)))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1

    frames_out = []
    frame_idx = 0
    sampled = 0

    while sampled < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % frame_interval == 0:
            t = frame_idx / native_fps
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5,
                minSize=(max(20, width // 20), max(20, height // 20))
            )
            if len(faces) > 0:
                # Use centroid of the largest face detected.
                areas = [(w * h, x, y, w, h) for (x, y, w, h) in faces]
                _, x, y, w, h = max(areas)
                cx = (x + w / 2) / width
                cy = (y + h / 2) / height
                # Bias slightly upward: keep face in upper-half of frame.
                cy = max(0.1, min(0.9, cy - 0.05))
            else:
                cx, cy = 0.5, 0.4  # sensible default: slightly above center
            frames_out.append({
                "time_seconds": round(t, 3),
                "face_count": int(len(faces)),
                "subject_x": round(cx, 3),
                "subject_y": round(cy, 3),
            })
            sampled += 1
        frame_idx += 1

    cap.release()

    face_detected = any(f["face_count"] > 0 for f in frames_out)
    xs = [f["subject_x"] for f in frames_out] or [0.5]
    ys = [f["subject_y"] for f in frames_out] or [0.4]
    mean_x = round(float(np.mean(xs)), 3)
    mean_y = round(float(np.mean(ys)), 3)

    return {
        "ok": True,
        "file": file_path,
        "duration_seconds": round(duration, 2),
        "width": width,
        "height": height,
        "frames_sampled": len(frames_out),
        "sample_fps": sample_fps,
        "opencv_used": True,
        "face_detected": face_detected,
        "summary": {"mean_x": mean_x, "mean_y": mean_y, "face_detected": face_detected},
        "frames": frames_out,
    }


def main():
    parser = argparse.ArgumentParser(description="JCut.AI OpenCV Video Analysis Bridge")
    parser.add_argument("--file", required=True, help="Path to video file")
    parser.add_argument("--type", choices=["composition", "motion", "faces"], required=True,
                        help="Type of analysis")
    parser.add_argument("--sample-fps", type=float, default=2.0,
                        help="Frames per second to sample for face detection (default 2)")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(json.dumps({"ok": False, "error": f"File not found: {args.file}"}))
        sys.exit(1)

    metadata = probe_metadata(args.file)
    if metadata["duration"] <= 0:
        print(json.dumps({"ok": False, "error": "Could not read video metadata."}))
        sys.exit(1)

    if args.type == "composition":
        res = classify_shot_type(args.file, metadata)
        res["ok"] = "error" not in res
        res["opencv_used"] = HAS_OPENCV
        print(json.dumps(res, indent=2))
    elif args.type == "motion":
        res = analyze_motion_curve(args.file, metadata)
        res["ok"] = "error" not in res
        res["opencv_used"] = HAS_OPENCV
        print(json.dumps(res, indent=2))
    elif args.type == "faces":
        res = detect_faces(args.file, metadata, sample_fps=args.sample_fps)
        print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
