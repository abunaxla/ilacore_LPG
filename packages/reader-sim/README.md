# packages/reader-sim — RFID reader simulator

The real UHF RFID hardware comes later. This simulator implements the same `ReaderAdapter`
interface the vendor adapter will implement, so nothing above it changes when hardware arrives.

It behaves like a real reader:
- duplicate reads of the same tag within a short time
- missed tags, stray reads from nearby cylinders that aren't part of the job (weaker signal)
- RSSI (signal strength) and timestamps on each read, spread over the scan and across antennas
- authenticates to the API as a registered device, with a credential that can be revoked, plus the operator's phone and PIN
- scenario scripts (for example "dispatch 40 miss 2 stray 1") for tests and demos, seeded so a run can be repeated exactly

## Pieces
| File | What it is |
|---|---|
| `src/adapter.ts` | `ReaderAdapter` and `TagRead`: the interface every reader implements |
| `src/scenario.ts` | `runScenario()` (all reads for a scenario), `parseScript()`, seeded random numbers |
| `src/simulated-reader.ts` | `SimulatedReader`: plays a scenario in real time, in bursts |
| `src/api-client.ts` | `ReaderApiClient`: device sign-in, open a scan session, upload reads in batches of 500 (a retried batch keeps its id, so the API stores it once), close |
| `src/cli.ts` | Command-line runner |

The API's integration tests (`apps/api/test/items.int.test.ts`) drive real scan sessions with it.

## Running a scenario
```bash
corepack pnpm --filter @ilacore/reader-sim build
# Dry run: shows what would be read, sends nothing. tags.txt has one tag number per line.
corepack pnpm --filter @ilacore/reader-sim sim --script "dispatch 40 miss 2 stray 1" --epcs tags.txt --dry-run
```
To send it to the API, register a reader on the Handhelds and readers page, then put its credential and the
operator's phone and PIN in the environment (never as arguments, which end up in shell history):
`READER_API_URL` (default `http://127.0.0.1:3001`), `READER_CREDENTIAL`, `READER_PHONE`, `READER_PIN`, and add
`--location <location id>`. The operator needs the permission for the purpose at that location
(dispatch: Loader; registration: Depot supervisor).

Script words: a purpose and a count, then any of `miss N`, `stray N`, `reads A-B` (reads per tag), `seed N`, `for Ns`.
