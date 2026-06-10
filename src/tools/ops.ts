// Timeline editing operations: add / update / remove clips, with auto-linking
// of paired V/A clips and ripple-by-default layout. All ops are batch + atomic.
import {
  Sequence, Clip, Caption, Transition, Vec2, clipTimelineDuration, clipTimelineEnd,
  clipTypeForPath, isVideoTrack, pairedAudioTrack, fillTransform,
} from "./model.js";
import { probeMedia, workspaceDir } from "./store.js";
import path from "node:path";
import { existsSync } from "node:fs";

let _counter = 0;
function newId(prefix: string): string {
  // Deterministic-ish unique id; fine for single-process CLI use.
  _counter += 1;
  return `${prefix}${Date.now().toString(36)}${_counter}`;
}

export interface AddOp {
  track: string;
  source: string;
  position_seconds: number;
  trim_start_seconds: number;
  trim_end_seconds: number;
  scale_x?: number;
  scale_y?: number;
  position_x?: number;
  position_y?: number;
  volume_db?: number;
  speed?: number;
  video_only?: boolean;
  label_color?: string;
  category?: string;
}

// Accepted clip/marker label colors. Anything else is dropped (no label).
const LABEL_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "violet", "white", "purple"];
function normColor(v: any): string | undefined {
  if (typeof v !== "string") return undefined;
  const c = v.trim().toLowerCase();
  return LABEL_COLORS.includes(c) ? c : undefined;
}

function resolveSource(workspace: string, source: string): string {
  if (path.isAbsolute(source)) return source;
  const ws = workspaceDir(workspace);
  // Try the path as given (e.g. "source/video/clip.mp4").
  const direct = path.join(ws, source);
  if (existsSync(direct)) return direct;
  // The model often passes just a bare filename or "video/clip.mp4" (that's what
  // sources-list reports as `name`). Resolve it by searching the source dirs so
  // any reasonable form the model uses just works.
  const base = path.basename(source);
  for (const sub of ["video", "audio", "images"]) {
    const candidate = path.join(ws, "source", sub, base);
    if (existsSync(candidate)) return candidate;
  }
  // Also try treating it as already-relative-to-source (e.g. "video/clip.mp4").
  const underSource = path.join(ws, "source", source);
  if (existsSync(underSource)) return underSource;
  // Fall back to the direct join so the downstream probe error names a real path.
  return direct;
}

// A clear, example-bearing error so a model that sends the wrong shape can
// self-correct in ONE step instead of looping on a cryptic Node crash.
function addOpSchemaError(detail: string): string {
  return `Invalid sequence-clips-add operation: ${detail}. ` +
    `Each operation needs at least { "track": "V1", "source": "video/FILE.mp4", ` +
    `"position_seconds": 0, "trim_start_seconds": 0, "trim_end_seconds": 2.5 }. ` +
    `"source" is a workspace-relative path from sources-list (e.g. "video/clip.mp4"). ` +
    `Aliases accepted: clip→source, time→position_seconds. ` +
    `Do NOT use only {"type","clip","time"}.`;
}

// Normalize a raw operation: accept the intuitive aliases small models reach for
// (clip/time/file), fill sensible defaults (track V1, trim 0→2.5s), and fail
// loudly with guidance if the essential source is missing.
function normalizeAddOp(raw: any, index: number): AddOp {
  if (raw == null || typeof raw !== "object") {
    throw new Error(addOpSchemaError(`operation ${index} is not an object`));
  }
  const source = raw.source ?? raw.clip ?? raw.file ?? raw.path;
  if (source == null || typeof source !== "string" || source.trim() === "") {
    throw new Error(addOpSchemaError(
      `operation ${index} has no clip source (got keys: ${Object.keys(raw).join(", ") || "none"})`));
  }
  const position = raw.position_seconds ?? raw.time ?? raw.start ?? raw.position;
  const trimStart = raw.trim_start_seconds ?? 0;
  const trimEnd = raw.trim_end_seconds ?? raw.duration_seconds ?? raw.duration
    ?? (typeof trimStart === "number" ? trimStart : 0) + 2.5;
  return {
    track: raw.track ?? "V1",
    source,
    position_seconds: typeof position === "number" ? position : 0,
    trim_start_seconds: typeof trimStart === "number" ? trimStart : 0,
    trim_end_seconds: typeof trimEnd === "number" ? trimEnd : (typeof trimStart === "number" ? trimStart : 0) + 2.5,
    scale_x: raw.scale_x, scale_y: raw.scale_y,
    position_x: raw.position_x, position_y: raw.position_y,
    volume_db: raw.volume_db, speed: raw.speed, video_only: raw.video_only,
    label_color: normColor(raw.label_color ?? raw.color ?? raw.label_colour),
    category: typeof raw.category === "string" ? raw.category.trim() || undefined : undefined,
  };
}

