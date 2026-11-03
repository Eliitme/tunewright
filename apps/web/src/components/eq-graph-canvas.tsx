/**
 * Frequency response graph with draggable band handles.
 * Drag a handle (left button) to change frequency and gain; scroll over a handle to change its Q.
 * With the graph focused: arrows nudge the selected band (Shift for bigger steps), [ and ] change Q, number keys 1–0 pick a band.
 */
import { useEffect, useRef } from "react";
import { logFrequencies, TP35_PRO_PROFILE, type DeviceEqState } from "@tunewright/walkplay-protocol";
import * as g from "../lib/graph-scale.ts";
import { paintEqGraph, readGraphColors } from "../lib/eq-graph-painter.ts";

interface Props {
  eq: DeviceEqState;
  selectedBand: number;
  disabled: boolean;
  onSelect(index: number): void;
  onChange(index: number, patch: { freq?: number; gain?: number; q?: number }): void;
}

const PAD = 28;
const FREQS = logFrequencies(400);
const [gainMin, gainMax] = TP35_PRO_PROFILE.gainRange;
const [freqMin, freqMax] = TP35_PRO_PROFILE.freqRange;
const [qMin, qMax] = TP35_PRO_PROFILE.qRange;

export function EqGraphCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const size = useRef<g.GraphSize>({ width: 0, height: 0, pad: PAD });
  const latest = useRef(props);
  const frame = useRef(0);
  const colors = useRef(readGraphColors());
  latest.current = props;

  const repaint = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintEqGraph(ctx, size.current, latest.current.eq, latest.current.selectedBand, FREQS, colors.current);
    });
  };
  // One observer per mount: resize the backing store only when the box changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      size.current = { width: rect.width, height: rect.height, pad: PAD };
      repaint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => ((colors.current = readGraphColors()), repaint());
    scheme.addEventListener("change", onScheme);
    // React's wheel listener is passive; a native one can stop the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      const { eq, disabled, onChange } = latest.current;
      if (disabled) return;
      const r = canvas.getBoundingClientRect();
      const hit = hitTest(eq, e.clientX - r.left, e.clientY - r.top);
      if (hit === -1) return;
      e.preventDefault();
      const band = eq.bands[hit]!;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      onChange(hit, { q: Math.round(g.clamp(band.q * factor, qMin, qMax) * 100) / 100 });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", onScheme);
      canvas.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  useEffect(repaint, [props.eq, props.selectedBand]);

  const hitTest = (eq: DeviceEqState, x: number, y: number) =>
    eq.bands.findIndex((b) => Math.hypot(g.freqToX(b.freq, size.current) - x, g.dbToY(g.clamp(b.gain, -g.GRAPH_DB_RANGE, g.GRAPH_DB_RANGE), size.current) - y) < 12);

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const endDrag = () => (dragging.current = null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const { eq, selectedBand, disabled, onChange, onSelect } = props;
    const band = eq.bands[selectedBand];
    if (disabled || !band) return;
    const big = e.shiftKey;
    const digit = "1234567890".indexOf(e.key);
    let patch: { freq?: number; gain?: number; q?: number } | null = null;
    if (digit !== -1 && digit < eq.bands.length) onSelect(digit);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const step = (e.key === "ArrowUp" ? 1 : -1) * (big ? 1 : 0.1);
      patch = { gain: Math.round(g.clamp(band.gain + step, gainMin, gainMax) * 10) / 10 };
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const ratio = Math.pow(2, (e.key === "ArrowRight" ? 1 : -1) / (big ? 3 : 24));
      patch = { freq: Math.round(g.clamp(band.freq * ratio, freqMin, freqMax)) };
    } else if (e.key === "[" || e.key === "]") {
      const factor = e.key === "]" ? 1.1 : 1 / 1.1;
      patch = { q: Math.round(g.clamp(band.q * factor, qMin, qMax) * 100) / 100 };
    } else return;
    e.preventDefault();
    if (patch) onChange(selectedBand, patch);
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      tabIndex={0}
      aria-label="EQ frequency response. Drag a point to change frequency and gain, scroll over a point to change Q. When focused: arrow keys nudge the selected band, [ and ] change Q, number keys pick a band."
      className={`h-full min-h-0 w-full touch-none rounded-xl border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent ${props.disabled ? "opacity-60" : "cursor-crosshair"}`}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (props.disabled || e.button !== 0) return;
        const { x, y } = local(e);
        const hit = hitTest(props.eq, x, y);
        if (hit === -1) return;
        props.onSelect(hit);
        dragging.current = hit;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const index = dragging.current;
        if (index === null) return;
        if (props.disabled || !(e.buttons & 1)) return endDrag();
        const { x, y } = local(e);
        props.onChange(index, {
          freq: Math.round(g.clamp(g.xToFreq(x, size.current), freqMin, freqMax)),
          gain: Math.round(g.clamp(g.yToDb(y, size.current), gainMin, gainMax) * 10) / 10,
        });
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    />
  );
}
