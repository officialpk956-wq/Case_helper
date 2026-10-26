// The case list and a case's introduction.
import { activeKey, api, barRow, h, pretty, store } from "./lib.js";
import { ventureIntro } from "./venture.js";

const people = (audience) => audience.map((a) => a.replace(/-/g, " ")).join(", ");

/** The case list's shape while it loads, so the page does not sit blank and then jump. */
function skeleton() {
  const bar = (cls) => h("div", { class: `skel ${cls}` });
  const card = () => h("div", { class: "card" }, bar("title"), bar("line"), bar("line short"), bar("line tiny"), bar("button"));
  return h("div", { class: "stack" },
    h("p", { class: "sr", role: "status" }, "Loading the cases"),
    h("section", { class: "hero", "aria-hidden": "true" }, bar("eyebrow"), bar("h1"), bar("h1 short"), bar("line"), bar("line short")),
    h("div", { class: "grid cols-2", "aria-hidden": "true" }, card(), card(), card(), card()));
}

export async function catalogue(ctx) {
  ctx.top({ crumb: "Case studies" });
  const loading = skeleton();
  ctx.main.append(loading);
  const cases = await api("GET", "/api/cases");
  const traitNames = new Set(cases.flatMap((c) => c.traits));
  const domains = [...new Set(cases.map((c) => c.meta.domain))];
  let filter = "all";
  const grid = h("div", { class: "grid cols-2" });
  const chips = h("div", { class: "row", role: "group", "aria-label": "Filter by track" });

  const resume = {};
  await Promise.all(cases.map(async (c) => {
    const ref = store.get(activeKey(c.id));
    if (!ref) return;
    try { resume[c.id] = await api("GET", `/api/runs/${ref}`); } catch { store.del(activeKey(c.id)); }
  }));

  const draw = () => {
    grid.replaceChildren(...cases.filter((c) => filter === "all" || c.meta.domain === filter).map((c, i) => {
      const run = resume[c.id];
      const action = run
        ? h("a", { class: "btn primary", href: `#/run/${run.ref}` }, run.done ? (run.phase === "final" ? "See your report" : "Finish the review") : `Resume ${c.kind === "venture" ? "quarter" : "cycle"} ${run.cycle} of ${run.cycles}`)
        : h("a", { class: "btn primary", href: `#/play/${c.id}` }, "Start the case");
      return h("article", { class: "card case-card" },
        h("div", { class: "row between" }, h("span", { class: "no" }, String(i + 1).padStart(2, "0")), h("span", { class: "chip live" }, "Live")),
        h("h2", null, c.title),
        h("p", { class: "muted" }, `${c.company}: ${c.one_liner}`),
        h("div", { class: "meta" },
          h("span", null, "Track ", h("b", null, pretty(c.meta.domain))),
          h("span", null, "Time ", h("b", null, `about ${c.meta.est_minutes} min`)),
          h("span", null, "Run ", h("b", null, `${c.cycles} ${c.kind === "venture" ? "quarters" : "cycles"} of ${c.cycle_weeks} weeks`)),
          h("span", null, "For ", h("b", null, people(c.meta.audience)))),
        h("div", { class: "row" }, c.traits.map((t) => h("span", { class: "chip" }, t))),
        h("div", { class: "row" }, action, run ? h("a", { class: "btn ghost", href: `#/play/${c.id}` }, run.done ? "Play again" : "Start over") : null));
    }));
    chips.replaceChildren(...["all", ...domains].map((d) => h("button", { class: `btn small ${d === filter ? "primary" : ""}`, type: "button", "aria-pressed": String(d === filter), onclick: () => { filter = d; draw(); chips.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }); } }, d === "all" ? "All" : pretty(d))));
  };
  draw();

  loading.remove();
  ctx.main.append(
    h("section", { class: "hero" },
      h("div", { class: "eyebrow" }, "Decision simulations"),
      h("h1", null, "Practise the calls a product, growth, engineering, design or company lead actually makes."),
      h("p", null, "Each case is a company with a problem, a few cycles to act in and a limited team to spend. The numbers move because of what you do. Your score comes from how you decide, judged inside the world you were dealt.")),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", null, cases.length), "live case" + (cases.length === 1 ? "" : "s")),
      h("div", { class: "stat" }, h("b", null, traitNames.size), "dimensions scored"),
      h("div", { class: "stat" }, h("b", null, "Local"), "runs stay on your machine")),
    h("div", { class: "stack" }, chips, grid),
    h("p", { class: "muted small fineprint" }, h("a", { href: "/legal.html" }, "Privacy and terms")));
}

export async function intro(ctx, id) {
  const sc = await ctx.scenario(id);
  if (sc.kind === "venture") return ventureIntro(ctx, sc);
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
        h("dl", { class: "kv" }, row("Stage", c.stage), row("Market", c.market), row("Business model", c.business_model), row("Your product", c.product)),
        h("p", null, c.brief)),
      h("section", { class: "card" },
        h("h3", null, "How a run works"),
        h("ol", null,
          h("li", null, h("b", null, "Brief. "), "Ask a few clarifying questions before you commit to anything."),
          h("li", null, h("b", null, "Plan. "), `Each cycle is ${sc.timeline.cycle_weeks} weeks. Spend ${sc.capacity.eng_sprints_per_cycle} engineering sprints on research, measurement, builds and tests. Every edit is checked as you make it, without showing results.`),
          h("li", null, h("b", null, "Reflect. "), "Say what you think is going on, what you will measure, and what you expect."),
          h("li", null, h("b", null, "Lock. "), "The cycle plays out. You see the dashboard, your tests and any market event."),
          h("li", null, h("b", null, "Decide. "), "In the last cycle you make the monetisation call and give your reasons.")),
        h("p", { class: "muted small" }, `${sc.timeline.cycles} cycles. You can ask ${sc.capacity.clarify_tokens} questions in all. You may rewind ${sc.maxRewinds} times if you want to take a cycle again. About ${sc.meta.est_minutes} minutes; the timer only runs while this tab is open.`))),
    h("section", { class: "card" },
      h("h3", null, "What you are scored on"),
      h("p", { class: "muted" }, "Seven dimensions. The score rewards a well-argued decision backed by what you learned more than a lucky result."),
      h("div", { class: "bars" }, sc.traits.map((t) => barRow(t.name, t.weight / Math.max(...sc.traits.map((x) => x.weight)), `${t.weight}`)))),
    h("section", { class: "card" },
      h("h3", null, "People who will weigh in"),
      h("div", { class: "grid cols-2" }, c.stakeholders.map((p) => h("div", null, h("b", null, p.name), h("span", { class: "muted" }, ` · ${p.role}`), h("div", { class: "small muted" }, p.stance))))),
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: begin }, "Begin the briefing"))));
}
