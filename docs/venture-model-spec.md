# Venture simulations: the company model, the product-manager seat, and how it is scored

Status: **built for all eight venture cases** (cases 3 to 10 below; cases 1 and 2 are the earlier retention cases). This document was written as the design spec and checked against a
runnable prototype in `proto/venture/`. The real engine (`src/venture/`) now reads the cases from `scenarios/*.venture.json`, serves them
through the web app, and reproduces the prototype's scores exactly for the two cases the prototype had (`node proto/venture/equiv.ts`). The file format is in
[venture-scenario-format.md](venture-scenario-format.md); the engine's own calibration is in `docs/venture-engine-calibration-latest.txt`.
The tables below are still generated from the prototype's data (`node proto/venture/docgen.ts`), which the scenario files were exported from.
The two product-manager cases (3 and 4) are the ones the prototype reproduces exactly. The other six (5 to 10) were written after the engine existed, in
`tools/venture/cases/`, and their effect sizes were fitted by `tools/venture/fit.ts` (see the format document, "Writing a case"). Section 8 says where each
departs from its premise. Their expected score ranges were written before each case's first run; two were moved afterwards (Eighteen Months, the random
bot; One Platform, the textbook bot and the gap to evidence-led play) and each move is disclosed in the case's calibration output and in section 8.

Where the build differs from what is written below:

* The quarter report does not show the profit against holding still, because with one item shipped that difference would read off its true effect and
  undo what an experiment is for. It shows profit against the quarter before. The forecast in the plan is still scored against holding still, in the review.
* A report shows only as much of the funnel as the measurement level at the start of that quarter allows (see "Segments" in the format document).
* The preview's range is sampled from worlds seeded by the scenario and the quarter, never by the player's own world, so the opening preview is the
  same for every player. The preview uses what the player has learned from deep dives.
* The engine refuses what a player could not do (dropping an item that is already live, promising something that is not on the roadmap), so a bot may not
  either. That moved the evidence-led mean in The Leaky Funnel from 92.9 to 92.8; no other number in section 5.5 changed.
* There is no per-quarter score. The score comes after the fourth quarter.

No person has played this. The effect sizes are placeholders fitted so the prototype behaves sensibly, and nobody with product experience has reviewed them.

## 1. What this adds

The two cases we have (job-search retention, B2B learning) run on a retention engine. They are good for one thing: a product manager chasing a retention number.
You asked for cases where the player takes decisions for four quarters with the business, tech, design and developer teams around them, for a manager, a chief executive, a developer and a designer.
That needs a different engine, built around a company that has customers, a team, money and a history, not around one metric. This spec defines that engine, specifies the product-manager seat on it completely, and sketches the other seats.

The line-up you agreed (the two existing cases stay):

| # | Seat | Case | Company | The question the player is paid to answer | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Product manager | Retention after the search | job-search app | Why do people leave after they find a job? | built (engine v1) |
| 2 | Product manager | Learning in the middle | B2B learning app | Why do learners stall in the middle? | built (engine v1) |
| 3 | Product manager | The Leaky Funnel | Marigold Pay, consumer payments | Where do new users leak, and what is worth building first? | specified here, prototyped |
| 4 | Product manager | Good, Better, Best | Tallyhouse, B2B time tracking | How does a plateaued product get to profit? | specified here, prototyped |
| 5 | Chief executive | Eighteen Months | Harbour & Loom, direct-to-consumer home textiles | How is scarce capital allocated when the runway is short? | built (engine v2) |
| 6 | Growth and strategy head | Both Sides of the Market | Nestwork, home-services marketplace | Where do you expand when supply and demand must grow together? | built (engine v2) |
| 7 | Developer (tech lead) | Debt Due | Brightkart, checkout and orders | How much of the quarter goes to features, and how much to what will break? | built (engine v2) |
| 8 | Developer (tech lead) | One Platform | Fieldledger, two merged software companies | How do you merge two systems without stopping either business? | built (engine v2) |
| 9 | Designer (design lead) | Seven Taps | Kestrel Bank, mobile banking | Is the problem the flow, the words, or trust, and how do you find out? | built (engine v2) |
| 10 | Designer (design lead) | Every Rider | Wayfare, city transit app | How do you design for people on cheap phones, in six languages, some who cannot see? | built (engine v2) |

All company, product and person names are invented. Mechanics are of the same kinds a decision simulation needs (a funnel, a capacity limit, hidden facts, an event, a plan), with our own numbers and wording.

## 2. How a game runs

A game is four quarters of twelve working weeks. A game is a seed: the same seed and the same decisions give the same result, and a different seed changes the hidden facts, how big each item's effect really is, how much each item overruns, which event arrives, and the incident luck. The decisions you make and the order you make them in never change the luck, so replaying with a different seed is a clean test of luck.

Each quarter the player sees, in this order:

1. **The state.** Customers by segment, the funnel, money, the team's capacity, technical debt, reliability, usability, morale, the five teams' trust, and what is known and not known (which facts a deep dive has shown, which experiments have read).
2. **The decisions** (section 4).
3. **The preview**, before locking. It shows what is predictable: what fits in the team's weeks, which items ship, which are at risk, which are blocked and why, and the profit the plan would give at the briefing's figures against doing nothing. It shows the uncertain parts as ranges, never as one number: how big the effects will really be, how much the work will overrun.
4. **The quarter report**: what shipped, what each number did, what was a surprise, and who is pleased or not.

In the third quarter an **event** arrives. In the fourth the board offers a **term sheet** of plans for the following year. After the fourth quarter the player gets the **review**: the score with every sub-criterion explained in plain words, and what an informed manager would have done in the same world. Two rewinds are allowed per game, by replaying the decisions up to a chosen quarter, as in the web app today.

## 3. The company model

Money is in rupees lakh (L), one lakh being 100,000 rupees. People are counted. A quarter is 12 weeks. Every equation below is in `proto/venture/model.ts`.

### 3.1 Customers, funnel and the books

Each segment has people who start signing up each quarter (arrivals), three stage conversions, a loss rate, revenue per customer, cost to serve, and a customer base. In one quarter, for each segment:

```text
registered      n1 = arrivals x s1
second stage    n2 = n1 x s2
first payment   n3 = n2 x s3
customers at the end   C' = C x (1 - loss) + n3
average customers      avg = (C + C') / 2
revenue         avg x revenue per customer / 100,000      (in L)
```

Everything that changes the business changes one of seven things in a segment: `s1`, `s2`, `s3`, the loss rate, revenue per customer, cost to serve, or arrivals. Each is a relative lift. If two items lift the same thing by 10%, the lifts do not add; they overlap: `1 - (1 - 0.10) x (1 - 0.10) = 19%`. Negative lifts (damage) combine the same way.

```text
stage conversion   s_j' = clamp(s_j x (1 + lift_j), 0, 0.95)
loss rate          loss' = clamp(loss x (1 - lift_loss) + 0.01 x incidents, 0.2 x loss, 0.9)
revenue per customer   arpu' = arpu x (1 + lift_arpu)
cost to serve      cost' = cost x clamp(1 + lift_cost, 0.3, 1.5)
arrivals           arrivals' = arrivals x (1 + lift_arrivals) x marketing lift
```

Profit for the quarter:

```text
profit = revenue - revenue lost to incidents (1.5% per incident)
       - cost to serve (avg x cost')
       - per-step costs (n1 x cost per step)
       - rewards paid (n3 x reward per customer)
       - running costs of live items
       - squad and company cost - marketing - granted requests - one-off costs of items that shipped
cash' = cash + profit
```

The generated table below shows one quarter of arithmetic for each case, with nothing changed: this is the "holding still" line the preview and the score compare against.

### 3.2 What the squad can build: capacity

The squad's engineering weeks for the roadmap in a quarter:

```text
debt factor     vD = clamp(1.1 - 0.008 x debt, 0.55, 1)
morale factor   vM = 0.8 + 0.2 x morale / 100
people          heads = engineers + 0.6 x (a replacement hired last quarter)
weeks           E = heads x 12 x (1 - 0.22) x vD x vM x pace output - incident load + 0.8 x contractor weeks granted
roadmap weeks   E x (1 - reliability reserve - debt reserve)        (each reserve is 0 to 25%)
design weeks    designers x 12 x 0.8 x vM x pace design factor
analyst weeks   analysts x 12 x 0.85
incident load   2.5 weeks per incident in the previous quarter
```

The 22% is meetings, support and leave. The debt factor is why technical debt matters: at debt 58 the team gets 64% of its weeks, at debt 40 it gets 78%. The pace changes output, debt, morale and incident odds together:

| Pace | Output | Debt added by each item shipped | Morale a quarter | Incident odds | Design output |
| --- | --- | --- | --- | --- | --- |
| relaxed | ×0.92 | ×0.5 | +1 | ×0.8 | ×1 |
| steady | ×1 | ×1 | 0 | ×1 | ×1 |
| push | ×1.10 | ×1.5 | −5 | ×1.35 | ×0.95 |

Contractors and marketing money are requests. A team grants a share of a request equal to its trust in the manager: `granted = request x clamp((trust - 35) / 45, 0, 1)`. Contractor weeks come from the leadership team's trust, marketing money from the business team's. A marketing request made when the business team's trust is too low to grant half of it costs 3 points of that team's trust.

### 3.3 Items: effort, overruns, gates, effects

An item (an initiative) has an engineering estimate in weeks, design weeks, analyst weeks, how well it is understood at the start (0 to 1), a sponsoring team, the effects it has when it works, and sometimes something it needs first. In this spec engineering effort in the item tables is the written estimate ×3, design ×2; the prototype multiplies the written estimates so that a squad can do about two thirds of the catalogue in a year, which is what makes choosing matter.

**Overrun.** The real effort is the estimate times `1 + max(-0.1, mean + spread x z)`, where `z` is a standard normal fixed per item per game:

```text
understanding  c = clamp(how well understood + 0.4 if tested + 0.3 x share of free design weeks put into research, 0, 1)
mean overrun   0.08 + 0.004 x debt - 0.1 x c
spread         0.20 - 0.08 x c
```

So work on a messy codebase overruns more, and research and experiments make estimates tighter and lower. The preview shows items as "ships" (fits at the expected overrun and at the 80th percentile), "at risk" (fits at the expected overrun but not at the 80th percentile), "does not fit", or "blocked".

**Funding.** The roadmap is an ordered list. In the quarter, each item in order gets the smaller of: what it still needs, the engineering weeks left, and the design and analyst weeks left in proportion. Progress carries over to the next quarter; there is no partial credit. An item that ships counts at 40% in the quarter it ships and at 100% afterwards.

**Gates.** Some items cannot start until something is true: another item is live, the measurement level is high enough, or a team trusts the manager enough. A funded item that is blocked takes no weeks and the quarter report says why.

**Effect size.** What an item does in a segment is its listed lift times:

