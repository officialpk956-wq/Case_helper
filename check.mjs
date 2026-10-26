// Usage: node check.mjs [scenario.json ...]   (default: every file in scenarios/)
// 1) validates against schema/scenario.schema.json (retention cases, *.scenario.json) or schema/venture.schema.json (venture cases, *.venture.json)
// 2) checks the cross-references a schema cannot.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const AJV_FROM = process.env.AJV_FROM ?? join(here, "package.json");
const Ajv2020 = createRequire(AJV_FROM)("ajv/dist/2020");

// The rule catalogue: every `fn` the engine must implement. Single source of truth.
export const KNOWN_FNS = new Set([
  // rubric sub-criteria
  "clarify_quality", "metric_defined_before_build", "scope_declared", "root_cause_diagnosis", "research_before_segment_build",
  "lever_segment_fit", "journey_coverage", "rice_calibration", "capacity_concentration", "delivered_vs_best", "capacity_used",
  "primary_plus_guardrail", "instrumentation_before_dependent", "vanity_trap", "ab_before_rollout",
  "test_hygiene", "acted_on_result", "notif_below_ceiling", "shock_prepared", "monetisation_fit",
  "status_update_complete", "expectation_calibrated",
  // modifiers
  "lever_live_before", "notif_over_ceiling_consecutive", "risky_lever_without_test", "levers_started_in_cycle_gt",
  "built_before_evidence", "killed_losing_test", "guardrail_breach_responded", "expectation_within",
  "endgame_choice_within_best", "endgame_choice_below",
  // event mitigations and endgame
  "lever_live", "research_done", "notif_volume_at_most_share_of_ceiling", "endgame_value",
]);

