// PROTOTYPE. Builds docs/venture-model-spec.md from docs/venture-model-spec.src.md and the case data, so that every number
// in the tables is the number the model runs on.
// Usage: node proto/venture/docgen.ts
import { readFileSync, writeFileSync } from "node:fs";
import { BOTS, doNothing, oracle } from "./bots.ts";
import { CASES, EFFORT } from "./cases.ts";
import { CUT, DIMS, scoreRun, SUB_WEIGHT } from "./score.ts";
import { idleDecision, newState, newWorld, playQuarter, W } from "./model.ts";
import type { CaseData, Effect, Init } from "./model.ts";
import { playRun } from "./play.ts";
import { ABOUT, HIDDEN } from "./text.ts";

const pct = (x: number, d = 0): string => `${(x * 100).toFixed(d)}%`;
const n0 = (x: number): string => Math.round(x).toLocaleString("en-IN");
const n1 = (x: number): string => (Math.round(x * 10) / 10).toString();
const table = (head: string[], rows: string[][]): string => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

function effectText(cs: CaseData, e: Effect): string {
  const out: string[] = [];
  const st = cs.stageNames;
  const sg = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`;
  if (e.inflow) out.push(`more people arrive ${sg(e.inflow)}`);
  if (e.s1) out.push(`${st[0]} ${sg(e.s1)}`);
  if (e.s2) out.push(`${st[1]} ${sg(e.s2)}`);
  if (e.s3) out.push(`${st[2]} ${sg(e.s3)}`);
  if (e.churn) out.push(e.churn > 0 ? `losses cut ${Math.abs(e.churn * 100).toFixed(0)}%` : `losses up ${Math.abs(e.churn * 100).toFixed(0)}%`);
  if (e.arpu) out.push(`revenue per customer ${sg(e.arpu)}`);
  if (e.cost) out.push(`cost to serve ${sg(e.cost)}`);
  return out.join(", ");
}

function gateText(cs: CaseData, i: Init): string {
  const n = i.needs;
  if (!n) return "none";
  const parts: string[] = [];
  if (n.done?.length) parts.push(`${n.done.map((id) => cs.inits.find((x) => x.id === id)!.name).join(" and ")} live`);
  if (n.level !== undefined) parts.push(`measurement level ${n.level}`);
  if (n.trust) parts.push(`${TEAM[n.trust[0]]} trust at least ${n.trust[1]}`);
  const base = parts.join(" and ");
  return n.orDone ? `${base}, or ${cs.inits.find((x) => x.id === n.orDone)!.name} live` : base;
}
const TEAM: Record<string, string> = { eng: "engineering", design: "design", biz: "business", lead: "leadership", ext: "outside (regulator, bank)" };

const segments = (cs: CaseData): string => table(
  ["Segment", "Arrive a quarter", `→ ${cs.stageNames[0]}`, `→ ${cs.stageNames[1]}`, `→ ${cs.stageNames[2]}`, `Reach ${cs.stageNames[2].toLowerCase()}`, "Losses a quarter", "Revenue per customer a quarter (₹)", "Cost to serve (₹)", "Customers"],
  cs.segments.map((s) => [s.name, n0(s.inflow), pct(s.stages[0]), pct(s.stages[1]), pct(s.stages[2]), pct(s.stages[0] * s.stages[1] * s.stages[2], 1), pct(s.churn), n0(s.arpu), n0(s.varCost), n0(s.customers)]),
);

function start(cs: CaseData): string {
  const w = { ...newWorld(cs, 1, { vary: false }), expected: { effect: 1, overrun: 1 } }, s = newState(cs);
  const r = playQuarter(w, s, idleDecision(), { evQ: 99 }).r;
  const t = cs.team;
  const rows: string[][] = [
    ["Squad", `${t.eng} engineers, ${t.design} designers, ${t.data} analysts, the product manager`],
    ["Engineering weeks for the roadmap in a quarter, at steady pace", `${n1(r.cap.road)} (of ${n1(r.cap.eng)} after reserves; ${n1(t.eng * W)} before overhead, debt and morale)`],
    ["Revenue a quarter", `${n0(r.revenue)} L`],
    ["Squad and company cost a quarter", `${n0(r.team)} L (the squad is ${n0(t.eng * t.costEng + t.design * t.costDesign + t.data * t.costData + t.pm)} L of it)`],
    ["Marketing a quarter", `${n0(t.marketing)} L`],
    ["Cost to serve customers, and per-step costs", `${n0(r.varCost + r.stageCost)} L`],
    ["Profit a quarter if nothing changes", `${n0(r.profit)} L`],
    ["Cash", `${n0(cs.start.cash)} L`],
    ["Technical debt (0 clean, 100 crippling)", `${cs.start.D}`],
    ["Reliability (0-100)", `${cs.start.R}`],
    ["Usability (0-100)", `${cs.start.U}`],
    ["Morale (0-100)", `${cs.start.M}`],
    ["Trust in the product manager", Object.entries(cs.start.trust).map(([k, v]) => `${TEAM[k]} ${v}`).join(", ")],
    ["Measurement level", `${cs.start.level} (0 none, 1 core events, 2 full funnel)`],
    ["Incidents in a middling quarter", `${cs.incidentBase}`],
  ];
  return table(["Starting position", "Value"], rows);
}

function worked(cs: CaseData): string {
  const w = { ...newWorld(cs, 1, { vary: false }), expected: { effect: 1, overrun: 1 } }, s = newState(cs);
  const r = playQuarter(w, s, idleDecision(), { evQ: 99 }).r;
  const rows = cs.segments.map((sg) => {
    const f = r.funnel[sg.id]!;
    return [sg.name, n0(sg.inflow), n0(f.n1), n0(f.n2), n0(f.n3), n0(sg.customers), n0(f.end), n0(f.avg), `${n1((f.avg * f.arpu) / 1e5)} L`];
  });
  return table(["Segment", "Arrive", cs.stageNames[0], cs.stageNames[1], cs.stageNames[2], "Customers at start", "At end", "Average", "Revenue"], rows)
    + `\n\nRevenue ${n0(r.revenue)} L, cost to serve and per-step costs ${n0(r.varCost + r.stageCost)} L, squad and company ${n0(r.team)} L, marketing ${n0(cs.team.marketing)} L, so profit ${n0(r.profit)} L.`;
}

/** One item, one segment, one key: the whole chain from the written lift to the money, then four quarters of the difference it makes. */
function workedEffect(cs: CaseData, itemId: string, segId: string, key: keyof Effect): string {
  const item = cs.inits.find((i) => i.id === itemId)!, seg = cs.segments.find((s) => s.id === segId)!, lift = item.effects[segId]![key]!;
  const s0 = newState(cs), w = { ...newWorld(cs, 1, { vary: false }), expected: { effect: 1, overrun: 1 } };
  const kU = 0.7 + (0.3 * s0.U) / 100, clar = Math.min(1, item.clar + 0.3 * idleDecision().research), cf = 0.85 + 0.15 * clar;
  const eff = lift * kU * cf, idx = key === "s1" ? 0 : key === "s2" ? 1 : 2;
  const before = seg.stages[idx]!, after = Math.min(0.95, before * (1 + eff));
  const lines: string[] = [
    `${item.name}, in ${seg.name}, on ${key === "s1" ? cs.stageNames[0] : key === "s2" ? cs.stageNames[1] : cs.stageNames[2]}, once it has been live for a full quarter:`,
    "",
    "```text",
    `written lift                     ${pct(lift, 1)}`,
    `x usability factor               ${(0.7 + (0.3 * s0.U) / 100).toFixed(3)}     (0.7 + 0.3 x ${s0.U} / 100)`,
    `x understanding factor           ${cf.toFixed(3)}     (0.85 + 0.15 x ${clar.toFixed(2)})`,
    `x this game's multiplier         1.000     (the preview uses 1; a real game draws it around 1)`,
    `x hidden fact / briefing figure  1.000     (the preview uses the briefing's figure)`,
    `= lift that applies              ${pct(eff, 2)}`,
    `conversion                       ${pct(before, 1)} -> ${pct(after, 1)}`,
    "```",
    "",
  ];
  let a = structuredClone(s0), b = structuredClone(s0);
  b.live[itemId] = 0;
  const rows: string[][] = [];
  for (let q = 1; q <= 4; q++) {
    const ra = playQuarter(w, a, idleDecision(), { evQ: 99 }), rb = playQuarter(w, b, idleDecision(), { evQ: 99 });
    const ca = Object.values(ra.s.C).reduce((t, x) => t + x, 0), cb = Object.values(rb.s.C).reduce((t, x) => t + x, 0);
    rows.push([String(q), n0(ca), n0(cb), n0(cb - ca), `${n1(rb.r.revenue - ra.r.revenue)} L`, `${n1(rb.r.profit - ra.r.profit)} L`]);
    a = ra.s; b = rb.s;
  }
  return lines.join("\n") + "\n" + table(["Quarter", "Customers at the end, item not built", "Item live from the start", "Difference", "Revenue difference", "Profit difference"], rows)
    + "\n\nThe difference grows because the extra people who get through stay as customers, and each quarter adds more.";
}

