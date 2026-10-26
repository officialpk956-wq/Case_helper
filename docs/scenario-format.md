# Scenario format and engine semantics (v0.1)

One JSON file is one playable case. The engine is generic; the case is data. The JSON Schema
(`schema/scenario.schema.json`) is the contract, `check.mjs` enforces it plus every cross-reference a
schema cannot express, and `src/` implements what the file means.

## What one cycle does

Before the first cycle a player may brief: `ask(run, questions)` asks clarifying questions and reads the answers,
so they can shape the first decision (see "The case a seed draws"). Later questions go in a cycle's decision.
Then `playCycle(run, decision)` in `src/engine.ts`, in this order:

1. **Validate.** Reject anything a player could not do: unknown or repeated lever, lever not yet available,
   unmet `requires`, over `capacity.eng_sprints_per_cycle`, too many clarify questions or tests (`experiment_slots_per_cycle`,
   or `experiment_slots_final_cycle` in the last cycle when the case sets one: nothing is built then, so there is room
   for another), notification volume out of range, endgame choice before the last cycle.
2. **Apply.** Record questions asked, levers started, levers dropped, the notification dial (persists until
   changed), the impact ranking. A lever starts in cycle `c` and is live from `c + lead_cycles`. A lever with
   no lead time planned in the same decision counts as live for the requirements of the others
   (switch on session tracking and analyse it the same cycle).
3. **Reveal.** Research levers and clarify questions reveal their hidden variables at the variable's stated
   `fidelity`. A clarify question's answer is read, and what it teaches about the case is kept (`run.known`).
4. **Test.** Each A/B test returns `true lift + N(0, sd)` with
   `sd = base_noise_sd * sqrt((min_sample_pct * min_weeks) / (sample_pct * weeks))`, plus `peek_penalty_sd`
   in quadrature if stopped early. Verdict: `win` at or above `test_ship_threshold`, `loss` below
   `test_kill_threshold` (or if a notification test shows opt-outs over `guardrail_breach_abs`), else
   `inconclusive`. A test of an `offer` lever (a pricing test; `kind: "offer"`, never started, only tested)
   judges nothing: it reveals the hidden variables `engine.test_reveals` names for it, for the segment shown and
   with noise that shrinks with exposure as above, and its `estimate` is the number it read. The hidden variable
   needs a `reveal.via` entry for `ab_test` to say at what fidelity. A test of a `holdout` lever (a cohort holdout;
   `kind: "holdout"`, also only tested) reveals no hidden variable and covers the whole base, so the segment does not
   matter. It keeps `samplePct` of the base off everything the player shipped (no lever live, today's notification policy,
   the event absorbed only as that bare state absorbs it) and reads the 30-day return of that cohort and of everyone
   else, each as `truth * (1 + sd * z)` with `sd = base_noise_sd * noise_scale * sqrt((min_sample_pct * min_weeks) /
   (cohort share * weeks))`, where `noise_scale` is the 30-day return metric's own. The larger cohort reads closer.
   `cohorts` holds both reads and their `sd`, and `estimate` is the gap, rest over withheld minus one. Neither pricing
   tests nor holdouts judge anything: the verdict is always `inconclusive`.
5. **Event.** In `events.cycle` the mitigation is fixed: the sum of `factor` for every mitigation whose
   `when` rule is true, capped at `event_max_mitigation`. The effect then applies with `event_persistence`.
6. **Metrics (true).** A build the brief blocks (see below) is not live and adds nothing. Per segment: `baseline * (1 + combined lifts)`. Lifts combine as
   `1 - product(1 - lift)`. A live lever's lift is scaled by its ramp (`ramp_first_live_cycle` in its first
   live cycle), by `soft_requires` (`else_multiplier` if the prerequisite is not live), and, for levers in
   `quality_scaled_levers`, by the hidden quality curve at the current instrumentation level. The
   notification dial adds `gain * (volume^0.6 * targeting_multiplier - baseline equivalent)` to sessions and
   a share of that to return. Volume over a segment's hidden fatigue ceiling adds opt-outs, and
   `opt_out_persistence` of last cycle's excess carries over. Opt-outs above baseline reduce return by
   `opt_out_return_penalty`.
