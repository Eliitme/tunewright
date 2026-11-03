# Code standards

- All repo content (code, comments, UI strings, docs) is written in English.
- Files: kebab-case for TS/JS (`walkplay-packet-builders.ts`), PascalCase for Swift. Names describe the purpose.
- Keep files under ~200 lines; split by responsibility.
- TypeScript strict + `noUncheckedIndexedAccess` + `erasableSyntaxOnly` (no parameter properties or enums, so Node can run scripts directly).
- Protocol code is pure and has no DOM/IOKit dependency; all I/O goes through `HidTransport`.
- Every value put on the wire is rounded with `roundHalfAwayFromZero` so TS and Swift match.
- Comments explain *why* (invariants, DAC timing), never plan or finding identifiers.
- No code copied from GPL projects. Protocol facts are restated in our own words in `docs/walkplay-protocol-notes.md`.
- Tests: Vitest. Shared vectors in `test-vectors/` are the source of truth for both TS and Swift.
- Commits: conventional commits.
