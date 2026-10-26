# Venture scenario format (v0.1)

One `*.venture.json` file is one playable case on the venture engine: a company with customers, a squad, money and hidden facts, played for
four quarters of twelve weeks. Retention cases (`*.scenario.json`, see [scenario-format.md](scenario-format.md)) run on a different engine and
are unaffected. What the equations mean is in [venture-model-spec.md](venture-model-spec.md), section 3; this page is the file's shape and
the rules the engine holds it to.

- The contract is `schema/venture.schema.json` (JSON Schema 2020-12, strict: unknown keys are refused).
- `node check.mjs` validates every file in `scenarios/` and then checks what a schema cannot (below).
- `src/venture/types.ts` is the engine's view of the file. Money is rupees lakh (1 L = 100,000 rupees).

## Top level

| Key | What it holds |
| --- | --- |
| `family`, `schema_version`, `id`, `title`, `version` | `"venture"`, `"0.1"`, a slug, the title, a semver |
| `meta` | `domain`, `seat` (`product_manager`, `chief_executive`, `growth_strategy`, `developer` or `designer`), `order` (where the case sits in the list a player sees; the two retention cases come first), `audience`, `est_minutes`, `locale`, `inspiration`, `rights_note` |
| `company` | The case file a player reads: `name`, `one_liner`, `stage`, `market`, `business_model`, `product`, `role`, `brief`, and `stakeholders` (`name`, `role`, `says`) |
| `stage_names` | The three funnel stages, as a player reads them |
| `terms` | Optional. The words this case uses where the product team's words would be wrong (below) |
| `segments` | Who the customers are (below) |
| `items` | What the squad can build (below) |
| `squad` | Head counts (`eng`, `design`, `data`), what each costs a quarter, `pm`, `fixed` (the rest of the company) and `marketing` |
| `start` | `debt`, `reliability`, `usability`, `morale` (0 to 100), `trust` of the five parties (`eng`, `design`, `biz`, `lead`, `ext`), `cash`, measurement `level` (0 to 2) |
| `incident_base`, `design_ref` | Expected incidents in a middling quarter; design weeks in a typical quarter (the unit usability work is measured in) |
| `hidden` | The facts a player can look into (below) |
| `events` | Three or so market events, one of which arrives in the third quarter |
| `plans` | The board's offers for the year after, chosen in the fourth quarter |
| `root` | The root-cause question: `prompt`, `options`, and how the truth is decided |
| `measurement` | What the team can see at levels 0, 1 and 2 |
| `quarters` | A title and an opening template for each of the four quarters |
| `rubric` | Dimension weights, which sub-criteria count double, and the score bands |
| `calibration` | How many worlds to play and what each scripted bot is expected to score |

## Terms

Every case runs on the same engine, which counts three kinds of team capacity (`eng`, `design`, `data` weeks), three company dials (`debt`,
`reliability`, `usability`) and five parties whose trust matters (`eng`, `design`, `biz`, `lead`, `ext`). A product team's words for them are the
default. A case for another seat says its own in `terms`, and anything it leaves out keeps the default:

| Key | Default | Eighteen Months (chief executive) |
| --- | --- | --- |
| `eng`, `design`, `data` | Engineering, Design, Analyst | Operations, Merchandising, Analytics |
| `debt`, `reliability`, `usability` | Technical debt, Reliability, Usability | Operating debt, Supply reliability, Customer experience |
| `parties.eng`, `.design`, `.biz`, `.lead`, `.ext` | Engineering, Design, Business, Leadership, Outside parties | Operations and supply, Brand and product, Sales and channels, Board and investors, Suppliers and partners |

The words are capitalised as a label would be; the screens lower-case them inside a sentence. They change only what a player reads: the
arithmetic is the same, so a case's numbers are not affected by what it calls things. `src/venture/types.ts` (`termsOf`) fills the gaps, and the
public scenario always carries the complete set. Free text in a case (items, events, quarter openings) is written in the case's own words by its author.

## Segments