7. **Observe.** The player sees `true * (1 + N(0, noise_sd * noise_scale))` where `noise_sd` is set by the live
   instrumentation level and `noise_scale` is the metric's own share of it (default 1; the 30-day return rate
   carries 0.3, since it is a cohort count and not an event stream), and only the metrics whose
   `visible_from_instrumentation` that level reaches.
8. **Endgame** (last cycle): value each option from the final true state and the hidden truth; grade the
   choice as a share of the best. The choice can be in the last decision (made before that cycle's results
   exist, on a forecast) or, if it is left out, at the review below.
9. **Score** the cycle.

**The review.** After the last cycle, `chooseEndgame(run, { option, reasoning, status? })` lets a player who left
the choice out choose with the final report in hand. It works once, only after the last cycle, scores that cycle
again with the choice, and may carry the status note, which a player would write at the review. A bot with a
`review` function is called after its last cycle; `src/play.ts` does it.

All randomness comes from `src/rng.ts`, one named stream per purpose, so a seed gives the same noise for the
same thing whatever the player did. Replaying identical decisions under another seed is a clean test of luck.

## The world a seed draws

Before the first cycle, `newRun` redraws the hidden world for the seed (`src/variation.ts`, configured by
`engine.variation`): every lever x segment effect and notification gain is multiplied by a lognormal factor
with mean 1 and sd `effect_sd`; each hidden variable named in `variation.hidden` has its numeric values
redrawn with its own `sd` and optional `min`, `max` or `min_multiple_of_baseline_volume`. Nothing the
player can observe moves (baselines, costs, lead times, names), zeros stay zero and signs never flip.
`newRun(sc, seed, { vary: false })` plays the file exactly as written, which the tests use whenever they
need exact numbers. Because findings carry values (next section), what a player learns decides which choices
are right in their world. See the README for what that does and does not buy.

## The case a seed draws

Alongside the world, `newRun` draws four facts about the case. They are hidden from the player and revealed by
clarifying answers (`run.facts` is the truth, `run.known` is what the player has been told):

- `case_facts.tracking`: options with a weight and an `instrumentation_level`. The company starts at that
  level, so session analytics and the article feed work from cycle 1 and a foundation at or below it is already
  in place: it counts as live for whatever needs it, and buying it again is allowed and wasted.
- `case_facts.scope`: options with a weight and the `stages` this quarter's brief covers. A build whose stages
  are all outside them is blocked: it starts and costs capacity, but it is never live, delivers no lift, mitigates
  no event, reads zero in a test, and has no impact to rank. Levers that serve any stage in scope are never blocked.
- `case_facts.backing`: options with a weight and `max_bets`, how many bets leadership will back. It backs the
  first builds the player starts, in order; a later build is blocked in the same way (a dropped bet keeps its
  place). The best plan `delivered_vs_best` measures against has at most `max_bets` bets, and
  `bets_concentrated` is full only if none was beyond it. Put the first option as the unconstrained one: it is
  what `vary: false` plays.
- `threat`: the market event, drawn from `events.pool` as before.

A clarify question's `answer` is a string, or `{ by, cases }` where `by` is `tracking`, `scope`, `backing` or
`threat` and there is one case per value. For `backing`, `check.mjs` requires the answer to teach `bets` equal to
that option's `max_bets`. Each case has the `text` a human reads and optional `learns` pairs a bot reads
(`{ scope: "during_search" }`). A question may declare `signal_for`: the events whose signal it carries. The
convention in the shipped case is that the first answer (`why_retention`) says what leadership worries about,
and its `learns.watch` names the follow-up question; that question's answer says what is coming. `check.mjs`
requires an answer for every value, a question for every event, and `watch` to name a real question.

