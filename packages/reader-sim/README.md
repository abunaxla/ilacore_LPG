# packages/reader-sim — RFID reader simulator

The real UHF RFID hardware comes later. This simulator implements the same `ReaderAdapter`
interface the vendor adapter will implement, so nothing above it changes when hardware arrives.

It must behave like a real reader:
- duplicate reads of the same tag within a short time
- missed tags, stray reads from nearby cylinders that aren't part of the handover
- RSSI (signal strength) and timestamps on each read
- authenticates to the API as a registered device, with a credential that can be revoked
- scenario scripts (for example "dispatch of 40 with 2 missed and 1 stray") for tests and demos