`inflow` people start the funnel each quarter; `stages` are the three conversions; `churn` is the share of customers lost a quarter; `arpu`
and `var_cost` are rupees per customer per quarter; `stage_cost` is rupees spent on each person who gets past the first stage. A player sees
`inflow`, `customers` and `arpu` on day one. Conversions, loss rates and step costs reach them only in a report, and only as far as the
measurement level allows (level 0: arrivals, first payments, customers, money; level 1: also sign-ups and losses; level 2: every step and rate).

## Items

An item has an engineering estimate in weeks (`eng`, at least 1: the fitting tool divides by it), `design` and `data` weeks, `clar` (how well understood, 0 to 1), the technical `debt` it
adds or pays down, and `effects`: relative lifts by segment on `s1`, `s2`, `s3` (the three stage conversions), `churn` (positive is fewer
losses), `arpu`, `cost` (negative is cheaper) and `inflow`. Optional parts:

- `scale`: `{ v, ref, keys }` multiplies those effect keys by `hidden[v] / ref`, so what the item is worth depends on a fact the player can look into.
- `per_new` (rupees a customer; `per_new_on` is `all` for a reward or `lift` for a referral), `one_off` (lakh, when it ships), `side_cost` (a
  running cost a quarter, optionally scaled by a hidden fact with `v` and `ref`, and cut by another item with `cut_by` and `cut`).
