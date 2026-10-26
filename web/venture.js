// A venture run: the case file, then four quarters of planning. Each quarter has tabs (overview, roadmap, team, learn, forecast, and the
// market event or the board's plans when they are due), a live check that asks the server whether the plan stands and what it would give,
// and a lock. The server plays the quarter; this file only builds the decision and shows what the server says a player may see.
import { activeKey, api, barRow, dialog, fill, h, pct, pretty, store, toast, toneOf } from "./lib.js";
import {
  FORECAST, PACE, PRIORITY, costLines, count, dials, effectLines, eventCard, factValue, learnedBlock, lcFirst, lk, namer, needText, partyName, plural, priorityName, scroll, signedPct, trustBars, weeks,
} from "./venture-parts.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const approval = (trust) => Math.max(0, Math.min(1, (trust - 35) / 45));

/** The top bar for a venture run. */
export function ventureTop(ctx, state, sc, where) {
  ctx.top({
    crumb: `${sc.company.name} · ${where}`,
    run: { ref: state.ref, minutes: sc.meta.est_minutes, rewindsLeft: state.rewinds.max - state.rewinds.used, onRewind: () => rewindDialog(ctx, state) },
  });
}

function rewindDialog(ctx, state) {
  if (state.rewinds.used >= state.rewinds.max) return toast("You have used all your rewinds.");
  if (state.decisions === 0) return toast("There is nothing to rewind yet.");
  const sel = h("select", { "aria-label": "Rewind to" }, Array.from({ length: state.decisions }, (_, i) => i + 1).map((q) => h("option", { value: q, selected: q === state.decisions }, `The start of quarter ${q}`)));
  dialog({
    title: "Rewind time",
    body: h("div", { class: "stack" },
      h("p", null, `You have ${plural(state.rewinds.max - state.rewinds.used, "rewind")} left. Rewinding takes the company back to the start of a quarter you have already locked. The same world is waiting, so what you learned about it is still true; what you do next can differ.`),
      h("p", { class: "muted" }, "Everything you did from that quarter on is discarded, including the results and what you learned."), sel),
    actions: [
      { label: "Cancel" },
      { label: "Rewind", danger: true, run: async () => {
        try { await api("POST", `/api/runs/${state.ref}/rewind`, { target: Number(sel.value) }); toast(`Back at the start of quarter ${sel.value}.`); ctx.go(`#/run/${state.ref}`); } catch (e) { toast(e.message); return false; }
      } },
    ],
  });
}

// ---------- the case file ----------

export function ventureIntro(ctx, sc) {
  ctx.top({ crumb: sc.title });
  const c = sc.company;
  const begin = async (e) => {
    e.target.disabled = true;
    try {
      const run = await api("POST", "/api/runs", { scenario: sc.id });
      store.set(activeKey(sc.id), run.ref);
      location.hash = `#/run/${run.ref}`;
    } catch (err) { e.target.disabled = false; ctx.toast(err.message); }
  };
  const row = (k, v) => [h("dt", null, k), h("dd", null, v)];
  ctx.main.append(h("div", { class: "stack" },
    h("a", { href: "#/", class: "small" }, "← All cases"),
    h("div", { class: "eyebrow" }, "Case file"),
    h("h1", null, sc.title),
    h("p", { class: "muted" }, c.one_liner),
    h("div", { class: "grid cols-2" },
      h("section", { class: "card" },
        h("h3", null, c.name),
        h("dl", { class: "kv" }, row("Stage", c.stage), row("Market", c.market), row("Business model", c.business_model), row("Product", c.product), row("Your role", c.role)),
        h("p", null, c.brief)),
      h("section", { class: "card" },
        h("h3", null, "How a game works"),
        h("ol", null,
          h("li", null, h("b", null, "Four quarters. "), "Each is twelve weeks. You decide what the squad builds, how hard to push it, what to learn and what to promise."),
          h("li", null, h("b", null, "A limited team. "), `${sc.terms.eng}, ${lcFirst(sc.terms.design)} and ${lcFirst(sc.terms.data)} weeks are finite, and everything you start has to fit them. ${sc.terms.debt}, morale and trust change how much the team can do.`),
          h("li", null, h("b", null, "Facts to find out. "), "Sponsors state some numbers with confidence. They are not always right, and you can look into them before you spend a quarter on them."),
          h("li", null, h("b", null, "A market event "), "arrives in the third quarter. How much it costs depends on what you put in place earlier and how you read it."),
          h("li", null, h("b", null, "A plan for next year "), "is chosen in the last quarter, from the board's three offers.")),
        h("p", { class: "muted small" }, `About ${sc.meta.est_minutes} minutes; the timer only runs while this tab is open. You may rewind ${sc.maxRewinds} times if you want to take a quarter again. The preview shows what is predictable as numbers and what is not as a range, and never the hidden facts.`))),
    h("section", { class: "card" },
      h("h3", null, "What you are scored on"),
      h("p", { class: "muted" }, "Seven dimensions. A good result you cannot explain scores less than a well-argued decision backed by what you learned. Luck is not credited or blamed: your results are measured against doing nothing and against a manager who was told every hidden fact."),
      h("div", { class: "bars" }, sc.rubric.dimensions.map((t) => barRow(t.name, t.weight / Math.max(...sc.rubric.dimensions.map((x) => x.weight)), `${t.weight}`))),
      h("details", { class: "more" }, h("summary", null, "What is judged in each dimension"), h("div", { class: "grid cols-2" }, sc.rubric.dimensions.map((t) => h("div", null, h("b", null, t.name), h("ul", { class: "small muted" }, t.subs.map((s) => h("li", null, s)))))))),
    h("section", { class: "card" },
      h("h3", null, "People who will weigh in"),
      h("div", { class: "grid cols-2" }, c.stakeholders.map((p) => h("div", null, h("b", null, p.name), h("span", { class: "muted" }, ` · ${p.role}`), h("div", { class: "small" }, `“${p.says}”`))))),
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: begin }, "Start quarter 1"))));
}