// Add clips. For each video clip whose source has audio, auto-create a linked
// audio clip on the paired A track (unless video_only). Returns created clips.
export async function addClips(
  workspace: string,
  seq: Sequence,
  rawOps: any[],
  allowOffline = false,
): Promise<{ created: Clip[]; warnings: string[] }> {
  if (!Array.isArray(rawOps)) {
    throw new Error(addOpSchemaError("--operations must be a JSON array"));
  }
  const ops: AddOp[] = rawOps.map((r, i) => normalizeAddOp(r, i));
  const created: Clip[] = [];
  const warnings: string[] = [];

  for (const op of ops) {
    if (op.trim_end_seconds <= op.trim_start_seconds) {
      throw new Error(`trim_end_seconds must be > trim_start_seconds (track ${op.track})`);
    }

    // Overlap detection: warn if this clip would collide with an existing clip
    // on the SAME track (a hidden stack — the wrong frame/audio wins at render).
    // We warn rather than block: the agent may be mid-build and will fix layout,
    // but it must KNOW. Cross-track overlap (V2 over V1) is intentional and fine.
    const newStart = op.position_seconds;
    const newDur = (op.trim_end_seconds - op.trim_start_seconds) / (op.speed ?? 1.0);
    const newEnd = newStart + newDur;
    for (const existing of seq.clips) {
      if (existing.track !== op.track) continue;
      const exStart = existing.start_time_seconds;
      const exEnd = clipTimelineEnd(existing);
      // Intervals overlap if each starts before the other ends (exclusive at edges).
      if (newStart < exEnd - 1e-6 && exStart < newEnd - 1e-6) {
        warnings.push(
          `Overlap on ${op.track}: new clip [${newStart.toFixed(2)}–${newEnd.toFixed(2)}s] ` +
          `collides with existing clip ${existing.id} [${exStart.toFixed(2)}–${exEnd.toFixed(2)}s]. ` +
          `Same-track clips that overlap stack hidden — adjust position or use a higher track.`,
        );
        break; // one warning per added clip is enough
      }
    }

    const abs = resolveSource(workspace, op.source);
    const type = clipTypeForPath(op.source);
    let probe;
    try {
      probe = await probeMedia(abs);
    } catch (e) {
      // For timeline imports, the media may be offline (external drive unplugged).
      // Create the clip anyway with unknown dimensions so the timeline structure
      // is preserved; the user can reconnect the drive and re-probe later.
      if (allowOffline) {
        probe = { width: undefined, height: undefined, fps: undefined,
                  duration: op.trim_end_seconds, has_audio: type !== "image", codec: undefined } as any;
        warnings.push(`Offline source (kept in timeline): ${op.source}`);
      } else {
        throw new Error(`Could not probe source ${abs}: ${(e as Error).message}`);
      }
    }

    // AUTO-FIT: if the caller didn't give an explicit scale (or left it at the
    // default 1.0) and the source doesn't match the canvas, compute a FILL scale so
    // the footage covers the frame, centered. This is what makes landscape footage
    // look right in a portrait sequence (and vice versa) — agents (especially small
    // local models) routinely forget to scale, leaving a tiny/cropped clip.
    let transform: { position: Vec2; scale: Vec2; rotation: number } | undefined;
    if (type === "audio") {
      transform = undefined;
    } else {
      const cw = seq.settings.width, ch = seq.settings.height;
      const sw = probe.width, sh = probe.height;
      const scaleGiven = op.scale_x != null || op.scale_y != null;
      if (!scaleGiven && sw && sh && (sw !== cw || sh !== ch)) {
        // Fill the canvas (cover), centered — matches model.ts fillTransform.
        const fit = fillTransform(sw, sh, cw, ch);
        transform = {
          position: { x: op.position_x ?? fit.position.x, y: op.position_y ?? fit.position.y },
          scale: { x: fit.scale, y: fit.scale },
          rotation: 0,
        };
        warnings.push(
          `Auto-scaled ${op.source.split("/").pop()} to ${fit.scale.toFixed(3)}× to fill the ` +
          `${cw}x${ch} canvas (source is ${sw}x${sh}).`,
        );
      } else {
        transform = {
          position: { x: op.position_x ?? 0, y: op.position_y ?? 0 },
          scale: { x: op.scale_x ?? 1, y: op.scale_y ?? 1 },
          rotation: 0,
        };
      }
    }

    const linkId = isVideoTrack(op.track) && probe.has_audio && !op.video_only
      ? newId("lnk")
      : null;

    const videoClip: Clip = {
      id: newId("c"),
      track: op.track,
      source_path: op.source,
      start_time_seconds: op.position_seconds,
      trim_start_seconds: op.trim_start_seconds,
      trim_end_seconds: op.trim_end_seconds,
      speed: op.speed ?? 1.0,
      volume_db: type === "audio" ? (op.volume_db ?? 0) : 0,
      transform,
      link_id: linkId,
      source_width: probe.width,
      source_height: probe.height,
      source_fps: probe.fps,
      source_duration: probe.duration,
      ...(probe.rotation ? { source_rotation: probe.rotation } : {}),
      has_audio: probe.has_audio,
      clip_type: type,
      ...(op.label_color ? { label_color: op.label_color } : {}),
      ...(op.category ? { category: op.category } : {}),
    };
    seq.clips.push(videoClip);
    created.push(videoClip);

    // Auto-pair audio for a video clip with sound.
    if (linkId) {
      const audioClip: Clip = {
        id: newId("c"),
        track: pairedAudioTrack(op.track),
        source_path: op.source,
        start_time_seconds: op.position_seconds,
        trim_start_seconds: op.trim_start_seconds,
        trim_end_seconds: op.trim_end_seconds,
        speed: op.speed ?? 1.0,
        volume_db: op.volume_db ?? 0,
        link_id: linkId,
        source_duration: probe.duration,
        has_audio: true,
        clip_type: "audio",
      };
      seq.clips.push(audioClip);
      created.push(audioClip);
    }

    if (transform && (op.scale_x == null || op.scale_y == null) &&
        probe.width && probe.height) {
      warnings.push(
        `Clip on ${op.track} added without explicit scale — defaulting to 1.0. ` +
        `Source is ${probe.width}x${probe.height}; set scale_x/scale_y to fit the ` +
        `${seq.settings.width}x${seq.settings.height} canvas.`,
      );
    }
  }

  return { created, warnings };
}

