// Pieces shared by the venture screens: money and fact formats, what an item does, the company's dials, the funnel by measurement level.
import { barRow, h, pct, toneOf } from "./lib.js";

/** Rupees lakh as a person reads them: 100 lakh is a crore. */
export function lk(v, sign = false) {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : sign && v > 0 ? "+" : "";
  return a >= 100 ? `${s}₹${(a / 100).toFixed(1)} Cr` : `${s}₹${Math.round(a)} L`;
}
export const count = (n) => (n >= 1e5 ? `${(n / 1e5).toFixed(2)} L` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
export const signedPct = (v, d = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;
/** A table that scrolls sideways on a narrow screen instead of widening the page. */
export const scroll = (el, min = false) => h("div", { class: `scroll-x ${min ? "min" : ""}` }, el);
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const weeks = (v) => `${(Math.round(v * 10) / 10).toString()} wk`;

export const PRIORITY = { grow: "Grow", activate: "Activate", retain: "Retain", monetise: "Monetise", quality: "Quality", debt: "Technical debt", learn: "Learn" };
/** The case's own words (sc.terms is complete: the server fills in the product team's word wherever a case says nothing). */
export const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
export const partyName = (sc, k) => sc.terms.parties[k];
export const priorityName = (sc, k) => (k === "debt" ? sc.terms.debt : PRIORITY[k]);
export const PACE = {
  relaxed: ["Relaxed", "A little less output, half the new debt, a team that recovers, fewer incidents."],
  steady: ["Steady", "The pace the team can hold."],
  push: ["Push", "More output, but more debt, morale down 5 a quarter, and more incidents."],
};
export const FORECAST = { down: "Lower", flat: "About the same", up_small: "A little higher", up_large: "A lot higher" };
export const LEVEL = { full: "Full", part: "Part", none: "None", na: "n/a" };

/** A hidden fact's number in its own unit. */
export const factValue = (f, v) => (f.unit === "multiple" ? `${v.toFixed(2)}×` : `${Math.round(v * 100)}%`);

export function namer(sc) {
  const m = new Map();
  for (const s of sc.segments) m.set(s.id, s.name);
  for (const i of sc.items) m.set(i.id, i.name);
  for (const f of sc.facts) m.set(f.id, f.label);
  for (const p of sc.plans) m.set(p.id, p.name);
  return (id) => m.get(id) ?? id;
}

/** One line per segment saying what an item does when it works, at the briefing's figures. */
export function effectLines(sc, item) {
  const st = sc.stageNames, sg = (v) => signedPct(v);
  return Object.entries(item.effects).map(([segId, e]) => {
    const bits = [];
    if (e.inflow) bits.push(`more people arrive ${sg(e.inflow)}`);
    if (e.s1) bits.push(`${st[0]} ${sg(e.s1)}`);
    if (e.s2) bits.push(`${st[1]} ${sg(e.s2)}`);
    if (e.s3) bits.push(`${st[2]} ${sg(e.s3)}`);
    if (e.churn) bits.push(e.churn > 0 ? `losses cut ${Math.abs(e.churn * 100).toFixed(0)}%` : `losses up ${Math.abs(e.churn * 100).toFixed(0)}%`);
    if (e.arpu) bits.push(`revenue per customer ${sg(e.arpu)}`);
    if (e.cost) bits.push(`cost to serve ${sg(e.cost)}`);
    return `${sc.segments.find((s) => s.id === segId).name}: ${bits.join(", ")}`;
  });
}

/** What the item costs besides the team's weeks. */
export function costLines(item) {
  const out = [];
  if (item.one_off) out.push(`${lk(item.one_off)} once, when it ships`);
  if (item.per_new) out.push(`₹${item.per_new} ${item.per_new_on === "lift" ? "for each extra customer it brings" : "for each new first payer"}`);
  if (item.side_cost) out.push(`${lk(item.side_cost.per_quarter)} a quarter to run${item.side_cost.depends_on ? " (depends on a fact you can look into)" : ""}`);
  return out;
}

export function needText(sc, item) {
  const n = item.needs;
  if (!n) return null;
  const name = namer(sc), parts = [];
  if (n.done?.length) parts.push(`${n.done.map(name).join(" and ")} live`);
  if (n.level !== undefined) parts.push(`measurement level ${n.level}`);
  if (n.trust) parts.push(`${lcFirst(partyName(sc, n.trust[0]))} trust of ${n.trust[1]}`);
  const base = parts.join(" and ");
  return n.or_done ? `${base}, or ${name(n.or_done)} live` : base;
}

/** Company dials: debt, reliability, usability, morale, each 0 to 100. Debt is better low. */
export function dials(sc, now) {
  const rows = [[sc.terms.debt, now.debt, true], [sc.terms.reliability, now.reliability, false], [sc.terms.usability, now.usability, false], ["Morale", now.morale, false]];
  return h("div", { class: "bars" }, rows.map(([label, v, inverse]) => barRow(label, v / 100, String(Math.round(v)), toneOf(inverse ? 1 - v / 100 : v / 100))));
}
export function trustBars(sc, trust) {
  return h("div", { class: "bars" }, Object.entries(sc.terms.parties).map(([k, label]) => barRow(label, trust[k] / 100, String(Math.round(trust[k])), toneOf(trust[k] / 100))));
}

/** The funnel by segment, with what the measurement level allows. A cell the team cannot see yet says so. */
export function funnelTable(sc, funnel, level) {
  const seg = (s) => funnel[s.id];
  const rows = [
    ["People who start", (f) => count(f.arrivals), 0],
    [sc.stageNames[0], (f) => (f.registered != null ? count(f.registered) : null), 1],
    [sc.stageNames[1], (f) => (f.second != null ? count(f.second) : null), 2],
    [sc.stageNames[2], (f) => count(f.firstPayments), 0],
    ["Conversion by step", (f) => (f.rate1 != null ? `${pct(f.rate1, 0)} · ${pct(f.rate2, 0)} · ${pct(f.rate3, 0)}` : null), 2],
    ["Customers lost in the quarter", (f) => (f.lossRate != null ? pct(f.lossRate, 1) : null), 1],
    ["Customers at the end", (f) => count(f.customers), 0],
    ["Revenue", (f) => lk(f.revenue), 0],
  ];
  return scroll(h("table", null,
    h("thead", null, h("tr", null, h("th", null, ""), sc.segments.map((s) => h("th", { class: "r" }, s.name)))),
    h("tbody", null, rows.map(([label, f, need]) => h("tr", null,
      h("th", { scope: "row" }, label),
      sc.segments.map((s) => { const v = f(seg(s)); return h("td", { class: `r num ${v == null ? "muted" : ""}` }, v ?? `needs level ${need}`); }))))), true);
}

export function moneyTable(m) {
  const lines = [
    ["Revenue", m.revenue, true], ["Cost to serve customers", -m.serving], ["Cost of the sign-up steps", -m.steps], ["Rewards paid", -m.rewards], ["Running costs of what shipped", -m.running],
    ["Squad and company", -m.squad], ["Marketing", -m.marketing], ["Contractors and extra marketing you asked for", -m.requests], ["One-off costs", -m.oneOff], ["Lost to incidents", -m.incidentLoss],
  ].filter(([, v]) => Math.abs(v) >= 0.5);
  return h("table", null, h("tbody", null,
    lines.map(([label, v, strong]) => h("tr", null, h("td", null, strong ? h("b", null, label) : label), h("td", { class: "r num" }, lk(v)))),
    h("tr", null, h("td", null, h("b", null, "Profit")), h("td", { class: `r num ${m.profit >= 0 ? "up" : "down"}` }, h("b", null, lk(m.profit)))),
    h("tr", null, h("td", { class: "muted" }, "Cash at the end"), h("td", { class: "r num" }, lk(m.cash)))));
}

export function eventCard(ev, heading = "The market moved") {
  if (!ev) return null;
  return h("div", { class: "event" }, h("div", { class: "eyebrow" }, ev.aftershock ? "Still felt from last quarter" : heading), ev.name ? h("h3", null, ev.name) : null, h("p", null, ev.signal), ev.body ? h("p", { class: "muted" }, ev.body) : null);
}

export function learnedBlock(sc, learned, name) {
  const rows = [];
  for (const f of learned.facts) {
    const meta = sc.facts.find((x) => x.id === f.id);
    rows.push(h("div", { class: "finding" }, h("h3", null, meta.label), h("div", null, `The deep dive showed `, h("b", null, factValue(meta, f.value)), `. The briefing said ${factValue(meta, meta.brief)}.`)));
  }
  for (const e of learned.experiments) rows.push(h("div", { class: "finding" }, h("h3", null, `Experiment: ${name(e.id)}`), h("div", null, `Worth about `, h("b", null, lk(e.value, true)), " over the next two years, give or take 30%.")));
  return rows;
}
