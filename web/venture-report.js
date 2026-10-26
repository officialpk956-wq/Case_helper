// The report after each quarter, and the final report after the fourth.
import { api, barRow, bandClass, h, pct, toneOf } from "./lib.js";
import { LEVEL, FORECAST, PACE, eventCard, factValue, funnelTable, learnedBlock, lk, moneyTable, namer, plural, priorityName, lcFirst, scroll, signedPct, trustBars, weeks } from "./venture-parts.js";
import { ventureTop } from "./venture.js";

const delta = (after, before, inverse = false) => {
  const d = after - before;
  if (Math.abs(d) < 0.5) return h("span", { class: "flat" }, "no change");
  const good = inverse ? d < 0 : d > 0;
  return h("span", { class: good ? "up" : "down" }, `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}`);
};

export async function ventureReportScreen(ctx, ref, n, state) {
  const sc = await ctx.scenario(state.scenarioId), name = namer(sc);
  const report = state.reports[n - 1];
  if (!report) { ctx.go(`#/run/${ref}`); return; }
  ventureTop(ctx, state, sc, `quarter ${n} report`);
  const newest = n === state.reports.length;
  const next = !newest ? { href: `#/run/${ref}`, label: "Back to the plan" } : state.phase === "final" ? { href: `#/run/${ref}/final`, label: "See your final report" } : { href: `#/run/${ref}`, label: `Plan quarter ${state.quarter}` };
  const m = report.money, q = report.quality;
  const row = (label, before, after, inverse) => h("tr", null, h("td", null, label), h("td", { class: "r num" }, Math.round(before)), h("td", { class: "r num" }, Math.round(after)), h("td", { class: "r" }, delta(after, before, inverse)));
  const wk = report.weeks;
  ctx.main.append(h("div", { class: "stack" },
    h("div", null, h("div", { class: "eyebrow" }, `Quarter ${n} of ${state.quarters} · locked`), h("h1", null, report.title)),
    eventCard(report.event),
    h("section", { class: "card" },
      h("div", { class: "score-hero" },
        h("div", null, h("div", { class: "eyebrow" }, "Profit this quarter"), h("div", { class: `big ${m.profit >= 0 ? "" : "down"}` }, lk(m.profit))),
        h("div", { class: "stack" }, h("div", { class: "muted" }, `Cash is now ${lk(m.cash)}.`), h("div", { class: "muted" }, `The team put ${weeks(wk.used)} of ${weeks(wk.roadmap)} into the roadmap.`))),
      h("p", { class: "muted small" }, "There is no score yet. The score comes after the fourth quarter, when it can be set against what was possible.")),
    h("div", { class: "grid cols-2" },
      h("section", { class: "card" }, h("h2", null, "What shipped"),
        report.shipped.length ? h("ul", null, report.shipped.map((id) => h("li", null, h("b", null, name(id))))) : h("p", { class: "muted" }, "Nothing was finished."),
        report.stalled.length ? h("p", { class: "small" }, "Still in progress: ", report.stalled.map((s) => `${name(s.id)} (${weeks(s.weeks)} this quarter)`).join(", "), ".") : null,
        Object.keys(report.blocked).length ? h("div", { class: "small" }, h("b", null, "Blocked, so no weeks were spent: "), Object.entries(report.blocked).map(([id, why]) => h("div", null, `${name(id)} — ${why}`))) : null,
        report.promises.list.length ? h("p", { class: "small" }, `Promises: ${report.promises.kept} kept, ${report.promises.broken} broken.`, report.promises.list.map((p) => ` ${name(p.id)} ${p.kept ? "✓" : "✗"}`).join("")) : null),
      h("section", { class: "card" }, h("h2", null, "What the team learned"), report.learned.facts.length || report.learned.experiments.length ? learnedBlock(sc, report.learned, name) : h("p", { class: "muted" }, "Nothing new this quarter."),
        report.learned.skipped.length ? h("p", { class: "notice" }, report.learned.skipped.map((s) => `The ${s.kind} on ${name(s.id)} did not run: ${s.why}.`).join(" ")) : null)),
    h("section", { class: "card" }, h("h2", null, "The funnel"), funnelTable(sc, report.funnel, report.level),
      h("p", { class: "muted small" }, `Your team could measure: ${sc.measurement.find((x) => x.level === report.level).label}. ${report.level < 2 ? `Put more ${lcFirst(sc.terms.data)} weeks into measurement to see more of the funnel.` : ""}`)),
    h("div", { class: "grid cols-2" },
      h("section", { class: "card" }, h("h2", null, "The books"), moneyTable({ ...m })),
      h("section", { class: "card" }, h("h2", null, "The company"),
        h("table", null, h("thead", null, h("tr", null, ["", "Before", "After", ""].map((c) => h("th", { class: c ? "r" : "" }, c)))),
          h("tbody", null, row(sc.terms.debt, q.before.debt, q.after.debt, true), row(sc.terms.reliability, q.before.reliability, q.after.reliability), row(sc.terms.usability, q.before.usability, q.after.usability), row("Morale", q.before.morale, q.after.morale))),
        report.incidents ? h("p", { class: "small down" }, `${plural(report.incidents, "incident")} this quarter.`) : h("p", { class: "small muted" }, "No incidents this quarter."),
        report.attrition ? h("p", { class: "notice" }, `Someone left the ${lcFirst(sc.terms.eng)} team. Their replacement works at 60% for a quarter.`) : null,
        h("h3", null, "Who trusts you"), trustBars(sc, report.trust.after))),
    h("div", { class: "row" }, h("a", { class: "btn primary", href: next.href }, next.label))));
}

