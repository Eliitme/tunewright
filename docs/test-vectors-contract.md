# Test vectors & transport contract

`test-vectors/` is the source of truth shared by TypeScript (`packages/walkplay-protocol`) and Swift (`apps/macos/TunewrightKit`). Both ports must pass **the same** files; expected values are never edited by hand.

| File | Origin | Contents |
|---|---|---|
| `source-captures/devicepeq-walkplay-tp35-pro-firmware-1-5-capture.json` | real HID capture (devicePEQ, 0BSD) | raw data, never edited |
| `packets-golden-capture.json` | extracted with `pnpm --filter @tunewright/walkplay-protocol vectors:golden`, **without** using our encoders | build/parse checked against the real device |
| `packets-generated.json` | `vectors:generate` | edge cases: other filter types, rounding, errors |
| `session-traces.json` | `node scripts/generate-session-traces.ts` | session scenarios with every report sent and each outcome |
| `preset-fixtures.json` | hand-written | valid / invalid presets |

Re-run a generator only when behavior changes **on purpose**; review JSON diffs like code.

## Packet vector
```jsonc
{ "name": "...", "kind": "buildBandWrite", "input": { "index": 0, "type": "PK", "freq": 21, "q": 0.6, "gain": 7, "sampleRate": 96000 },
  "expectedHex": "..." }          // or "expected": <parsed value>, or "expectedError": "RangeError"
```
- `expectedHex`: payload **without report ID, unpadded**.
- Kinds: `buildVersionRequest`, `buildBandReadRequest`, `buildPreampReadRequest`, `buildBandWrite`, `buildPreampWrite`, `buildRamApply`, `buildFlashSave`, `buildRestoreDefaults`, `buildFilterModeWrite`, `buildGainModeWrite`, `roundHalfAwayFromZero`, `parseVersion`, `parseBand`, `parsePreamp`. Swift dispatches on the same kinds.
- `expectedError` only requires that an error is thrown (the name is a hint).
- Coefficients are compared **byte for byte**. If Swift is 1 LSB off because of libm, move the input away from a rounding boundary instead of loosening the comparison.

## Session trace
```jsonc
{ "name": "...", "fake": { "initialState"?, "transientFlatReads"?, "dropBandWrite"?: {"index","gain","times"}, "unplugAtSend"? },
  "steps": [ {"op":"readInitialState"} | {"op":"applyVerified","state"} | {"op":"applyLiveBurst","states":[...]} | {"op":"save","state"} ],
  "expected": { "sentHex": ["..."], "results": [ {"ok":true,...} | {"ok":false,"error":"EqVerifyError","restored":true} ] } }
```
The fake DAC answers synchronously inside `send`, stores band packets byte for byte like the real device, and uses a clock that never really waits (time only advances through `sleep`). `times: -1` means always drop. Details: `packages/walkplay-protocol/src/testing/`.

## Transport contract
```
outputReportLength   output payload size in bytes, excluding the report ID
send(reportId, payload)   transport zero-pads to outputReportLength; IOKit inserts the ID byte into the buffer
onReport(cb(reportId, payload))   payload EXCLUDES the report ID (IOKit strips it)
onDisconnect(cb)     every pending request is rejected immediately
```
- Pick the collection that has output report `0x4B`, matched by report ID. On the TP35 Pro it is the Consumer Control collection (usage page `0x0C`, usage `0x01`), shared with media-key input report 3; there is no vendor-page collection.

## Rounding
Every wire value (`Q×256`, `gain×256`, preamp, coefficients ×2³⁰) uses **round half away from zero**. Never `Math.round` (JS) or `.toNearestOrEven`.

## Share link slug
`/s/([A-Za-z0-9]{12,})$` — for both web and API URLs.
