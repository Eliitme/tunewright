/** Coordinate mapping for the EQ graph: log frequency on x, dB on y. */
export const GRAPH_FREQ_MIN = 20;
export const GRAPH_FREQ_MAX = 20_000;
export const GRAPH_DB_RANGE = 12;
const LOG_SPAN = Math.log10(GRAPH_FREQ_MAX / GRAPH_FREQ_MIN);

export interface GraphSize {
  width: number;
  height: number;
  pad: number;
}

export const freqToX = (f: number, s: GraphSize) =>
  s.pad + (Math.log10(f / GRAPH_FREQ_MIN) / LOG_SPAN) * (s.width - 2 * s.pad);

export const xToFreq = (x: number, s: GraphSize) =>
  GRAPH_FREQ_MIN * Math.pow(10, ((x - s.pad) / (s.width - 2 * s.pad)) * LOG_SPAN);

export const dbToY = (db: number, s: GraphSize) =>
  s.pad + ((GRAPH_DB_RANGE - db) / (2 * GRAPH_DB_RANGE)) * (s.height - 2 * s.pad);

export const yToDb = (y: number, s: GraphSize) =>
  GRAPH_DB_RANGE - ((y - s.pad) / (s.height - 2 * s.pad)) * 2 * GRAPH_DB_RANGE;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
export const formatFreq = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${Math.round(f)}`);