export interface UpdateOp {
  clip_id: string;
  start_time_seconds?: number;
  trim_start_seconds?: number;
  trim_end_seconds?: number;
  speed?: number;
  speed_keyframes?: { at: number; speed: number }[] | null;
  volume_db?: number;
  track?: string;
  scale_x?: number;
  scale_y?: number;
  position_x?: number;
  position_y?: number;
  rotation?: number;
  label_color?: string;
}

// Update clips. Duration-altering changes ripple downstream clips on the same
// track (unless noRipple). Linked partners receive the same timeline changes.
export function updateClips(
  seq: Sequence,
  ops: UpdateOp[],
  noRipple = false,
): { updated: string[]; shifted: { id: string; from: number; to: number }[] } {
  const updated: string[] = [];
  const shifted: { id: string; from: number; to: number }[] = [];
  const byId = new Map(seq.clips.map((c) => [c.id, c]));

  for (const op of ops) {
    const c = byId.get(op.clip_id);
    if (!c) throw new Error(`No clip with id ${op.clip_id}`);
    const oldDuration = clipTimelineDuration(c);

    // Gather the clip + its linked partner for timeline-property propagation.
    const group = c.link_id
      ? seq.clips.filter((x) => x.link_id && x.link_id === c.link_id)
      : [c];

    const timelineChanged =
      op.start_time_seconds != null ||
      op.trim_start_seconds != null ||
      op.trim_end_seconds != null ||
      op.speed != null;

    for (const g of group) {
      if (op.start_time_seconds != null) g.start_time_seconds = op.start_time_seconds;
      if (op.trim_start_seconds != null) g.trim_start_seconds = op.trim_start_seconds;
      if (op.trim_end_seconds != null) g.trim_end_seconds = op.trim_end_seconds;
      if (op.speed != null) g.speed = op.speed;
    }
    // Non-timeline props apply only to the targeted clip.
    if (op.speed_keyframes !== undefined) {
      c.speed_keyframes = op.speed_keyframes === null ? undefined : op.speed_keyframes;
    }
    if (op.volume_db != null) c.volume_db = op.volume_db;
    if (op.track != null) c.track = op.track;
    if ((op as any).label_color != null || (op as any).color != null) {
      const col = normColor((op as any).label_color ?? (op as any).color);
      if (col) c.label_color = col;
    }
    if (c.transform) {
      if (op.scale_x != null) c.transform.scale.x = op.scale_x;
      if (op.scale_y != null) c.transform.scale.y = op.scale_y;
      if (op.position_x != null) c.transform.position.x = op.position_x;
      if (op.position_y != null) c.transform.position.y = op.position_y;
      if (op.rotation != null) c.transform.rotation = op.rotation;
    }
    updated.push(c.id);

    // Ripple: if duration changed and position wasn't explicitly set, shift
    // downstream clips on the affected tracks to keep a gapless layout.
    // Run ONCE per op (outside the group loop) to avoid double-shifting linked
    // pairs — iterating per group member would shift each downstream clip once
    // per member, multiplying delta by the group size.
    const newDuration = clipTimelineDuration(c);
    const delta = newDuration - oldDuration;
    if (!noRipple && timelineChanged && op.start_time_seconds == null && delta !== 0) {
      const tracks = new Set(group.map((g) => g.track));
      const groupIds = new Set(group.map((g) => g.id));
      // oldEnd = the end position before the edit (= new end minus the growth).
      // Shift any clip that started at or after oldEnd — i.e., downstream of the
      // edit. Using oldEnd (not newEnd) means shrinks also close the vacated gap.
      const oldEnd = clipTimelineEnd(c) - delta;
      const alreadyShifted = new Set<string>();
      for (const other of seq.clips) {
        if (groupIds.has(other.id)) continue;
        if (!tracks.has(other.track)) continue;
        if (other.start_time_seconds >= oldEnd && !alreadyShifted.has(other.id)) {
          const from = other.start_time_seconds;
          other.start_time_seconds += delta;
          shifted.push({ id: other.id, from, to: other.start_time_seconds });
          alreadyShifted.add(other.id);
        }
      }
    }
  }
  return { updated, shifted };
}