// ---------- the plan for a quarter ----------

export async function ventureScreen(ctx, state) {
  const sc = await ctx.scenario(state.scenarioId);
  store.set(activeKey(sc.id), state.ref);
  ventureTop(ctx, state, sc, state.done ? "final report" : `quarter ${state.quarter} of ${state.quarters}`);
  if (state.phase === "final") { location.replace(`#/run/${state.ref}/final`); return; }
  plan(ctx, state, sc);
}

function plan(ctx, state, sc) {
  const { ref } = state, q = state.quarter, name = namer(sc);
  const item = (id) => sc.items.find((i) => i.id === id);
  const live = (id) => state.items.find((i) => i.id === id);
  const lastD = state.last ?? {};
  const draftKey = `pm.vdraft.${ref}.q${q}`, lockedKey = `pm.vlocked.${ref}.q${q}`;
  const inProgress = state.items.filter((i) => i.status === "in progress").map((i) => i.id);
  const d = Object.assign({
    roadmap: inProgress, drop: [], commit: [], experiments: [], dives: [],
    pace: lastD.pace ?? "steady", reserve: { rel: lastD.reserve?.rel ?? 0.06, debt: lastD.reserve?.debt ?? 0.07 },
    research: lastD.research ?? 0.4, instrument: lastD.instrument ?? 0.5,
    asks: { contractors: 0, marketing: 0 },
    priority: lastD.priority ?? "", root_cause: lastD.reflection?.root_cause ?? "", expected: "",
    reading: "", checked: false, direction: "", plan: "",
  }, store.get(draftKey) ?? store.get(lockedKey) ?? {});
  const persist = () => store.set(draftKey, d);

  const decision = () => {
    const out = { roadmap: d.roadmap, reserve: { rel: d.reserve.rel, debt: d.reserve.debt }, pace: d.pace, research: d.research, instrument: d.instrument };
    if (d.priority) out.priority = d.priority;
    if (d.drop.length) out.drop = d.drop;
    if (d.experiments.length) out.experiments = d.experiments;
    if (d.dives.length) out.dives = d.dives;
    const promised = d.commit.filter((id) => d.roadmap.includes(id));
    if (promised.length) out.commit = promised;
    const asks = {};
    if (d.asks.contractors > 0) asks.contractors = d.asks.contractors;
    if (d.asks.marketing > 0) asks.marketing = d.asks.marketing;
    if (Object.keys(asks).length) out.asks = asks;
    if (q === 3 && state.event && d.reading && d.direction) out.event = { evidence: d.checked && state.now.level >= 1, reading: d.reading, direction: d.direction };
    if (q === 4 && d.plan) out.plan = d.plan;
    if (d.root_cause && d.expected) out.reflection = { root_cause: d.root_cause, expected: d.expected };
    return out;
  };
  const missing = () => {
    const m = [];
    if (!d.priority) m.push("a theme");
    if (!d.root_cause) m.push("the cause you believe in");
    if (!d.expected) m.push("a forecast");
    if (q === 3 && state.event && (!d.reading || !d.direction)) m.push("your answer to the market event");
    if (q === 4 && !d.plan) m.push("a plan for next year");
    return m;
  };

  // ----- live check: the server tries the plan on a copy and says only whether it stands, and what it would give -----
  let pv = { s: "wait", msg: "Checking your plan…", data: null };
  let timerId = 0, seq = 0;
  const check = (delay = 350) => {
    clearTimeout(timerId);
    pv = { ...pv, s: "wait", msg: "Checking your plan…" };
    drawBar();
    timerId = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await api("POST", `/api/runs/${ref}/preview`, { decision: decision() });
        if (mine !== seq) return;
        pv = { s: r.ok ? "ok" : "err", msg: r.ok ? "Your plan stands." : r.error, data: r.preview ?? pv.data };
        drawBar();
        if (tab === "preview" || tab === "roadmap") drawPanel();
      } catch (e) {
        if (mine !== seq) return;
        pv = { ...pv, s: "err", msg: e.message };
        drawBar();
      }
    }, delay);
  };
  const touch = (redraw = true) => { persist(); check(); drawTabs(); if (redraw) drawPanel(); };

  // ----- shell -----
  const tabsEl = h("div", { class: "tabs", role: "tablist", "aria-label": "Plan sections" });
  const panelEl = h("div", { role: "tabpanel", tabindex: "0" });
  const barEl = h("div", { class: "planbar" });
  let tab = store.get(`pm.vtab.${ref}`) ?? "overview";

  const TABS = [
    ["overview", "Overview", () => 0],
    ["roadmap", "Roadmap", () => d.roadmap.length + d.drop.length],
    ["team", "Team and pace", () => 0],
    ["learn", "Learn", () => d.dives.length + d.experiments.length],
    ...(q === 3 && state.event ? [["event", "Market event", () => (d.reading && d.direction ? 1 : 0)]] : []),
    ...(q === 4 ? [["plan", "Next year", () => (d.plan ? 1 : 0)]] : []),
    ["forecast", "Theme and forecast", () => (missing().filter((x) => /theme|cause|forecast/.test(x)).length ? 0 : 1)],
    ["preview", "Preview", () => 0],
  ];
  // A tab remembered from another quarter (the market event, the plans) may not exist in this one.
  if (!TABS.some(([id]) => id === tab)) tab = "overview";
  const drawTabs = () => {
    const focused = tabsEl.contains(document.activeElement) ? document.activeElement.id : null;
    tabsEl.replaceChildren(...TABS.map(([id, label, count_]) => h("button", {
      class: "tab", role: "tab", type: "button", id: `vtab-${id}`, "aria-selected": String(tab === id),
      onclick: () => { tab = id; store.set(`pm.vtab.${ref}`, id); drawTabs(); drawPanel(); },
    }, label, count_() ? h("span", { class: "dot", "aria-label": "has changes" }) : null)));
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    const on = tabsEl.querySelector('[aria-selected="true"]');
    if (on) tabsEl.scrollLeft = Math.max(0, on.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2);
  };

  function drawBar() {
    const p = pv.data, needed = p?.roadmapWeeks.needed ?? 0, have = p?.roadmapWeeks.have ?? 1, over = needed > have * 1.0001;
    const fillEl = h("i");
    fillEl.style.width = `${Math.min(100, (needed / have) * 100)}%`;
    const miss = missing();
    barEl.replaceChildren(h("div", { class: "inner" },
      h("div", null,
        h("div", { class: "row between small" }, h("b", null, `${sc.terms.eng} weeks`), h("span", { class: "num" }, p ? `${weeks(needed)} of ${weeks(have)}` : "…")),
        h("div", { class: `meter ${over ? "over" : ""}`, role: "img", "aria-label": p ? `${Math.round(needed)} of ${Math.round(have)} ${lcFirst(sc.terms.eng)} weeks` : "checking" }, fillEl),
        p ? h("div", { class: "small muted" }, `Profit this quarter about ${lk(p.money.profit)} (80% range ${lk(p.money.low)} to ${lk(p.money.high)}), against ${lk(p.money.holdProfit)} if nothing changes.`) : null),
      h("div", null,
        h("div", { class: `check ${pv.s}`, "aria-live": "polite" }, h("b", null, pv.s === "ok" ? "✓" : pv.s === "err" ? "✗" : "…"), pv.msg),
        miss.length ? h("div", { class: "small muted" }, `Before you can lock: ${miss.join(", ")}.`) : null),
      h("button", { class: "btn primary", type: "button", disabled: pv.s !== "ok" || miss.length > 0, onclick: confirmLock }, `Lock quarter ${q}`)));
  }

  // ----- small builders -----
  const radios = (nameAttr, options, current, onPick) => h("div", { class: "options" }, options.map((o) => h("label", { class: "radio" },
    h("input", { type: "radio", name: nameAttr, value: o.id, checked: current === o.id, onchange: () => onPick(o.id) }), h("span", null, h("b", null, o.label), o.detail ? h("div", { class: "muted" }, o.detail) : null))));
  const slider = (id, label, min, max, step, value, show, onInput, hint) => {
    const out = h("span", { class: "num" }, show(value));
    return h("div", { class: "field" }, h("label", { for: id }, label),
      h("div", { class: "row" }, h("input", { id, type: "range", min, max, step, value, oninput: (e) => { const v = Number(e.target.value); out.textContent = show(v); onInput(v); } }), out),
      hint ? h("div", { class: "small muted" }, hint) : null);
  };
  const statusChip = (id) => {
    const s = live(id);
    if (s.status === "live") return h("span", { class: "chip good" }, `Live since quarter ${s.liveSince}`);
    if (s.status === "dropped") return h("span", { class: "chip" }, "Dropped");
    if (s.status === "in progress") return h("span", { class: "chip accent" }, `In progress, ${weeks(s.weeksPut)} put in`);
    return null;
  };
  const previewOf = (id) => pv.data?.items.find((x) => x.id === id);

  // ----- panels -----
  const panels = {
    overview() {
      const reports = state.reports, lastR = reports[reports.length - 1];
      const customers = Object.values(state.now.customers).reduce((t, x) => t + x, 0);
      const lvl = sc.measurement.find((m) => m.level === state.now.level);
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("div", { class: "eyebrow" }, `Quarter ${q} of ${state.quarters} · 12 weeks`), h("h2", null, state.opening.title), h("p", null, state.opening.text),
          lastR ? h("a", { class: "btn small", href: `#/run/${ref}/report/${reports.length}` }, "Read last quarter's report") : null),
        q === 3 && state.event ? h("div", { class: "event" }, h("div", { class: "eyebrow" }, "The market moved"), h("p", null, state.event.signal), h("button", { class: "btn small", type: "button", onclick: () => { tab = "event"; store.set(`pm.vtab.${ref}`, tab); drawTabs(); drawPanel(); } }, "Answer it")) : null,
        h("div", { class: "kpis" },
          h("div", { class: "kpi" }, h("div", { class: "eyebrow" }, "Cash"), h("div", { class: "v" }, lk(state.now.cash)), h("div", { class: "small muted" }, "In the bank now")),
          h("div", { class: "kpi" }, h("div", { class: "eyebrow" }, "Profit a quarter if nothing changes"), h("div", { class: `v ${state.holdProfit >= 0 ? "" : "down"}` }, lk(state.holdProfit)), h("div", { class: "small muted" }, "At the briefing's figures")),
          h("div", { class: "kpi" }, h("div", { class: "eyebrow" }, "Customers"), h("div", { class: "v" }, count(customers)), h("div", { class: "small muted" }, sc.segments.map((s) => `${s.name}: ${count(state.now.customers[s.id])}`).join(" · "))),
          h("div", { class: "kpi" }, h("div", { class: "eyebrow" }, "What the team can measure"), h("div", { class: "v small-v" }, lvl.label), h("div", { class: "small muted" }, lvl.shows))),
        h("div", { class: "grid cols-2" },
          h("section", { class: "card" }, h("h3", null, "The company"), dials(sc, state.now), h("p", { class: "muted small" }, `${sc.terms.debt} slows the team and breeds incidents, so lower is better. The others are better high.`)),
          h("section", { class: "card" }, h("h3", null, "Who trusts you"), trustBars(sc, state.now.trust), h("p", { class: "muted small" }, "Trust decides how much of your requests a team grants, and what it will let you start."))),
        h("section", { class: "card" }, h("h3", null, "What you have learned"),
          state.learned.facts.length || state.learned.experiments.length
            ? learnedBlock(sc, { facts: state.learned.facts, experiments: state.learned.experiments }, name)
            : h("p", { class: "muted" }, "Nothing yet. A deep dive shows one fact the sponsors have stated; an experiment reads what one item is worth before you commit a quarter to it.")),
        h("section", { class: "card" }, h("h3", null, "Who your customers are"), scroll(h("table", null,
          h("thead", null, h("tr", null, ["Segment", "Customers", "Start each quarter", "About them"].map((c) => h("th", null, c)))),
          h("tbody", null, sc.segments.map((s) => h("tr", null, h("td", null, h("b", null, s.name)), h("td", { class: "num" }, count(state.now.customers[s.id])), h("td", { class: "num" }, count(s.arrivals)), h("td", { class: "muted" }, s.description))))))),
        h("section", { class: "card" }, h("h3", null, "People who will weigh in"),
          h("div", { class: "grid cols-2" }, sc.company.stakeholders.map((p) => h("div", null, h("b", null, p.name), h("span", { class: "muted" }, ` · ${p.role}`), h("div", { class: "small" }, `“${p.says}”`))))));
    },

    roadmap() {
      const funded = d.roadmap, rest = sc.items.map((i) => i.id).filter((id) => !funded.includes(id) && live(id).status !== "live" && live(id).status !== "dropped");
      const done = sc.items.map((i) => i.id).filter((id) => ["live", "dropped"].includes(live(id).status));
      const move = (i, by) => { const o = [...d.roadmap]; [o[i], o[i + by]] = [o[i + by], o[i]]; d.roadmap = o; touch(); };
      const card = (id, index) => {
        const it = item(id), st = live(id), planned = d.roadmap.includes(id), pi = previewOf(id), promised = d.commit.includes(id), shutting = d.drop.includes(id);
        const gate = needText(sc, it), facts = it.depends_on.map((f) => sc.facts.find((x) => x.id === f));
        const known = (f) => state.learned.facts.find((k) => k.id === f.id);
        const statusPv = planned && pi ? h("span", { class: `chip ${pi.status === "ships" ? "good" : pi.status === "at risk" ? "warn" : "bad"}` }, pi.status === "blocked" ? `Blocked: ${pi.why}` : pi.status === "ships" ? "Ships this quarter" : pi.status === "at risk" ? "Might not ship" : "Does not fit") : null;
        const actions = st.status === "live" || st.status === "dropped" ? [] : [
          h("button", { class: `btn small ${planned ? "primary" : ""}`, type: "button", "aria-pressed": String(planned), onclick: () => { d.roadmap = planned ? d.roadmap.filter((x) => x !== id) : [...d.roadmap, id]; if (planned) d.commit = d.commit.filter((x) => x !== id); touch(); } }, planned ? "On the roadmap" : "Fund"),
          planned ? h("button", { class: `btn small ${promised ? "primary" : ""}`, type: "button", "aria-pressed": String(promised), title: `Promise ${partyName(sc, it.sponsor)} it ships this quarter`, onclick: () => { d.commit = promised ? d.commit.filter((x) => x !== id) : [...d.commit, id]; touch(); } }, promised ? `Promised to ${partyName(sc, it.sponsor)}` : `Promise ${partyName(sc, it.sponsor)}`) : null,
          st.status === "in progress" ? h("button", { class: `btn small ${shutting ? "danger" : ""}`, type: "button", "aria-pressed": String(shutting), onclick: () => { d.drop = shutting ? d.drop.filter((x) => x !== id) : [...d.drop, id]; if (!shutting) d.roadmap = d.roadmap.filter((x) => x !== id); touch(); } }, shutting ? "Dropping it" : "Drop it") : null,
        ];
        return h("div", { class: `card lever ${planned ? "planned" : ""}` },
          h("div", { class: "top" },
            h("div", null, h("h3", null, planned && index != null ? `${index + 1}. ${it.name}` : it.name),
              h("div", { class: "row" }, statusChip(id), statusPv, st.blocked && !planned ? h("span", { class: "chip warn" }, `Blocked: ${st.blocked}`) : null, h("span", { class: "chip" }, pretty(it.area)), it.big ? h("span", { class: "chip" }, "Big") : null, it.risky ? h("span", { class: "chip warn" }, "Risky") : null, it.favourite ? h("span", { class: "chip accent" }, `Favourite of ${lcFirst(partyName(sc, it.sponsor))}`) : null)),
            h("div", { class: "stack" }, h("div", { class: "cost" }, `${weeks(it.eng)} ${lcFirst(sc.terms.eng)}`), h("div", { class: "small muted num" }, `${weeks(it.design)} ${lcFirst(sc.terms.design)} · ${weeks(it.data)} ${lcFirst(sc.terms.data)}`),
              planned && index != null ? h("div", { class: "row" }, h("button", { class: "btn small", type: "button", disabled: index === 0, "aria-label": `Move ${it.name} up`, onclick: () => move(index, -1) }, "↑"), h("button", { class: "btn small", type: "button", disabled: index === funded.length - 1, "aria-label": `Move ${it.name} down`, onclick: () => move(index, 1) }, "↓")) : null)),
          h("p", null, it.about),
          h("div", { class: "row" }, actions),
          h("details", { class: "more" }, h("summary", null, "What it does, what it needs, what to know"),
            h("p", { class: "small" }, h("b", null, "When it works: "), effectLines(sc, it).join(" · ") || "it changes nothing directly"),
            it.debt !== 0 || it.quality || it.enables ? h("p", { class: "small" }, [it.debt < 0 ? `Pays down ${-it.debt} points of ${lcFirst(sc.terms.debt)}. ` : it.debt > 0 ? `Adds ${it.debt} points of ${lcFirst(sc.terms.debt)}. ` : "", it.quality?.rel ? `${sc.terms.reliability} +${it.quality.rel}. ` : "", it.quality?.use ? `${sc.terms.usability} +${it.quality.use}. ` : "", it.enables ? `Raises measurement to level ${it.enables}.` : ""].join("")) : null,
            costLines(it).length ? h("p", { class: "small" }, h("b", null, "Costs besides the team: "), costLines(it).join("; ")) : null,
            gate ? h("p", { class: "small" }, h("b", null, "Needs first: "), gate) : null,
            facts.length ? h("div", { class: "small" }, h("b", null, "What it depends on: "), facts.map((f) => h("div", null, `${f.label}. The briefing says ${factValue(f, f.brief)}${known(f) ? `; your deep dive showed ${factValue(f, known(f).value)}.` : "."}`))) : null,
            h("p", { class: "small muted" }, `Understood ${pct(it.understood, 0)} at the start. The estimate is the team's; real work usually runs over, less so when it is understood and the codebase is in good shape.`)));
      };
      return h("div", { class: "stack" },
        h("p", { class: "muted" }, "Items are funded in the order you list them. What does not fit stalls, and what you have put weeks into is kept for later. Promise a team an item only if you are sure it ships this quarter: a kept promise earns trust and a broken one costs more."),
        funded.length ? h("div", { class: "stack" }, h("h3", null, "Your roadmap"), funded.map((id, i) => card(id, i))) : h("p", { class: "notice" }, "Nothing is funded yet."),
        h("h3", null, "Other items"), rest.map((id) => card(id, null)),
        done.length ? [h("h3", null, "Done"), done.map((id) => card(id, null))] : null);
    },

    team() {
      const p = pv.data, cap = p?.capacity;
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("h3", null, "Pace"),
          radios("pace", Object.entries(PACE).map(([id, [label, detail]]) => ({ id, label, detail })), d.pace, (v) => { d.pace = v; touch(); })),
        h("section", { class: "card" }, h("h3", null, "Reserves"),
          h("p", { class: "muted" }, `Weeks held back from the roadmap. ${sc.terms.reliability} work cuts incidents and makes the team harder to knock over; ${lcFirst(sc.terms.debt)} work pays down what slows everyone. Each is at most 25%.`),
          slider("rsv-rel", `${sc.terms.reliability} reserve`, 0, 0.25, 0.01, d.reserve.rel, (v) => pct(v, 0), (v) => { d.reserve.rel = v; persist(); check(); drawBar(); }),
          slider("rsv-debt", `${sc.terms.debt} reserve`, 0, 0.25, 0.01, d.reserve.debt, (v) => pct(v, 0), (v) => { d.reserve.debt = v; persist(); check(); drawBar(); }),
          cap ? h("p", { class: "small muted" }, `The team has about ${weeks(cap.eng)} this quarter, ${weeks(cap.road)} of it for the roadmap after reserves. ${sc.terms.debt} and morale together give it ${pct(cap.vD * cap.vM, 0)} of its full strength.`) : null),
        h("section", { class: "card" }, h("h3", null, `${sc.terms.design} and ${lcFirst(sc.terms.data)} weeks`),
          h("p", { class: "muted" }, `${sc.terms.design} weeks the roadmap does not use go to research, which makes estimates tighter, or to polish, which raises ${lcFirst(sc.terms.usability)}. ${sc.terms.data} weeks go to the items that need them, then to deep dives and experiments, then to measurement.`),
          slider("split-res", `Free ${lcFirst(sc.terms.design)} weeks spent on research (the rest is polish)`, 0, 1, 0.05, d.research, (v) => pct(v, 0), (v) => { d.research = v; persist(); check(); }),
          slider("split-ins", `Free ${lcFirst(sc.terms.data)} weeks spent on measurement`, 0, 1, 0.05, d.instrument, (v) => pct(v, 0), (v) => { d.instrument = v; persist(); check(); }),
          p ? h("p", { class: "small muted" }, `${sc.terms.design}: ${weeks(p.designWeeks.free)} free (${weeks(p.designWeeks.research)} research, ${weeks(p.designWeeks.polish)} polish). ${sc.terms.data}: ${weeks(p.analystWeeks.used)} used of ${weeks(p.analystWeeks.have)}.`) : null),
        h("section", { class: "card" }, h("h3", null, "Ask for more"),
          h("p", { class: "muted" }, `A team grants a share of a request equal to how much it trusts you. A marketing request that is turned down mostly costs you the trust of ${lcFirst(partyName(sc, "biz"))}.`),
          slider("ask-c", `Contractor weeks (from ${lcFirst(partyName(sc, "lead"))})`, 0, sc.limits.contractors, 2, d.asks.contractors, (v) => `${v} wk`, (v) => { d.asks.contractors = v; persist(); check(); }, `Trust from ${lcFirst(partyName(sc, "lead"))} is ${Math.round(state.now.trust.lead)}: they would grant about ${pct(approval(state.now.trust.lead), 0)} of this.`),
          slider("ask-m", `Extra marketing money (from ${lcFirst(partyName(sc, "biz"))})`, 0, sc.limits.marketing, 20, d.asks.marketing, (v) => lk(v), (v) => { d.asks.marketing = v; persist(); check(); }, `Trust from ${lcFirst(partyName(sc, "biz"))} is ${Math.round(state.now.trust.biz)}: they would grant about ${pct(approval(state.now.trust.biz), 0)} of this.`)));
    },

    learn() {
      const level = state.now.level, analyst = sc.squad.data;
      const diveCount = d.dives.length, expCount = d.experiments.length;
      const tick = (list, id, max) => { d[list] = d[list].includes(id) ? d[list].filter((x) => x !== id) : d[list].length >= max ? d[list] : [...d[list], id]; touch(); };
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("h3", null, "What the team can measure"),
          h("div", { class: "options" }, sc.measurement.map((m) => h("div", { class: `radio ${m.level === level ? "on" : ""}` }, h("span", null, h("b", null, `Level ${m.level}: ${m.label}`, m.level === level ? "  (now)" : ""), h("div", { class: "muted" }, m.shows))))),
          h("p", { class: "muted small" }, `Measurement grows from ${lcFirst(sc.terms.data)} weeks put into it (set in Team and pace) or from items that build it. It decides what the reports show, whether experiments can run, and whether you can say you checked the cause of the market event.`)),
        h("section", { class: "card" }, h("h3", null, "Look into a fact"),
          h("p", { class: "muted" }, `A deep dive costs 1.5 ${lcFirst(sc.terms.data)} weeks and shows one fact to within a few percent. Your ${lcFirst(sc.terms.data)} team has ${analyst} ${analyst === 1 ? "person" : "people"}, so about ${Math.round(analyst * 12 * 0.85)} ${lcFirst(sc.terms.data)} weeks a quarter, shared with the items that need them.`),
          sc.facts.map((f) => {
            const k = state.learned.facts.find((x) => x.id === f.id), on = d.dives.includes(f.id);
            return h("div", { class: "card flat" }, h("div", { class: "row between" }, h("b", null, f.label),
              k ? h("span", { class: "chip good" }, `Known: ${factValue(f, k.value)}`) : h("button", { class: `btn small ${on ? "primary" : ""}`, type: "button", "aria-pressed": String(on), disabled: !on && diveCount >= sc.limits.dives, onclick: () => tick("dives", f.id, sc.limits.dives) }, on ? "Looking into it" : "Look into it")),
              h("p", { class: "small" }, f.description), h("p", { class: "small muted" }, `The briefing says ${factValue(f, f.brief)}.`));
          })),
        h("section", { class: "card" }, h("h3", null, "Run an experiment"),
          h("p", { class: "muted" }, level < 1 ? `Experiments need measurement level 1. Put ${lcFirst(sc.terms.data)} weeks into measurement first.` : `An experiment costs 2 ${lcFirst(sc.terms.data)} weeks and half a ${lcFirst(sc.terms.eng)} week, and reads what one item is worth before you commit a quarter to it. The reading is rough: give or take 30%.`),
          sc.items.filter((i) => live(i.id).status !== "live" && live(i.id).status !== "dropped").map((i) => {
            const on = d.experiments.includes(i.id), r = state.learned.experiments.find((x) => x.id === i.id);
            return h("div", { class: "card flat" }, h("div", { class: "row between" }, h("span", null, h("b", null, i.name), r ? `  · last read ${lk(r.value, true)} over two years` : ""),
              h("button", { class: `btn small ${on ? "primary" : ""}`, type: "button", "aria-pressed": String(on), disabled: (!on && expCount >= sc.limits.experiments) || level < 1, onclick: () => tick("experiments", i.id, sc.limits.experiments) }, on ? "Testing it" : "Test it")));
          })));
    },

    event() {
      const ev = state.event;
      return h("div", { class: "stack" },
        h("div", { class: "event" }, h("div", { class: "eyebrow" }, "The market moved"), h("p", null, ev.signal)),
        h("section", { class: "card" }, h("h3", null, "What do you think is behind it?"), radios("cause", ev.causes.map((c) => ({ id: c.id, label: c.label })), d.reading, (v) => { d.reading = v; touch(false); drawPanel(); }),
          h("label", { class: "radio" }, h("input", { type: "checkbox", checked: d.checked && ev.canCheck, disabled: !ev.canCheck, onchange: (e) => { d.checked = e.target.checked; touch(false); } }),
            h("span", null, h("b", null, "I checked this against our data"), h("div", { class: "muted" }, ev.canCheck ? "Only say this if you did. A guess that turns out right earns less than a reading you checked." : "Your measurement is too thin to check anything yet. You can still pick a cause, but it is a guess.")))),
        h("section", { class: "card" }, h("h3", null, "How do you answer it?"), radios("direction", ev.directions.map((c) => ({ id: c.id, label: c.label })), d.direction, (v) => { d.direction = v; touch(false); drawBar(); })),
        h("p", { class: "muted" }, `How much of the damage is absorbed depends on what you have already put in place (items live, trust, measurement, ${lcFirst(sc.terms.reliability)}), on reading the cause right, and on the response you choose. The follow-up goes in the roadmap as usual.`));
    },

    plan() {
      const now = state.now, opts = sc.plans.map((p) => {
        const meets = [];
        if (p.needs.use !== undefined) meets.push([`${lcFirst(sc.terms.usability)} at least ${p.needs.use}`, now.usability >= p.needs.use]);
        if (p.needs.rel !== undefined) meets.push([`${lcFirst(sc.terms.reliability)} at least ${p.needs.rel}`, now.reliability >= p.needs.rel]);
        if (p.needs.debt_below !== undefined) meets.push([`${lcFirst(sc.terms.debt)} below ${p.needs.debt_below}`, now.debt < p.needs.debt_below]);
        if (p.needs.trust) meets.push([`${lcFirst(partyName(sc, p.needs.trust[0]))} trust of ${p.needs.trust[1]}`, now.trust[p.needs.trust[0]] >= p.needs.trust[1]]);
        const m = (x) => (x === 1 ? null : `${x > 1 ? "+" : "−"}${Math.abs(Math.round((x - 1) * 100))}%`);
        const changes = [["people arriving", p.inflow], ["revenue per customer", p.arpu], ["cost to serve", p.cost], ["customers lost", p.churn], ["marketing", p.marketing]].filter(([, x]) => x !== 1).map(([l, x]) => `${l} ${m(x)}`);
        return { id: p.id, label: p.name, detail: h("div", null, h("div", null, p.pitch), h("div", { class: "small" }, `If it works: ${changes.join(", ")}.`),
          h("div", { class: "small" }, meets.length ? ["It needs ", meets.map(([t, ok], i) => [i ? ", " : "", h("span", { class: ok ? "up" : "down" }, `${t} ${ok ? "✓" : "✗ (not yet)"}`)])] : "It needs nothing in particular."), h("div", { class: "small muted" }, "Each need you do not meet takes 30% off what the plan promises.")) };
      });
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("div", { class: "eyebrow" }, "The board"), h("h2", null, "Which plan do you back for next year?"),
          h("p", null, `Your position when you choose is what counts: ${lcFirst(sc.terms.usability)}, ${lcFirst(sc.terms.reliability)}, ${lcFirst(sc.terms.debt)} and trust as they stand at the end of this quarter. Use the preview to see where this quarter's decisions leave them.`),
          h("div", { class: "options" }, opts.map((o) => h("label", { class: "radio" }, h("input", { type: "radio", name: "plan", value: o.id, checked: d.plan === o.id, onchange: () => { d.plan = o.id; touch(false); drawBar(); } }), h("span", null, h("b", null, o.label), o.detail))))));
    },

    forecast() {
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("h3", null, "What is this quarter mostly for?"), h("p", { class: "muted" }, "A theme says what you are trying to do. It changes no numbers, but it is read against what you fund."),
          radios("theme", Object.keys(PRIORITY).map((id) => ({ id, label: priorityName(sc, id) })), d.priority, (v) => { d.priority = v; touch(false); drawBar(); drawTabs(); })),
        h("section", { class: "card" }, h("h3", null, sc.root.prompt), h("p", { class: "muted" }, "Say what you believe now. “I need more data” is an honest answer early and a weak one late."),
          radios("root", sc.root.options.map((o) => ({ id: o.id, label: o.label })), d.root_cause, (v) => { d.root_cause = v; touch(false); drawBar(); drawTabs(); })),
        h("section", { class: "card" }, h("h3", null, "This quarter's profit, against doing nothing new"), h("p", { class: "muted" }, "The preview shows the expected figure. Say where you think it will actually land."),
          radios("fc", Object.entries(FORECAST).map(([id, label]) => ({ id, label })), d.expected, (v) => { d.expected = v; touch(false); drawBar(); drawTabs(); })));
    },

    preview() {
      const p = pv.data;
      if (!p) return h("p", { class: "muted" }, "Checking your plan…");
      const statusChip_ = (s) => h("span", { class: `chip ${s === "ships" ? "good" : s === "at risk" ? "warn" : "bad"}` }, s === "ships" ? "Ships" : s === "at risk" ? "At risk" : s === "blocked" ? "Blocked" : "Does not fit");
      return h("div", { class: "stack" },
        pv.s === "err" ? h("p", { class: "notice" }, pv.msg) : null,
        h("p", { class: "muted" }, "Everything here is at the briefing's figures and what you have learned. It is a forecast: how big the effects really are and how far the work runs over are what you do not know yet, and they are what the range shows."),
        h("div", { class: "grid cols-2" },
          h("section", { class: "card" }, h("h3", null, "The team's weeks"),
            h("div", { class: "bars" }, barRow("Roadmap", p.roadmapWeeks.needed / p.roadmapWeeks.have, `${weeks(p.roadmapWeeks.needed)} of ${weeks(p.roadmapWeeks.have)}`, p.roadmapWeeks.needed > p.roadmapWeeks.have ? "bad" : ""), barRow(sc.terms.data, p.analystWeeks.used / p.analystWeeks.have, `${weeks(p.analystWeeks.used)} of ${weeks(p.analystWeeks.have)}`)),
            h("p", { class: "small muted" }, `Before reserves the team has ${weeks(p.capacity.eng)}. ${sc.terms.design} has ${weeks(p.designWeeks.free)} free after the roadmap.`)),
          h("section", { class: "card" }, h("h3", null, "The quarter in money"),
            h("dl", { class: "kv" }, h("dt", null, "Profit expected"), h("dd", { class: "num" }, lk(p.money.profit)), h("dt", null, "80% range"), h("dd", { class: "num" }, `${lk(p.money.low)} to ${lk(p.money.high)}`), h("dt", null, "If nothing changed"), h("dd", { class: "num" }, lk(p.money.holdProfit)), h("dt", null, "Cash at the end"), h("dd", { class: "num" }, lk(p.money.cashAfter))))),
        p.items.length ? h("section", { class: "card" }, h("h3", null, "Your roadmap"), scroll(h("table", null,
          h("thead", null, h("tr", null, ["Item", "", "Weeks it still needs", "If the work runs slow"].map((c) => h("th", null, c)))),
          h("tbody", null, p.items.map((x) => h("tr", null, h("td", null, h("b", null, name(x.id)), x.why ? h("div", { class: "small muted" }, x.why) : null), h("td", null, statusChip_(x.status)), h("td", { class: "num" }, x.status === "blocked" ? "—" : weeks(x.weeksStillNeeded)), h("td", { class: "num" }, x.status === "blocked" ? "—" : weeks(x.weeksIfSlow)))))))) : null,
        p.skipped.length ? h("p", { class: "notice" }, p.skipped.map((s) => `${s.kind === "experiment" ? "The experiment on" : "The deep dive on"} ${name(s.id)} would not run: ${s.why}.`).join(" ")) : null,
        p.notes.length ? h("div", { class: "stack" }, p.notes.map((n) => h("p", { class: "notice" }, n))) : null,
        h("section", { class: "card" }, h("h3", null, "Where it leaves the company"), h("dl", { class: "kv" },
          h("dt", null, "Customers"), h("dd", { class: "num" }, count(p.after.customers)), h("dt", null, sc.terms.debt), h("dd", { class: "num" }, Math.round(p.after.D)), h("dt", null, sc.terms.reliability), h("dd", { class: "num" }, Math.round(p.after.R)),
          h("dt", null, sc.terms.usability), h("dd", { class: "num" }, Math.round(p.after.U)), h("dt", null, "Morale"), h("dd", { class: "num" }, Math.round(p.after.M)), h("dt", null, "Incidents expected"), h("dd", { class: "num" }, p.after.incidents.toFixed(1)))));
    },
  };

  function drawPanel() {
    const y = window.scrollY;
    panelEl.setAttribute("aria-labelledby", `vtab-${tab}`);
    panelEl.replaceChildren((panels[tab] ?? panels.overview)());
    window.scrollTo(0, y);
  }

  // ----- locking -----
  function confirmLock() {
    const rows = [
      ["Funding", d.roadmap.length ? d.roadmap.map(name).join(", ") : "nothing"],
      ["Promised", d.commit.filter((id) => d.roadmap.includes(id)).length ? d.commit.filter((id) => d.roadmap.includes(id)).map(name).join(", ") : "nothing"],
      ["Dropping", d.drop.length ? d.drop.map(name).join(", ") : "nothing"],
      ["Learning", [...d.dives.map((f) => `look into ${name(f)}`), ...d.experiments.map((e) => `test ${name(e)}`)].join("; ") || "nothing"],
      ["Pace and reserves", `${PACE[d.pace][0]}, ${lcFirst(sc.terms.reliability)} ${pct(d.reserve.rel, 0)}, ${lcFirst(sc.terms.debt)} ${pct(d.reserve.debt, 0)}`],
      ["Theme", priorityName(sc, d.priority)],
    ];
    if (q === 3 && state.event) rows.push(["Market event", `${state.event.causes.find((c) => c.id === d.reading)?.label ?? "—"} → ${state.event.directions.find((c) => c.id === d.direction)?.label ?? "—"}`]);
    if (q === 4) rows.push(["Plan for next year", name(d.plan)]);
    dialog({
      title: `Lock quarter ${q}?`,
      body: h("div", { class: "stack" }, h("dl", { class: "kv" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
        h("p", { class: "muted" }, state.rewinds.max - state.rewinds.used > 0 ? `You cannot change this afterwards, except by using one of your ${state.rewinds.max - state.rewinds.used} rewinds.` : "You have no rewinds left, so this is final.")),
      actions: [{ label: "Keep planning" }, { label: "Lock the quarter", primary: true, run: () => { lock(decision()); } }],
    });
  }

  async function lock(dec) {
    ctx.main.className = "";
    ctx.main.replaceChildren(h("div", { class: "processing" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("h2", null, `Closing quarter ${q}`), h("p", { class: "muted", "aria-live": "polite" }, "Building, shipping, counting customers, closing the books…")));
    barEl.remove();
    try {
      await Promise.all([api("POST", `/api/runs/${ref}/lock`, { decision: dec }), sleep(1400)]);
      store.set(lockedKey, d);
      store.del(draftKey);
      ctx.go(`#/run/${ref}/report/${q}`);
    } catch (e) {
      toast(e.message);
      ctx.refresh();
    }
  }

  ctx.main.className = "wide";
  ctx.main.replaceChildren(h("div", null, h("div", { class: "eyebrow" }, sc.company.name), h("h1", null, `Quarter ${q}: ${state.opening.title}`)), tabsEl, panelEl);
  document.body.append(barEl);
  ctx.cleanup(() => { clearTimeout(timerId); barEl.remove(); });
  drawTabs(); drawPanel(); drawBar(); check(0);
}