`newRun(sc, seed, { vary: false })` takes the first option of each fact, as written, and still draws the event.

## What a revealed finding shows

A hidden variable is revealed by a source: a research lever, a clarify question, or an A/B test. Each
source has a fidelity, set on the variable's `reveal.via[]` entry or defaulting to the variable's own, and
the player is shown a `Reading` (`run.revealed[id].readings`) at that fidelity:

- **exact**: the truth, as it is.
- **noisy**: the same shape with every number scaled by `1 + noisy_sd * z`. An A/B test scales that noise by
  its own exposure, so a bigger, longer test reads closer.
- **directional**: no magnitudes. Siblings that are numbers come back as an order (`{ order: [...] }`) read
  through `directional_sd` noise; a lone number comes back as a bucket against the file's typical value
  (`below`, `typical`, `above`).

A source only reads what it covers: the exit survey reads the placed segment, a test reads the segment it
ran on, interviews read all. Strings and other non-numbers cannot be fuzzed and come back as they are.
Readings are deterministic for a seed and accumulate; several readings of one thing can be pooled.

`segment_response` is derived rather than written: what each segment responds to is the return lift every
lever gives it in this world (`fillDerived`), so an interview's order can never disagree with the effects.
`endgameValue(run, params, cycle, world)` takes the facts an option's value depends on as an argument. The
engine passes the real ones; `src/beliefs.ts` builds the player's version from what they were shown, the
observed metrics and the file's typical values.

## Scoring

```
sub-criterion  -> full | part | none | na        (a rule fn from the catalogue)
points         =  trait.weight / sub-criteria in the trait * level factor
trait_total    =  100 * points earned / points earnable this cycle
final          =  clamp(trait_total + modifier_total, 0, 100)
run score      =  mean of the cycle finals
```

Rules the engine holds itself to (`src/rules.ts`):

- **No free points for inaction.** A sub-criterion is `none` unless the player did something that earns it.
  Nothing built is `none`, not `na`.
- **`na` is only for questions that cannot be asked yet by time:** the event not reached, the endgame not
  reached, a test not yet judgeable, capacity in the last cycle (nothing started there can pay off), or once every
  bet leadership will back is started (no more build can go live). `na`
  drops out of both sides and each remaining sub-criterion keeps its own fixed worth, so one live question
  never inherits the weight of the others.
- **A right answer with nothing learned behind it is a guess,** and earns `part`: the diagnosis, the impact
  ranking, and the match of levers to the focus segment.
- **Builds are scored by the lift they deliver over the run** (`delivered_vs_best`): the reach-weighted lift in
  30-day return of the builds started, summed over every cycle so that starting a lever earlier counts, as a
  share of the best choice of builds and start cycles the player could have made with the capacity they left
  for building each cycle. It depends on the world, and only discriminates when capacity binds (the shipped
  case has 8 sprints a cycle; at 12 every build was affordable). See the README for what it does to the bots.
- **A claim about the world needs something learned behind it** (`backed_by` on a sub-criterion): a list of
  clarifying questions asked or hidden variables read (any fidelity, from research, a test or a question).
  If the rule says full and none of them has happened by that cycle, the credit is capped at part and the
  evidence line is the sub-criterion's `missing` text. Used on the primary metric, the focus segment, the
  guardrail and the monetisation choice. Use it for a choice among alternatives whose merit depends on the
  world.
- **A practice is only a skill if its right answer differs between cases.** Asking, tracking first, covering
  the journey and concentrating would otherwise be right in every seed, and no behaviour could tell understanding
  from a key. So they read the case: the question that carries the signal depends on the threat; paying for
  tracking the company already has is waste; the stages that count are the ones in scope and a blocked build counts
  against you; a focus segment in a stage the brief rules out is not a focus; how many bets to concentrate on is
  the number leadership will back. Do not gate such a practice on research: research cannot make it more right,
  and a gate would only score research twice.
