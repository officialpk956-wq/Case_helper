// The run itself: briefing, the plan for a cycle (tabs, live check, lock), and the review after the last cycle.
import { activeKey, api, dialog, fill, h, namer, pct, pretty, store, toast } from "./lib.js";
import { eventCard, findings, kpis, tests } from "./parts.js";
import { ventureScreen } from "./venture.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The top bar for a run: where you are, the timer, and the rewinds you have left. */
export function runTop(ctx, state, sc, where) {
  ctx.top({
    crumb: `${sc.company.name} · ${where}`,
    run: { ref: state.ref, minutes: sc.meta.est_minutes, rewindsLeft: state.rewinds.max - state.rewinds.used, onRewind: () => rewindDialog(ctx, state, sc) },
  });
}

export async function runScreen(ctx, ref) {
  const state = await api("GET", `/api/runs/${ref}`);
  if (state.kind === "venture") return ventureScreen(ctx, state);
  const sc = await ctx.scenario(state.scenarioId);
  store.set(activeKey(sc.id), state.ref);
  runTop(ctx, state, sc, state.done ? "review" : `cycle ${state.cycle} of ${state.cycles}`);
  if (state.phase === "final") { location.replace(`#/run/${ref}/final`); return; }
  if (state.phase === "review") return review(ctx, state, sc);
  if (state.decisions === 0 && !store.get(`pm.briefed.${ref}`)) return briefing(ctx, state, sc);
  return plan(ctx, state, sc);
}

export function rewindDialog(ctx, state, sc) {
  if (state.rewinds.used >= state.rewinds.max) return toast("You have used all your rewinds.");
  if (state.decisions === 0) return toast("There is nothing to rewind yet.");
  const sel = h("select", { "aria-label": "Rewind to" }, Array.from({ length: state.decisions }, (_, i) => i + 1).map((c) => h("option", { value: c, selected: c === state.decisions }, `The start of cycle ${c}`)));
  dialog({
    title: "Rewind time",
    body: h("div", { class: "stack" },
      h("p", null, `You have ${plural(state.rewinds.max - state.rewinds.used, "rewind")} left. Rewinding takes the case back to the start of a cycle you have already locked. The same world is waiting, so what you learn is still true; what you do next can differ.`),
      h("p", { class: "muted" }, "Everything you did from that cycle on is discarded, including the results and what you learned."),
      sel),
    actions: [
      { label: "Cancel" },
      { label: "Rewind", danger: true, run: async () => {
        try {
          await api("POST", `/api/runs/${state.ref}/rewind`, { target: Number(sel.value) });
          toast(`Back at the start of cycle ${sel.value}.`);
          ctx.go(`#/run/${state.ref}`);
        } catch (e) { toast(e.message); return false; }
      } },
    ],
  });
}

// ---------- briefing ----------

function briefing(ctx, state, sc) {
  const c = sc.company;
  const draw = (st) => {
    const left = st.tokens.left;
    ctx.main.replaceChildren(h("div", { class: "stack" },
      h("div", null, h("div", { class: "eyebrow" }, "Briefing"), h("h1", null, c.name), h("p", { class: "muted" }, c.brief)),
      h("section", { class: "card" },
        h("div", { class: "row between" }, h("h3", null, "Ask before you commit"), h("span", { class: `chip ${left ? "accent" : "warn"}` }, `${plural(left, "question")} left of ${st.tokens.total}`)),
        h("p", { class: "muted" }, "Questions you ask now are answered straight away. The same budget covers any question you ask in later cycles, so spend it on what you do not know."),
        h("div", { class: "stack" }, sc.questions.map((q) => {
          const got = st.asked.find((a) => a.id === q.id);
          return h("div", { class: "card" },
            h("div", { class: "row between" },
              h("b", null, q.text),
              got ? h("span", { class: "chip good" }, "Asked") : h("button", { class: "btn small", type: "button", disabled: left === 0, onclick: async (e) => {
                e.target.disabled = true;
                try { draw(await api("POST", `/api/runs/${st.ref}/ask`, { ids: [q.id] })); } catch (err) { toast(err.message); e.target.disabled = false; }
              } }, "Ask")),
            got ? h("p", { class: "muted" }, got.answer) : null);
        }))),
      h("section", { class: "card" },
        h("h3", null, "People who will weigh in"),
        h("div", { class: "grid cols-2" }, c.stakeholders.map((p) => h("div", null, h("b", null, p.name), h("span", { class: "muted" }, ` · ${p.role}`), h("div", { class: "small muted" }, p.stance))))),
      h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: () => { store.set(`pm.briefed.${st.ref}`, true); ctx.go(`#/run/${st.ref}`); } }, "Start cycle 1"))));
  };
  draw(state);
}

