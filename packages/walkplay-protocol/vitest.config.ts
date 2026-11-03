import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/biquad-coefficients.ts",
        "src/q30-fixed-point.ts",
        "src/wire-rounding.ts",
        "src/walkplay-packet-builders.ts",
        "src/walkplay-response-parsers.ts",
      ],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