const schema = JSON.parse(readFileSync(join(here, "schema", "scenario.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const validateVenture = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(join(here, "schema", "venture.schema.json"), "utf8")));
// The venture engine's own catalogues, so a scenario that names something the engine cannot judge or say fails here, not in a run.
const { SUBS, DIMENSION_IDS } = await import("./src/venture/score.ts");
const { unknownPlaceholders } = await import("./src/venture/narrative.ts");
const { BOTS: VENTURE_BOTS } = await import("./src/venture/bots.ts");

function semantic(s) {
  const errs = [];
  const err = (m) => errs.push(m);
  const ids = (arr, what) => {
    const seen = new Set();
    for (const x of arr) { if (seen.has(x.id)) err(`duplicate ${what} id: ${x.id}`); seen.add(x.id); }
    return seen;
  };
  const seg = ids(s.segments, "segment");
  const lev = ids(s.levers, "lever");
  const met = ids(s.metrics, "metric");
  const hid = ids(s.hidden_variables, "hidden variable");
  const clr = ids(s.clarify.questions, "clarify question");
  const evt = ids(s.events.pool, "event");
  ids(s.reflection.prompts, "reflection prompt");
  ids(s.rubric.traits, "trait");
  ids(s.rubric.traits.flatMap((t) => t.subcriteria), "subcriterion");
  ids(s.rubric.modifiers, "modifier");
  ids(s.calibration.bots, "bot");
  ids(s.endgame.options, "endgame option");

  const close = (a, b) => Math.abs(a - b) < 1e-9;
  if (!close(s.segments.reduce((t, x) => t + x.share, 0), 1)) err("segment shares must sum to 1");
  if (!close(s.rubric.traits.reduce((t, x) => t + x.weight, 0), 100)) err("trait weights must sum to 100");

  const maxInstr = Math.max(...s.measurement.instrumentation_levels.map((l) => l.level));
  const checkSegs = (obj, where) => Object.keys(obj ?? {}).forEach((k) => { if (!seg.has(k)) err(`${where}: unknown segment ${k}`); });
  for (const l of s.levers) {
    checkSegs(l.effects, `lever ${l.id}.effects`);
    if (l.kind === "build" && !l.effects) err(`lever ${l.id}: build levers need effects`);
    for (const r of l.requires?.levers ?? []) if (!lev.has(r)) err(`lever ${l.id}: requires unknown lever ${r}`);
    for (const r of l.soft_requires?.levers ?? []) if (!lev.has(r)) err(`lever ${l.id}: soft_requires unknown lever ${r}`);
    for (const h of l.reveals_hidden ?? []) if (!hid.has(h)) err(`lever ${l.id}: reveals unknown hidden variable ${h}`);
    if ((l.requires?.instrumentation_level ?? 0) > maxInstr) err(`lever ${l.id}: needs instrumentation above max level`);
    const set = l.params?.sets_instrumentation_level;
    if (set !== undefined && !s.measurement.instrumentation_levels.some((x) => x.level === set)) err(`lever ${l.id}: sets unknown instrumentation level ${set}`);
  }
  const stageSet = ids(s.stages, "stage");
  for (const l of s.levers) for (const st of l.stages) if (!stageSet.has(st)) err(`lever ${l.id}: unknown stage ${st}`);
  for (const k of ["tracking", "scope", "backing"]) {
    ids(s.case_facts[k], `case fact ${k} option`);
    if (!close(s.case_facts[k].reduce((t, o) => t + o.weight, 0), 1)) err(`case_facts.${k} weights must sum to 1`);
  }
  for (const o of s.case_facts.scope) for (const st of o.stages) if (!s.levers.some((l) => l.stages.includes(st))) err(`case_facts.scope ${o.id}: no lever has stage ${st}`);
  const facts = { tracking: new Set(s.case_facts.tracking.map((o) => o.id)), scope: new Set(s.case_facts.scope.map((o) => o.id)), backing: new Set(s.case_facts.backing.map((o) => o.id)), threat: evt };
  for (const q of s.clarify.questions) {
    for (const e of q.signal_for ?? []) if (!evt.has(e)) err(`question ${q.id}: signal_for unknown event ${e}`);
    if (typeof q.answer === "string") continue;
    const vals = facts[q.answer.by];
    if (!vals) { err(`question ${q.id}: answer depends on unknown fact ${q.answer.by}`); continue; }
    for (const v of vals) if (!q.answer.cases[v]) err(`question ${q.id}: no answer for ${q.answer.by}=${v}`);
    for (const [v, a] of Object.entries(q.answer.cases)) {
      if (!vals.has(v)) err(`question ${q.id}: answer for unknown ${q.answer.by}=${v}`);
      if (a.learns?.watch && !clr.has(a.learns.watch)) err(`question ${q.id}: learns a watch that is not a question: ${a.learns.watch}`);
      if (q.answer.by === "backing" && a.learns?.bets !== String(s.case_facts.backing.find((o) => o.id === v)?.max_bets)) err(`question ${q.id}: the answer for backing=${v} must teach bets=${s.case_facts.backing.find((o) => o.id === v)?.max_bets}`);
    }
  }
  for (const e of s.events.pool) if (!s.clarify.questions.some((q) => q.signal_for?.includes(e.id))) err(`event ${e.id}: no question carries its signal`);

  const refs = { lever: lev, clarify: clr, event: evt };
  for (const h of s.hidden_variables) for (const v of h.reveal.via) if (!refs[v.kind].has(v.ref)) err(`hidden ${h.id}: reveal via unknown ${v.kind} ${v.ref}`);
  for (const q of s.clarify.questions) for (const h of q.reveals ?? []) if (!hid.has(h)) err(`clarify ${q.id}: reveals unknown hidden variable ${h}`);
  for (const c of s.rubric.traits.flatMap((t) => t.subcriteria)) for (const b of c.backed_by?.any_of ?? []) {
    if (b.clarify && !clr.has(b.clarify)) err(`subcriterion ${c.id}: backed_by unknown clarify question ${b.clarify}`);
    if (b.reading && !hid.has(b.reading)) err(`subcriterion ${c.id}: backed_by unknown hidden variable ${b.reading}`);
  }
  for (const m of s.metrics) if (m.visible_from_instrumentation > maxInstr) err(`metric ${m.id}: visible above max instrumentation`);

  const en = s.engine;
  checkSegs(en.notification_baseline.volume, "engine.notification_baseline.volume");
  for (const id of seg) if (!(id in en.notification_baseline.volume)) err(`engine.notification_baseline.volume missing segment ${id}`);
  if (!seg.has(en.post_placement_segment)) err("engine.post_placement_segment is not a segment");
  for (const [l, h] of Object.entries(en.quality_scaled_levers)) { if (!lev.has(l)) err(`engine.quality_scaled_levers: unknown lever ${l}`); if (!hid.has(h)) err(`engine.quality_scaled_levers: unknown hidden variable ${h}`); }
  for (const [l, hs] of Object.entries(en.test_reveals)) { if (!lev.has(l)) err(`engine.test_reveals: unknown lever ${l}`); for (const h of hs) if (!hid.has(h)) err(`engine.test_reveals: unknown hidden variable ${h}`); }
  for (const h of Object.keys(en.variation.hidden)) if (!hid.has(h)) err(`engine.variation.hidden: unknown hidden variable ${h}`);
  for (const h of s.hidden_variables) if (h.truth && typeof h.truth === "object" && "derived_from" in h.truth && h.truth.derived_from !== "lever_effects") err(`hidden ${h.id}: unknown derived_from ${h.truth.derived_from}`);
  for (const e of s.events.pool) checkSegs(e.effects, `event ${e.id}.effects`);
  if (s.events.cycle > s.timeline.cycles) err("event cycle is after the last cycle");
  if (s.endgame.cycle !== s.timeline.cycles) err("endgame must happen in the last cycle");
  if (s.timeline.cycle_briefs.length !== s.timeline.cycles) err("need one brief per cycle");
  s.timeline.cycle_briefs.forEach((b, i) => { if (b.n !== i + 1) err(`cycle brief ${i + 1} has n=${b.n}`); });

  for (const p of s.reflection.prompts) {
    if (p.id === "primary_metric") for (const o of p.options ?? []) if (!met.has(o.id)) err(`primary_metric option ${o.id} is not a metric`);
  }
  const bands = s.rubric.bands.map((b) => b.min);
  if (bands.some((v, i) => i && v >= bands[i - 1]) || bands.at(-1) !== 0) err("bands must descend and end at 0");
  for (const b of s.calibration.bots) if (b.expected_final.min > b.expected_final.max) err(`bot ${b.id}: min > max`);

  if (s.calibration.playbook) errs.push(...checkPlaybook(s, { seg, lev, clr, hid, evt }));

  const rules = [
    ...s.rubric.traits.flatMap((t) => t.subcriteria.map((c) => [`subcriterion ${c.id}`, c.rule])),
    ...s.rubric.modifiers.map((m) => [`modifier ${m.id}`, m.rule]),
    ...s.events.pool.flatMap((e) => e.mitigations.map((m, i) => [`event ${e.id}.mitigation ${i}`, m.when])),
    ...s.endgame.options.map((o) => [`endgame ${o.id}`, o.value_model]),
  ];
  const used = new Map();
  for (const [where, r] of rules) {
    used.set(r.fn, (used.get(r.fn) ?? 0) + 1);
    if (!KNOWN_FNS.has(r.fn)) err(`${where}: unknown rule fn ${r.fn}`);
    const p = r.params ?? {};
    for (const key of ["lever", "levers", "before", "evidence_levers", "requires_lever"]) {
      for (const v of [].concat(p[key] ?? [])) if (!lev.has(v)) err(`${where}: params.${key} names unknown lever ${v}`);
    }
  }
  for (const f of KNOWN_FNS) if (!used.has(f)) err(`catalogue lists ${f} but no rule uses it`);
  return errs;
}

/** The playbook's ids must be the case's: a script that names a lever, question, segment or answer that is not there fails here, not in a run. */
function checkPlaybook(s, { seg, lev, clr, hid, evt }) {
  const errs = [];
  const err = (m) => errs.push(m);
  const pb = s.calibration.playbook;
  const stages = new Set(s.stages.map((x) => x.id));
  const options = (id) => new Set((s.reflection.prompts.find((p) => p.id === id)?.options ?? []).map((o) => o.id));
  const need = (set, v, what, where) => { if (!set.has(v)) err(`playbook ${where}: ${what} ${v} is not in the case`); };
  const TOKENS = new Set(["$post_first", "$during_first"]);
  const segmentOk = (v, where) => { if (!seg.has(v) && !TOKENS.has(v)) err(`playbook ${where}: segment ${v} is not in the case`); };
  const decision = (d, where) => {
    for (const id of d.start ?? []) need(lev, id, "lever", `${where}.start`);
    for (const id of d.drop ?? []) need(lev, id, "lever", `${where}.drop`);
    for (const id of d.impactRanking ?? []) need(lev, id, "lever", `${where}.impactRanking`);
    for (const id of d.clarify ?? []) need(clr, id, "question", `${where}.clarify`);
    if (d.focusSegment) segmentOk(d.focusSegment, `${where}.focusSegment`);
    for (const k of Object.keys(d.notifications ?? {})) need(seg, k, "segment", `${where}.notifications`);
    for (const e of d.experiments ?? []) { need(lev, e.lever, "lever", `${where}.experiments`); segmentOk(e.segment, `${where}.experiments`); }
    for (const [k, v] of Object.entries(d.reflection ?? {})) if (!options(k).has(v)) err(`playbook ${where}.reflection.${k}: ${v} is not an option`);
    if (d.endgame) need(new Set(s.endgame.options.map((o) => o.id)), d.endgame.option, "endgame option", `${where}.endgame`);
  };
  const script = (sc, where) => {
    decision(sc.base, `${where}.base`);
    if (sc.cycles.length > s.timeline.cycles) err(`playbook ${where}: more cycles than the case has`);
    sc.cycles.forEach((d, i) => decision(d, `${where}.cycles[${i}]`));
  };
  need(clr, pb.brief.first, "question", "brief.first");
  for (const q of [...pb.brief.then, pb.brief.fallback]) need(clr, q, "question", "brief");
  need(seg, pb.focus.during, "segment", "focus.during"); need(seg, pb.focus.post, "segment", "focus.post");
  need(stages, pb.focus.during_stage, "stage", "focus.during_stage"); need(stages, pb.focus.post_stage, "stage", "focus.post_stage");
  need(hid, pb.diagnosis.variable, "hidden variable", "diagnosis"); need(lev, pb.diagnosis.lever, "lever", "diagnosis");
  need(options("root_cause"), pb.diagnosis.cause, "root_cause option", "diagnosis"); need(options("root_cause"), pb.diagnosis.unknown, "root_cause option", "diagnosis");
  const sc = pb.scripts;
  script(sc.notification_spammer, "scripts.notification_spammer");
  script(sc.framework_first, "scripts.framework_first");
  script(sc.cautious_researcher.tracked, "scripts.cautious_researcher.tracked");
  script(sc.cautious_researcher.untracked, "scripts.cautious_researcher.untracked");
  script(sc.answer_key_guesser, "scripts.answer_key_guesser");
  const i = pb.insight;
  for (const id of [i.basic_tracking, i.pipeline, i.analytics, ...i.research, i.gated_build, i.cheap_leader, i.finding_adds.build]) need(lev, id, "lever", "insight");
  need(hid, i.finding_adds.variable, "hidden variable", "insight.finding_adds");
  for (const k of ["first_cycle_tests", "second_cycle_tests", "last_cycle_tests"]) for (const t of i[k]) { need(lev, t.lever, "lever", `insight.${k}`); segmentOk(t.segment, `insight.${k}`); }
  for (const [e, ls] of Object.entries(i.prepare)) { need(evt, e, "event", "insight.prepare"); for (const l of ls) need(lev, l, "lever", "insight.prepare"); }
  for (const e of Object.keys(i.margins.by_threat)) need(evt, e, "event", "insight.margins");
  return errs;
}

/** The cross-references a venture schema cannot express. */
function ventureSemantic(s) {
  const errs = [];
  const err = (m) => errs.push(m);
  const ids = (arr, what) => {
    const seen = new Set();
    for (const x of arr) { if (seen.has(x.id)) err(`duplicate ${what} id: ${x.id}`); seen.add(x.id); }
    return seen;
  };
  const seg = ids(s.segments, "segment"), itm = ids(s.items, "item"), hid = ids(s.hidden, "hidden fact"), evt = ids(s.events, "event");
  ids(s.plans, "plan"); ids(s.root.options, "root cause option"); ids(s.rubric.dimensions, "dimension"); ids(s.calibration.bots, "bot");
  const segs = (obj, where) => Object.keys(obj ?? {}).forEach((k) => { if (!seg.has(k)) err(`${where}: unknown segment ${k}`); });
  const pairs = [];

  for (const i of s.items) {
    segs(i.effects, `item ${i.id}.effects`);
    for (const sc of i.scale ?? []) if (!hid.has(sc.v)) err(`item ${i.id}: scale names unknown hidden fact ${sc.v}`);
    if (i.side_cost?.v && !hid.has(i.side_cost.v)) err(`item ${i.id}: side_cost names unknown hidden fact ${i.side_cost.v}`);
    if (i.side_cost?.cut_by && !itm.has(i.side_cost.cut_by)) err(`item ${i.id}: side_cost.cut_by names unknown item ${i.side_cost.cut_by}`);
    for (const d of [...(i.needs?.done ?? []), ...(i.needs?.or_done ? [i.needs.or_done] : [])]) { if (!itm.has(d)) err(`item ${i.id}: needs unknown item ${d}`); if (d === i.id) err(`item ${i.id}: needs itself`); }
    if (i.per_new_on && i.per_new === undefined) err(`item ${i.id}: per_new_on without per_new`);
    pairs.push([i.id, i.needs?.done ?? []]);
  }
  // A prerequisite cycle would leave items nobody can ever start.
  const waiting = new Map(pairs);
  for (let progress = true; progress && waiting.size;) {
    progress = false;
    for (const [id, deps] of waiting) if (deps.every((d) => !waiting.has(d))) { waiting.delete(id); progress = true; }
  }
  if (waiting.size) err(`items wait on each other in a loop: ${[...waiting.keys()].join(", ")}`);

  for (const f of s.hidden) if (!(f.range[0] < f.range[1])) err(`hidden ${f.id}: range must run from low to high`);
  if (!hid.has(s.root.dive)) err(`root.dive names unknown hidden fact ${s.root.dive}`);
  const opts = new Set(s.root.options.map((o) => o.id));
  for (const k of ["high", "low"]) if (!opts.has(s.root[k])) err(`root.${k} is not one of the options`);
  if (!opts.has("need_more_data")) err("root options must include need_more_data");
  if (s.root.high === s.root.low) err("root.high and root.low must differ");

  for (const e of s.events) {
    segs(e.effects, `event ${e.id}.effects`);
    if (!e.causes.some((c) => c.id === e.cause)) err(`event ${e.id}: cause is not among the causes offered`);
    if (!e.directions.some((c) => c.id === e.direction)) err(`event ${e.id}: direction is not among the responses offered`);
    for (const m of e.mitigations) if (m.live && !itm.has(m.live)) err(`event ${e.id}: mitigation names unknown item ${m.live}`);
    const by = e.mitigations.reduce((t, m) => t + m.by, 0);
    if (by > 0.9 - 0.25 + 1e-9) err(`event ${e.id}: mitigations alone absorb ${Math.round(by * 100)}%, leaving no room for reading and response`);
  }
  for (const p of s.plans) if (p.needs.debt_below !== undefined && p.needs.debt_below <= 0) err(`plan ${p.id}: debt_below must be above 0`);

  if (!s.measurement.every((m, i) => m.level === i)) err("measurement must list levels 0, 1 and 2 in order");
  if (s.start.level > 2) err("start.level is above the highest measurement level");
  if (!s.quarters.every((q, i) => q.n === i + 1)) err("quarters must be numbered 1 to 4 in order");
  for (const q of s.quarters) for (const k of unknownPlaceholders(q.opening, [...seg])) err(`quarter ${q.n}: the opening uses {${k}}, which the engine cannot fill`);

  const dims = new Set(s.rubric.dimensions.map((d) => d.id));
  for (const d of DIMENSION_IDS) if (!dims.has(d)) err(`rubric is missing the dimension ${d}`);
  for (const d of dims) if (!DIMENSION_IDS.includes(d)) err(`rubric names a dimension the engine does not judge: ${d}`);
  if (Math.abs(s.rubric.dimensions.reduce((t, d) => t + d.weight, 0) - 100) > 1e-9) err("dimension weights must sum to 100");
  const subIds = new Set(SUBS.map((x) => x.id));
  for (const d of s.rubric.doubled) if (!subIds.has(d)) err(`rubric.doubled names a sub-criterion the engine does not judge: ${d}`);
  const bands = s.rubric.bands.map((b) => b.min);
  if (bands.some((v, i) => i && v >= bands[i - 1]) || bands.at(-1) !== 0) err("bands must descend and end at 0");

  const known = new Set(VENTURE_BOTS.map((b) => b.id));
  for (const b of s.calibration.bots) {
    if (!known.has(b.id)) err(`calibration names a bot the engine does not have: ${b.id}`);
    if (b.expected_final.min > b.expected_final.max) err(`bot ${b.id}: min > max`);
    if (b.revised && b.revised.min > b.revised.max) err(`bot ${b.id}: revised.min > revised.max`);
  }
  for (const need of ["do_nothing", "evidence_led", "textbook"]) if (!s.calibration.bots.some((b) => b.id === need)) err(`calibration must expect ${need}`);
  return errs;
}

const files = process.argv.slice(2);
const targets = files.length ? files : readdirSync(join(here, "scenarios")).filter((f) => f.endsWith(".json")).map((f) => join(here, "scenarios", f));
let failed = false;
for (const f of targets) {
  const s = JSON.parse(readFileSync(f, "utf8"));
  const venture = f.endsWith(".venture.json");
  const check = venture ? validateVenture : validate;
  const problems = check(s) ? [] : check.errors.map((e) => `schema ${e.instancePath || "/"} ${e.message}`);
  if (!problems.length) problems.push(...(venture ? ventureSemantic(s) : semantic(s)));
  console.log(`${problems.length ? "FAIL" : "ok  "} ${f}`);
  for (const p of problems) console.log("   -", p);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
