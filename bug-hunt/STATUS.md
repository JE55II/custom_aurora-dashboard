# Status of this audit

Snapshot: plugin **1.2.6**. The reports and `REPORT.md` in this folder describe that
version, so their `file:line` citations are historical rather than current.

**All 45 confirmed findings are fixed.** They shipped across these releases:

| version | contents |
|---|---|
| **1.2.7** | the Embed widget, plus every finding below: CRIT-01, the six HIGHs, all 16 mediums and all 22 lows |
| **1.2.8** | the widget editors no longer discard edits when closed without pressing Done (reported by a user on the Pinned widget) |
| **1.2.9** | the two community-plugin review warnings: a shipped default hotkey, and an ES2019 `trimStart()` in an ES2018 target |
| **1.2.10** | a v2 → v3 settings migration, so the new Embed widget also reaches existing dashboards |
| **1.2.11** | widget-editor styling: the accent did not resolve inside modals, select labels were cropped, rows had no spacing |

Counts, as confirmed by the verification pass: **1 critical, 6 high, 16 medium,
22 low**. `REPORT.md` holds the ranked list in fix order; `08-verification.md` holds
the adversarial re-derivation; the numbered `0*-*.md` files are the per-area sweeps.

## Notes for anyone arriving later

- **Appendix A of `REPORT.md` lists seven refuted claims.** They are not bugs. They
  are recorded so nobody spends time re-reporting them (for example, "collapsing a
  widget creates overlaps" and "`.dash-task` is dead CSS" were both disproved).
- **The audit's own limits** are documented at the end of `REPORT.md`: everything was
  driven in jsdom against a stubbed Obsidian API, with no layout engine, and the
  plugin was never run inside real Obsidian. Findings that depend on real rendering
  were verified structurally, not visually — which is why 1.2.11 was still needed
  after the audit was closed: a user's screenshot showed the modals rendering
  unstyled, something no amount of jsdom testing could have caught.
- **Scratch is not committed.** `bug-hunt/scratch-*/` (about 1.8 MB of compiled
  probes, fixtures and HTML dumps) is gitignored; `shim.cjs` is the harness those
  scratch scripts loaded, kept because the recipe in `README.md` refers to it.