```text
live fraction (0.4 or 1)
x usability factor (0.7 + 0.3 x usability / 100)
x (0.85 + 0.15 x understanding)
x the game's multiplier for this item and segment (lognormal, mean 1, spread 0.45; fixed per game)
x hidden fact / the briefing's figure     (only for the keys that depend on a hidden fact)
```

The preview and the guesses a manager can make use the multiplier 1 and the briefing's figure. The truth in a game is different, and finding out how it differs is most of the job.

### 3.4 Quality and people

Five numbers move every quarter:

```text
technical debt   D' = D + (debt of items shipped, x pace debt factor if positive) + 3.5 - 16 x min(1, debt reserve / 0.15)
reliability      R' = R + 14 x min(1, reliability reserve / 0.15) - 5 + (reliability of items shipped) - 6 x incidents
usability        U' = U + 12 x (polish design weeks / reference weeks) - 5 + (usability of items shipped) - 0.06 x max(0, D - 50)
morale           M' = M + pace effect + 6 x (shipped / funded - 0.6) + 2 if debt reserve >= 8% - 4 x incidents
                          - 8 x (promises broken / promises made) + 3 if over 80% of promises kept - 10 x overload
                 where overload = max(0, estimated weeks funded / roadmap weeks - 1.1)
```

Free design weeks are split between research (which tightens estimates) and polish (which raises usability). If morale is below 42, each quarter there is a chance of `(42 - M) / 40` that an engineer leaves; the replacement works at 60% for a quarter.

Each of the five teams (engineering, design, business, leadership, and outside parties such as a regulator or a partner bank) has a trust number in the manager. A promise to a sponsoring team that an item will ship this quarter moves that team's trust by +5 if it ships and −8 if it does not. Engineering trust also drops 2 for each incident, 3 for a pushed quarter, and rises 1 for a relaxed quarter or an 8% debt reserve. Leadership trust drops 3 per incident and moves 1 with the sign of profit.

### 3.5 Incidents

Expected incidents in a quarter: `base x (1 + 0.015 x debt) x (1.3 - reliability / 100) x pace incident odds x (1 - 0.5 x min(1, reliability reserve / 0.2))`, plus the event's own term in the quarters it bites. The count is 0, 1 or 2, drawn once per quarter from that rate with a seeded draw that does not depend on the player. Each incident costs 1.5% of revenue, a point of extra losses, 6 reliability, 2.5 weeks next quarter, and trust.

### 3.6 Learning, and the gap between the briefing and the truth

This is the part that makes investigation worth doing, so it is stated plainly.

Every case has a few **hidden facts**: numbers that decide whether a big item pays. The case file (the briefing) states a figure for each, in the voice of a sponsor who believes it. The true value in a game is drawn from a range that is not centred on that figure, so the briefing is wrong in a direction that favours the sponsor's preferred item. The player can find the truth:

* **Measurement.** Analyst weeks put into instrumentation accumulate: 6 weeks gives level 1 (core events), 14 gives level 2 (the full funnel). An item can also raise the level. Experiments need level 1; reading an event from data needs level 1.
* **Deep dive.** 1.5 analyst weeks. Shows one hidden fact to within ±8%.
* **Experiment.** 2 analyst weeks and 0.5 engineering weeks on one item. Reads that item's real value over the horizon, with ±30% noise.
* **Research.** Design weeks put into research tighten overruns (3.3).

The score rewards this chain; it does not reward looking for its own sake (section 5).

### 3.7 The event

Each case has three possible events. One is drawn per game by weight, always arriving in the third quarter, at full strength in that quarter and half strength in the fourth. The player handles it in five steps:

1. See the signal (what the team sees in the numbers and the inbox).
2. Choose a cause from three.
3. Say whether the cause was checked against data. This only counts if measurement is at level 1 or more; an unchecked answer is a guess.
4. Choose a response from three.
5. Fund the follow-up in the roadmap as usual.