export function removeClips(
  seq: Sequence,
  ids: string[],
  noRipple = false,
): { removed: string[]; shifted: { id: string; from: number; to: number }[] } {
  const shifted: { id: string; from: number; to: number }[] = [];
  const removed: string[] = [];
  const idSet = new Set(ids);
  // Also pull in linked partners of any removed clip.
  for (const c of seq.clips) {
    if (idSet.has(c.id) && c.link_id) {
      for (const o of seq.clips) if (o.link_id === c.link_id) idSet.add(o.id);
    }
  }

  const toRemove = seq.clips.filter((c) => idSet.has(c.id));
  seq.clips = seq.clips.filter((c) => !idSet.has(c.id));
  removed.push(...toRemove.map((c) => c.id));

  if (!noRipple) {
    // Build a per-track offset map: for each track, sum the gaps of all removed
    // clips that start before a given survivor. Processing removed clips in
    // ascending order and accumulating offsets avoids the stale-position bug
    // where a survivor shifted by round N would fail the threshold check in
    // round N+1, leaving a gap for multi-clip removes on the same track.
    const byTrack = new Map<string, { start: number; gap: number }[]>();
    for (const gone of toRemove) {
      const list = byTrack.get(gone.track) || [];
      list.push({ start: gone.start_time_seconds, gap: clipTimelineDuration(gone) });
      byTrack.set(gone.track, list);
    }
    // Sort each track's removals ascending so we accumulate offsets left-to-right.
    for (const list of byTrack.values()) list.sort((a, b) => a.start - b.start);

    // Snapshot original positions before any mutation so gap comparisons are
    // always against original (pre-shift) starts, not live mutated values.
    const originalStart = new Map(seq.clips.map((c) => [c.id, c.start_time_seconds]));
    for (const other of seq.clips) {
      const removals = byTrack.get(other.track);
      if (!removals) continue;
      const origStart = originalStart.get(other.id)!;
      // Sum the gap of every removed clip whose original start was before this survivor.
      let totalGap = 0;
      for (const r of removals) {
        if (r.start < origStart) totalGap += r.gap;
      }
      if (totalGap > 0) {
        const from = other.start_time_seconds;
        other.start_time_seconds = Math.max(0, other.start_time_seconds - totalGap);
        shifted.push({ id: other.id, from, to: other.start_time_seconds });
      }
    }
  }
  return { removed, shifted };
}