function inits(cs: CaseData): string {
  const base = (id: string): Init => cs.inits.find((i) => i.id === id)!;
  return table(
    ["Item", "What it is", "Engineering / design / analyst weeks", "Understood at the start", "Sponsor", "Needs first", "What it does when it works (at the briefing's figures)", "Flags"],
    cs.inits.map((i) => {
      const eff = Object.entries(i.effects).map(([sid, e]) => `${cs.segments.find((x) => x.id === sid)!.name}: ${effectText(cs, e)}`).join("; ") || "nothing directly";
      const extra: string[] = [];
      if (i.debt < 0) extra.push(`technical debt ${i.debt}`);
      if (i.quality?.rel) extra.push(`reliability +${i.quality.rel}`);
      if (i.quality?.use) extra.push(`usability +${i.quality.use}`);
      if (i.enables) extra.push(`measurement level ${i.enables}`);
      if (i.perNew) extra.push(`pays ₹${i.perNew} ${i.perNewOn === "lift" ? "per extra customer it brings" : "per new first payer"}`);
      if (i.oneOff) extra.push(`one-off cost ${n0(i.oneOff)} L`);
      if (i.sideCost) extra.push(`running cost ${n0(i.sideCost.perQuarter)} L a quarter${i.sideCost.v ? ` at the briefing's ${i.sideCost.v}` : ""}${i.sideCost.cutBy ? `, cut ${pct(i.sideCost.cut ?? 0)} by ${base(i.sideCost.cutBy).name}` : ""}`);
      const flags = [i.big ? "big" : "", i.risky ? "risky" : "", i.fav ? "sponsor's favourite" : ""].filter(Boolean).join(", ") || "-";
      return [`**${i.name}**`, ABOUT[i.id] ?? "", `${i.eng} / ${i.design} / ${i.data}`, pct(i.clar), TEAM[i.sponsor]!, gateText(cs, i), [eff, ...extra].join("; "), flags];
    }),
  );
}

function hidden(cs: CaseData): string {
  const rows = Object.entries(cs.hidden).map(([k, [lo, hi]]) => {
    const moves = cs.inits.filter((i) => (i.scale ?? []).some((x) => x.v === k) || i.sideCost?.v === k).map((i) => i.name);
    const root = cs.root.dive === k ? `decides the root cause: ${cs.root.high} at ${cs.root.threshold} or more, otherwise ${cs.root.low}` : "";
    return [`**${k}**`, HIDDEN[k] ?? "", String(cs.brief[k]), `${lo} to ${hi}`, [moves.join(", "), root].filter(Boolean).join("; ")];
  });
  return table(["Hidden fact", "What it is, and where the briefing's figure comes from", "The briefing says", "In any one game it is somewhere in", "What it moves"], rows);
}

function events(cs: CaseData): string {
  return cs.events.map((e) => {
    const eff = Object.entries(e.effects).map(([sid, ef]) => `${cs.segments.find((x) => x.id === sid)!.name}: ${effectText(cs, ef)}`).join("; ");
    const mit = e.mitigations.map((m) => `${m.live ? `${cs.inits.find((i) => i.id === m.live)!.name} live` : m.trust ? `${TEAM[m.trust[0]]} trust ${m.trust[1]}+` : m.level !== undefined ? `measurement level ${m.level}` : `reliability ${m.rel}+`} (${pct(m.by)})`).join("; ");
    return [
      `**${e.name}** (${pct(e.weight)} of games)`,
      `- What the team sees: ${e.signal}`,
      `- What is happening: ${e.body}`,
      `- Causes offered: ${e.causes.map((c) => c.label).join(" / ")}. The true one: ${e.causes.find((c) => c.id === e.cause)!.label}.`,
      `- Responses offered: ${e.directions.map((c) => c.label).join(" / ")}. The right one: ${e.directions.find((c) => c.id === e.direction)!.label}.`,
      `- Damage if nothing absorbs it (full in the quarter it hits, half in the next): ${eff}${e.incident ? `; about ${e.incident} extra incidents` : ""}.`,
      `- What absorbs it: ${mit}. Reading the cause from data adds 15%, from a guess 5%; the right response adds 10%.`,
    ].join("\n");
  }).join("\n\n");
}

function plans(cs: CaseData): string {
  return table(["Plan for next year", "The pitch", "People arriving", "Revenue per customer", "Cost to serve", "Losses", "Marketing", "What has to be true"],
    cs.plans.map((p) => {
      const need: string[] = [];
      if (p.needs.use !== undefined) need.push(`usability ≥ ${p.needs.use}`);
      if (p.needs.rel !== undefined) need.push(`reliability ≥ ${p.needs.rel}`);
      if (p.needs.debtBelow !== undefined) need.push(`technical debt < ${p.needs.debtBelow}`);
      if (p.needs.trust) need.push(`${TEAM[p.needs.trust[0]]} trust ≥ ${p.needs.trust[1]}`);
      const m = (x: number): string => (x === 1 ? "same" : `×${x}`);
      return [`**${p.name}**`, p.pitch, m(p.inflow), m(p.arpu), m(p.cost), m(p.churn), m(p.marketing), need.join(", ")];
    }));
}

function rootQuestion(cs: CaseData): string {
  return cs.root.options.map((o) => `- ${o.label}${o.id === "need_more_data" ? " (an honest answer early, a weak one late)" : ""}`).join("\n");
}

const SUBS: { dim: string; id: string; measures: string; full: string; part: string; na: string }[] = [
  { dim: "strategy", id: "priority_alignment", measures: "The theme chosen for the second quarter against where the open work was worth most (true values).", full: "Chosen theme is the best one, and something was learned first (a deep dive or an experiment in the first two quarters).", part: "Best theme but nothing learned first; or the runner-up after learning.", na: "-" },
  { dim: "strategy", id: "roadmap_follows_priority", measures: "Share of engineering weeks that went to items serving the theme named that quarter.", full: `At least ${pct(CUT.roadmapOnPriority[0])}.`, part: `At least ${pct(CUT.roadmapOnPriority[1])}.`, na: "-" },
  { dim: "strategy", id: "stranded_work", measures: "Items started and not finished by the end, and not dropped.", full: "None.", part: "One.", na: "Nothing was built." },
  { dim: "evidence", id: "measurement_built", measures: "Whether the team can see its funnel, and whether anything depended on that.", full: "Full funnel visibility by the end of the second quarter, and an experiment, a level-gated item or an event reading depended on it.", part: "Visibility reached, but nothing used it; or reached late (third quarter).", na: "-" },
  { dim: "evidence", id: "learned_before_bets", measures: "Big or risky items that were tested, or whose hidden facts were read by a deep dive, before work began.", full: "All of them.", part: `At least ${pct(CUT.learnedShare[1])}.`, na: "No big or risky item was started." },
  { dim: "evidence", id: "experiments_acted_on", measures: "Whether each experiment reading was followed.", full: `At least ${pct(CUT.actedShare[0])} followed (built if positive, left or dropped if not).`, part: `At least ${pct(CUT.actedShare[1])}.`, na: "No experiments." },
  { dim: "evidence", id: "diagnosis", measures: "The root cause the manager named, against the true one in this game.", full: "Right, and the deep dive on the deciding fact had been run.", part: "Right, but no deep dive behind it (a lucky or unsupported answer).", na: "-" },
  { dim: "delivery", id: "delivered_vs_best", measures: "True value of the items shipped, timed by when they shipped, against the best set the capacity allowed.", full: `At least ${pct(CUT.deliveredVsBest[0])} of the best set.`, part: `At least ${pct(CUT.deliveredVsBest[1])}.`, na: "No item had positive value." },
  { dim: "delivery", id: "capacity_used", measures: "Engineering weeks put into the roadmap against what was available.", full: `At least ${pct(CUT.capacityUsed[0])}.`, part: `At least ${pct(CUT.capacityUsed[1])}.`, na: "-" },
  { dim: "delivery", id: "roadmap_fits_capacity", measures: "Quarters where the funded work, at its expected overrun, was no more than 115% of capacity.", full: `At least ${pct(CUT.fitsCapacity[0])} of quarters.`, part: `At least ${pct(CUT.fitsCapacity[1])}.`, na: "No roadmap." },
  { dim: "delivery", id: "pace_fits_state", measures: "Whether the pace suited morale, debt and recent incidents. Pushing is fine when morale is at least 65 and debt at most 55; a tired team should not be pushed.", full: "No quarter mismatched.", part: "One.", na: "-" },
  { dim: "stewardship", id: "debt_managed", measures: "Change in technical debt over the year.", full: `Fell by at least ${-CUT.debtChange[0]}.`, part: `Rose by at most ${CUT.debtChange[1]}.`, na: "-" },
  { dim: "stewardship", id: "reserves_matched", measures: "Reliability and debt reserves each quarter against need: too thin when reliability is under 60 (or there was an incident) or debt is over 60; wasteful above 18% when there is no need.", full: "At most one of eight settings off.", part: "Two or three off.", na: "-" },
  { dim: "stewardship", id: "incident_exposure", measures: "Expected incidents a quarter (from debt, reliability, pace and reserves; what actually happened is luck and is not counted) against a middling product.", full: `At most ${pct(CUT.incidentRatio[0])} of the middling rate.`, part: `At most ${pct(CUT.incidentRatio[1])}.`, na: "-" },
  { dim: "stewardship", id: "usability_kept", measures: "Change in usability over the year.", full: `Rose by at least ${CUT.usabilityChange[0]}.`, part: `Fell by at most ${-CUT.usabilityChange[1]}.`, na: "-" },
  { dim: "leadership", id: "commitments_kept", measures: "Promises made to the sponsoring teams, kept against broken.", full: `At least ${pct(CUT.keptShare[0])} kept and at least ${CUT.keptCount} kept in all (promising nothing is not leadership).`, part: `At least ${pct(CUT.keptShare[1])} kept.`, na: "No promises." },
  { dim: "leadership", id: "trust_built", measures: "Change in the five teams' trust in the manager.", full: `Average up at least ${CUT.trustChange[0]}, at least three teams up by 3 or more, none down more than 3.`, part: "Average not down.", na: "-" },
  { dim: "leadership", id: "morale_kept", measures: "Change in morale; capped at part if anyone left.", full: `Down by at most ${-CUT.moraleChange[0]}.`, part: `Down by at most ${-CUT.moraleChange[1]}.`, na: "-" },
  { dim: "leadership", id: "asks_sized_to_trust", measures: "Requests for marketing money or contractors, made when the team trusted the manager enough to grant at least half.", full: `At least ${pct(CUT.asksGranted[0])} of requests.`, part: `At least ${pct(CUT.asksGranted[1])}.`, na: "No requests." },
  { dim: "leadership", id: "gates_anticipated", measures: "Funded items that need something first (another item, measurement, trust), and whether they were stopped.", full: "Never stopped.", part: "Stopped, but got through in the end.", na: "No gated item was funded." },
  { dim: "adapt", id: "event_response", measures: "The cause named for the third-quarter event and the response chosen.", full: "Right cause read from data, and the right response.", part: "One of the two right (or the right cause from a guess).", na: "-" },
  { dim: "adapt", id: "event_absorbed", measures: "Share of the event's damage that was absorbed.", full: `At least ${pct(CUT.absorbed[0])}.`, part: `At least ${pct(CUT.absorbed[1])}.`, na: "-" },
  { dim: "adapt", id: "expectations_calibrated", measures: "Each quarter's forecast (profit against holding still: down, flat, up a little, up a lot) against what happened.", full: `Average credit at least ${CUT.calibrated[0]} (exact 1, one step off 0.5).`, part: `At least ${CUT.calibrated[1]}.`, na: "No forecasts." },
  { dim: "value", id: "value_created", measures: "Profit over the year plus what the position left behind is worth to a reference builder, against doing nothing, as a share of the same measure for a manager who was told every hidden fact.", full: `At least ${pct(CUT.valueCreated[0])}.`, part: `At least ${pct(CUT.valueCreated[1])}.`, na: "The informed manager created nothing." },
  { dim: "value", id: "paid_its_way", measures: "Profit over the year against doing nothing, as a share of the revenue of doing nothing.", full: `No worse than ${pct(CUT.paidItsWay[0], 1)}.`, part: `No worse than ${pct(CUT.paidItsWay[1], 1)}.`, na: "-" },
  { dim: "value", id: "unit_economics", measures: "Items shipped that lose money in this game.", full: "None.", part: "One.", na: "Nothing shipped." },
  { dim: "value", id: "cash_safe", measures: "Lowest cash against starting cash.", full: `At least ${pct(CUT.cash[0])} of it.`, part: `At least ${pct(CUT.cash[1])}.`, na: "-" },
  { dim: "value", id: "plan_choice", measures: "The term-sheet plan chosen, as a share of the way from the worst plan to the best (four quarters of profit from the end position, in this game).", full: `At least ${pct(CUT.planShare[0])}, and something was learned first.`, part: `At least ${pct(CUT.planShare[1])}; or the best plan with nothing learned.`, na: "-" },
];

function scoring(): string {
  return DIMS.map((d) => {
    const rows = SUBS.filter((s) => s.dim === d.id).map((s) => [`\`${s.id}\`${SUB_WEIGHT[s.id] ? " ×2" : ""}`, s.measures, s.full, s.part, s.na]);
    return `**${d.name}** (weight ${d.weight}; each of its ${rows.length} sub-criteria is worth ${n1(d.weight / rows.length)} points, and the ones marked ×2 are worth twice that)\n\n${table(["Sub-criterion", "What it measures", "Full (1)", "Part (½)", "Not applicable when"], rows)}`;
  }).join("\n\n");
}

/** What each dimension carries of the whole score when every sub-criterion applies: the weights with the doubled sub-criteria counted. */
function weights(): string {
  const worth = (dimId: string): number => { const subs = SUBS.filter((s) => s.dim === dimId), w = DIMS.find((d) => d.id === dimId)!.weight; return subs.reduce((t, s) => t + (w / subs.length) * (SUB_WEIGHT[s.id] ?? 1), 0); };
  const total = DIMS.reduce((t, d) => t + worth(d.id), 0);
  return table(["Dimension", "Weight", "Sub-criteria", "Doubled", "Share of the score when all apply"],
    DIMS.map((d) => [d.name, String(d.weight), String(SUBS.filter((s) => s.dim === d.id).length), String(SUBS.filter((s) => s.dim === d.id && SUB_WEIGHT[s.id]).length), pct(worth(d.id) / total, 1)]));
}

function example(caseIdx: number, botId: string, seed: number): string {
  const cs = CASES[caseIdx]!, w = newWorld(cs, seed), bot = BOTS.find((b) => b.id === botId)!;
  const run = playRun(w, bot.bot, botId), sc = scoreRun(run, playRun(w, doNothing, "do_nothing"), playRun(w, oracle, "oracle"));
  const lines: string[] = [`${botId} in ${cs.title}, game ${seed} (hidden: ${Object.entries(w.hidden).map(([k, v]) => `${k} ${n1(Math.round(v * 100) / 100)}`).join(", ")}; event: ${w.event.name})`, ""];
  run.qs.forEach((x, k) => lines.push(`Q${k + 1}: ${x.d.pace}, reserves ${pct(x.d.reserve.rel)}/${pct(x.d.reserve.debt)}; funded ${x.d.roadmap.join(", ") || "nothing"}; shipped ${x.r.completed.join(", ") || "nothing"}; profit ${n0(x.r.profit)} L`
    + `${x.r.readings.dived.length ? `; deep dives ${x.r.readings.dived.join(", ")}` : ""}${x.r.readings.tested.length ? `; experiments ${x.r.readings.tested.join(", ")}` : ""}`));
  lines.push("", `Score ${n1(sc.total)}${sc.modifiers.length ? ` (${n1(sc.base)} from the sub-criteria; ${sc.modifiers.map((m) => `${m.id} ${m.pts > 0 ? "+" : ""}${m.pts}`).join(", ")})` : ""}`);
  for (const d of sc.dims) { lines.push(`  ${d.name}: ${d.score === null ? "n/a" : Math.round(d.score * 100)}`); for (const s of d.subs) lines.push(`    ${s.level.padEnd(4)} ${s.id}: ${s.note}`); }
  return "```text\n" + lines.join("\n") + "\n```";
}

function calibration(): string {
  const txt = readFileSync("docs/venture-calibration-latest.txt", "utf8");
  return "```text\n" + txt.slice(txt.indexOf("SEEDS 1-40")).split("ITEM VALUES")[0]!.trim() + "\n```";
}

function whatif(): string {
  const txt = readFileSync("docs/venture-whatif-latest.txt", "utf8");
  return "```text\n" + txt.slice(txt.indexOf("=== ")).trim() + "\n```";
}

const fill: Record<string, string> = {};
fill["whatif"] = whatif();
CASES.forEach((cs, k) => {
  const key = k === 0 ? "marigold" : "tallyhouse";
  fill[`${key}.segments`] = segments(cs); fill[`${key}.start`] = start(cs); fill[`${key}.worked`] = worked(cs); fill[`${key}.inits`] = inits(cs);
  fill[`${key}.hidden`] = hidden(cs); fill[`${key}.events`] = events(cs); fill[`${key}.plans`] = plans(cs); fill[`${key}.root`] = rootQuestion(cs);
});
fill["marigold.effect"] = workedEffect(CASES[0]!, "kyc_camera", "new", "s2");
fill["tallyhouse.effect"] = workedEffect(CASES[1]!, "onboarding_wizard", "solo", "s1");
fill["scoring"] = scoring();
fill["weights"] = weights();
fill["calibration"] = calibration();
fill["example.good"] = example(0, "evidence_led", 2);
fill["example.poor"] = example(0, "textbook", 2);
fill["effort"] = `engineering effort in the item tables is the written estimate ×${EFFORT.eng}, design ×${EFFORT.design}`;

let out = readFileSync("docs/venture-model-spec.src.md", "utf8");
out = out.replace(/\{\{([\w.]+)\}\}/g, (m, k: string) => { const v = fill[k]; if (v === undefined) throw new Error(`no data for ${m}`); return v; });
writeFileSync("docs/venture-model-spec.md", out);
console.log(`wrote docs/venture-model-spec.md (${out.split("\n").length} lines)`);
