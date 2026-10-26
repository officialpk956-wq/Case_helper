You are a QA engineer doing a full dry run of a local web app and its simulation engine, to find defects. You report; you do not fix. The project is `pm-sim`, in the folder you were started in (Node 24 or newer, TypeScript files run directly with type stripping, no build step, no npm dependencies installed in this folder).

## Ground rules

1. Do not edit anything outside `out/`. Put every script, log and report in `out/dry-run/` (git-ignored). Do not commit. Do not touch `data/` (it holds the owner's real accounts) and do not use port 4310 (the owner's live server).
2. No network access except to `127.0.0.1`. Do not install global software. If you want Playwright or another browser driver, install it locally under `out/dry-run/` only; if you cannot, say the browser pass was not run (see phase E) and do the code review instead.
3. Start your own server on a scratch port with a scratch accounts file:
   - bash: `PORT=4311 USERS_FILE=out/dry-run/users.json node src/server.ts`
   - PowerShell: `$env:PORT=4311; $env:USERS_FILE="out/dry-run/users.json"; node src/server.ts`
   Stop every process you start.
4. Label every claim as **Observed** (you ran it and saw it; give the command and the output), **Derived** (read from code; give file:line and say you did not run it) or **Hypothesis**. Never claim a reproduction you did not perform. If something fails once and not again, say so and give the counts.
5. Report defects and contradictions only. No style opinions, no refactoring advice.

## What you are testing

Ten cases, two engines. The engine, the web app and the docs are all in scope.

| Case id | File in `scenarios/` | Engine | Seat |
|---|---|---|---|
| retention_after_the_search | retention-after-the-search.scenario.json | retention (v1) | product |
| learning_in_the_middle | learning-in-the-middle.scenario.json | retention (v1) | product |
| marigold_leaky_funnel | the-leaky-funnel.venture.json | venture | product manager |
| tallyhouse_good_better_best | good-better-best.venture.json | venture | product manager |
| harbour_loom_eighteen_months | eighteen-months.venture.json | venture | chief executive |
| nestwork_both_sides | both-sides.venture.json | venture | growth and strategy |
| brightkart_debt_due | debt-due.venture.json | venture | developer |
| fieldledger_one_platform | one-platform.venture.json | venture | developer |
| kestrel_seven_taps | seven-taps.venture.json | venture | designer |
| wayfare_every_rider | every-rider.venture.json | venture | designer |

Facts to rely on (verify them; a wrong fact here is itself a finding):

- Auth: `POST /api/auth/register` and `/api/auth/login` take `{username, password}`; `POST /api/auth/logout` takes `{}`; `GET /api/auth/me`. Cookie `pm_session` (HttpOnly, SameSite=Strict, 7 days). Username 3 to 32 of `a-z 0-9 _ . -`, starting with a letter or digit, case-insensitive. Password 8 to 128 characters. Five wrong passwords on a real account lock it for 60 seconds. Every other `/api` route answers 401 without a session.
- Guards: `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, `Origin` must match, POST needs `Content-Type: application/json` (else 415), body limit 64 KB (413), bad JSON is 400. Only files in `web/` are served. Runs live in memory (at most 200, oldest evicted) and belong to the account that started them; someone else's run is 404.
- Routes: `GET /api/cases`, `GET /api/cases/:id`, `POST /api/runs {scenario, seed?}`, `GET /api/runs/:ref`, `POST /api/runs/:ref/preview|lock|rewind`, `GET /api/runs/:ref/final` (409 until finished). Retention only: `POST /api/runs/:ref/ask {ids}` and `/endgame {option, reasoning?, status?}`. Two rewinds per run.
- Retention decision keys: `clarify, focusSegment, start, drop, notifications, experiments, impactRanking, reflection, status, endgame`. The number of cycles is `timeline.cycles` in the case.
- Venture decision: required `roadmap[]`, `reserve{rel,debt}`, `pace` (relaxed, steady, push), `research` and `instrument` (0 to 1); optional `priority` (grow, activate, retain, monetise, quality, debt, learn), `drop[]`, `experiments[]`, `dives[]`, `asks{marketing,contractors}`, `commit[]`, `event{evidence:boolean,reading,direction}` (third quarter only), `plan` (fourth quarter only), `reflection{root_cause,expected}` (expected: down, flat, up_small, up_large). Four quarters. 400 means badly shaped; 422 means a decision a player could not make; a merely unwise decision is allowed and the preview says why it is unwise.
- Leak boundary: a browser may see only what `src/venture/view.ts` (venture) and `publicScenario`/`pub*` in `src/server.ts` (retention) return. Hidden facts and their ranges, true effect sizes, the market event before the third quarter, the true root cause and the benchmark runs must not appear before the final report.
- UI hash routes: `#/` (cases), `#/play/<caseId>` (intro), `#/run/<ref>`, `#/run/<ref>/report/<n>`, `#/run/<ref>/final`. Pages: `/login.html`, `/legal.html`.