// ── Captions ─────────────────────────────────────────────────────────────────
export interface CaptionAddOp {
  text: string;
  start_time_seconds: number;
  end_time_seconds: number;
  zone?: number; offset_x?: number; offset_y?: number;
  font_family?: string; font_size?: number; bold?: boolean;
  fill_color?: string; stroke_color?: string; stroke_width?: number;
  background_color?: string; background_opacity?: number;
  alignment?: "left" | "center" | "right";
}

export function addCaptions(seq: Sequence, ops: CaptionAddOp[]): { created: Caption[]; warnings: string[] } {
  const created: Caption[] = [];
  const warnings: string[] = [];
  if (!seq.captions) seq.captions = [];
  for (const op of ops) {
    if (op.end_time_seconds <= op.start_time_seconds) {
      throw new Error(`Caption end must be > start (text: "${op.text.slice(0, 30)}")`);
    }
    if (op.zone != null && (op.zone < 0 || op.zone > 8)) {
      throw new Error(`Caption zone must be 0–8 (got ${op.zone})`);
    }
    const cap: Caption = {
      id: newId("cap"),
      text: op.text,
      start_time_seconds: op.start_time_seconds,
      end_time_seconds: op.end_time_seconds,
      zone: op.zone ?? 7, // bottom-center default
      offset_x: op.offset_x, offset_y: op.offset_y,
      font_family: op.font_family, font_size: op.font_size, bold: op.bold,
      fill_color: op.fill_color, stroke_color: op.stroke_color, stroke_width: op.stroke_width,
      background_color: op.background_color, background_opacity: op.background_opacity,
      alignment: op.alignment,
    };
    seq.captions.push(cap);
    created.push(cap);
  }
  return { created, warnings };
}

export function removeCaptions(seq: Sequence, ids: string[]): { removed: string[] } {
  const idSet = new Set(ids);
  const before = (seq.captions || []).length;
  seq.captions = (seq.captions || []).filter((c) => !idSet.has(c.id));
  const removed = ids.filter((id) => before !== (seq.captions || []).length || idSet.has(id));
  return { removed: [...idSet] };
}

