# packages/domain — shared rules and types

Pure TypeScript, with no I/O. The API and the web app both use it, so each rule is written once.

To go here:
- The state dimensions of a tracked item: physical, custody, safety, security (docs/drafts/cylinder-state-model.md)
- Balanced-handover check: every full handed over must be matched by an empty, a sale report or an approved exception
- Liability assignment for shortfalls (giver liable)
- Pricing: exchange = G, outright = G + C
- Permission identifiers (docs/drafts/permission-matrix.md)
