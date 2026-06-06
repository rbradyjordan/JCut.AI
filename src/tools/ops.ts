// Timeline editing operations: add / update / remove clips, with auto-linking
// of paired V/A clips and ripple-by-default layout — the same contract Wideframe
// exposes. All ops are batch + atomic.
import {
  Sequence, Clip, clipTimelineDuration, clipTimelineEnd,
  clipTypeForPath, isVideoTrack, pairedAudioTrack,
} from "./model.js";
import { probeMedia, workspaceDir } from "./store.js";
import path from "node:path";

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
}

function resolveSource(workspace: string, source: string): string {
  return path.isAbsolute(source) ? source : path.join(workspaceDir(workspace), source);
}

// Add clips. For each video clip whose source has audio, auto-create a linked
// audio clip on the paired A track (unless video_only). Returns created clips.
export async function addClips(
  workspace: string,
  seq: Sequence,
  ops: AddOp[],
  allowOffline = false,
): Promise<{ created: Clip[]; warnings: string[] }> {
  const created: Clip[] = [];
  const warnings: string[] = [];

  for (const op of ops) {
    if (op.trim_end_seconds <= op.trim_start_seconds) {
      throw new Error(`trim_end_seconds must be > trim_start_seconds (track ${op.track})`);
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

    const transform =
      type === "audio"
        ? undefined
        : {
            position: { x: op.position_x ?? 0, y: op.position_y ?? 0 },
            scale: { x: op.scale_x ?? 1, y: op.scale_y ?? 1 },
            rotation: 0,
          };

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
      has_audio: probe.has_audio,
      clip_type: type,
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
    const newDuration = clipTimelineDuration(c);
    const delta = newDuration - oldDuration;
    if (!noRipple && timelineChanged && op.start_time_seconds == null && delta !== 0) {
      const tracks = new Set(group.map((g) => g.track));
      for (const g of group) {
        const gEnd = clipTimelineEnd(g);
        for (const other of seq.clips) {
          if (other === g) continue;
          if (!tracks.has(other.track)) continue;
          if (other.start_time_seconds >= gEnd - delta && other.start_time_seconds >= g.start_time_seconds) {
            const from = other.start_time_seconds;
            other.start_time_seconds += delta;
            shifted.push({ id: other.id, from, to: other.start_time_seconds });
          }
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
    for (const gone of toRemove) {
      const gap = clipTimelineDuration(gone);
      for (const other of seq.clips) {
        if (other.track === gone.track && other.start_time_seconds > gone.start_time_seconds) {
          const from = other.start_time_seconds;
          other.start_time_seconds = Math.max(0, other.start_time_seconds - gap);
          shifted.push({ id: other.id, from, to: other.start_time_seconds });
        }
      }
    }
  }
  return { removed, shifted };
}