// ── Transitions (with handle-sufficiency validation) ──
export interface TransitionAddOp {
  kind: "video" | "audio";
  from_clip_id: string;
  to_clip_id: string;
  transition_type: string;
  duration_seconds: number;
  alignment?: "center" | "start-at-cut" | "end-at-cut";
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

// A clip's untrimmed "handles": footage available BEYOND the trim points that a
// transition can borrow to overlap into. tail = after the out-point; head =
// before the in-point. Without source_duration we can't know the tail handle.
function handles(c: Clip): { head: number; tail: number } {
  const head = c.trim_start_seconds; // footage before in-point
  const tail = c.source_duration != null
    ? Math.max(0, c.source_duration - c.trim_end_seconds)
    : 0;
  return { head, tail };
}

export function addTransitions(
  seq: Sequence, ops: TransitionAddOp[],
): { created: Transition[]; warnings: string[] } {
  const created: Transition[] = [];
  const warnings: string[] = [];
  if (!seq.transitions) seq.transitions = [];
  const byId = new Map(seq.clips.map((c) => [c.id, c]));

  for (const op of ops) {
    const from = byId.get(op.from_clip_id);
    const to = byId.get(op.to_clip_id);
    if (!from) throw new Error(`Transition: no clip ${op.from_clip_id}`);
    if (!to) throw new Error(`Transition: no clip ${op.to_clip_id}`);
    if (from.track !== to.track) {
      throw new Error(`Transition clips must be on the same track (${from.track} vs ${to.track})`);
    }
    if (op.duration_seconds <= 0) throw new Error("Transition duration must be > 0");

    // Clips must be ADJACENT (the out-clip ends where the in-clip starts).
    const fromEnd = clipTimelineEnd(from);
    if (Math.abs(fromEnd - to.start_time_seconds) > 0.05) {
      warnings.push(
        `Transition between ${from.id} and ${to.id}: clips aren't adjacent ` +
        `(gap/overlap of ${(to.start_time_seconds - fromEnd).toFixed(2)}s). ` +
        `Transitions blend at a cut — make the clips adjacent first.`,
      );
    }

    // Handle-sufficiency: the overlap must be backed by untrimmed footage.
    const align = op.alignment ?? "center";
    const fromH = handles(from), toH = handles(to);
    const needOutgoing = align === "start-at-cut" ? 0 : align === "end-at-cut" ? op.duration_seconds : op.duration_seconds / 2;
    const needIncoming = align === "end-at-cut" ? 0 : align === "start-at-cut" ? op.duration_seconds : op.duration_seconds / 2;
    if (from.source_duration != null && fromH.tail < needOutgoing - 1e-6) {
      warnings.push(
        `Insufficient handle on outgoing clip ${from.id}: needs ${needOutgoing.toFixed(2)}s of ` +
        `footage past its out-point but only ${fromH.tail.toFixed(2)}s available. ` +
        `Shorten the transition, use start-at-cut alignment, or extend the clip's trim_end.`,
      );
    }
    if (toH.head < needIncoming - 1e-6) {
      warnings.push(
        `Insufficient handle on incoming clip ${to.id}: needs ${needIncoming.toFixed(2)}s of ` +
        `footage before its in-point but only ${toH.head.toFixed(2)}s available. ` +
        `Shorten the transition, use end-at-cut alignment, or reduce the clip's trim_start.`,
      );
    }

    const tr: Transition = {
      id: newId("tr"),
      kind: op.kind,
      from_clip_id: op.from_clip_id,
      to_clip_id: op.to_clip_id,
      transition_type: op.transition_type as any,
      duration_seconds: op.duration_seconds,
      alignment: align,
      easing: op.easing ?? "linear",
    };
    seq.transitions.push(tr);
    created.push(tr);
  }
  return { created, warnings };
}

export function removeTransitions(seq: Sequence, ids: string[]): { removed: string[] } {
  const idSet = new Set(ids);
  seq.transitions = (seq.transitions || []).filter((t) => !idSet.has(t.id));
  return { removed: [...idSet] };
}

// Cascade: drop transitions whose clips no longer exist or are no longer
// adjacent (matches Premiere). Call after clip remove/move operations.
export function cascadeTransitions(seq: Sequence): string[] {
  if (!seq.transitions?.length) return [];
  const byId = new Map(seq.clips.map((c) => [c.id, c]));
  const dropped: string[] = [];
  seq.transitions = seq.transitions.filter((t) => {
    const from = byId.get(t.from_clip_id), to = byId.get(t.to_clip_id);
    if (!from || !to) { dropped.push(t.id); return false; }
    if (Math.abs(clipTimelineEnd(from) - to.start_time_seconds) > 0.05) { dropped.push(t.id); return false; }
    return true;
  });
  return dropped;
}