export async function ventureFinalScreen(ctx, ref, state) {
  let rep;
  try { rep = await api("GET", `/api/runs/${ref}/final`); } catch (e) { if (e.status === 409) { ctx.go(`#/run/${ref}`); return; } throw e; }
  const sc = await ctx.scenario(rep.scenarioId), name = namer(sc);
  ventureTop(ctx, state, sc, "final report");
  const money = rep.money, ev = rep.truth.event;
  const dimsEl = h("div", { class: "stack" }, rep.dimensions.map((dm) => h("details", { class: "more card flat", open: false },
    h("summary", null, h("b", null, dm.name), `  ·  ${dm.share == null ? "n/a" : Math.round(dm.share * 100)}`),
    h("table", null, h("tbody", null, dm.subs.filter((s) => s.level !== "na").map((s) => h("tr", null,
      h("td", null, h("span", { class: `level ${s.level}` }, LEVEL[s.level])),
      h("td", null, h("b", null, s.label), s.doubled ? h("span", { class: "chip" }, "counts double") : null, h("div", { class: "small muted" }, s.note))))),
      dm.subs.some((s) => s.level === "na") ? h("tfoot", null, h("tr", null, h("td", { colspan: 2, class: "small muted" }, `Did not apply: ${dm.subs.filter((s) => s.level === "na").map((s) => s.label).join(", ")}.`))) : null))));
  const dec = (d) => {
    const bits = [];
    bits.push(["Funded", d.roadmap.length ? d.roadmap.map(name).join(", ") : "nothing"]);
    if (d.commit?.length) bits.push(["Promised", d.commit.map(name).join(", ")]);
    if (d.drop?.length) bits.push(["Dropped", d.drop.map(name).join(", ")]);
    if (d.dives?.length || d.experiments?.length) bits.push(["Learned", [...(d.dives ?? []).map((f) => `looked into ${name(f)}`), ...(d.experiments ?? []).map((e) => `tested ${name(e)}`)].join("; ")]);
    bits.push(["Pace and reserves", `${PACE[d.pace][0]}, ${lcFirst(sc.terms.reliability)} ${pct(d.reserve.rel, 0)}, ${lcFirst(sc.terms.debt)} ${pct(d.reserve.debt, 0)}`]);
    if (d.priority) bits.push(["Theme", priorityName(sc, d.priority)]);
    if (d.reflection) bits.push(["Believed", `${sc.root.options.find((o) => o.id === d.reflection.root_cause)?.label ?? d.reflection.root_cause}; forecast ${FORECAST[d.reflection.expected].toLowerCase()}`]);
    if (d.plan) bits.push(["Plan", name(d.plan)]);
    return h("dl", { class: "kv" }, bits.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
  };

  ctx.main.append(h("div", { class: "stack" },
    h("div", { class: "no-print" }, h("a", { href: "#/", class: "small" }, "← All cases")),
    h("section", { class: "card" },
      h("div", { class: "eyebrow" }, `${sc.company.name} · final report`),
      h("h1", null, "Final report"),
      h("div", { class: "score-hero" },
        h("div", { class: "big" }, rep.score.toFixed(1)),
        h("div", { class: "stack" }, h("span", { class: `chip ${bandClass(rep.band)}` }, rep.band),
          h("div", { class: "muted" }, rep.idle ? "You took no decisions, so nothing could be earned." : `${rep.rewindsUsed ? `You used ${plural(rep.rewindsUsed, "rewind")}.` : "No rewinds used."}`),
          rep.modifiers.length ? h("div", { class: "small" }, rep.modifiers.map((m) => `${m.pts > 0 ? "+" : "−"}${Math.abs(m.pts)} ${m.why}`).join(" · ")) : null))),
    h("div", { class: "grid cols-2" },
      h("section", { class: "card" }, h("h2", null, "By dimension"), h("div", { class: "bars" }, rep.dimensions.map((dm) => barRow(dm.name, dm.share ?? 0, dm.share == null ? "—" : String(Math.round(dm.share * 100)), toneOf(dm.share ?? 0)))),
        h("p", { class: "muted small" }, "Each bar is the share of the points available that you earned.")),
      h("section", { class: "card" }, h("h2", null, "Money, over the year"),
        h("table", null, h("tbody", null,
          h("tr", null, h("td", null, "You"), h("td", { class: "r num" }, lk(money.made))),
          h("tr", null, h("td", null, "If you had done nothing"), h("td", { class: "r num" }, lk(money.ifNothing))),
          h("tr", null, h("td", null, "A manager told every hidden fact"), h("td", { class: "r num" }, lk(money.informed))))),
        h("p", { class: "muted small" }, "Profit over the four quarters. The score also counts what the position left behind for next year."))),
    h("section", { class: "card" }, h("h2", null, "Where the points went"), h("p", { class: "muted" }, "Every part of the score, with the reason. Open a dimension."), dimsEl),
    h("section", { class: "card" }, h("h2", null, "What was true"),
      h("p", { class: "muted" }, "Hidden from you while you played."),
      scroll(h("table", null, h("thead", null, h("tr", null, ["Fact", "The briefing said", "The truth", "You found"].map((c) => h("th", null, c)))),
        h("tbody", null, rep.truth.facts.map((f) => h("tr", null, h("td", null, f.label), h("td", { class: "num" }, factValue(f, f.brief)), h("td", { class: "num" }, h("b", null, factValue(f, f.truth))), h("td", { class: "num" }, f.found == null ? "—" : factValue(f, f.found))))))),
      h("p", null, h("b", null, "The cause: "), rep.truth.root.truth, ". ", rep.truth.root.said ? `You said: ${sc.root.options.find((o) => o.id === rep.truth.root.said)?.label ?? rep.truth.root.said}.` : "You never named one."),
      h("div", { class: "event" }, h("div", { class: "eyebrow" }, "The market event"), h("h3", null, ev.name), h("p", null, ev.body),
        h("p", { class: "small" }, `The cause was: ${ev.cause}. The right answer was: ${ev.response}.`),
        ev.you ? h("p", { class: "small" }, `You read the cause ${ev.readRight ? "right" : "wrong"}${ev.readRight ? (ev.checked ? ", checking it against data" : ", but only as a guess") : ""}, and ${ev.answeredRight ? "chose the right answer" : "chose a different answer"}. ${Math.round(ev.absorbed * 100)}% of the damage was absorbed.`) : h("p", { class: "small" }, "You gave no answer."))),
    h("section", { class: "card" }, h("h2", null, "What each item was worth"),
      h("p", { class: "muted" }, "Over the year and the year after, in this game. “At the briefing” is what the sponsors' numbers said it would be worth."),
      scroll(h("table", null, h("thead", null, h("tr", null, ["Item", "At the briefing", "In this game", "What you did"].map((c, i) => h("th", { class: i && i < 3 ? "r" : "" }, c)))),
        h("tbody", null, [...rep.items].sort((a, b) => b.worth - a.worth).map((i) => h("tr", null, h("td", null, i.name), h("td", { class: "r num" }, lk(i.briefed)), h("td", { class: `r num ${i.worth < 0 ? "down" : ""}` }, h("b", null, lk(i.worth))), h("td", null, i.shippedIn ? `Shipped in quarter ${i.shippedIn}` : "Not shipped"))))))),
    h("section", { class: "card" }, h("h2", null, "The plans"),
      h("table", null, h("thead", null, h("tr", null, ["Plan", "Four quarters of profit from where you ended", ""].map((c) => h("th", null, c)))),
        h("tbody", null, rep.plans.map((p) => h("tr", null, h("td", null, p.name), h("td", { class: "num" }, lk(p.value)), h("td", null, p.chosen ? h("span", { class: "chip accent" }, "Your choice") : null)))))),
    h("section", { class: "card" }, h("h2", null, "What a manager told every hidden fact would have done"),
      h("p", { class: "muted" }, "Not the only good game, and not perfect play. The benchmark the score measures you against."),
      scroll(h("table", null, h("thead", null, h("tr", null, ["Quarter", "Funded", "Pace", "Profit"].map((c) => h("th", null, c)))),
        h("tbody", null, rep.informed.map((x) => h("tr", null, h("td", { class: "num" }, x.q), h("td", null, x.funded.length ? x.funded.join(", ") : "nothing"), h("td", null, PACE[x.pace][0]), h("td", { class: "num" }, lk(x.profit)))))))),
    h("section", { class: "card" }, h("h2", null, "What you did"), h("div", { class: "stack" }, rep.quarters.map((x) => h("div", null, h("h3", null, `Quarter ${x.q} · profit ${lk(x.profit)}`), dec(x.decision))))),
    h("div", { class: "row no-print" },
      h("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Print or save as PDF"),
      h("a", { class: "btn", href: `#/play/${sc.id}` }, "Play this case again"),
      h("a", { class: "btn ghost", href: "#/" }, "All cases"))));
}
