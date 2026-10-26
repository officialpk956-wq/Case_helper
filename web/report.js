// The report after a cycle, and the final report at the end of the run.
import { api, bandClass, barRow, h, namer, pct, rupees, toneOf } from "./lib.js";
import { eventCard, findings, kpis, tests, traitBars } from "./parts.js";
import { runTop } from "./play.js";
import { ventureFinalScreen, ventureReportScreen } from "./venture-report.js";

const LEVEL = { full: "Full", part: "Part", none: "None", na: "n/a" };

export async function reportScreen(ctx, ref, n) {
  const state = await api("GET", `/api/runs/${ref}`);
  if (state.kind === "venture") return ventureReportScreen(ctx, ref, n, state);
  const sc = await ctx.scenario(state.scenarioId);
  const report = state.reports[n - 1], score = state.scores[n - 1];
  if (!report || !score) { ctx.go(`#/run/${ref}`); return; }
  runTop(ctx, state, sc, `cycle ${n} report`);
  const brief = sc.timeline.cycle_briefs.find((b) => b.n === n);
  const isNewest = n === state.reports.length;
  const next = !isNewest ? { href: `#/run/${ref}`, label: "Back to the plan" }
    : state.phase === "final" ? { href: `#/run/${ref}/final`, label: "See your final report" }
    : state.phase === "review" ? { href: `#/run/${ref}`, label: "Make the monetisation call" }
    : { href: `#/run/${ref}`, label: `Plan cycle ${state.cycle}` };
  ctx.main.append(h("div", { class: "stack" },
    h("div", null, h("div", { class: "eyebrow" }, `Cycle ${n} of ${state.cycles} · locked`), h("h1", null, brief.title)),
    eventCard(report.event),
    h("section", { class: "card" },
      h("div", { class: "score-hero" },
        h("div", null, h("div", { class: "eyebrow" }, "This cycle's score"), h("div", { class: "big" }, score.final.toFixed(1))),
        h("div", { class: "stack" }, h("span", { class: `chip ${bandClass(score.band)}` }, score.band), h("div", { class: "muted" }, `${report.spent} of ${sc.capacity.eng_sprints_per_cycle} sprints committed`))),
      h("p", { class: "muted small" }, "The score is how you decided, not only how the numbers moved. The evidence behind each part is in your final report.")),
    h("div", { class: "grid cols-2" },
      h("section", { class: "card" }, h("h2", null, "By dimension"), traitBars(score.traits)),
      h("section", { class: "card" }, h("h2", null, "Cycle by cycle"), h("div", { class: "bars" }, state.scores.map((s) => barRow(`Cycle ${s.cycle}`, s.final / 100, s.final.toFixed(1), toneOf(s.final / 100)))))),
    h("section", null, h("h2", null, "Dashboard"), kpis(sc, state.reports.slice(0, n))),
    report.tests.length ? h("section", { class: "card" }, h("h2", null, "Tests that finished"), tests(sc, report.tests)) : null,
    h("section", { class: "card" }, h("h2", null, "New this cycle"), findings(sc, state, n)),
    h("div", { class: "row" }, h("a", { class: "btn primary", href: next.href }, next.label))));
}

