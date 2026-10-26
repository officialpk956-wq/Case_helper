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

An item (an initiative) has an engineering estimate in weeks, design weeks, analyst weeks, how well it is understood at the start (0 to 1), a sponsoring team, the effects it has when it works, and sometimes something it needs first. In this spec {{effort}}; the prototype multiplies the written estimates so that a squad can do about two thirds of the catalogue in a year, which is what makes choosing matter.

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

{{weights}}

{{scoring}}

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

{{example.good}}

A game played by the manager who ranks by estimates and never investigates:

{{example.poor}}

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

{{calibration}}

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

{{whatif}}

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

{{marigold.segments}}

{{marigold.start}}

One quarter with nothing changed:

{{marigold.worked}}

### What is hidden

{{marigold.hidden}}

### The root-cause question

The player is asked, every quarter, which of these they believe is behind the leak. The true answer is decided by the first hidden fact above.

{{marigold.root}}

### What the effects mean, worked through

{{marigold.effect}}

### What can be built

Effects are relative changes to a rate. "Identity verified +13%" takes a 36% completion rate to about 40%, not to 49%. A running cost or one-off cost is paid in full whether or not the item works.

{{marigold.inits}}

### The four quarters

* **Quarter 1, "The review".** The board has just met. The player sees the funnel, the voices, and that measurement is at level 0. *Template:* "Of every 100 people who start signing up, {first_payers_new} new-to-digital users make a first payment. The board gave you {road} weeks of engineering to change that. You cannot yet see where people stop."
* **Quarter 2, "First results".** *Template:* "{shipped} shipped last quarter. Profit was {profit}, {delta} against holding still. {learned}. {who_is_pleased}."
* **Quarter 3, "The shock".** One of the three events (below) arrives. *Template:* the event's signal, then the five steps of 3.7.
* **Quarter 4, "The term sheet".** *Template:* "The board will back one of three plans for next year. Your position: usability {U}, reliability {R}, technical debt {D}, engineering trust {eng}, outside trust {ext}."

### The events

{{marigold.events}}

### The plans on the term sheet

{{marigold.plans}}

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

{{tallyhouse.segments}}

{{tallyhouse.start}}

One quarter with nothing changed:

{{tallyhouse.worked}}

### What is hidden

{{tallyhouse.hidden}}

### The root-cause question

{{tallyhouse.root}}

### What the effects mean, worked through

{{tallyhouse.effect}}

### What can be built

Effects are relative changes to a rate, as in case 3. "Paid −24%" takes 55 of every 100 solo trial users who consider upgrading down to about 42; it only touches the new customers each quarter, which is why a large fall can cost little while a small rise in revenue per customer, which applies to the whole base, can pay for it.

{{tallyhouse.inits}}

### The four quarters

* **Quarter 1, "The runway".** *Template:* "{cash} lakh in the bank and a loss of {loss} a quarter: {quarters_left} quarters of money. Your squad has {road} weeks."
* **Quarter 2, "First results".** Same template as case 3.
* **Quarter 3, "The shock".** One of the three events below.
* **Quarter 4, "The term sheet".** The three plans below.

### The events

{{tallyhouse.events}}

### The plans on the term sheet

{{tallyhouse.plans}}

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