- `needs`: `done` (items that must be live), `level`, `trust` (`[party, minimum]`), `or_done` (another item that satisfies the need instead).
- `sponsor` (who is promised, and whose trust moves), `serves` (themes), `risky`, `big`, `fav` (a sponsor's favourite), `enables` (measurement level), `quality` (`rel`, `use`).

## Hidden facts

`brief` is what the case file and its sponsors say; `range` is where the truth in one game is drawn from. The two must not be the same
centre: the briefing is wrong in the direction that favours the sponsor's preferred item. `unit` is `share` or `multiple`, for display. The facts
named in `scale` and `side_cost.v` are what an item depends on. `root.dive` names the fact that decides the root cause: `root.high` is true
when it is at least `root.threshold`, otherwise `root.low`. A deep dive shows a fact to within about 8%; an experiment reads an item's value to within about 30%.

## Events and plans

An event has `weight` (the chance it is drawn), `signal` (what the team sees), `body` (what is happening, shown after the quarter), `causes`
and `directions` (three options each, with `cause` and `direction` naming the true ones), `effects` by segment (full in the quarter it hits, half
in the next), an optional `incident` count, and `mitigations`: things that absorb a share (`by`) when true (`live` item, `trust`, measurement
`level`, `rel` reliability). Reading the cause from data adds 15% and from a guess 5%; the right response adds 10%; the total is capped at 90%.

A plan has multipliers on arrivals, revenue per customer, cost to serve, losses and marketing, and `needs` (`use`, `rel`, `debt_below`, `trust`).
Each need not met at the end of the game takes 30% off what the plan promises.

## Quarters and templates

`quarters[n].opening` is filled from the run by fixed templates (`src/venture/narrative.ts`). The names it may use are `company`, `cash`,
`runway`, `hold_profit`, `road`, `shipped`, `profit`, `delta`, `learned`, `pleased`, `U`, `R`, `D`, `M`, `level_label`, `trust_eng`,
`trust_design`, `trust_biz`, `trust_lead`, `trust_ext`, and `per100_<segment id>` (of every 100 people who start, how many reach the last stage).
A template naming anything else fails `check.mjs`. Nothing in a template can say what a player has not been shown.

## Rubric and calibration

`rubric.dimensions` must be exactly the engine's seven (`strategy`, `evidence`, `delivery`, `stewardship`, `leadership`, `adapt`, `value`) with
weights summing to 100. `rubric.doubled` lists the sub-criteria that count double (they must be sub-criteria the engine judges; the list is
`SUBS` in `src/venture/score.ts`). `rubric.bands` descend to 0. `calibration.bots` gives each scripted bot's expected mean score; a range that
was changed after seeing results carries `revised` with the range as first written and why it moved. `do_nothing`, `evidence_led` and
`textbook` must be expected. Run `node src/calibrate.ts --scenario scenarios/<file>` (`--seeds N`, `--from N`).

Evidence-led play must beat the textbook manager by 25 points unless the case sets `calibration.min_gap` (`gap`, `why`), which a case may do
only to say why its two kinds of play are closer than that. Whichever of these a case changes after seeing results is shown in the calibration
output, so a reader sees what was moved and when.

## Writing a case

The effect sizes in a finished case are fitted, not hand-tuned. `tools/venture/cases/<slug>.ts` holds a case as authored: a scenario with rough
effects (`raw`) and a `plan` that says what each ordinary item should be worth per engineering week, which items are bets on a hidden fact, and
which cost-side knob (`side`, `per_new`, `one_off` or `loss`) the fit may move. `node tools/venture/build.ts [slug]` fits the numbers to the
engine's economy and writes `scenarios/<slug>.venture.json`; the notes it prints say what each item came out worth at the briefing and, for a bet,
at what value of the hidden fact it stops paying (about three worlds in ten, so a manager who trusts a sponsor's number is caught out that often
and one who looks into it is not). `tools/venture/common.ts` holds what the cases share: the rubric text and weights by seat, the expected ranges
written before a case's first run, and the measurement and quarter templates. The scenario file is the source of truth once written; run the build
again only to refit after changing the model or a case's raw numbers. A bet's briefing figure must be on the safe side of the value at which it stops paying
(above it where the benefit grows with the fact, below it where the cost does), or the fit has nothing to solve for. `sh tools/record-calibration.sh` rewrites `docs/venture-engine-calibration-latest.txt` for every case.

## What `check.mjs` adds to the schema

Unique ids; every segment, item, hidden fact and bot named somewhere exists; no item waits on itself or on a loop; `needs` and `mitigations`
name real items; every hidden `range` runs low to high; the root cause options include `need_more_data` and `high` differs from `low`;
each event's `cause` and `direction` are among its options; mitigations leave room for reading and response; measurement levels run 0, 1, 2;
quarters are numbered 1 to 4 and their templates fill; dimension weights sum to 100 and cover the engine's dimensions; bands descend to 0.

## What a browser may see

The engine keeps the hidden facts and their ranges, every effect's real size and `scale`, each item's real overrun, the events until the
third quarter, the true cause, and the benchmark runs. `src/venture/view.ts` is the only thing that builds what is sent, and
`test/venture.test.ts` and `test/venture-server.test.ts` hold it to that: a game's first view and the first preview are identical in every
world, the order of the event's answers does not give the right one away, and the full truth appears only in the final report.

## The API

Every route below needs a signed-in session (a cookie from `POST /api/auth/login` or `/api/auth/register`, each `{username, password}`; `POST /api/auth/logout` ends it and
`GET /api/auth/me` says who you are). Without one the answer is 401. A run is visible only to the account that started it; anyone else gets 404.

`GET /api/cases` lists every case (`kind` is `retention` or `venture`); `GET /api/cases/:id` is the public scenario. For a venture run:
`POST /api/runs {scenario, seed?}`, `GET /api/runs/:ref`, `POST /api/runs/:ref/preview {decision}`, `POST /api/runs/:ref/lock {decision}`,
`POST /api/runs/:ref/rewind {target}` (two per game) and `GET /api/runs/:ref/final` (409 until the game is over). A decision is
`{ roadmap, reserve: {rel, debt}, pace, research, instrument }` plus optionally `priority`, `drop`, `experiments`, `dives`, `asks`
(`contractors`, `marketing`), `commit`, `event` (`evidence`, `reading`, `direction`; third quarter only), `plan` (fourth quarter only) and
`reflection` (`root_cause`, `expected`). A badly shaped decision is a 400; one a player could not make (an unknown or live item, a reserve out of
range, a promise for something not on the roadmap) is a 422 with the reason, and changes nothing. Merely unwise decisions are allowed and the
preview says so: a blocked item, work that does not fit, an experiment with nothing to measure with.
