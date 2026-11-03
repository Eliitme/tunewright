/** Scroll-driven animations API used by GlassyUI's refraction filter; not yet in TypeScript's DOM lib. */
declare class ViewTimeline extends AnimationTimeline {
  constructor(options?: { subject?: Element; axis?: "block" | "inline" | "x" | "y"; inset?: string });
  readonly source: Element | null;
  readonly subject: Element | null;
  readonly startOffset: CSSNumericValue;
  readonly endOffset: CSSNumericValue;
}
