// Pieces shared by the plan, report and final screens: the dashboard, what the player has learned, test results, the market event.
import { barRow, change, h, metricValue, namer, pct, pretty, signed, sparkline, toneOf } from "./lib.js";

/** The dashboard: what each metric last read, how it compares with the starting figure, and its path across cycles. */
export function kpis(sc, reports) {
  const last = reports[reports.length - 1];
  return h("div", { class: "kpis" }, sc.metrics.map((m) => {
    const seen = reports.map((r) => r.observed[m.id]);
    const now = last ? last.observed[m.id] : undefined;
    // Before any report, only what the company already measures; a metric that needs session tracking is not known yet.
    const known = last ? now !== undefined : m.visible_from_instrumentation === 0;
    const value = last ? now : m.baseline;
    const d = known && last ? change(now, m.baseline) : null;
    return h("div", { class: "kpi" },
      h("div", { class: "eyebrow" }, m.label),
      known
        ? [h("div", { class: "v" }, metricValue(m, value)),
           h("div", { class: `d ${d == null ? "flat" : d > 0.005 ? "up" : d < -0.005 ? "down" : "flat"}` }, last ? (d == null ? "" : `${signed(d)} on the starting figure`) : "Starting figure, as leadership reports it"),
           sparkline([m.baseline, ...seen])]
        : [h("div", { class: "v muted" }, "—"), h("div", { class: "small muted" }, last ? "Not measurable at your current tracking" : "Not measured yet")],
      h("div", { class: "small muted" }, m.definition));
  }));
}

function valueNode(v, ctx) {
  const { name, percent } = ctx;
  if (typeof v === "number") return h("span", { class: "num" }, percent ? pct(v, Math.abs(v) < 0.1 ? 2 : 1) : String(Number(v.toPrecision(3))));
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => valueNode(x, ctx)).flatMap((x, i) => (i ? [", ", x] : [x]));
  if (v && typeof v === "object") {
    if ("bucket" in v && Object.keys(v).length === 1) return h("span", { class: "chip" }, { below: "Below typical", typical: "About typical", above: "Above typical" }[v.bucket] ?? v.bucket);
    if ("order" in v && Object.keys(v).length === 1) return h("span", null, v.order.map((id, i) => [i ? " › " : "", name(id)]));
    return h("dl", { class: "kv" }, Object.entries(v).flatMap(([k, x]) => [h("dt", null, name(k)), h("dd", null, valueNode(x, ctx))]));
  }
  return String(v);
}

const FIDELITY = { exact: ["Exact", "good"], noisy: ["Rough figure", "warn"], directional: ["Direction only", "warn"] };

/** Everything the player has been shown about the hidden parts of the case, newest reading last. */
export function findings(sc, state, onlyCycle) {
  const name = namer(sc);
  const groups = state.readings.map((g) => ({ ...g, readings: g.readings.filter((r) => onlyCycle == null || r.cycle === onlyCycle) })).filter((g) => g.readings.length);
  if (!groups.length) return h("p", { class: "muted" }, onlyCycle == null ? "Nothing yet. Interviews, analytics, tests and some answers will show up here." : "Nothing new this cycle.");
  return h("div", null, groups.map((g) => {
    const meta = sc.readings[g.id] ?? { label: pretty(g.id) };
    return h("div", { class: "finding" },
      h("h3", null, meta.label),
      g.readings.map((r) => {
        const [fl, tone] = FIDELITY[r.fidelity] ?? [r.fidelity, ""];
        const covers = r.covers === "all" ? null : r.covers.map(name).join(", ");
        return h("div", { class: "stack" },
          h("div", { class: "row small muted" }, h("span", { class: `chip ${tone}` }, fl), `${r.viaName} · ${r.cycle === 0 ? "briefing" : `cycle ${r.cycle}`}`, covers ? ` · covers ${covers}` : ""),
          h("div", null, valueNode(r.value, { name, percent: meta.percent })));
      }));
  }));
}

/** What a finished test says, in the units that kind of test reads. */
function testResult(sc, t) {
  const l = sc.levers.find((x) => x.id === t.lever);
  if (l.kind === "holdout") return t.cohorts ? `Kept off the work: ${pct(t.cohorts.withheld)}. Everyone else: ${pct(t.cohorts.rest)}. Gap ${signed(t.estimate)}.` : "";
  if (l.kind === "offer") return `Read ${pct(t.estimate, 2)}`;
  const lift = `${signed(t.estimate)} on 30-day return`;
  return t.optOutEstimate != null ? `${lift}; opt-outs ${t.optOutEstimate >= 0 ? "+" : "−"}${Math.abs(t.optOutEstimate * 100).toFixed(1)} points` : lift;
}
const VERDICT = { win: ["Looks good", "good"], loss: ["Does not work", "bad"], inconclusive: ["Inconclusive", ""] };
/** A pricing test or a holdout measures a number and judges nothing, so it has no verdict to show. */
const reads = (sc, t) => ["offer", "holdout"].includes(sc.levers.find((x) => x.id === t.lever).kind);

export function tests(sc, list) {
  if (!list.length) return h("p", { class: "muted" }, "No tests yet.");
  const name = namer(sc);
  return h("table", null,
    h("thead", null, h("tr", null, ["Cycle", "Test", "Sample", "Result", ""].map((c) => h("th", null, c)))),
    h("tbody", null, list.map((t) => {
      const [vl, tone] = reads(sc, t) ? ["A reading", "accent"] : VERDICT[t.verdict] ?? [t.verdict, ""];
      return h("tr", null,
        h("td", { class: "num" }, t.cycle),
        h("td", null, h("b", null, name(t.lever)), h("div", { class: "small muted" }, `${name(t.segment)}${t.volume != null ? `, ${t.volume}/week` : ""}`)),
        h("td", { class: "num" }, `${t.samplePct}% · ${t.weeks}w${t.stoppedEarly ? " · stopped early" : ""}`),
        h("td", null, testResult(sc, t)),
        h("td", null, h("span", { class: `chip ${tone}` }, vl)));
    })));
}

export function eventCard(ev) {
  if (!ev) return null;
  return h("div", { class: "event" }, h("div", { class: "eyebrow" }, "The market moved"), h("h3", null, ev.name), h("p", null, ev.signal), h("p", { class: "muted" }, ev.body));
}

/** Seven trait bars, one per dimension the case scores. */
export function traitBars(traits) {
  return h("div", { class: "bars" }, traits.map((t) => barRow(t.name, t.pct ?? 0, t.pct == null ? "—" : `${Math.round(t.pct * 100)}`, toneOf(t.pct ?? 0))));
}
