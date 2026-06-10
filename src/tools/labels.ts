// Section TEXT labels for the timeline — rendered to PNG and placed as image clips
// on a track above the footage (default V2). Premiere doesn't render marker NAMES
// as text on the timeline (they're chevrons on the ruler), so to get visible,
// always-on-screen section titles we bake the text into a PNG and lay it on V2.
//
// Each PNG is a transparent frame with a colored pill in a corner holding the
// section title — sized to the sequence canvas so it overlays cleanly. The clips
// flow through the normal image-clip export path (no fragile native Title objects),
// so the .prproj stays valid.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "./bin.js";
import { workspaceDir } from "./store.js";

// JCut marker/label color → an RGB hex (no #) for the label pill background.
const LABEL_HEX: Record<string, string> = {
  green: "1FB85A",
  red: "E6506E",
  orange: "E69628",
  yellow: "DCC83C",
  cyan: "3CB4D2",
  blue: "4678E6",
  violet: "9650D2",
  purple: "9650D2",
  white: "E6E6E6",
};

// Where generated label PNGs live, per workspace. Stable names (slug of the text +
// color) so re-running an edit reuses the same file instead of piling up.
export function labelsDir(workspace: string): string {
  return path.join(workspaceDir(workspace), "generated", "labels");
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "label";
}

// ffmpeg drawtext escaping: colon, backslash, single-quote, % are special inside
// the filter string. Keep it simple and ASCII-fold the fancy dashes the model loves.
function escDrawText(s: string): string {
  return s
    .replace(/[—–]/g, "-")        // em/en dash → hyphen (drawtext font may lack glyph)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")       // straight apostrophe → curly (avoids quoting hell)
    .replace(/%/g, "\\%");
}

export interface LabelSpec {
  text: string;
  color?: string;       // marker color name
  width: number;        // canvas width
  height: number;       // canvas height
}

// Render ONE label PNG. Returns the absolute path. The pill sits bottom-left with
// generous padding; font size scales with canvas height so it reads on 1080p & 4K.
export async function renderLabelPng(workspace: string, spec: LabelSpec): Promise<string> {
  const dir = labelsDir(workspace);
  await fs.mkdir(dir, { recursive: true });
  const color = (spec.color && LABEL_HEX[spec.color]) ? spec.color : "green";
  const hex = LABEL_HEX[color];
  const file = path.join(dir, `${slug(spec.text)}__${color}.png`);

  // Reuse if already rendered for this exact canvas size (cheap idempotency: a
  // re-render with a different size overwrites — fine, last writer wins).
  const fontSize = Math.round(spec.height * 0.042);          // ~45px on 1080p
  const padX = Math.round(fontSize * 0.9);
  const padY = Math.round(fontSize * 0.55);
  const marginX = Math.round(spec.width * 0.03);
  const marginY = Math.round(spec.height * 0.06);
  const txt = escDrawText(spec.text);

  // A transparent canvas, then a rounded-ish colored box behind white text. We use
  // drawtext's own box (box=1) for the pill — simplest reliable path across ffmpeg
  // builds (no overlay/geq gymnastics).
  const vf =
    `drawtext=text='${txt}':fontcolor=white:fontsize=${fontSize}:` +
    `box=1:boxcolor=0x${hex}@0.92:boxborderw=${padX}|${padY}|${padX}|${padY}:` +
    `x=${marginX}:y=h-th-${marginY}`;

  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black@0.0:s=${spec.width}x${spec.height}:d=1,format=rgba`,
    "-vf", vf,
    "-frames:v", "1",
    file,
  ];

  await new Promise<void>((resolve, reject) => {
    const ff = spawn(FFMPEG, args);
    let err = "";
    ff.stderr?.on("data", (d) => { err += d.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg drawtext failed (${code}): ${err.split("\n").slice(-6).join("\n")}`));
    });
  });
  return file;
}

// Render a batch of section labels and return their paths in input order.
export async function renderLabels(workspace: string, specs: LabelSpec[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of specs) out.push(await renderLabelPng(workspace, s));
  return out;
}