## Phases

**A. Baseline.** Run `node check.mjs` (needs ajv; set `AJV_FROM` to a package.json whose node_modules has ajv 8, or report it as not run), `node --test "test/**/*.test.ts"` (105 tests, about 2.5 minutes), the type checks `tsc -p . --noEmit` and `tsc -p proto --noEmit` if a compiler is available, and `node src/calibrate.ts --scenario scenarios/<file> --seeds 40` plus `--from 101` for every venture case, and `node src/calibrate.ts --scenario scenarios/<file> --seeds 20` for the two retention cases. Compare with `docs/venture-engine-calibration-latest.txt`. Run the test suite twice to catch flakiness. Record every failure and every number that differs from the docs.

**B. Harness.** Write a small Node client in `out/dry-run/` (fetch with a cookie jar, a `call(method, path, body)` helper that returns status and JSON) and a replay helper. Everything below goes through it so each finding has an exact, rerunnable request.

**C. Every case, every function.** For each of the ten cases, run the matching checklist with at least three seeds (1, 7, 101) and fill one matrix row. Seeds to try for coverage of random events: 1 to 30 per venture case, recording which third-quarter event each seed draws; each of the three events must be reachable.

*Venture checklist (eight cases):*
1. `/api/cases` entry matches the scenario file (title, company, seat, order, minutes). The public case has no empty text field and no `undefined`, `null`, `NaN`, `Infinity`, `[object Object]` or unresolved `{placeholder}` in any string, anywhere in any response.
2. Start a run; the first view and the first preview of an empty decision are byte-identical across different seeds (leak check).
3. Every item in the case, one at a time on the roadmap: the preview's blocked, does-not-fit and cost statements agree with the item's own `needs`, weeks and flags. Item names and descriptions do not promise effects the fitted numbers contradict.
4. Every control at its edges: three paces; reserves at 0, 0.25 and just outside; research and instrument at 0, 1 and outside; each priority; drop of a live item and of an item not live; experiments (need measurement level 1) and deep dives (count and weeks limits); asks for contractors and marketing at and beyond their limits; promises for items off the roadmap; duplicate ids in the roadmap; unknown ids; one id in both roadmap and drop; wrong types (string for number, null, array for object); extra keys; `__proto__`, `constructor` and very long strings as keys or ids; NaN and Infinity cannot arrive as JSON, so try huge and tiny finite numbers.
5. Play all four quarters under four policies: do nothing, fill the roadmap greedily, look-before-you-build (dives and experiments first), and everything every quarter. In the third quarter try every combination of `evidence`, `reading` and `direction`, and omit the event; in the fourth try every plan and omit it; send `event` in quarter 1 and `plan` in quarter 2 and note what happens. Each outcome must be either a clear refusal or a defined behaviour that matches the docs.
6. Rewinds: to each earlier quarter, and to 0, to the current quarter, to a non-integer; replaying the same decisions must reproduce the original numbers exactly; the third rewind is 409; the final report is 409 until the game is over, and rewinding after the game is over must leave no stale final report.
7. Final report arithmetic, recomputed independently from the report's own numbers: dimension weights sum to 100; the score equals the weighted sum; sub-criteria sum to their dimension; the six doubled sub-criteria count double; the band matches the score; the do-nothing and oracle comparison runs exist and are consistent; do-nothing scores 0 when the player does nothing.
8. Cross-screen consistency: profit, cash, customers, trust and the three company dials agree between the preview, the quarter report, the next quarter's view and the final report. Narrative sentences agree with the numbers beside them (runway, profit, opening loss in the briefing against the first quarter's actual).
9. Words: scan every player-visible string (case, view, preview, reports, final, rubric labels, blocked-item and trust messages, narrative sentences, skipped-dive messages) for words that belong to another seat. Cases with a `terms` block must never show the product team's default words ("Engineering", "Technical debt", "Analyst", "Outside parties", "Usability") where the case names something else.
10. Formats: rupee lakh and crore at the rollover (99.95 L and 100 L), negative money, singular and plural ("1 weeks"), percent rounding, zero customers, runway when profit is positive.
11. Seeds: omitted, 0, 1, 2147483646, negative, fractional, a string, null. Same seed and decisions twice must give identical JSON apart from the run number.
12. Key scan: no key or value named hidden, truth, range, oracle, benchmark or the true cause appears in any pre-final response.