- **Capacity is only idle if something could use it.** Sprints put into a build that is stopped at launch (outside
  the brief or beyond the bets leadership will back) are used on nothing, for `capacity_used` and for concentration
  alike. Once every backed bet is started, a cycle that starts no stopped build is `na` for `capacity_used`.
- **Preparation has to be deliberate.** A default that happens to absorb the event earns nothing.
- **A status note has to describe what was actually done this cycle.** A stock sentence earns nothing.
- Modifiers fire in the cycle the thing happens, not every cycle after.

## Rule catalogue

`KNOWN_FNS` in `check.mjs` lists the 36 functions a scenario may name; `src/rules.ts` implements them and a
test keeps the two in step. Groups: 22 rubric sub-criteria (`SUB`), 10 modifiers (`MOD`), 3 event-mitigation
predicates (`PRED`), 1 endgame value model. All are pure functions of the run so far.

## Public versus private

Send to the browser: `company`, `timeline`, `segments`, `metrics` (without `kind` and `noise_scale`, which would
name the vanity metric), `capacity`, `levers` without `effects`, `soft_requires` or most `params`, the text of each
clarify question and its answer only after it is asked, and a hidden variable's `player.label` with the readings
the player has been shown. Keep server-side: `engine`, `hidden_variables` (truth and description), lever
`effects`, `events`, `rubric` rules, `endgame.options[].value_model`, `case_facts`, `calibration`, and each question's
`relevance`. The rubric's evidence rules only work if players cannot read the answers. `src/server.ts` implements
the split, and `test/server.test.ts` checks it by key.

A hidden variable may carry `player: { label, percent? }`: the name a reading of it is shown under (not the finding
itself) and whether its numbers are shares. A variable with no `player` is never shown by name.

## Stages

`stages` names the journey's two stages in order: the one players work on, and the one after the goal is reached.
The second stage's segment is `engine.post_placement_segment`. Levers and `case_facts.scope` refer to stage ids,
and a player is shown the `label`. For a scope option that covers one stage, use the stage's id as the option's id:
the clarifying answer teaches that id (`learns.scope`) and the bots read it back.

## The calibration playbook

`calibration.playbook` is what the scripted bots do in this case, so `src/bots.ts` knows no case:

- `brief`, `focus` and `diagnosis`: the first question, the ones after it, the segment each stage is about, and the
  analysis that shows the real cause.
- `scripts`: the spammer, the textbook plan, the careful researcher (one script for a company that already tracks
  and one for one that does not) and the answer-key guesser, each as the fields every cycle shares (`base`) and a
  decision per cycle. A script's `start` list is filtered at run time to what is available and affordable. A segment may be
  `$post_first` or `$during_first`: the one the brief points to.
- `insight`: the roles the evidence-driven bots need (the tracking foundations, the analysis, the research levers,
  the tests to run in the first, second and last cycles, the gated build, what to build against each threat, the
  finding that adds a build, and how far under the fatigue ceiling to stay).

`check.mjs` checks every id in it against the case. The tests' sizes default to the largest sample and the longest
run the case's experiment platform allows.

## Adding a case

Copy a file, change the content (including the playbook), run `node check.mjs`, then `node src/calibrate.ts`, which
calibrates every case and shows whether the bots land where `calibration.bots[].expected_final` says. Write those ranges
before the first run, and if you revise one afterwards, say so in the bot's `policy` and in the README, as the
textbook bot's was. If a case needs a rule that does not exist, add it to `KNOWN_FNS` and `src/rules.ts` once, for every
case. The engine's vocabulary is retention-shaped (six metrics, a notification dial, price and attribution in the
endgame, the scope, tracking and backing facts), so a case that does not fit it needs engine work first. The endgame
value models keep their original parameter names (`placements_per_active_per_cycle` is a rate of the outcome the case
sells, whatever it is).