// ---------- the plan for a cycle ----------

const REFLECT_SKIP = "expected_movement"; // answered afresh every cycle

function plan(ctx, state, sc) {
  const { ref } = state, cycle = state.cycle, lastCycle = cycle === sc.endgame.cycle;
  const name = namer(sc);
  const lv = (id) => sc.levers.find((l) => l.id === id);
  /** The engine's messages name levers by id; a player reads their names. */
  const leverIds = new RegExp("\\b(" + sc.levers.map((l) => l.id).sort((x, y) => y.length - x.length).join("|") + ")\\b", "g");
  const friendly = (m) => m.replace(leverIds, (id) => name(id));
  const dial = sc.levers.find((l) => l.kind === "dial");
  const draftKey = `pm.draft.${ref}.c${cycle}`;
  const lockedKey = `pm.locked.${ref}.c${cycle}`; // what was locked here before, so a rewind starts from your last plan
  const carry = store.get(`pm.last.${ref}`) ?? {};
  const d = Object.assign({
    clarify: [], start: [], drop: [], experiments: [],
    focusSegment: carry.focusSegment ?? "",
    reflection: Object.fromEntries(Object.entries(carry.reflection ?? {}).filter(([k]) => k !== REFLECT_SKIP)),
    status: { hypothesis: "", bet: "", expected_movement: "", risk: "" },
    ranking: [...state.ranking], rankingTouched: state.ranking.length > 0,
    endgame: { mode: "later", option: null, reasoning: "" },
    notif: structuredClone(state.notifications),
  }, store.get(draftKey) ?? store.get(lockedKey) ?? {});
  const persist = () => store.set(draftKey, d);

  const startedIds = new Set(state.started.map((s) => s.id));
  const notifChanges = () => Object.entries(d.notif).filter(([s, n]) => n.volume !== state.notifications[s].volume || n.targeting !== state.notifications[s].targeting);
  const spend = () => d.start.reduce((t, id) => t + lv(id).cost_sprints, 0) + (notifChanges().length ? dial.cost_sprints : 0) + d.experiments.length * sc.experiment.cost_sprints;
  const capacity = sc.capacity.eng_sprints_per_cycle;

  const decision = () => {
    const out = {};
    if (d.clarify.length) out.clarify = d.clarify;
    if (d.focusSegment) out.focusSegment = d.focusSegment;
    if (d.start.length) out.start = d.start;
    if (d.drop.length) out.drop = d.drop;
    const ch = notifChanges();
    if (ch.length) out.notifications = Object.fromEntries(ch.map(([s, n]) => [s, { volume: n.volume, targeting: n.targeting }]));
    if (d.experiments.length) out.experiments = d.experiments;
    if (d.rankingTouched && d.ranking.length) out.impactRanking = d.ranking;
    const refl = Object.fromEntries(Object.entries(d.reflection).filter(([, v]) => v));
    if (Object.keys(refl).length) out.reflection = refl;
    const status = Object.fromEntries(Object.entries(d.status).filter(([, v]) => v.trim()));
    if (Object.keys(status).length) out.status = status;
    if (lastCycle && d.endgame.mode === "now" && d.endgame.option) out.endgame = { option: d.endgame.option, reasoning: d.endgame.reasoning };
    return out;
  };

  const missing = () => {
    const m = [];
    if (!d.focusSegment) m.push("a focus segment");
    const unanswered = sc.reflection.filter((p) => !d.reflection[p.id]).length;
    if (unanswered) m.push(`${plural(unanswered, "reflection answer")}`);
    if (lastCycle && d.endgame.mode === "now" && (!d.endgame.option || (sc.endgame.reasoningRequired && !d.endgame.reasoning.trim()))) m.push("the monetisation call and why");
    return m;
  };

  // ----- live check: the server tries the plan on a copy and says only whether it stands -----
  let pv = { s: "wait", msg: "Checking your plan…", locks: {} };
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
        const relock = JSON.stringify(r.locks) !== JSON.stringify(pv.locks);
        pv = { s: r.ok ? "ok" : "err", msg: r.ok ? "Your plan stands." : friendly(r.error), locks: r.locks };
        drawBar();
        if (relock && ["research", "build"].includes(tab)) drawPanel();
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
  let tab = store.get(`pm.tab.${ref}`) ?? "overview";

  const TABS = [
    ["overview", "Overview", () => 0], ["questions", "Questions", () => d.clarify.length],
    ["research", "Measure & research", () => d.start.filter((id) => ["research", "foundation"].includes(lv(id).kind)).length],
    ["build", "Build", () => d.start.filter((id) => lv(id).kind === "build").length + d.drop.length],
    ["dial", "Notifications", () => notifChanges().length], ["tests", "Tests", () => d.experiments.length],
    ["rank", "Prioritise", () => (d.rankingTouched ? 1 : 0)], ["reflect", "Reflect", () => (missing().length ? 0 : 1)],
    ...(lastCycle ? [["endgame", "Monetisation", () => (d.endgame.mode === "now" && d.endgame.option ? 1 : 0)]] : []),
  ];
  const drawTabs = () => {
    const focused = tabsEl.contains(document.activeElement) ? document.activeElement.id : null;
    tabsEl.replaceChildren(...TABS.map(([id, label, count]) => h("button", {
      class: "tab", role: "tab", type: "button", id: `tab-${id}`, "aria-selected": String(tab === id),
      onclick: () => { tab = id; store.set(`pm.tab.${ref}`, id); drawTabs(); drawPanel(); },
    }, label, count() ? h("span", { class: "dot", "aria-label": "has changes" }) : null)));
    // On a narrow screen the row scrolls sideways; keep the chosen tab in view.
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    const on = tabsEl.querySelector('[aria-selected="true"]');
    if (on) tabsEl.scrollLeft = Math.max(0, on.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2);
  };

  function drawBar() {
    const used = spend(), over = used > capacity + 1e-9;
    const fill = h("i");
    fill.style.width = `${Math.min(100, (used / capacity) * 100)}%`;
    const miss = missing();
    barEl.replaceChildren(h("div", { class: "inner" },
      h("div", null,
        h("div", { class: "row between small" }, h("b", null, "Engineering capacity"), h("span", { class: "num" }, `${used} / ${capacity} sprints`)),
        h("div", { class: `meter ${over ? "over" : ""}`, role: "img", "aria-label": `${used} of ${capacity} sprints committed` }, fill)),
      h("div", null,
        h("div", { class: `check ${pv.s}`, "aria-live": "polite" }, h("b", null, pv.s === "ok" ? "✓" : pv.s === "err" ? "✗" : "…"), pv.msg),
        miss.length ? h("div", { class: "small muted" }, `Before you can lock: ${miss.join(", ")}.`) : null),
      h("button", { class: "btn primary", type: "button", disabled: pv.s !== "ok" || miss.length > 0, onclick: confirmLock }, `Lock cycle ${cycle}`)));
  }

  // ----- panels -----
  const panels = {
    overview() {
      const brief = sc.timeline.cycle_briefs.find((b) => b.n === cycle);
      const last = state.reports[state.reports.length - 1];
      const past = state.reports.flatMap((r) => r.tests);
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("div", { class: "eyebrow" }, `Cycle ${cycle} of ${state.cycles} · ${sc.timeline.cycle_weeks} weeks`), h("h2", null, brief.title), h("p", null, brief.brief)),
        eventCard(last?.event),
        h("section", null, h("h3", null, "Dashboard"), kpis(sc, state.reports)),
        h("section", { class: "card" }, h("h3", null, "What you have learned"), findings(sc, state)),
        past.length ? h("section", { class: "card" }, h("h3", null, "Test results"), tests(sc, past)) : null,
        state.started.length ? h("section", { class: "card" }, h("h3", null, "What is running"), h("table", null, h("tbody", null, state.started.map((s) => h("tr", null,
          h("td", null, h("b", null, name(s.id))),
          h("td", { class: "muted" }, `started in cycle ${s.cycle}`),
          h("td", null, s.dropped != null ? h("span", { class: "chip" }, `shut down in cycle ${s.dropped}`) : s.liveFrom <= cycle ? h("span", { class: "chip good" }, "live") : h("span", { class: "chip warn" }, `live from cycle ${s.liveFrom}`))))))) : null,
        h("section", { class: "card" }, h("h3", null, "Who your users are"), h("table", null,
          h("thead", null, h("tr", null, ["Segment", "Share", "About them"].map((c) => h("th", null, c)))),
          h("tbody", null, sc.segments.map((s) => h("tr", null, h("td", null, h("b", null, s.name)), h("td", { class: "num" }, pct(s.share, 0)), h("td", { class: "muted" }, s.description)))))));
    },

    questions() {
      const left = state.tokens.left - d.clarify.length;
      return h("div", { class: "stack" },
        h("p", { class: "muted" }, `${plural(left, "question")} left. A question you ask now is answered when you lock the cycle.`),
        sc.questions.map((q) => {
          const got = state.asked.find((a) => a.id === q.id), queued = d.clarify.includes(q.id);
          return h("div", { class: "card" },
            h("div", { class: "row between" }, h("b", null, q.text),
              got ? h("span", { class: "chip good" }, got.at === 0 ? "Asked in the briefing" : `Asked in cycle ${got.at}`)
                : h("button", { class: `btn small ${queued ? "primary" : ""}`, type: "button", "aria-pressed": String(queued), disabled: !queued && left === 0, onclick: () => { d.clarify = queued ? d.clarify.filter((x) => x !== q.id) : [...d.clarify, q.id]; touch(); } }, queued ? "Queued" : "Ask this cycle")),
            got ? h("p", { class: "muted" }, got.answer) : null);
        }));
    },

    research: () => leverList(["research", "foundation"], "Learn something, or fix what you can see. These take effect straight away unless they say otherwise."),
    build: () => leverList(["build"], "A build changes what people do, but it takes a cycle to go live and then ramps up. Only so many bets will be backed, so choose them with care."),

    dial() {
      const live = (t) => {
        const unlock = sc.levers.find((l) => l.params?.unlocks_targeting === t);
        return !unlock || state.started.some((s) => s.id === unlock.id && s.liveFrom <= cycle && s.dropped == null);
      };
      const [lo, hi] = dial.params.volume_per_week_range;
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("h3", null, dial.name), h("p", null, dial.description), h("p", { class: "muted" }, dial.player_prior), h("p", { class: "muted small" }, `${dial.risk} Changing the policy for any segment costs ${plural(dial.cost_sprints, "sprint")}.`)),
        sc.segments.map((s) => {
          const cur = d.notif[s.id], was = state.notifications[s.id];
          const out = h("span", { class: "num" }, `${cur.volume} per week`);
          return h("div", { class: "card" },
            h("div", { class: "row between" }, h("h3", null, s.name), h("span", { class: "muted small" }, `Today ${was.volume} per week, ${pretty(was.targeting).toLowerCase()}`)),
            h("div", { class: "field" }, h("label", { for: `vol-${s.id}` }, "Notifications per user per week"),
              h("div", { class: "row" }, h("input", { id: `vol-${s.id}`, type: "range", min: lo, max: hi, step: "0.1", value: cur.volume, oninput: (e) => { cur.volume = Number(e.target.value); out.textContent = `${cur.volume} per week`; persist(); check(); drawTabs(); } }), out)),
            h("div", { class: "field" }, h("label", { for: `tg-${s.id}` }, "Who gets them"),
              h("select", { id: `tg-${s.id}`, onchange: (e) => { cur.targeting = e.target.value; touch(false); } },
                dial.params.targeting_options.map((t) => h("option", { value: t, selected: cur.targeting === t, disabled: !live(t) && t !== was.targeting }, pretty(t) + (live(t) ? "" : " (needs a build first)"))))));
        }));
    },

    tests() {
      const slotsLeft = state.slots - d.experiments.length;
      const testable = sc.levers.filter((l) => l.testable);
      const f = { lever: testable[0].id, segment: sc.segments[0].id, samplePct: 25, weeks: 4, volume: 3, targeting: "rules" };
      const [sLo, sHi] = sc.experiment.sample_pct_range, [wLo, wHi] = sc.experiment.weeks_range;
      const form = h("div", { class: "card" });
      const drawForm = () => {
        const l = lv(f.lever);
        const sv = h("span", { class: "num" }, `${f.samplePct}%`), wv = h("span", { class: "num" }, `${f.weeks} weeks`), vv = h("span", { class: "num" }, `${f.volume} per week`);
        fill(form,
          h("h3", null, "Add a test"),
          h("div", { class: "field" }, h("label", { for: "tf-lever" }, "What to test"), h("select", { id: "tf-lever", onchange: (e) => { f.lever = e.target.value; drawForm(); } }, testable.map((t) => h("option", { value: t.id, selected: t.id === f.lever }, t.name)))),
          h("p", { class: "muted small" }, `${l.description} ${l.player_prior}`),
          h("div", { class: "field" }, h("label", { for: "tf-seg" }, "On which segment"), h("select", { id: "tf-seg", onchange: (e) => { f.segment = e.target.value; } }, sc.segments.map((s) => h("option", { value: s.id, selected: s.id === f.segment }, s.name)))),
          h("div", { class: "field" }, h("label", { for: "tf-sample" }, "Share of that segment in the test"), h("div", { class: "row" }, h("input", { id: "tf-sample", type: "range", min: sLo, max: sHi, step: "1", value: f.samplePct, oninput: (e) => { f.samplePct = Number(e.target.value); sv.textContent = `${f.samplePct}%`; } }), sv)),
          h("div", { class: "field" }, h("label", { for: "tf-weeks" }, "How long it runs"), h("div", { class: "row" }, h("input", { id: "tf-weeks", type: "range", min: wLo, max: wHi, step: "1", value: f.weeks, oninput: (e) => { f.weeks = Number(e.target.value); wv.textContent = `${f.weeks} weeks`; } }), wv)),
          l.kind === "dial" ? [
            h("div", { class: "field" }, h("label", { for: "tf-vol" }, "Notifications per week to try"), h("div", { class: "row" }, h("input", { id: "tf-vol", type: "range", min: dial.params.volume_per_week_range[0], max: dial.params.volume_per_week_range[1], step: "0.5", value: f.volume, oninput: (e) => { f.volume = Number(e.target.value); vv.textContent = `${f.volume} per week`; } }), vv)),
          ] : null,
          h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", disabled: slotsLeft <= 0, onclick: () => {
            d.experiments.push({ lever: f.lever, segment: f.segment, samplePct: f.samplePct, weeks: f.weeks, ...(l.kind === "dial" ? { volume: f.volume, targeting: f.targeting } : {}) });
            touch();
          } }, "Add this test"), h("span", { class: "muted small" }, `Costs ${plural(sc.experiment.cost_sprints, "sprint")} and uses one slot.`)));
      };
      drawForm();
      return h("div", { class: "stack" },
        h("p", { class: "muted" }, `${plural(slotsLeft, "test slot")} left this cycle. Results arrive when you lock, and they are never exact: small samples and short tests give noisy answers.`),
        d.experiments.map((e, i) => h("div", { class: "card" }, h("div", { class: "row between" },
          h("span", null, h("b", null, name(e.lever)), ` on ${name(e.segment)} · ${e.samplePct}% for ${e.weeks} weeks${e.volume != null ? ` · ${e.volume} per week` : ""}`),
          h("button", { class: "btn small ghost", type: "button", onclick: () => { d.experiments.splice(i, 1); touch(); } }, "Remove")))),
        form);
    },

    rank() {
      const builds = sc.levers.filter((l) => l.kind === "build");
      const order = [...d.ranking.filter((id) => builds.some((b) => b.id === id)), ...builds.map((b) => b.id).filter((id) => !d.ranking.includes(id))];
      const move = (i, by) => { const o = [...order]; [o[i], o[i + by]] = [o[i + by], o[i]]; d.ranking = o; d.rankingTouched = true; touch(); };
      return h("div", { class: "stack" },
        h("p", { class: "muted" }, "Put the builds in the order you expect them to lift 30-day return, best first. You can rank ones you have not funded. The order is part of what you commit to, so change it when you learn something."),
        h("div", { class: "row" }, h("span", { class: `chip ${d.rankingTouched ? "good" : ""}` }, d.rankingTouched ? "Your ranking will be recorded" : "Not ranked yet"),
          d.rankingTouched ? null : h("button", { class: "btn small", type: "button", onclick: () => { d.ranking = order; d.rankingTouched = true; touch(); } }, "Use this order")),
        order.map((id, i) => h("div", { class: "card flat row between" },
          h("span", null, h("span", { class: "num muted" }, `${i + 1}. `), h("b", null, name(id))),
          h("span", { class: "row" },
            h("button", { class: "btn small", type: "button", disabled: i === 0, "aria-label": `Move ${name(id)} up`, onclick: () => move(i, -1) }, "↑"),
            h("button", { class: "btn small", type: "button", disabled: i === order.length - 1, "aria-label": `Move ${name(id)} down`, onclick: () => move(i, 1) }, "↓")))));
    },

    reflect() {
      const radios = (p) => h("fieldset", { class: "card" },
        h("legend", { class: "label" }, p.text),
        h("div", { class: "options" }, p.options.map((o) => h("label", { class: "radio" }, h("input", { type: "radio", name: `r-${p.id}`, value: o.id, checked: d.reflection[p.id] === o.id, onchange: () => { d.reflection[p.id] = o.id; persist(); check(); drawTabs(); drawBar(); } }), h("span", null, o.label)))));
      const note = (key, label, ph) => h("div", { class: "field" }, h("label", { for: `st-${key}` }, label), h("textarea", { id: `st-${key}`, placeholder: ph, value: d.status[key], oninput: (e) => { d.status[key] = e.target.value; persist(); } }));
      const funded = d.start.map(name), shut = d.drop.map(name);
      return h("div", { class: "stack" },
        h("div", { class: "card" }, h("h3", null, "Where will you focus?"), h("p", { class: "muted" }, "Pick the segment this cycle is mostly for."),
          h("div", { class: "options" }, sc.segments.map((s) => h("label", { class: "radio" }, h("input", { type: "radio", name: "focus", value: s.id, checked: d.focusSegment === s.id, onchange: () => { d.focusSegment = s.id; persist(); check(); drawTabs(); drawBar(); } }), h("span", null, h("b", null, s.name), h("div", { class: "small muted" }, s.description)))))),
        sc.reflection.map(radios),
        h("div", { class: "card" }, h("h3", null, "What you are committing to"),
          h("dl", { class: "kv" }, h("dt", null, "Funding"), h("dd", null, funded.length ? funded.join(", ") : "nothing new"), h("dt", null, "Shutting down"), h("dd", null, shut.length ? shut.join(", ") : "nothing"),
            h("dt", null, "Testing"), h("dd", null, d.experiments.length ? d.experiments.map((e) => name(e.lever)).join(", ") : "nothing"),
            h("dt", null, "Notification policy"), h("dd", null, notifChanges().length ? "changing" : "unchanged"))),
        h("div", { class: "card" }, h("h3", null, "Your update to the CPO"), h("p", { class: "muted" }, "A few plain sentences about what you did this cycle and why. They are read against what you actually chose."),
          note("hypothesis", "Hypothesis", "What do you think is going on?"), note("bet", "The bet", "What are you doing about it this cycle?"), note("expected_movement", "What you expect", "What should move, and by how much?"), note("risk", "Risk", "What could make this wrong?"),
          h("button", { class: "btn small", type: "button", onclick: () => {
            const parts = [];
            if (d.start.length) parts.push(`start ${funded.join(", ")}`);
            if (d.experiments.length) parts.push(`test ${d.experiments.map((e) => name(e.lever)).join(", ")}`);
            if (notifChanges().length) parts.push("change the notification policy");
            if (d.drop.length) parts.push(`shut down ${shut.join(", ")}`);
            d.status.bet = parts.length ? `This cycle we ${parts.join("; ")}.` : "";
            persist(); drawPanel();
          } }, "Draft the bet from my plan")));
    },

    endgame() {
      const eg = sc.endgame;
      const card = (o) => h("label", { class: "radio" }, h("input", { type: "radio", name: "eg", value: o.id, checked: d.endgame.option === o.id, onchange: () => { d.endgame.option = o.id; touch(false); } }), h("span", null, h("b", null, o.name), h("div", { class: "muted" }, o.pitch)));
      return h("div", { class: "stack" },
        h("section", { class: "card" }, h("div", { class: "eyebrow" }, "Leadership asks"), h("h2", null, eg.title), h("p", null, eg.brief)),
        h("div", { class: "options" },
          h("label", { class: "radio" }, h("input", { type: "radio", name: "mode", checked: d.endgame.mode === "later", onchange: () => { d.endgame.mode = "later"; touch(); } }), h("span", null, h("b", null, "Decide after the final report"), h("div", { class: "muted" }, "You lock this cycle, see where it landed, then make the call with the numbers in front of you."))),
          h("label", { class: "radio" }, h("input", { type: "radio", name: "mode", checked: d.endgame.mode === "now", onchange: () => { d.endgame.mode = "now"; touch(); } }), h("span", null, h("b", null, "Decide now"), h("div", { class: "muted" }, "Commit before this cycle plays out, on what you expect to happen.")))),
        d.endgame.mode === "now" ? h("div", { class: "stack" }, h("div", { class: "options" }, eg.options.map(card)),
          h("div", { class: "field" }, h("label", { for: "eg-why" }, "Why this one?"), h("textarea", { id: "eg-why", value: d.endgame.reasoning, oninput: (e) => { d.endgame.reasoning = e.target.value; persist(); drawBar(); } }))) : null);
    },
  };

  function leverList(kinds, intro) {
    const list = sc.levers.filter((l) => kinds.includes(l.kind));
    return h("div", { class: "stack" }, h("p", { class: "muted" }, intro), list.map((l) => {
      const st = state.started.find((s) => s.id === l.id), planned = d.start.includes(l.id), shutting = d.drop.includes(l.id);
      const lock = pv.locks[l.id];
      const running = st && st.dropped == null;
      const status = running ? (st.liveFrom <= cycle ? h("span", { class: "chip good" }, `Running since cycle ${st.cycle}`) : h("span", { class: "chip warn" }, `Started in cycle ${st.cycle}, live from ${st.liveFrom}`))
        : st ? h("span", { class: "chip" }, `Shut down in cycle ${st.dropped}`) : planned ? h("span", { class: "chip accent" }, "In your plan") : lock ? h("span", { class: "chip" }, friendly(lock)) : null;
      const lead = l.lead_cycles === 0 ? "live straight away" : `live ${plural(l.lead_cycles, "cycle")} after you start it`;
      const action = !st
        ? h("button", { class: `btn small ${planned ? "primary" : ""}`, type: "button", "aria-pressed": String(planned), disabled: !planned && !!lock, onclick: () => { d.start = planned ? d.start.filter((x) => x !== l.id) : [...d.start, l.id]; touch(); } }, planned ? "Funded" : "Fund")
        : running && l.kind === "build"
          ? h("button", { class: `btn small ${shutting ? "danger" : ""}`, type: "button", "aria-pressed": String(shutting), onclick: () => { d.drop = shutting ? d.drop.filter((x) => x !== l.id) : [...d.drop, l.id]; touch(); } }, shutting ? "Shutting down" : "Shut down")
          : null;
      return h("div", { class: `card lever ${planned ? "planned" : ""} ${running ? "running" : ""}` },
        h("div", { class: "top" }, h("div", null, h("h3", null, l.name), h("div", { class: "row" }, status, h("span", { class: "chip" }, pretty(l.category)), l.stages.map((s) => h("span", { class: "chip" }, name(s))))),
          h("div", { class: "stack" }, h("div", { class: "cost" }, `${l.cost_sprints} sprint${l.cost_sprints === 1 ? "" : "s"}`), action)),
        h("p", null, l.description),
        h("div", { class: "small muted" }, `Takes effect ${lead}.`),
        h("details", { class: "more" }, h("summary", null, "What to know"), h("p", null, l.player_prior), h("p", { class: "muted" }, l.risk)));
    }));
  }

  function drawPanel() {
    const y = window.scrollY;
    panelEl.setAttribute("aria-labelledby", `tab-${tab}`);
    panelEl.replaceChildren((panels[tab] ?? panels.overview)());
    window.scrollTo(0, y);
  }

  // ----- locking -----
  function confirmLock() {
    const dec = decision();
    const rows = [
      ["Funding", d.start.length ? d.start.map(name).join(", ") : "nothing new"],
      ["Shutting down", d.drop.length ? d.drop.map(name).join(", ") : "nothing"],
      ["Testing", d.experiments.length ? d.experiments.map((e) => name(e.lever)).join(", ") : "nothing"],
      ["Questions", d.clarify.length ? d.clarify.map(name).join(" / ") : "none"],
      ["Capacity", `${spend()} of ${capacity} sprints`],
      ["Focus", name(d.focusSegment)],
    ];
    if (lastCycle) rows.push(["Monetisation", d.endgame.mode === "now" ? sc.endgame.options.find((o) => o.id === d.endgame.option).name : "after the final report"]);
    dialog({
      title: `Lock cycle ${cycle}?`,
      body: h("div", { class: "stack" }, h("dl", { class: "kv" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
        h("p", { class: "muted" }, state.rewinds.max - state.rewinds.used > 0 ? `You cannot change this afterwards, except by using one of your ${state.rewinds.max - state.rewinds.used} rewinds.` : "You have no rewinds left, so this is final.")),
      actions: [{ label: "Keep planning" }, { label: "Lock the cycle", primary: true, run: () => { lock(dec); } }],
    });
  }

  async function lock(dec) {
    ctx.main.className = "";
    ctx.main.replaceChildren(h("div", { class: "processing" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("h2", null, `Closing cycle ${cycle}`), h("p", { class: "muted", "aria-live": "polite" }, "Running your tests, reading the dashboards, scoring the cycle…")));
    barEl.remove();
    try {
      await Promise.all([api("POST", `/api/runs/${ref}/lock`, { decision: dec }), sleep(1600)]);
      store.set(`pm.last.${ref}`, { focusSegment: d.focusSegment, reflection: d.reflection });
      store.set(lockedKey, d);
      store.del(draftKey);
      ctx.go(`#/run/${ref}/report/${cycle}`);
    } catch (e) {
      toast(e.message);
      ctx.refresh();
    }
  }

  ctx.main.className = "wide";
  ctx.main.replaceChildren(h("div", null, h("div", { class: "eyebrow" }, sc.company.name), h("h1", null, `Cycle ${cycle}: ${sc.timeline.cycle_briefs.find((b) => b.n === cycle).title}`)), tabsEl, panelEl);
  document.body.append(barEl);
  ctx.cleanup(() => { clearTimeout(timerId); barEl.remove(); });
  drawTabs(); drawPanel(); drawBar(); check(0);
}

// ---------- review after the last cycle ----------

function review(ctx, state, sc) {
  const eg = sc.endgame;
  const f = { option: null, reasoning: "" };
  const submit = h("button", { class: "btn primary", type: "button", disabled: true, onclick: async (e) => {
    e.target.disabled = true;
    try { await api("POST", `/api/runs/${state.ref}/endgame`, { option: f.option, reasoning: f.reasoning }); ctx.go(`#/run/${state.ref}/final`); } catch (err) { toast(err.message); e.target.disabled = false; }
  } }, "Make the call");
  const ready = () => { submit.disabled = !f.option || (eg.reasoningRequired && !f.reasoning.trim()); };
  ctx.main.className = "wide";
  ctx.main.replaceChildren(h("div", { class: "stack" },
    h("div", null, h("div", { class: "eyebrow" }, "Review"), h("h1", null, eg.title), h("p", { class: "muted" }, eg.brief)),
    h("section", null, h("h3", null, "Where the final cycle landed"), kpis(sc, state.reports)),
    eventCard(state.reports.filter((r) => r.event).at(-1)?.event),
    h("section", { class: "card" }, h("h3", null, "What you have learned"), findings(sc, state)),
    state.reports.some((r) => r.tests.length) ? h("section", { class: "card" }, h("h3", null, "Test results"), tests(sc, state.reports.flatMap((r) => r.tests))) : null,
    h("section", { class: "card" }, h("h3", null, "Your call"),
      h("div", { class: "options" }, eg.options.map((o) => h("label", { class: "radio" }, h("input", { type: "radio", name: "eg", value: o.id, onchange: () => { f.option = o.id; ready(); } }), h("span", null, h("b", null, o.name), h("div", { class: "muted" }, o.pitch))))),
      h("div", { class: "field" }, h("label", { for: "why" }, eg.reasoningRequired ? "Why this one? (required)" : "Why this one?"), h("textarea", { id: "why", oninput: (e) => { f.reasoning = e.target.value; ready(); } })),
      h("div", { class: "row" }, submit, h("span", { class: "muted small" }, "This is final unless you rewind.")))));
}
