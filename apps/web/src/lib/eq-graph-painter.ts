/** Draws the EQ grid, response curves and band handles onto a 2D canvas. */
import { chainResponseDb, TP35_PRO_PROFILE, type DeviceEqState, type FilterSpec } from "@tunewright/walkplay-protocol";
import * as g from "./graph-scale.ts";

export interface GraphColors {
  line: string;
  muted: string;
  fg: string;
  accent: string;
  surface: string;
}

export function readGraphColors(): GraphColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return { line: v("--color-line"), muted: v("--color-muted"), fg: v("--color-fg"), accent: v("--color-accent"), surface: v("--color-surface") };
}

const FS = TP35_PRO_PROFILE.dspSampleRate;
const TYPE_NAMES = { PK: "Peak", LSQ: "Low shelf", HSQ: "High shelf", LP: "Low pass", HP: "High pass" } as const;

const clampDb = (db: number) => g.clamp(db, -g.GRAPH_DB_RANGE, g.GRAPH_DB_RANGE);

function tracePath(ctx: CanvasRenderingContext2D, s: g.GraphSize, freqs: number[], db: number[]) {
  ctx.beginPath();
  freqs.forEach((f, i) => {
    const x = g.freqToX(f, s);
    const y = g.dbToY(clampDb(db[i] ?? 0), s);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

/** Fills between a curve and the 0 dB line. */
function fillToZero(ctx: CanvasRenderingContext2D, s: g.GraphSize, freqs: number[], db: number[], style: string | CanvasGradient) {
  const zero = g.dbToY(0, s);
  tracePath(ctx, s, freqs, db);
  ctx.lineTo(g.freqToX(freqs[freqs.length - 1]!, s), zero);
  ctx.lineTo(g.freqToX(freqs[0]!, s), zero);
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
}

function paintGrid(ctx: CanvasRenderingContext2D, s: g.GraphSize, c: GraphColors) {
  ctx.lineWidth = 1;
  ctx.font = "10px ui-sans-serif, system-ui";
  ctx.fillStyle = c.muted;
  ctx.textAlign = "center";
  for (const f of g.GRID_FREQS) {
    const x = Math.round(g.freqToX(f, s)) + 0.5;
    ctx.strokeStyle = c.line;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, s.pad);
    ctx.lineTo(x, s.height - s.pad);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(g.formatFreq(f), x, s.height - s.pad + 14);
  }
  ctx.textAlign = "right";
  for (let db = -g.GRAPH_DB_RANGE; db <= g.GRAPH_DB_RANGE; db += 6) {
    const y = Math.round(g.dbToY(db, s)) + 0.5;
    ctx.strokeStyle = db === 0 ? c.muted : c.line;
    ctx.globalAlpha = db === 0 ? 0.8 : 0.6;
    ctx.beginPath();
    ctx.moveTo(s.pad, y);
    ctx.lineTo(s.width - s.pad, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(`${db > 0 ? "+" : ""}${db}`, s.pad - 6, y + 3);
  }
  ctx.textAlign = "left";
}

function paintReadout(ctx: CanvasRenderingContext2D, s: g.GraphSize, index: number, b: FilterSpec, preamp: number, c: GraphColors) {
  const gain = `${b.gain > 0 ? "+" : ""}${b.gain.toFixed(1)} dB`;
  const text = `Band ${index + 1} · ${TYPE_NAMES[b.type]} · ${g.formatFreq(b.freq)} Hz · ${gain} · Q ${+b.q.toFixed(2)}`;
  ctx.font = "600 11px ui-sans-serif, system-ui";
  ctx.fillStyle = c.fg;
  ctx.fillText(text, s.pad + 8, s.pad + 14);
  if (preamp !== 0) {
    ctx.textAlign = "right";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillStyle = c.muted;
    ctx.fillText(`– – output incl. preamp ${preamp} dB`, s.width - s.pad - 8, s.pad + 14);
    ctx.textAlign = "left";
  }
}

export function paintEqGraph(
  ctx: CanvasRenderingContext2D,
  s: g.GraphSize,
  eq: DeviceEqState,
  selected: number,
  freqs: number[],
  c: GraphColors,
) {
  ctx.clearRect(0, 0, s.width, s.height);
  paintGrid(ctx, s, c);

  // The selected band on its own, as a faint shape, so its reach is visible.
  const sel = eq.bands[selected];
  if (sel) {
    ctx.globalAlpha = 0.18;
    fillToZero(ctx, s, freqs, chainResponseDb([sel], 0, FS, freqs), c.accent);
    ctx.globalAlpha = 1;
  }

  // Filters only: the handles sit on this curve.
  const eqCurve = chainResponseDb(eq.bands, 0, FS, freqs);
  const top = g.dbToY(g.GRAPH_DB_RANGE, s);
  const bottom = g.dbToY(-g.GRAPH_DB_RANGE, s);
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, `color-mix(in srgb, ${c.accent} 35%, transparent)`);
  gradient.addColorStop(0.5, "transparent");
  gradient.addColorStop(1, `color-mix(in srgb, ${c.accent} 35%, transparent)`);
  fillToZero(ctx, s, freqs, eqCurve, gradient);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  tracePath(ctx, s, freqs, eqCurve);
  ctx.stroke();

  // What the DAC actually outputs: filters plus preamp.
  if (eq.preamp !== 0) {
    ctx.strokeStyle = c.fg;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    tracePath(ctx, s, freqs, eqCurve.map((db) => db + eq.preamp));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  ctx.font = "600 10px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  eq.bands.forEach((b, i) => {
    const x = g.freqToX(b.freq, s);
    const y = g.dbToY(clampDb(b.gain), s);
    const isSel = i === selected;
    if (isSel) {
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fillStyle = `color-mix(in srgb, ${c.accent} 25%, transparent)`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, isSel ? 8 : 6.5, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? c.accent : b.gain !== 0 ? `color-mix(in srgb, ${c.accent} 45%, ${c.surface})` : c.surface;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isSel ? "#fff" : c.fg;
    ctx.fillText(String(i + 1), x, y + 3.5);
  });
  ctx.textAlign = "left";

  if (sel) paintReadout(ctx, s, selected, sel, eq.preamp, c);
}
