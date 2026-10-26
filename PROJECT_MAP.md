# pm-sim project map

The complete project lives at `I:\case_comp\pm-sim`. Run commands from that folder with Node.js 24 or newer.

| Path | Purpose |
| --- | --- |
| `src/` | Retention simulation, rules, scores, calibration, authentication, and local HTTP server. |
| `src/venture/` | Venture simulation engine, scores, bots, loading, and calibration. |
| `web/` | Browser app, case list, play screens, reports, styles, login and legal pages. |
| `scenarios/` | Two retention case files and eight venture case files. |
| `schema/` | Scenario JSON schemas. |
| `proto/` | Earlier venture prototype and equivalence checker. |
| `tools/venture/` | Venture case authoring and build tools. |
| `test/` | Engine, server, auth, hardening, scenario and design tests. |
| `docs/` | Format, model and calibration documentation. |
| `check.mjs` | Checks scenario schemas and references. |
| `data/` | Persisted local account file; preserve when moving the app. |
| `out/` | Dry-run evidence, browser playthroughs, screenshots and scratch artifacts. |
| `README.md`, `package.json`, `tsconfig.json` | Usage, scripts and TypeScript configuration. |

Useful commands from `I:\case_comp\pm-sim`:

```powershell
C:\node.exe check.mjs
C:\node.exe --test "test/**/*.test.ts"
C:\node.exe src/server.ts
```

The app serves on `http://127.0.0.1:4310` by default. Runtime code has no npm dependencies. Earlier validation used TypeScript and AJV from `D:\d\rea\node_modules`; browser evidence uses a bundled Playwright copy under `out\dry-run\node_modules`. Those external development tools are not part of the app and were not moved.