export async function finalScreen(ctx, ref) {
  const state = await api("GET", `/api/runs/${ref}`);
  if (state.kind === "venture") return ventureFinalScreen(ctx, ref, state);
  let rep;
  try { rep = await api("GET", `/api/runs/${ref}/final`); } catch (e) { if (e.status === 409) { ctx.go(`#/run/${ref}`); return; } throw e; }
  const sc = await ctx.scenario(rep.scenarioId);
  const name = namer(sc);
  runTop(ctx, state, sc, "final report");

  const eg = rep.endgame, chosen = eg.values.find((v) => v.id === eg.option), top = eg.values.reduce((a, b) => (b.value > a.value ? b : a));
  const verdict = eg.ratio >= 0.85 ? "a call that held up" : eg.ratio >= 0.5 ? "a call that left value on the table" : "a call that missed most of the value";
  const cyclesEl = h("div", { class: "stack" }, rep.cycles.map((c) => h("details", { class: "more card flat", open: c.cycle === rep.cycles.length },
    h("summary", null, h("b", null, `Cycle ${c.cycle}`), `  ·  ${c.final.toFixed(1)}  ·  ${c.band}`),
    h("div", { class: "stack" },
      c.traits.map((t) => h("div", null, h("h3", null, t.name), h("table", null, h("tbody", null, t.subs.filter((s) => s.level !== "na").map((s) => h("tr", null,
        h("td", null, h("span", { class: `level ${s.level}` }, LEVEL[s.level])),
        h("td", null, h("b", null, s.label), h("div", { class: "small muted" }, s.evidence)),
        h("td", { class: "r num" }, `${s.points.toFixed(1)} / ${s.maxPoints.toFixed(1)}`))))))),
      c.modifiers.length ? h("div", null, h("h3", null, "Adjustments"), h("table", null, h("tbody", null, c.modifiers.map((m) => h("tr", null, h("td", { class: `r num ${m.points > 0 ? "up" : "down"}` }, `${m.points > 0 ? "+" : "−"}${Math.abs(m.points)}`), h("td", null, m.why)))))) : null))));

  const did = (d) => {
    const parts = [];
    if (d.clarify?.length) parts.push(["Asked", d.clarify.map(name).join(" / ")]);
    if (d.start?.length) parts.push(["Funded", d.start.map(name).join(", ")]);
    if (d.drop?.length) parts.push(["Shut down", d.drop.map(name).join(", ")]);
    if (d.experiments?.length) parts.push(["Tested", d.experiments.map((e) => `${name(e.lever)} on ${name(e.segment)}`).join(", ")]);
    if (d.notifications) parts.push(["Notifications", Object.entries(d.notifications).map(([s, v]) => `${name(s)} ${v.volume}/week`).join(", ")]);
    if (d.focusSegment) parts.push(["Focus", name(d.focusSegment)]);
    if (d.status?.bet) parts.push(["The bet", d.status.bet]);
    return parts.length ? h("dl", { class: "kv" }, parts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])) : h("p", { class: "muted" }, "Nothing committed.");
  };

  ctx.main.append(h("div", { class: "stack" },
    h("div", { class: "no-print" }, h("a", { href: "#/", class: "small" }, "← All cases")),
    h("section", { class: "card" },
      h("div", { class: "eyebrow" }, `${sc.company.name} · final report`),
      h("h1", null, "Final report"),
      h("div", { class: "score-hero" },
        h("div", { class: "big" }, rep.score.toFixed(1)),
        h("div", { class: "stack" }, h("span", { class: `chip ${bandClass(rep.band)}` }, rep.band), h("div", { class: "muted" }, `Mean of your ${rep.cycles.length} cycle scores. ${rep.rewindsUsed ? `You used ${rep.rewindsUsed} rewind${rep.rewindsUsed === 1 ? "" : "s"}.` : "No rewinds used."}`)))),
    h("div", { class: "grid cols-2" },
      h("section", { class: "card" }, h("h2", null, "By dimension"), traitBars(rep.traits), h("p", { class: "muted small" }, "Each bar is the share of the points available that you earned, across every cycle where it applied.")),
      h("section", { class: "card" }, h("h2", null, "Cycle by cycle"), h("div", { class: "bars" }, rep.cycles.map((c) => barRow(`Cycle ${c.cycle}`, c.final / 100, c.final.toFixed(1), toneOf(c.final / 100)))))),
    h("section", { class: "card" },
      h("h2", null, "The monetisation call"),
      h("p", null, `You chose `, h("b", null, eg.optionName), `: ${verdict}. It was worth ${rupees(chosen.value)} against ${rupees(top.value)} for the best option (${pct(eg.ratio, 0)} of it).`),
      eg.reasoning ? h("p", { class: "muted" }, `“${eg.reasoning}”`) : null,
      h("table", null, h("thead", null, h("tr", null, ["Option", "Worth in this case", ""].map((c) => h("th", null, c)))),
        h("tbody", null, eg.values.map((v) => h("tr", null, h("td", null, v.name), h("td", { class: "num" }, rupees(v.value)), h("td", null, v.id === eg.option ? h("span", { class: "chip accent" }, "Your choice") : null, v.id === top.id ? h("span", { class: "chip good" }, "Best") : null)))))),
    h("section", { class: "card" }, h("h2", null, "Where the points went"), h("p", { class: "muted" }, "Every part of the score, with the reason, for each cycle."), cyclesEl),
    h("section", { class: "card" }, h("h2", null, "What was true in your case"), h("p", { class: "muted" }, "Hidden from you while you played."),
      h("dl", { class: "kv" }, rep.case.flatMap((r) => [h("dt", null, r.label), h("dd", null, r.value)]))),
    h("section", { class: "card" }, h("h2", null, "What you did"), h("div", { class: "stack" }, rep.decisions.map((d) => h("div", null, h("h3", null, `Cycle ${d.cycle}`), did(d))))),
    h("div", { class: "row no-print" },
      h("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Print or save as PDF"),
      h("a", { class: "btn", href: `#/play/${sc.id}` }, "Play this case again"),
      h("a", { class: "btn ghost", href: "#/" }, "All cases"))));
}