What is absorbed: `absorbed = clamp(sum of satisfied mitigations + reading + response, 0, 0.9)`. Each event lists mitigations (an item already live, a team's trust at a level, the measurement level, reliability at a level) with a share each. Reading the cause right adds 15% if it was checked and 5% if guessed; the right response adds 10%. The damage lands as lifts of the kinds in 3.1, times `(1 - absorbed)`. Absorbed damage is not luck: it is what the player built before the event.

### 3.8 The term sheet

In the fourth quarter the board offers three plans for the following year. Each changes arrivals, revenue per customer, cost to serve, losses and marketing by a factor, and each needs some things to be true (usability, reliability, debt, a team's trust). Each unmet need takes 30% off what the plan promises. A plan's value in a game is four quarters of profit simulated forward from the end position under the plan's factors, at the game's true multipliers. Choosing the plan is scored by how far it is from the worst plan to the best plan in that game, so the player has to think about their own end position, not pick the plan that sounds best.

## 4. The product-manager seat: what the player decides

| Decision | What it does | Where it shows up |
| --- | --- | --- |
| Theme for the quarter (grow, activate, retain, monetise, quality, debt, learn) | Declares intent; it has no effect on the numbers | `priority_alignment`, `roadmap_follows_priority` |
| Roadmap: an ordered list of items | Spends engineering, design and analyst weeks (3.3) | most of the model |
| Drop an item | Stops it; its progress is lost | `stranded_work`, `experiments_acted_on` |
| Reliability reserve and debt reserve (0 to 25% each) | Takes weeks from the roadmap, buys reliability and pays down debt (3.2, 3.4) | `reserves_matched`, `debt_managed`, `incident_exposure` |
| Pace: relaxed, steady, push | 3.2 | `pace_fits_state`, morale |
| Design weeks: research or polish | Tightens estimates, or raises usability | `usability_kept` |
| Analyst weeks: instrumentation | Builds measurement (3.6) | `measurement_built` |
| Experiments and deep dives | 3.6 | `learned_before_bets`, `experiments_acted_on`, `diagnosis` |
| Requests: marketing money, contractors | Granted by trust (3.2) | `asks_sized_to_trust` |
| Promises: which items you promise to which sponsor, for this quarter | Trust moves when they land or do not (3.4) | `commitments_kept`, `trust_built` |
| Forecast: is next quarter's profit against holding still down, flat, up a little, or up a lot | Nothing | `expectations_calibrated` |
| Root cause: which of five causes you believe is behind the problem | Nothing | `diagnosis` |
| Q3 event: cause, checked or guessed, response | 3.7 | `event_response`, `event_absorbed` |
| Q4 plan | 3.8 | `plan_choice` |

## 5. Scoring

### 5.1 The rule

A score is 100 × earned ÷ earnable, plus modifiers, kept between 0 and 100. It is built from seven dimensions, each made of sub-criteria, and each sub-criterion is judged **full, part, none or not applicable**:

```text
worth of one sub-criterion = (its dimension's weight / the number of sub-criteria in that dimension) x (2 for the six marked x2 in 5.2, else 1)
earned     = sum over sub-criteria that applied of worth x (1 for full, 0.5 for part, 0 for none)
earnable   = sum over sub-criteria that applied of worth        (not applicable ones are left out)
score      = clamp(100 x earned / earnable + modifiers, 0, 100)
```

Four rules keep it honest:

* **No free points for inaction.** If every decision in all four quarters is the default (nothing funded, no learning, no promises, no forecast, default reserves, steady pace), every sub-criterion is judged "none". Some sub-criteria are "not applicable" when the situation never came up, but not applicable is not a gift: it removes the sub-criterion from what could be earned.
* **A claim needs backing.** A right answer that was not backed by learning is capped at "part": the right theme, the right root cause, the right plan, a right reading of the event.
* **Luck is not credited or blamed.** Outcomes are measured against two other runs in the same world, with the same luck: doing nothing, and a manager who was told every hidden fact. Incident exposure is judged by the expected rate, not by whether an incident happened to occur.
* **Both sides of every trade-off are scored.** Pushing the team shows up in morale, trust and incident exposure as well as in delivery; paying down debt shows up in value created as well as in stewardship.

### 5.2 The dimensions and every sub-criterion

The dimension weights are 20, 20, 15, 10, 10, 10, 15. Six sub-criteria count double because they ask whether the manager found and built the right thing: `priority_alignment`, `diagnosis`, `learned_before_bets`, `delivered_vs_best`, `value_created` and `plan_choice`. Doubling them means a dimension with doubled sub-criteria carries more of the score than its weight says. This is what each carries when every sub-criterion applies:

| Dimension | Weight | Sub-criteria | Doubled | Share of the score when all apply |
| --- | --- | --- | --- | --- |
| Strategy and focus | 20 | 3 | 1 | 21.1% |
| Customer and evidence | 20 | 4 | 2 | 23.7% |
| Delivery and execution | 15 | 4 | 1 | 14.8% |
| Quality and technical stewardship | 10 | 4 | 0 | 7.9% |
| Cross-team leadership | 10 | 5 | 0 | 7.9% |
| Adaptability | 10 | 3 | 0 | 7.9% |
| Business value | 15 | 5 | 2 | 16.6% |

**Strategy and focus** (weight 20; each of its 3 sub-criteria is worth 6.7 points, and the ones marked ×2 are worth twice that)

| Sub-criterion | What it measures | Full (1) | Part (½) | Not applicable when |
| --- | --- | --- | --- | --- |
| `priority_alignment` ×2 | The theme chosen for the second quarter against where the open work was worth most (true values). | Chosen theme is the best one, and something was learned first (a deep dive or an experiment in the first two quarters). | Best theme but nothing learned first; or the runner-up after learning. | - |
| `roadmap_follows_priority` | Share of engineering weeks that went to items serving the theme named that quarter. | At least 55%. | At least 35%. | - |
| `stranded_work` | Items started and not finished by the end, and not dropped. | None. | One. | Nothing was built. |

**Customer and evidence** (weight 20; each of its 4 sub-criteria is worth 5 points, and the ones marked ×2 are worth twice that)

| Sub-criterion | What it measures | Full (1) | Part (½) | Not applicable when |
| --- | --- | --- | --- | --- |
| `measurement_built` | Whether the team can see its funnel, and whether anything depended on that. | Full funnel visibility by the end of the second quarter, and an experiment, a level-gated item or an event reading depended on it. | Visibility reached, but nothing used it; or reached late (third quarter). | - |
| `learned_before_bets` ×2 | Big or risky items that were tested, or whose hidden facts were read by a deep dive, before work began. | All of them. | At least 50%. | No big or risky item was started. |
| `experiments_acted_on` | Whether each experiment reading was followed. | At least 80% followed (built if positive, left or dropped if not). | At least 50%. | No experiments. |
| `diagnosis` ×2 | The root cause the manager named, against the true one in this game. | Right, and the deep dive on the deciding fact had been run. | Right, but no deep dive behind it (a lucky or unsupported answer). | - |

**Delivery and execution** (weight 15; each of its 4 sub-criteria is worth 3.8 points, and the ones marked ×2 are worth twice that)

| Sub-criterion | What it measures | Full (1) | Part (½) | Not applicable when |
| --- | --- | --- | --- | --- |
| `delivered_vs_best` ×2 | True value of the items shipped, timed by when they shipped, against the best set the capacity allowed. | At least 50% of the best set. | At least 25%. | No item had positive value. |
| `capacity_used` | Engineering weeks put into the roadmap against what was available. | At least 85%. | At least 60%. | - |
| `roadmap_fits_capacity` | Quarters where the funded work, at its expected overrun, was no more than 115% of capacity. | At least 75% of quarters. | At least 50%. | No roadmap. |
| `pace_fits_state` | Whether the pace suited morale, debt and recent incidents. Pushing is fine when morale is at least 65 and debt at most 55; a tired team should not be pushed. | No quarter mismatched. | One. | - |

**Quality and technical stewardship** (weight 10; each of its 4 sub-criteria is worth 2.5 points, and the ones marked ×2 are worth twice that)

| Sub-criterion | What it measures | Full (1) | Part (½) | Not applicable when |
| --- | --- | --- | --- | --- |
| `debt_managed` | Change in technical debt over the year. | Fell by at least 6. | Rose by at most 2. | - |
| `reserves_matched` | Reliability and debt reserves each quarter against need: too thin when reliability is under 60 (or there was an incident) or debt is over 60; wasteful above 18% when there is no need. | At most one of eight settings off. | Two or three off. | - |
| `incident_exposure` | Expected incidents a quarter (from debt, reliability, pace and reserves; what actually happened is luck and is not counted) against a middling product. | At most 85% of the middling rate. | At most 115%. | - |
| `usability_kept` | Change in usability over the year. | Rose by at least 4. | Fell by at most 2. | - |

**Cross-team leadership** (weight 10; each of its 5 sub-criteria is worth 2 points, and the ones marked ×2 are worth twice that)

| Sub-criterion | What it measures | Full (1) | Part (½) | Not applicable when |
| --- | --- | --- | --- | --- |
| `commitments_kept` | Promises made to the sponsoring teams, kept against broken. | At least 85% kept and at least 6 kept in all (promising nothing is not leadership). | At least 60% kept. | No promises. |
| `trust_built` | Change in the five teams' trust in the manager. | Average up at least 4, at least three teams up by 3 or more, none down more than 3. | Average not down. | - |
| `morale_kept` | Change in morale; capped at part if anyone left. | Down by at most 2. | Down by at most 10. | - |
| `asks_sized_to_trust` | Requests for marketing money or contractors, made when the team trusted the manager enough to grant at least half. | At least 75% of requests. | At least 50%. | No requests. |
| `gates_anticipated` | Funded items that need something first (another item, measurement, trust), and whether they were stopped. | Never stopped. | Stopped, but got through in the end. | No gated item was funded. |

**Adaptability** (weight 10; each of its 3 sub-criteria is worth 3.3 points, and the ones marked ×2 are worth twice that)

| Sub-criterion | What it measures | Full (1) | Part (½) | Not applicable when |
| --- | --- | --- | --- | --- |
| `event_response` | The cause named for the third-quarter event and the response chosen. | Right cause read from data, and the right response. | One of the two right (or the right cause from a guess). | - |
| `event_absorbed` | Share of the event's damage that was absorbed. | At least 50%. | At least 30%. | - |
| `expectations_calibrated` | Each quarter's forecast (profit against holding still: down, flat, up a little, up a lot) against what happened. | Average credit at least 0.7 (exact 1, one step off 0.5). | At least 0.4. | No forecasts. |

**Business value** (weight 15; each of its 5 sub-criteria is worth 3 points, and the ones marked ×2 are worth twice that)

| Sub-criterion | What it measures | Full (1) | Part (½) | Not applicable when |
| --- | --- | --- | --- | --- |
| `value_created` ×2 | Profit over the year plus what the position left behind is worth to a reference builder, against doing nothing, as a share of the same measure for a manager who was told every hidden fact. | At least 75%. | At least 40%. | The informed manager created nothing. |
| `paid_its_way` | Profit over the year against doing nothing, as a share of the revenue of doing nothing. | No worse than -0.5%. | No worse than -3.0%. | - |
| `unit_economics` | Items shipped that lose money in this game. | None. | One. | Nothing shipped. |
| `cash_safe` | Lowest cash against starting cash. | At least 50% of it. | At least 20%. | - |
| `plan_choice` ×2 | The term-sheet plan chosen, as a share of the way from the worst plan to the best (four quarters of profit from the end position, in this game). | At least 80%, and something was learned first. | At least 40%; or the best plan with nothing learned. | - |

### 5.3 Modifiers

| Modifier | Points | When |
| --- | --- | --- |
| `found_it_first` | +3 | The root cause was found by a deep dive in the first quarter, named correctly, and no big or risky item shipped in that quarter |
| `killed_a_loser` | +2 | An item that read negative, or loses money in this game, was dropped |
| `favourite_built_blind` | −2 | A sponsor's favourite shipped with no test and no deep dive on its hidden facts first |
| `pushed_into_incident` | −2 | A pushed quarter in which morale ended below 55 and an incident occurred |
| `overcommitted_and_broke_promises` | −3 | Funded more than 130% of capacity and broke at least two promises in the same quarter |

### 5.4 Two scored games

The same world, two managers. Each line under a dimension is a sub-criterion with its level and the sentence the player would read in the review.

A game played by the evidence-led manager:

```text
evidence_led in The Leaky Funnel, game 2 (hidden: camera_share 0.7, fraud_mult 0.9, reward_hunters 0.8, merchant_pull 0.4; event: The partner bank has a bad week)

Q1: steady, reserves 6%/7%; funded kyc_camera, nudges; shipped kyc_camera, nudges; profit 237 L; deep dives camera_share, fraud_mult, reward_hunters, merchant_pull
Q2: steady, reserves 6%/7%; funded fraud_v2, app_perf; shipped fraud_v2, app_perf; profit 253 L; experiments soundbox
Q3: steady, reserves 6%/7%; funded kyc_defer; shipped kyc_defer; profit 170 L; experiments kyc_defer
Q4: steady, reserves 10%/7%; funded salary_link; shipped salary_link; profit 255 L

Score 94.3 (91.3 from the sub-criteria; found_it_first +3)
  Strategy and focus: 75
    part priority_alignment: named grow for the second quarter; the open work paid most under monetise, after learning
    full roadmap_follows_priority: 68% of the engineering weeks went to the priority named that quarter
    full stranded_work: everything started was finished
  Customer and evidence: 100
    full measurement_built: measurement level 0 at the start, 2 after the second quarter, 2 after the third; something depended on it
    full learned_before_bets: 1 of 1 big or risky items were tested, or had their hidden facts read, before work began
    full experiments_acted_on: 2 of 2 experiment readings were followed (built if positive, left alone or dropped if not)
    full diagnosis: named camera_failures; the cause in this world was camera_failures, and the deep dive had been run
  Delivery and execution: 90
    full delivered_vs_best: shipped items worth 1381.1 lakh against 1860.5 for the best feasible set
    part capacity_used: 85% of the roadmap engineering weeks were used
    full roadmap_fits_capacity: 4 of 4 quarters asked for no more than the team could do
    full pace_fits_state: 0 quarter(s) where the pace did not suit morale, debt or incidents
  Quality and technical stewardship: 88
    full debt_managed: technical debt went from 58 to 47.1
    full reserves_matched: 0 of 8 reserve settings were too thin for the need, or more than the need justified
    part incident_exposure: expected incidents 55.5 per hundred quarters against 55 for a middling product (what actually happened is luck and is not counted)
    full usability_kept: usability went from 52 to 64.7
  Cross-team leadership: 88
    full commitments_kept: 6 promises kept, 0 broken (full needs at least 6 kept: promising nothing is not leadership)
    part trust_built: average trust moved +3.8; 4 of 5 teams trust the manager at least 3 more, the worst moved +0
    full morale_kept: morale went from 68 to 77.6
    na   asks_sized_to_trust: 0 of 0 requests were made when the team trusted the manager enough to grant them
    full gates_anticipated: 0 funded item-quarter(s) were stopped by a missing prerequisite
  Adaptability: 100
    full event_response: read the cause correctly, from data; chose the right response
    full event_absorbed: 50% of the hit was absorbed (live fixes, trust, measurement, reliability and the response all count)
    full expectations_calibrated: 4 of 4 quarters' profit-against-holding forecasts matched what happened
  Business value: 100
    full value_created: created 1886.3 lakh over the year and the position left behind, more than the 1368.4 for the benchmark manager who was told every hidden fact
    full paid_its_way: profit over the year was +210.3 lakh against doing nothing
    full unit_economics: everything shipped pays for itself
    full cash_safe: cash never fell below 2737 lakh (started at 2500)
    full plan_choice: chose deepen: 100% of the way from the worst plan to the best
```

A game played by the manager who ranks by estimates and never investigates:

```text
textbook in The Leaky Funnel, game 2 (hidden: camera_share 0.7, fraud_mult 0.9, reward_hunters 0.8, merchant_pull 0.4; event: The partner bank has a bad week)

Q1: steady, reserves 8%/8%; funded soundbox; shipped nothing; profit 234 L
Q2: steady, reserves 8%/8%; funded soundbox, kyc_camera, referral; shipped soundbox, kyc_camera; profit -560 L
Q3: steady, reserves 8%/8%; funded referral, lang_onboard, first_reward; shipped referral, lang_onboard, first_reward; profit 168 L
Q4: steady, reserves 8%/8%; funded support_bot, app_perf; shipped support_bot; profit 157 L

Score 37.3 (39.3 from the sub-criteria; favourite_built_blind -2)
  Strategy and focus: 38
    none priority_alignment: named activate for the second quarter; the open work paid most under monetise, with nothing learned first
    full roadmap_follows_priority: 57% of the engineering weeks went to the priority named that quarter
    part stranded_work: 1 started and not finished: app_perf
  Customer and evidence: 30
    part measurement_built: measurement level 0 at the start, 1 after the second quarter, 2 after the third; nothing depended on it
    none learned_before_bets: 0 of 2 big or risky items were tested, or had their hidden facts read, before work began
    na   experiments_acted_on: no experiments were run
    part diagnosis: named camera_failures; the cause in this world was camera_failures, with no deep dive behind the answer
  Delivery and execution: 60
    none delivered_vs_best: shipped items worth 116.4 lakh against 1860.5 for the best feasible set
    full capacity_used: 99% of the roadmap engineering weeks were used
    full roadmap_fits_capacity: 4 of 4 quarters asked for no more than the team could do
    full pace_fits_state: 0 quarter(s) where the pace did not suit morale, debt or incidents
  Quality and technical stewardship: 88
    full debt_managed: technical debt went from 58 to 45.9
    full reserves_matched: 0 of 8 reserve settings were too thin for the need, or more than the need justified
    part incident_exposure: expected incidents 53 per hundred quarters against 55 for a middling product (what actually happened is luck and is not counted)
    full usability_kept: usability went from 52 to 65.6
  Cross-team leadership: 17
    part commitments_kept: 6 promises kept, 3 broken (full needs at least 6 kept: promising nothing is not leadership)
    none trust_built: average trust moved -0.6; 2 of 5 teams trust the manager at least 3 more, the worst moved -10
    none morale_kept: morale went from 68 to 45.8
    na   asks_sized_to_trust: 0 of 0 requests were made when the team trusted the manager enough to grant them
    na   gates_anticipated: no gated item was funded
  Adaptability: 17
    part event_response: read the cause correctly, without data; chose the wrong response
    none event_absorbed: 20% of the hit was absorbed (live fixes, trust, measurement, reliability and the response all count)
    none expectations_calibrated: 0 of 4 quarters' profit-against-holding forecasts matched what happened
  Business value: 29
    none value_created: created -13.7 lakh over the year and the position left behind, against 1368.4 for the benchmark manager who was told every hidden fact
    none paid_its_way: profit over the year was -705.9 lakh against doing nothing
    none unit_economics: shipped item(s) that lose money in this world: soundbox, first_reward
    full cash_safe: cash never fell below 2173.6 lakh (started at 2500)
    part plan_choice: chose deepen: 100% of the way from the worst plan to the best, with nothing learned first
```

### 5.5 Calibration: does the score tell good play from bad?

Six scripted managers play both product-manager cases in 40 worlds each (`proto/venture/bots.ts`). They stand in for kinds of manager; none uses a language model.

| Manager | What it does |
| --- | --- |
| do_nothing | Takes no decisions |
| random | Anything valid, chosen by chance |
| feature_factory | Funds the loudest sponsor's items and everything else, cheapest first; pushes the team; keeps no reserves; promises everything; guesses the event wrong |
| debt_first | 25% reserves for debt and reliability, a relaxed pace, builds little |
| textbook | Ranks items by estimated value per week at the briefing's figures; never investigates |
| evidence_led | Instruments, deep-dives every hidden fact, tests the bets, builds what the evidence supports, sequences prerequisites, reads the event from data, picks the plan on expected value |
| oracle | Told every hidden fact and every item's real value. A benchmark, not a contender: it skips the investigation, so it scores little in the evidence dimension |

Expected ranges ("priors") for each manager were written into `run.ts` before the first run. Three of them have since been revised after seeing results; the table below marks each manager against its current range, and the revisions are set out after it. Results with the weights of 5.2, on the seeds used while tuning (1 to 40) and on seeds never looked at before the end (101 to 140):

```text
SEEDS 1-40
=== The Leaky Funnel (Marigold Pay), 40 worlds, seeds 1-40 ===
do_nothing       score   0.0  [  0-  0]  prior 0-5    ok        profit vs idle      0 L   next year vs idle (builder)      0 L   end cash   3167 L   customers 562k
random           score  36.7  [ 19- 47]  prior 30-40  ok        profit vs idle    -88 L   next year vs idle (builder)    939 L   end cash   3079 L   customers 624k
feature_factory  score  20.6  [ 10- 32]  prior 20-40  ok        profit vs idle   -554 L   next year vs idle (builder)   1453 L   end cash   2613 L   customers 671k
debt_first       score  53.0  [ 47- 60]  prior 45-55  ok        profit vs idle    222 L   next year vs idle (builder)    801 L   end cash   3389 L   customers 596k
textbook         score  50.4  [ 34- 65]  prior 40-60  ok        profit vs idle   -371 L   next year vs idle (builder)   1410 L   end cash   2796 L   customers 633k
evidence_led     score  92.9  [ 71-100]  prior 90-95  ok        profit vs idle      4 L   next year vs idle (builder)   1876 L   end cash   3171 L   customers 655k
oracle           score  71.6  [ 64- 78]  prior bench  ok        profit vs idle    190 L   next year vs idle (builder)   1850 L   end cash   3357 L   customers 658k
dimension means (0-100)
                  strategy  evidence  delivery stewardsh leadershi     adapt     value
do_nothing               0         0         0         0         0         0         0
random                  19        34        53        75         6        35        63
feature_factory         16        27        51        25        20        11        35
debt_first              25        33        60        72        85        61        71
textbook                50        22        85        88        63        34        51
evidence_led            85        95        89        88        84        94        92
oracle                  62        41        95        88        79        92        83
=== Good, Better, Best (Tallyhouse), 40 worlds, seeds 1-40 ===
do_nothing       score   0.0  [  0-  0]  prior 0-5    ok        profit vs idle      0 L   next year vs idle (builder)      0 L   end cash    102 L   customers 8k
random           score  35.2  [ 17- 51]  prior 30-40  ok        profit vs idle     30 L   next year vs idle (builder)    160 L   end cash    132 L   customers 8k
feature_factory  score  21.3  [ 12- 28]  prior 20-40  ok        profit vs idle   -134 L   next year vs idle (builder)    213 L   end cash    -31 L   customers 9k
debt_first       score  49.5  [ 42- 59]  prior 45-55  ok        profit vs idle     83 L   next year vs idle (builder)    200 L   end cash    185 L   customers 8k
textbook         score  51.0  [ 34- 65]  prior 40-60  ok        profit vs idle     65 L   next year vs idle (builder)    189 L   end cash    167 L   customers 8k
evidence_led     score  91.6  [ 79- 96]  prior 90-95  ok        profit vs idle     97 L   next year vs idle (builder)    321 L   end cash    199 L   customers 9k
oracle           score  70.7  [ 62- 78]  prior bench  ok        profit vs idle    109 L   next year vs idle (builder)    316 L   end cash    212 L   customers 9k
dimension means (0-100)
                  strategy  evidence  delivery stewardsh leadershi     adapt     value
do_nothing               0         0         0         0         0         0         0
random                  15        39        43        66        24        29        60
feature_factory         25        27        56         7        23        18        28
debt_first              25        27        61        63        74        72        71
textbook                50        27        85        75        47        22        60
evidence_led            93        88        93        69        77        89        95
oracle                  69        41        92        67        78        87        82

HELD-OUT SEEDS 101-140
=== The Leaky Funnel (Marigold Pay), 40 worlds, seeds 101-140 ===
do_nothing       score   0.0  [  0-  0]  prior 0-5    ok        profit vs idle      0 L   next year vs idle (builder)      0 L   end cash   3187 L   customers 564k
random           score  31.4  [ 12- 51]  prior 30-40  ok        profit vs idle   -186 L   next year vs idle (builder)    812 L   end cash   3001 L   customers 612k
feature_factory  score  19.6  [ 11- 31]  prior 20-40  OUTSIDE   profit vs idle   -581 L   next year vs idle (builder)   1362 L   end cash   2606 L   customers 665k
debt_first       score  53.5  [ 44- 60]  prior 45-55  ok        profit vs idle    211 L   next year vs idle (builder)    738 L   end cash   3398 L   customers 594k
textbook         score  49.2  [ 34- 66]  prior 40-60  ok        profit vs idle   -408 L   next year vs idle (builder)   1367 L   end cash   2779 L   customers 635k
evidence_led     score  91.9  [ 81-100]  prior 90-95  ok        profit vs idle     32 L   next year vs idle (builder)   1705 L   end cash   3219 L   customers 658k
oracle           score  71.4  [ 64- 81]  prior bench  ok        profit vs idle    209 L   next year vs idle (builder)   1624 L   end cash   3397 L   customers 653k
dimension means (0-100)
                  strategy  evidence  delivery stewardsh leadershi     adapt     value
do_nothing               0         0         0         0         0         0         0
random                  14        29        47        77         4        27        57
feature_factory         13        26        53        25        20        10        33
debt_first              25        33        61        73        85        63        72
textbook                46        21        86        88        60        33        52
evidence_led            84        93        87        88        81        94        91
oracle                  60        43        93        88        76        91        83
=== Good, Better, Best (Tallyhouse), 40 worlds, seeds 101-140 ===
do_nothing       score   0.0  [  0-  0]  prior 0-5    ok        profit vs idle      0 L   next year vs idle (builder)      0 L   end cash    104 L   customers 8k
random           score  31.2  [ 15- 60]  prior 30-40  ok        profit vs idle     27 L   next year vs idle (builder)    143 L   end cash    131 L   customers 8k
feature_factory  score  21.9  [ 11- 29]  prior 20-40  ok        profit vs idle   -129 L   next year vs idle (builder)    215 L   end cash    -25 L   customers 8k
debt_first       score  48.8  [ 42- 57]  prior 45-55  ok        profit vs idle     87 L   next year vs idle (builder)    189 L   end cash    191 L   customers 8k
textbook         score  51.0  [ 37- 62]  prior 40-60  ok        profit vs idle     65 L   next year vs idle (builder)    194 L   end cash    169 L   customers 8k
evidence_led     score  91.7  [ 82- 98]  prior 90-95  ok        profit vs idle     91 L   next year vs idle (builder)    361 L   end cash    195 L   customers 9k
oracle           score  71.5  [ 63- 79]  prior bench  ok        profit vs idle     99 L   next year vs idle (builder)    351 L   end cash    203 L   customers 9k
dimension means (0-100)
                  strategy  evidence  delivery stewardsh leadershi     adapt     value
do_nothing               0         0         0         0         0         0         0
random                  11        34        41        63        23        25        58
feature_factory         28        27        55         8        22        17        29
debt_first              25        27        59        63        75        74        68
textbook                51        27        85        75        45        20        61
evidence_led            92        90        93        69        79        85        95
oracle                  71        42        93        69        77        86        82
```

How to read it, without rounding in our favour:

* **The order holds in both cases and on both sets of seeds:** evidence_led, then textbook and debt_first within about four points of each other (debt_first is ahead in The Leaky Funnel and behind in Good, Better, Best), then random, then feature_factory, then do_nothing. The evidence-led manager scores 38 to 43 points above either of the two in the middle; with the weights as first written the gap was about 27. It also made the most money, about 1.8 times the next best in The Leaky Funnel and 1.5 times in Good, Better, Best, counting profit over the year plus the next year's profit under the same reference builder. The weights do not change how anyone plays, so the money is the same as before the reweighting.
* **Where each prior stands.** do_nothing (0 to 5) and textbook (40 to 60) are as first written and landed inside in all four runs. feature_factory (20 to 40), also as first written, landed inside in three of four and 0.4 under in one (19.6, The Leaky Funnel, held-out seeds). The other three ranges were revised after seeing results, as set out next, and every manager landed inside its revised range in all four runs.
* **Three ranges were revised after seeing results, on your instruction.**

  | Manager | Written before the first run | What was observed (mean of 40 games, four runs) | Range now |
  | --- | --- | --- | --- |
  | debt_first | 25 to 45 | 60 to 65 with the weights as first written; 48.8 to 53.5 with option D | 45 to 55 |
  | random | 15 to 35 | 31.2 to 36.7 | 30 to 40 |
  | evidence_led | 65 to 90 | 91.6 to 92.9 | 90 to 95 |

  The debt_first expectation failed because most of the stewardship, leadership, adaptability and value sub-criteria reward the absence of harm, and a manager who builds little and breaks nothing collects them; the weights were changed (5.6) before its range was. The random and evidence_led ranges were set to fit what was observed, so landing inside them shows nothing about whether the original expectations were right: on the original ranges, random was just above (36.7 and 35.2) on the tuning seeds and evidence_led was above in every run. The ranges apply to a mean over 40 games; single games vary far more (evidence_led scored from 71 to 100). No other range was touched.
* **The top of the scale can be won.** evidence_led reaches 100 in a few worlds, which takes a flawless game. The benchmark manager is a heuristic, not a true optimum, and it can be beaten: the first example in 5.4 beats it.
* **Things changed after seeing results** (so you know what the table does and does not show): the value of an item is measured over two years and by simulating forward, not by one quarter's change; the sub-criterion `value_created` is judged against the informed manager, not against doing nothing; `measurement_built` is capped at part unless something used the measurement; `trust_built` needs three teams up, not just the average; the cut for `value_created` was raised from 60% and 30% to 75% and 40%; the dimension weights were changed from 15, 15, 15, 15, 15, 10, 15 to 20, 20, 15, 10, 10, 10, 15 and six sub-criteria were doubled (5.6); the feature_factory manager was fixed so that it really overcommits; the drift constants for technical debt and usability were set so that doing nothing neither improves nor ruins them; each hidden fact was given a briefing figure that differs from the true range; and the expected ranges for debt_first, random and evidence_led were revised (above). Seeds 101 to 140 were run only after the changes before the reweighting were final. I had seen their results under the first weights before the weights were changed, so they are not fully held out for that last change; the choice of option D was made from the comparison on seeds 1 to 40.
* **Not verified:** whether a person plays like any of these managers; whether the sub-criteria are fair to a person who plays differently but well (for example, who builds the bets first and learns by shipping); the effect sizes against any real product; the narrative text. Calibrating with a handful of human playtests is the next real test.

### 5.6 Why these weights

With the weights as first written (15, 15, 15, 15, 15, 10, 15, every sub-criterion equal), a manager who only paid down debt and built little scored 60 to 65. To choose a fix I re-scored the same games under three other weightings of the same sub-criteria. Nothing about play changes, only how much each sub-criterion is worth (before modifiers, seeds 1 to 40). A is the weighting as first written. B moves weight to strategy and evidence (20, 20, 15, 10, 10, 10, 15). C counts six sub-criteria double: `value_created`, `delivered_vs_best`, `priority_alignment`, `diagnosis`, `plan_choice` and `learned_before_bets`, the ones that ask whether the manager found and built the right thing. D is both, and it is the one now in use.

```text
=== The Leaky Funnel: score of each manager under other weightings, seeds 1-40 (before modifiers) ===
                       A:       B:       C:       D:
do_nothing            0.0      0.0      0.0      0.0
random               43.1     42.1     41.1     39.6
feature_factory      28.7     29.1     27.8     27.5
debt_first           65.1     61.6     57.5     53.0
textbook             61.7     58.5     56.2     52.4
evidence_led         89.1     89.5     89.7     90.0
oracle               79.8     77.5     75.4     72.2

=== Good, Better, Best: score of each manager under other weightings, seeds 1-40 (before modifiers) ===
                       A:       B:       C:       D:
do_nothing            0.0      0.0      0.0      0.0
random               42.1     40.9     40.1     38.4
feature_factory      27.7     29.8     27.4     28.2
debt_first           60.6     57.6     53.5     49.5
textbook             59.9     58.9     54.3     52.0
evidence_led         84.8     86.3     87.3     88.8
oracle               76.5     75.8     72.8     71.0

A: as first written
B: more weight on strategy and evidence (20,20,15,10,10,10,15)
C: outcome and judgement sub-criteria count double
D: B and C together (adopted)
```

Reweighting the dimensions alone (B) moved debt_first by about 3 points, which was not enough. Counting the judgement sub-criteria double (C) moved it by 7 to 8. Both together (D) put debt_first and textbook in the low 50s, kept evidence_led at about 90, and widened the gap between the evidence-led manager and the two in the middle from about 27 points to about 38 to 43. Column D matches the scores in 5.5 before modifiers (for example debt_first at 53.0 and 49.5); the scores in 5.5 also include the modifiers of 5.3, which is why evidence_led is a few points higher there.

D has a cost worth knowing. It moves credit from hygiene to judgement, so a manager who is careful and unambitious now scores about 50. The six doubled sub-criteria carry 42% of the score when they all apply, so a game with perfect hygiene and every judgement call wrong cannot reach more than about 58 before modifiers. Whether that is the right balance for a real product manager is not something this prototype can show; it needs people to play it.

## 6. Case 3: The Leaky Funnel (Marigold Pay)

### The company

Marigold Pay is a three-year-old payments app in India. It started with person-to-person transfers and added bill payments, a salary-linked account for urban employees, and a QR code for small shops. About 6 lakh people use it in a quarter. It earns from a fee on merchant payments, from a share of credit arranged with a partner bank, and from small charges on some transfers. It makes a profit of roughly ₹2 crore a quarter and has ₹25 crore in the bank.

### You

You are the product manager for sign-up and activation. Your squad is eight engineers, three designers and two analysts. The Head of Product is your manager and the chief executive sits in your quarterly reviews. Nobody on the team can say exactly where people drop out of sign-up, because the app records installs and payments and little in between.

### The problem

Of every 100 people who start signing up, 13 new-to-digital users, 28 salaried users and 13 merchants make a first payment. The biggest leak is identity verification: only 36 of every 100 new-to-digital registrants finish it. The marketing budget is ₹8 crore a quarter, so every person who leaves at verification is money already spent. The board wants the funnel fixed in a year without hurting the profit.

### The voices

| Who | What they say | What is behind it |
| --- | --- | --- |
| Support lead | "Most verification complaints are people who could not get the camera to read the card." | Stated as 65%; the truth lies between 35% and 75% (decides the root cause) |
| Head of growth | "Rivals pay people to join. A first-payment reward and a referral programme will move the number this quarter." | The reward's damage depends on how many people take it and leave |
| Chief executive | "Merchants will love the soundbox. I met three of them at a fair and they did not want to give it back." | Stated as 0.7; the truth lies between 0.15 and 0.95 |
| Risk and compliance | "If people pay before they are verified, fraud will rise. By how much depends on how many we let through." | Stated as 1.2 times today's losses; the truth lies between 0.9 and 2.6 times |
| Engineering lead | "Every change to the identity service takes twice as long as it should. Give us time to clean it." | Technical debt starts at 58 |
| Partner bank, regulator | "We watch your failure rate. The regulator reviews identity every year." | Outside trust starts at 44, which blocks two valuable items |

### The data

| Segment | Arrive a quarter | → Registered | → Identity verified | → First payment | Reach first payment | Losses a quarter | Revenue per customer a quarter (₹) | Cost to serve (₹) | Customers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New-to-digital payers | 4,20,000 | 70% | 36% | 52% | 13.1% | 20% | 140 | 38 | 2,90,000 |
| Salaried urban users | 1,80,000 | 78% | 55% | 66% | 28.3% | 18% | 520 | 70 | 2,70,000 |
| Micro-merchants | 60,000 | 64% | 42% | 48% | 12.9% | 18% | 980 | 210 | 46,000 |

| Starting position | Value |
| --- | --- |
| Squad | 8 engineers, 3 designers, 2 analysts, the product manager |
| Engineering weeks for the roadmap in a quarter, at steady pace | 40.1 (of 44.6 after reserves; 96 before overhead, debt and morale) |
| Revenue a quarter | 2,235 L |
| Squad and company cost a quarter | 791 L (the squad is 122 L of it) |
| Marketing a quarter | 800 L |
| Cost to serve customers, and per-step costs | 437 L |
| Profit a quarter if nothing changes | 207 L |
| Cash | 2,500 L |
| Technical debt (0 clean, 100 crippling) | 58 |
| Reliability (0-100) | 62 |
| Usability (0-100) | 52 |
| Morale (0-100) | 68 |
| Trust in the product manager | engineering 62, design 58, business 50, leadership 55, outside (regulator, bank) 44 |
| Measurement level | 0 (0 none, 1 core events, 2 full funnel) |
| Incidents in a middling quarter | 0.55 |

One quarter with nothing changed:

| Segment | Arrive | Registered | Identity verified | First payment | Customers at start | At end | Average | Revenue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New-to-digital payers | 4,20,000 | 2,94,000 | 1,05,840 | 55,037 | 2,90,000 | 2,85,262 | 2,87,631 | 402.7 L |
| Salaried urban users | 1,80,000 | 1,40,400 | 77,220 | 50,965 | 2,70,000 | 2,70,713 | 2,70,356 | 1405.9 L |
| Micro-merchants | 60,000 | 38,400 | 16,128 | 7,741 | 46,000 | 45,180 | 45,590 | 446.8 L |

Revenue 2,235 L, cost to serve and per-step costs 437 L, squad and company 791 L, marketing 800 L, so profit 207 L.

### What is hidden

| Hidden fact | What it is, and where the briefing's figure comes from | The briefing says | In any one game it is somewhere in | What it moves |
| --- | --- | --- | --- | --- |
| **camera_share** | Of the people who fail identity verification, the share who fail at the camera step rather than at document rules or mismatches. Support says most of it is the camera. | 0.65 | 0.35 to 0.75 | Identity-check camera guidance and retry; decides the root cause: camera_failures at 0.55 or more, otherwise process_friction |
| **fraud_mult** | Fraud losses, as a multiple of today's, if people can pay before verification finishes. The risk team's number was made when the plan was a small pilot. | 1.2 | 0.9 to 2.6 | Verify after the first payment |
| **reward_hunters** | The share of people who take the first-payment reward and leave once it is spent. Growth's figure comes from a campaign that targeted loyal users. | 0.4 | 0.15 to 0.85 | First-payment reward |
| **merchant_pull** | How much merchants really value the soundbox, as a share of the benefit the chief executive expects. Taken from three merchants they met. | 0.7 | 0.15 to 0.95 | Merchant QR soundbox integration |

### The root-cause question

The player is asked, every quarter, which of these they believe is behind the leak. The true answer is decided by the first hidden fact above.

- People fail the identity camera step
- The identity flow asks too much
- There is no reason to make a first payment
- The app is too unreliable
- I need more data (an honest answer early, a weak one late)

### What the effects mean, worked through

Identity-check camera guidance and retry, in New-to-digital payers, on Identity verified, once it has been live for a full quarter:

```text
written lift                     13.0%
x usability factor               0.856     (0.7 + 0.3 x 52 / 100)
x understanding factor           0.962     (0.85 + 0.15 x 0.75)
x this game's multiplier         1.000     (the preview uses 1; a real game draws it around 1)
x hidden fact / briefing figure  1.000     (the preview uses the briefing's figure)
= lift that applies              10.69%
conversion                       36.0% -> 39.8%
```

| Quarter | Customers at the end, item not built | Item live from the start | Difference | Revenue difference | Profit difference |
| --- | --- | --- | --- | --- | --- |
| 1 | 6,01,155 | 6,09,587 | 8,432 | 11.9 L | 9.5 L |
| 2 | 5,97,147 | 6,12,399 | 15,252 | 33.6 L | 26.8 L |
| 3 | 5,93,803 | 6,14,584 | 20,781 | 51.2 L | 40.9 L |
| 4 | 5,90,984 | 6,16,261 | 25,278 | 65.7 L | 52.5 L |

The difference grows because the extra people who get through stay as customers, and each quarter adds more.

### What can be built

Effects are relative changes to a rate. "Identity verified +13%" takes a 36% completion rate to about 40%, not to 49%. A running cost or one-off cost is paid in full whether or not the item works.

| Item | What it is | Engineering / design / analyst weeks | Understood at the start | Sponsor | Needs first | What it does when it works (at the briefing's figures) | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Identity-check camera guidance and retry** | Guided capture for the identity photo: framing hints, glare warnings, one automatic retry. | 18 / 4 / 0 | 60% | engineering | none | New-to-digital payers: Identity verified +13%; Salaried urban users: Identity verified +5%; Micro-merchants: Identity verified +9% | - |
| **Verify after the first payment** | Let people make a first payment before verification finishes, with a low limit until it does. | 30 / 6 / 1 | 35% | leadership | outside (regulator, bank) trust at least 50, or Fraud rules engine v2 live | New-to-digital payers: Identity verified +49%, First payment −8%; Salaried urban users: Identity verified +33%, First payment −5%; Micro-merchants: Identity verified +43%, First payment −7%; running cost 137 L a quarter at the briefing's fraud_mult, cut 65% by Fraud rules engine v2 | big, risky |
| **First-payment reward** | A small cashback on the first successful payment. | 9 / 2 / 0 | 80% | business | none | New-to-digital payers: First payment +33%, losses up 11%; Salaried urban users: First payment +13%, losses up 5%; Micro-merchants: First payment +11%, losses up 3%; pays ₹45 per new first payer | risky |
| **Regional-language onboarding** | Onboarding and error messages in six regional languages. | 18 / 8 / 0 | 60% | design | none | New-to-digital payers: Registered +8%, Identity verified +9%; Salaried urban users: Registered +2%; Micro-merchants: Identity verified +3% | - |
| **Support deflection assistant** | An assistant that answers the twenty commonest support questions without a person. | 18 / 2 / 0 | 70% | business | none | New-to-digital payers: losses cut 1%, cost to serve −7%; Salaried urban users: losses cut 1%, cost to serve −7%; Micro-merchants: losses cut 1%, cost to serve −7% | - |
| **Salary-account linking and credit offers** | Link a salary account and offer credit against it. Needs the partner bank's confidence. | 24 / 4 / 0 | 50% | leadership | outside (regulator, bank) trust at least 45 | Salaried urban users: First payment +1%, revenue per customer +6% | - |
| **Merchant QR soundbox integration** | Integrate a QR speaker so merchants hear each payment. Marigold subsidises the device, about ₹1,800 for each of its 46,000 merchants. The chief executive's favourite. | 30 / 4 / 0 | 40% | leadership | none | Micro-merchants: First payment +18%, losses cut 27%, revenue per customer +33%; one-off cost 817 L | big, sponsor's favourite |
| **Fraud rules engine v2** | A rules engine that scores each payment before it clears. Needed before verification can be deferred safely. | 18 / 0 / 3 | 50% | outside (regulator, bank) | measurement level 1 | Salaried urban users: First payment +2%; Micro-merchants: First payment +2% | - |
| **Low-end Android performance** | Make the app fast on 2 GB phones: smaller bundles, fewer cold starts. | 12 / 0 / 0 | 80% | engineering | none | New-to-digital payers: Registered +4%, losses cut 2%; Salaried urban users: losses cut 1%; technical debt -2; reliability +4 | - |
| **Smart nudges** | Timely reminders to finish verification and to make a first payment. | 6 / 2 / 0 | 80% | business | none | New-to-digital payers: First payment +1%, losses cut 1%; Salaried urban users: First payment +1%, losses cut 1%; Micro-merchants: First payment +1%, losses cut 1% | - |
| **Referral programme** | Pay a user and their friend when the friend makes a first payment. | 15 / 4 / 0 | 60% | business | none | New-to-digital payers: more people arrive +9%; Salaried urban users: more people arrive +5%; pays ₹60 per extra customer it brings | - |
| **Funnel event instrumentation** | Record every step of the funnel as events, so the team can see where people leave. Raises measurement to level 2. | 9 / 0 / 2 | 90% | engineering | none | nothing directly; technical debt -1; measurement level 2 | - |
| **Identity-service refactor** | Rebuild the identity service that every release has to work around. Pays down technical debt. | 24 / 0 / 0 | 60% | engineering | none | nothing directly; technical debt -12; reliability +3 | - |

### The four quarters

* **Quarter 1, "The review".** The board has just met. The player sees the funnel, the voices, and that measurement is at level 0. *Template:* "Of every 100 people who start signing up, {first_payers_new} new-to-digital users make a first payment. The board gave you {road} weeks of engineering to change that. You cannot yet see where people stop."
* **Quarter 2, "First results".** *Template:* "{shipped} shipped last quarter. Profit was {profit}, {delta} against holding still. {learned}. {who_is_pleased}."
* **Quarter 3, "The shock".** One of the three events (below) arrives. *Template:* the event's signal, then the five steps of 3.7.
* **Quarter 4, "The term sheet".** *Template:* "The board will back one of three plans for next year. Your position: usability {U}, reliability {R}, technical debt {D}, engineering trust {eng}, outside trust {ext}."

### The events

**The regulator tightens identity rules** (35% of games)
- What the team sees: Verification completions fell across every segment in one week, and the compliance desk has a new circular.
- What is happening: A new rule requires a second identity factor. Completion drops until the flow is rebuilt around it.
- Causes offered: A rule changed / We shipped a bug / A fraud wave hit. The true one: A rule changed.
- Responses offered: Rebuild to the new rule at once / Ask the regulator for time / Pause any shortcut and wait. The right one: Rebuild to the new rule at once.
- Damage if nothing absorbs it (full in the quarter it hits, half in the next): New-to-digital payers: Identity verified −15%; Salaried urban users: Identity verified −15%; Micro-merchants: Identity verified −15%.
- What absorbs it: Identity-check camera guidance and retry live (25%); outside (regulator, bank) trust 55+ (20%); measurement level 1 (10%). Reading the cause from data adds 15%, from a guess 5%; the right response adds 10%.

**The partner bank has a bad week** (35% of games)
- What the team sees: Payments are timing out and support tickets say money left accounts and did not arrive.
- What is happening: The partner bank's settlement rail fails twice. Users who were mid-payment lose trust in you, not in the bank.
- Causes offered: The partner is failing / Our release broke payments / Fraud controls are blocking real payments. The true one: The partner is failing.
- Responses offered: Fail over and tell users plainly / Wait for the bank / Roll back our last release. The right one: Fail over and tell users plainly.
- Damage if nothing absorbs it (full in the quarter it hits, half in the next): New-to-digital payers: First payment −8%, losses up 8%; Salaried urban users: First payment −10%, losses up 8%; Micro-merchants: First payment −10%, losses up 10%; about 1.2 extra incidents.
- What absorbs it: reliability 70+ (35%); Low-end Android performance live (10%); engineering trust 60+ (15%). Reading the cause from data adds 15%, from a guess 5%; the right response adds 10%.

**A rival starts a cashback war** (30% of games)
- What the team sees: New installs are cheaper for the rival and our newest users are leaving for it within weeks.
- What is happening: A funded rival pays people to switch. The users you are least able to keep are the ones who leave first.
- Causes offered: A rival is paying to win users / Our app got worse / A seasonal dip. The true one: A rival is paying to win users.
- Responses offered: Keep our best users, do not match the offer / Match the cashback / Ignore it. The right one: Keep our best users, do not match the offer.
- Damage if nothing absorbs it (full in the quarter it hits, half in the next): New-to-digital payers: more people arrive −20%, losses up 15%; Salaried urban users: more people arrive −10%, losses up 8%; Micro-merchants: losses up 4%.
- What absorbs it: Smart nudges live (20%); First-payment reward live (15%); Merchant QR soundbox integration live (10%). Reading the cause from data adds 15%, from a guess 5%; the right response adds 10%.

### The plans on the term sheet

| Plan for next year | The pitch | People arriving | Revenue per customer | Cost to serve | Losses | Marketing | What has to be true |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Acquire hard** | Spend heavily on installs next year and live with what it costs. | ×1.35 | same | same | same | ×1.4 | usability ≥ 55, reliability ≥ 60 |
| **Deepen the base** | Earn more from the people you already have: credit, merchants, fewer exits. | same | ×1.14 | same | ×0.95 | same | usability ≥ 50, outside (regulator, bank) trust ≥ 50 |
| **Profit first** | Cut acquisition spend and cost to serve, and let the base run. | ×0.88 | same | ×0.88 | same | ×0.7 | technical debt < 70 |

## 7. Case 4: Good, Better, Best (Tallyhouse)

### The company

Tallyhouse sells time tracking and project profitability software to creative agencies: design studios, advertising shops, web agencies. About 7,800 accounts pay, from solo freelancers to a few networks with forty offices. Revenue is about ₹7 crore a quarter, costs are about ₹8 crore, and the company loses roughly ₹60 lakh a quarter. There is ₹4 crore in the bank, enough for about six quarters. The chief executive has to show a route to profit within four quarters or the next round is gone.

### You

You are the product manager for the core product. Your squad is seven engineers, two designers and two analysts. Measurement is at level 1: you can see trial starts and payments, not what happens between.

### The problem

Growth has plateaued on one plan at one price. Only 2.5 of every 100 solo trials end up paying, and 8 of every 100 mid-size and enterprise trials. Every team has a theory:

| Who | What they say | What is behind it |
| --- | --- | --- |
| Head of sales | "Three network deals died on security reviews. Give me single sign-on and an audit log and I will close them." | Stated as 0.75 of the upside being real; the truth lies between 0.15 and 0.95 |
| Finance lead | "Billing complaints are a quarter of the tickets. It is not the problem." | Stated as 0.25; the truth lies between 0.15 and 0.50, and if it is 0.38 or more billing is the root cause |
| Customer success | "Heavy users keep asking to pay for more. A usage add-on will sell itself." | Stated as 1.1; the truth lies between 0.4 and 1.4 |
| The chair of the board | "One price for everybody leaves money on the table." | Stated as 0.9 for how hard conversion falls with repackaging; the truth lies between 0.6 and 2.0 |
| Head of engineering | "The billing module has caused every outage this year and nobody wants to touch it." | Technical debt starts at 64 |
| Design lead | "Trials get lost in the first session." | Usability starts at 48 |

### The data

| Segment | Arrive a quarter | → Trial activated | → Upgrade considered | → Paid | Reach paid | Losses a quarter | Revenue per customer a quarter (₹) | Cost to serve (₹) | Customers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Solo and small studios | 20,000 | 45% | 10% | 55% | 2.5% | 9% | 2,100 | 380 | 4,800 |
| Mid-size agencies | 1,800 | 60% | 35% | 40% | 8.4% | 5% | 14,000 | 2,100 | 2,800 |
| Networks and enterprise | 140 | 70% | 40% | 30% | 8.4% | 4% | 95,000 | 12,000 | 250 |

| Starting position | Value |
| --- | --- |
| Squad | 7 engineers, 2 designers, 2 analysts, the product manager |
| Engineering weeks for the roadmap in a quarter, at steady pace | 32.2 (of 35.8 after reserves; 84 before overhead, debt and morale) |
| Revenue a quarter | 725 L |
| Squad and company cost a quarter | 437 L (the squad is 105 L of it) |
| Marketing a quarter | 230 L |
| Cost to serve customers, and per-step costs | 126 L |
| Profit a quarter if nothing changes | -68 L |
| Cash | 400 L |
| Technical debt (0 clean, 100 crippling) | 64 |
| Reliability (0-100) | 66 |
| Usability (0-100) | 48 |
| Morale (0-100) | 64 |
| Trust in the product manager | engineering 58, design 52, business 45, leadership 60, outside (regulator, bank) 55 |
| Measurement level | 1 (0 none, 1 core events, 2 full funnel) |
| Incidents in a middling quarter | 0.5 |

One quarter with nothing changed:

| Segment | Arrive | Trial activated | Upgrade considered | Paid | Customers at start | At end | Average | Revenue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Solo and small studios | 20,000 | 9,000 | 900 | 495 | 4,800 | 4,837 | 4,818 | 101.2 L |
| Mid-size agencies | 1,800 | 1,080 | 378 | 151 | 2,800 | 2,796 | 2,798 | 391.7 L |
| Networks and enterprise | 140 | 98 | 39 | 12 | 250 | 250 | 250 | 237.7 L |

Revenue 725 L, cost to serve and per-step costs 126 L, squad and company 437 L, marketing 230 L, so profit -68 L.

### What is hidden

| Hidden fact | What it is, and where the briefing's figure comes from | The briefing says | In any one game it is somewhere in | What it moves |
| --- | --- | --- | --- | --- |
| **elasticity** | How hard paid conversion falls when the plans are repackaged. Sales says customers will not mind. | 0.9 | 0.6 to 2 | Three-tier packaging |
| **addon_wtp** | What customers will pay for a usage add-on, relative to what customer success heard in renewal calls. | 1.1 | 0.4 to 1.4 | Usage-based add-on |
| **billing_share** | The share of customer losses that billing errors cause. Finance counts only tickets filed as billing complaints. | 0.25 | 0.15 to 0.5 | Billing module rewrite; decides the root cause: billing_quality at 0.38 or more, otherwise packaging |
| **ent_pipeline** | The share of the enterprise upside that single sign-on would really unlock; other things also stall large deals. Sales counts every lost deal that mentioned security. | 0.75 | 0.15 to 0.95 | Single sign-on and audit log |

### The root-cause question

- Billing errors are driving people away
- The plans do not fit what people will pay
- We lack what big buyers need
- Trials are not getting started
- I need more data (an honest answer early, a weak one late)

### What the effects mean, worked through

Guided set-up, in Solo and small studios, on Trial activated, once it has been live for a full quarter:

```text
written lift                     19.8%
x usability factor               0.844     (0.7 + 0.3 x 48 / 100)
x understanding factor           0.978     (0.85 + 0.15 x 0.85)
x this game's multiplier         1.000     (the preview uses 1; a real game draws it around 1)
x hidden fact / briefing figure  1.000     (the preview uses the briefing's figure)
= lift that applies              16.34%
conversion                       45.0% -> 52.4%
```

| Quarter | Customers at the end, item not built | Item live from the start | Difference | Revenue difference | Profit difference |
| --- | --- | --- | --- | --- | --- |
| 1 | 7,883 | 8,009 | 126 | 2.1 L | 0.6 L |
| 2 | 7,911 | 8,151 | 240 | 6.2 L | 4 L |
| 3 | 7,934 | 8,278 | 344 | 10 L | 7.1 L |
| 4 | 7,953 | 8,392 | 439 | 13.4 L | 10 L |

The difference grows because the extra people who get through stay as customers, and each quarter adds more.

### What can be built

Effects are relative changes to a rate, as in case 3. "Paid −24%" takes 55 of every 100 solo trial users who consider upgrading down to about 42; it only touches the new customers each quarter, which is why a large fall can cost little while a small rise in revenue per customer, which applies to the whole base, can pay for it.

| Item | What it is | Engineering / design / analyst weeks | Understood at the start | Sponsor | Needs first | What it does when it works (at the briefing's figures) | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Guided set-up** | Guided set-up: import clients, invite a teammate, log a first timesheet. | 15 / 6 / 0 | 70% | design | none | Solo and small studios: Trial activated +20%, Upgrade considered +7%; Mid-size agencies: Trial activated +11% | - |
| **Three-tier packaging** | Replace the single plan with three tiers: Good, Better, Best. | 12 / 6 / 2 | 50% | business | measurement level 1 | Solo and small studios: Paid −24%, revenue per customer +5%; Mid-size agencies: Paid −20%, revenue per customer +6%; Networks and enterprise: revenue per customer +4% | risky |
| **Usage-based add-on** | A metered add-on for the heaviest users (projects, exports, storage). | 24 / 4 / 2 | 40% | business | measurement level 1 | Mid-size agencies: losses cut 2%, revenue per customer +15%; Networks and enterprise: revenue per customer +13%; running cost 47 L a quarter | big, risky |
| **Annual-plan upsell** | A discount for paying annually, in the app and at renewal. | 9 / 2 / 0 | 80% | business | none | Solo and small studios: Paid +7%, losses cut 32%, revenue per customer −4%; Mid-size agencies: losses cut 21%, revenue per customer −3% | - |
| **Single sign-on and audit log** | Single sign-on and an audit log, which security reviews at large agencies demand. The sales head's favourite. | 27 / 4 / 0 | 60% | business | none | Networks and enterprise: Paid +119%, losses cut 34%; Mid-size agencies: Paid +17%; running cost 29 L a quarter | big, sponsor's favourite |
| **Billing module rewrite** | Rewrite the billing module (proration, taxes, invoices) behind every outage this year. Pays down technical debt. | 36 / 2 / 1 | 40% | engineering | none | Solo and small studios: losses cut 16%; Mid-size agencies: losses cut 13%; Networks and enterprise: losses cut 11%; technical debt -14; reliability +6 | big |
| **Accounting integrations** | Sync with the three accounting tools agencies use. | 24 / 4 / 0 | 60% | business | none | Mid-size agencies: Paid +17%, losses cut 10%; Solo and small studios: Paid +10% | - |
| **Mobile timesheets** | A mobile timesheet for people who bill by the hour. | 21 / 8 / 0 | 60% | design | none | Solo and small studios: Trial activated +9%, losses cut 7%; Mid-size agencies: losses cut 9% | - |
| **Profitability dashboards** | Profitability dashboards: margin by client, by project, by person. | 18 / 6 / 0 | 60% | business | none | Mid-size agencies: losses cut 2%, revenue per customer +3%; Networks and enterprise: revenue per customer +2% | - |
| **Design system rollout** | Roll out one component library across the app. | 15 / 12 / 0 | 70% | design | none | Solo and small studios: Trial activated +4%; Mid-size agencies: Trial activated +3%; technical debt -4; usability +10 | - |
| **Performance and reliability sprint** | A sprint on speed and uptime. | 15 / 0 / 0 | 80% | engineering | none | Solo and small studios: losses cut 3%; Mid-size agencies: losses cut 3%; Networks and enterprise: losses cut 3%; technical debt -2; reliability +12 | - |
| **In-app upgrade flow** | In-app prompts and a one-page upgrade flow at the moments people hit a limit. | 12 / 4 / 0 | 70% | business | none | Solo and small studios: Upgrade considered +22%; Mid-size agencies: Upgrade considered +10% | - |
| **Product analytics pipeline** | Record every step of the funnel as events, so the team can see where people leave. Raises measurement to level 2. | 9 / 0 / 2 | 90% | engineering | none | nothing directly; technical debt -1; measurement level 2 | - |

### The four quarters

* **Quarter 1, "The runway".** *Template:* "{cash} lakh in the bank and a loss of {loss} a quarter: {quarters_left} quarters of money. Your squad has {road} weeks."
* **Quarter 2, "First results".** Same template as case 3.
* **Quarter 3, "The shock".** One of the three events below.
* **Quarter 4, "The term sheet".** The three plans below.

### The events

**A network of agencies leaves for a rival** (35% of games)
- What the team sees: The largest customer group has gone quiet and asked for a call about security reviews.
- What is happening: A network with forty offices says it cannot stay without single sign-on and an audit trail.
- Causes offered: We lack what large buyers need / We are too expensive / Billing errors upset them. The true one: We lack what large buyers need.
- Responses offered: Commit to the missing features with dates / Offer a discount / Wait and see. The right one: Commit to the missing features with dates.
- Damage if nothing absorbs it (full in the quarter it hits, half in the next): Networks and enterprise: Paid −10%, losses up 25%; Mid-size agencies: losses up 3%.
- What absorbs it: Single sign-on and audit log live (35%); business trust 55+ (15%); Profitability dashboards live (10%). Reading the cause from data adds 15%, from a guess 5%; the right response adds 10%.

**A rival undercuts the mid tier** (35% of games)
- What the team sees: Upgrades from trial are slipping and sales say prospects keep quoting a competitor's price.
- What is happening: A funded rival halves its price for agencies of your size.
- Causes offered: A competitor is cutting price / Our onboarding got worse / A seasonal dip. The true one: A competitor is cutting price.
- Responses offered: Repackage and sell value, do not match the price / Match the price / Ignore it. The right one: Repackage and sell value, do not match the price.
- Damage if nothing absorbs it (full in the quarter it hits, half in the next): Mid-size agencies: Paid −12%, revenue per customer −5%; Solo and small studios: Paid −8%.
- What absorbs it: Three-tier packaging live (25%); Annual-plan upsell live (15%); measurement level 1 (10%). Reading the cause from data adds 15%, from a guess 5%; the right response adds 10%.

**A security scare reaches the press** (30% of games)
- What the team sees: A researcher has posted about a flaw in file sharing, and trial sign-ups have dipped.
- What is happening: The flaw is real and already patched in your head, but nobody outside knows that.
- Causes offered: A real flaw was found / A rumour with nothing behind it / A rival is spreading it. The true one: A real flaw was found.
- Responses offered: Disclose, patch, and tell customers / Deny it / Fix it quietly. The right one: Disclose, patch, and tell customers.
- Damage if nothing absorbs it (full in the quarter it hits, half in the next): Solo and small studios: Trial activated −5%, losses up 6%; Mid-size agencies: Trial activated −5%, losses up 6%; Networks and enterprise: losses up 6%; about 1.5 extra incidents.
- What absorbs it: reliability 70+ (30%); Performance and reliability sprint live (15%); engineering trust 60+ (15%). Reading the cause from data adds 15%, from a guess 5%; the right response adds 10%.

### The plans on the term sheet

| Plan for next year | The pitch | People arriving | Revenue per customer | Cost to serve | Losses | Marketing | What has to be true |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Move up-market** | Build for large buyers: security, sign-on, support, longer deals. | ×0.95 | ×1.18 | ×1.05 | ×0.9 | ×1.1 | reliability ≥ 65, business trust ≥ 55 |
| **Own self-serve** | Make buying frictionless and win on volume. | ×1.3 | ×0.97 | same | same | ×1.3 | usability ≥ 55 |
| **Reach profit** | Cut spend, simplify, and stop losing money. | ×0.9 | ×1.05 | ×0.85 | same | ×0.75 | technical debt < 65 |

## 8. The other six cases

These are the premises as they were agreed, before anything was built; all six are now built ("What was built", below the table). All six run on the same company model (section 3). What changes with the seat is what the player controls, which numbers the screen leads with, which facts are hidden, the words the screens use (`terms` in the scenario) and the weights of the dimensions. The scoring rule in 5.1 is the same for every seat.

| Case | The player | Controls, each quarter | Hidden facts | Events (one arrives in quarter 3) | Plans for the year after |
| --- | --- | --- | --- | --- | --- |
| **5. Eighteen Months** (chief executive) | Chief executive of Harbour & Loom, a home-textile brand selling on its own site, on marketplaces and on quick-commerce apps, with 400 people and 18 months of cash | Where the money goes across channels, product lines and prices; hiring and freezes by function; supplier contracts; when to raise money and on what terms; which leader to back or replace | The real margin of the quick-commerce channel after returns and discounts (the sales head's number is flattering); how reliable the main supplier is; how long investors' appetite lasts | A supplier fire; a rival's price war; a senior leader resigns | Expand, consolidate, or raise now |
| **6. Both Sides of the Market** (growth and strategy head) | Growth and strategy head at Nestwork, a marketplace where households book cleaners and electricians | Which city to open next; provider incentives against customer promotions; the take rate; channel mix; a subscription; a partnership | How many providers a city needs before bookings stop failing; the real repeat rate; how good the partner channel's customers are | A rival launches with subsidies; a ruling that reclassifies providers; a seasonal collapse | Deepen three cities, open six, or go for profit |
| **7. Debt Due** (developer) | Tech lead at Brightkart, whose checkout and order service has nine engineers, a sale day coming and a backlog of shortcuts | The split of the quarter between features, reliability, security and debt; architecture choices; hiring and onboarding; on-call and incident practice; test and release investment | Where the real bottleneck is (database locks, the deploy pipeline or flaky tests); which dependency is out of support; the cause of the last outage | An outage on sale day; a critical vulnerability disclosed in a dependency; the strongest engineer resigns | Modernise in steps, rewrite, or hold and ship |
| **8. One Platform** (developer) | Tech lead after Fieldnote (field-service app) and Ledgerly (invoicing) merged into Fieldledger, with two stacks and two customer bases | Migration order; team topology; API contracts; data migration; freeze windows; observability; deprecation dates promised to customers | How tightly the old systems are coupled; how dirty the data is; which customers depend on legacy quirks | A key customer escalates; the one person who understands a legacy module leaves; a compliance audit | One platform in a year, two with a bridge, or keep both |
| **9. Seven Taps** (designer) | Design lead at Kestrel Bank, where paying a bill takes seven taps and 38% of people give up | Research against building; what to redesign; design-system investment; accessibility work; the quality of hand-off; how critique runs | Whether people fail on the flow, the words or trust; the real accessibility gaps; whether the abandonment is mostly older users | An accessibility complaint reaches the regulator; a rebrand is ordered from above; an executive asks for a pet redesign | Redesign the core, build a system, or fix the worst tasks |
| **10. Every Rider** (designer) | Design lead at Wayfare, a city transit app used on low-end phones, in six languages, by commuters including people who cannot see | Who is recruited for research; languages and scripts; performance budgets; accessibility testing; how live delays are shown; design operations | The one task riders fail most; which languages matter in which neighbourhoods; how much people need offline use | A strike day triples traffic; a press story on accessibility; a rival ships an update | Inclusive core, speed first, or new features |

How the rubric moves with the seat. These weights are the ones now in use (`tools/venture/common.ts`); every seat doubles the same six judgement sub-criteria as the product manager, and none of the other seats' weights has been reviewed by a person who does that job:

| Dimension | Product manager | Chief executive | Growth and strategy | Developer | Designer |
| --- | --- | --- | --- | --- | --- |
| Strategy and focus | 20 | 20 | 20 | 10 | 10 |
| Customer and evidence | 20 | 10 | 15 | 10 | 20 |
| Delivery and execution | 15 | 10 | 10 | 20 | 15 |
| Quality and stewardship | 10 | 10 | 5 | 25 | 20 |
| Cross-team leadership | 10 | 20 | 15 | 15 | 15 |
| Adaptability | 10 | 15 | 15 | 10 | 5 |
| Business value | 15 | 15 | 20 | 10 | 15 |

### What was built, and where it departs from the premise

The engine moves money only through items, events and plans, and a hidden fact can act only through an item or a side cost. That shaped every case:

* **5. Eighteen Months** (`harbour_loom_eighteen_months`, order 5). Three segments (own site, marketplaces, quick-commerce apps), thirteen items, four hidden facts: the quick-commerce leak after returns and discounts (the sales head says 12%; the root cause turns on it), the main mill's real fill rate, the premium line's real demand, and how much of the site's abandonment is the checkout. Events: a fire at the mill, a rival's price war, the head of sales resigns. Plans: expand, consolidate, raise now. *Not built as written:* investors' appetite window is not a hidden fact (nothing in the engine could depend on it); hiring and freezes are not modelled; `overhead_cut` renegotiates variable channel costs, leaving head-office costs unchanged; fundraising timing is the choice of plan in the fourth quarter, not a free-standing lever; replacing a leader is the third event, not something the player can do. The customer-facing words, the dials and the parties are the case's own (`terms`).
* **6. Both Sides of the Market** (`nestwork_both_sides`, order 6). Three segments (mature, second-wave and newest cities), thirteen items, four hidden facts: providers a ward needs (the operations head's forty is the briefing figure), the repeat rate, the partner channel's quality, and how many promotion-won households stay. Events: a rival's subsidies, a ruling that reclassifies providers, the monsoon collapse. Plans: deepen three cities, open six, go for profit. *Not built as written:* "which city to open next" is not chosen city by city; opening six at once and deepening the second wave are separate items, and the plan in the fourth quarter carries the same choice.
* **7 to 10** (`brightkart_debt_due`, `fieldledger_one_platform`, `kestrel_seven_taps`, `wayfare_every_rider`). Thirteen to fifteen items each, four or five hidden facts, three events and three plans, as in the premises. Their hidden facts follow the premise where an item could depend on it and add one or two others; Seven Taps replaces the regulator complaint and the pet redesign with a viral video of a blind customer failing to pay and a rival's one-tap bill pay; the trust-versus-words-versus-flow question is flow against words. They use the product team's words for capacity, dials and parties.

The effect sizes are fitted by `tools/venture/fit.ts`: each ordinary item is made worth a stated multiple of a believable value per engineering week at the briefing's figures, and each bet on a hidden fact is made to stop paying in about three worlds in ten. They are placeholders in the same sense as the product cases', and nobody who does these jobs has reviewed them. Calibration for all eight cases, on seeds 1 to 40 and 101 to 140, is in `docs/venture-engine-calibration-latest.txt`.

Every one of the six cases' calibration holds its invariants: doing nothing scores 0, the arithmetic adds up, a replay reproduces the game, the order do_nothing < feature_factory < random < textbook < evidence_led holds, and evidence-led play beats the textbook manager by the required gap. Moved after seeing results, and disclosed in the case's files:

* Eighteen Months, `random`: written as 20 to 45, the first run gave 45.1 (noise in forty worlds is about 2 points), moved to 20 to 50.
* One Platform, `textbook`: written as 35 to 65, the first run gave 65.5, moved to 45 to 70. The gap between evidence-led and textbook play was 24.3 against the default 25, so that case sets `calibration.min_gap` to 20, with its reason.

## 9. What I need from you, and what comes next

1. **Is this the right shape?** Four quarters, a company with real numbers, the briefing that flatters the sponsor, hidden facts to learn, one event, a term sheet, seven scored dimensions. If something here is not what you meant by "similar to the Myelin simulations", this is the cheapest moment to say.
2. **Decided: the weights (5.6) and the expected ranges (5.5).** Option D is in use. The expected ranges for debt_first, random and evidence_led were revised after seeing results, at your instruction, and each revision is disclosed in 5.5, in `run.ts`, in the calibration file and in the README. Nothing from the calibration is open any more except that no person has played it.
3. **The six other cases.** Built, in the order 5 to 10. The names, companies and premises in section 8 were mine; change any that do not suit you, and say so for a case that has to be rewritten.
4. **Where the existing two cases sit.** They stay as they are, on the retention engine, and appear in the same list. They are about a different kind of problem, so their rubric does not change.
5. **Go-ahead to build** the real engine in `src/` (scenario format, preview, the five-step event, term sheet, rewinds, calibration bots), the screens (state, decisions, preview, report, review) and the two product-manager cases. The seats for the chief executive, growth and strategy head, developer and designer followed, one pair at a time, each with its own calibration run.

What is not covered by any of this: nobody has played it, the effect sizes have not been reviewed by a product person, and the narrative text is templated, not written per game.