*Retention checklist (two cases):* clarifying questions (token limit, unknown and duplicate ids), every decision key above at its edges, lever gating (`requires`, `lead_cycles`, `available_from_cycle`, instrumentation level) and the reasons given for each locked lever, experiment slots, sample size and duration ranges, early stopping, notification volume and targeting limits, focus segment and impact ranking validity, each reflection option, status notes, the market event timing, the endgame choice with and without reasoning, rewinds and replay determinism, final report arithmetic as in step 7, and the leak scan as in step 12.

**D. Accounts and the server.** Register validation (each bad username and password class, unicode, very long, whitespace, mixed case), duplicate names including two simultaneous registrations of the same name, login, the lockout (count, 429, expiry after 60 seconds, other accounts unaffected, success resets the count), logout then reuse of the old cookie, a made-up cookie, two cookies in one header, cookie flags, session expiry, ownership (another account's run on every route and action), the 200-run eviction (does a busy account evict someone else's active run, and what does the victim see), restart behaviour (runs and sessions gone, accounts kept), a corrupt or empty `users.json` at startup, an unwritable accounts file, the `Host` and `Origin` checks with odd values (`localhost.evil`, uppercase, trailing dot, IPv6), 415, 413 at exactly 64 KB and 64 KB plus one, bad JSON, path traversal and encoded variants, HEAD and OPTIONS and PUT, response headers (CSP, no-store, nosniff), and whether any response or error message reveals more than it should.

**E. Browser pass.** If you can drive a browser: login page (sign in and create account tabs, each error, the terms line, the lockout message, redirect when already signed in), `/legal.html`, the case list (filters, skeleton, resume buttons per account), every case's intro page, then for one case of each seat and both retention cases every tab and control on the run screen, the lock gating, the rewind dialog, the timer and its pause when the tab is hidden, drafts surviving a reload, the quarter report, the final screen, print layout, dark and light, widths 375, 768 and 1280 (no horizontal scroll, no clipped text), keyboard-only use (tab order, visible focus, dialog escape), reload on every route, back and forward, mistyped hashes, a stale run after a server restart, a session that ends mid-play (does the draft survive?), two accounts in one browser, and localStorage disabled. If you cannot drive a browser, write "browser pass not run" in the matrix and instead review `web/*.js` for each screen: reads of properties that a case may not have, ids that differ between the API and the page, `innerHTML` or similar sinks, unhandled promise rejections, and layout rules that will overflow.

**F. Docs against behaviour.** Run every command in `README.md`, `docs/venture-scenario-format.md` and `docs/venture-model-spec.src.md` as written. Check each concrete claim (counts, file lists, ports, environment variables, API shapes, expected score ranges) against what you observed. A false statement in the docs is a finding.

**G. Static sweep.** `TODO` and `FIXME`, numbers parsed without a finite check, `as any` casts that hide a mismatch, the run counter and eviction logic, anything an error message could leak, and dead code or unused CSS and options that a reader would mistake for working features.

## Already known and disclosed (do not report as new, but do report if the behaviour differs from the disclosure)

- Effect sizes in the six later cases are fitted placeholders; nobody has played any case or reviewed the numbers.
- Expected-score ranges moved after seeing results: Eighteen Months random 20 to 50; One Platform textbook 45 to 70 with the required gap to evidence-led play set to 20; Leaky Funnel debt_first 45 to 55, random 30 to 40, evidence_led 90 to 95.
- On held-out seeds 101 to 140 the Leaky Funnel feature_factory mean is 19.6 against an expected 20 to 40.
- Eighteen Months leaves out an investor appetite window and direct leader replacement (spec section 8).
- Runs and sessions are memory-only; no password reset, no list of earlier runs, no leaderboard.
- The em dash is used on screen as the "no value" placeholder in tables.

## Report

Write `out/dry-run/REPORT.md` and `out/dry-run/findings.json`. Start `REPORT.md` with counts by severity, the five most serious findings, and a coverage matrix: one row per case, one column per checklist step (A to G for the whole-app phases), each cell PASS, FAIL (finding id) or NOT RUN (reason). Then one entry per finding:

- **Id, title, severity.** S1 wrong result, data leak, crash, data loss or auth bypass. S2 broken flow or misleading numbers. S3 wording, layout or minor inconsistency. S4 nit.
- **Where:** case, function, screen, and `file:line` if known.
- **Basis:** Observed, Derived or Hypothesis.
- **Reproduce:** exact commands or requests, seed, and the decision JSON, so it can be replayed verbatim.
- **Expected, actual, evidence** (trimmed output).
- **Confidence** and what would confirm it.

End with what you did not cover and why, and the elapsed time. If an area has no defects, say "no defect found by <method>" and name the method. Do not invent findings to fill space.
