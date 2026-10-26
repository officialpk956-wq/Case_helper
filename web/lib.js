// Shared helpers for the pm-sim browser app: DOM building, the API client, storage, number formats, timer, dialogs.

/** Build an element. Children can be strings, nodes, arrays, or nothing. `on*` attributes are listeners; `value`/`checked` are properties. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked") el[k] = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
/** Replace an element's children. Unlike replaceChildren, arrays are flattened and null is skipped. */
export const fill = (el, ...kids) => append(clear(el), kids);

/** Who is signed in; app.js fills it in before the first screen is drawn. */
export const session = { user: null };
/** Where the browser remembers a player's unfinished run of a case. It is per account, so two people sharing a browser keep their own. */
export const activeKey = (caseId) => `pm.active.${session.user}.${caseId}`;

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) location.replace("/login.html"); // the session ended (or never began)
  if (!res.ok) { const e = new Error(data?.error ?? res.statusText); e.status = res.status; throw e; }
  return data;
}

// localStorage can be missing or full; the app has to work without it.
export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- formats ----------

export const pretty = (id) => String(id).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
export function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
export const rupees = (n) => `₹${compact(n)}`;
export function users(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}
/** A metric value in its own unit. */
export function metricValue(m, v) {
  if (v == null || Number.isNaN(v)) return "—";
  if (m.unit.startsWith("share")) return pct(v, 1);
  if (m.unit === "seconds") return v >= 180 ? `${(v / 60).toFixed(1)} min` : `${v.toFixed(0)} s`;
  if (m.unit === "users") return users(v);
  return v.toFixed(2);
}
/** A change against a starting point, as a share. */
export function change(now, before) {
  if (now == null || !before) return null;
  return now / before - 1;
}
export const signed = (v, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;
export const ordinal = (n) => `${n}`;

export function bandClass(band) {
  return { Exceptional: "good", Strong: "good", Competent: "accent", Weak: "warn", Poor: "bad" }[band] ?? "";
}

/** A function from any id in the case (segment, lever, metric, question, reading) to its player-facing name. */
export function namer(sc) {
  const m = new Map();
  for (const s of sc.segments) m.set(s.id, s.name);
  for (const s of sc.stages) m.set(s.id, s.label);
  for (const l of sc.levers) m.set(l.id, l.name);
  for (const x of sc.metrics) m.set(x.id, x.label);
  for (const q of sc.questions) m.set(q.id, q.text);
  for (const [id, r] of Object.entries(sc.readings)) m.set(id, r.label);
  return (id) => m.get(id) ?? pretty(id);
}

// ---------- charts ----------

const SVG = "http://www.w3.org/2000/svg";
export function sparkline(values) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", "0 0 100 30");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  const vs = values.filter((v) => v != null && !Number.isNaN(v));
  if (vs.length < 2) return svg;
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const pts = values.map((v, i) => (v == null ? null : [4 + (92 * i) / (values.length - 1), 26 - (22 * (v - lo)) / span])).filter(Boolean);
  const line = document.createElementNS(SVG, "polyline");
  line.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(line);
  const last = pts[pts.length - 1];
  const dot = document.createElementNS(SVG, "circle");
  dot.setAttribute("cx", last[0]); dot.setAttribute("cy", last[1]); dot.setAttribute("r", "2.2");
  svg.append(dot);
  return svg;
}

/** A labelled horizontal bar; `share` is 0 to 1. */
export function barRow(label, share, text, tone) {
  const fill = h("i", { class: tone ?? "" });
  fill.style.width = `${Math.max(0, Math.min(1, share ?? 0)) * 100}%`;
  return h("div", { class: "bar" }, h("span", null, label), h("span", { class: "track", "aria-hidden": "true" }, fill), h("span", { class: "num" }, text));
}
export const toneOf = (share) => (share >= 0.75 ? "good" : share >= 0.5 ? "" : share >= 0.3 ? "warn" : "bad");

// ---------- dialog and toast ----------

const dialogs = [];
let backgroundInert = [];
export function dialog({ title, body, actions }) {
  const root = document.getElementById("dialog-root");
  const previous = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const wasTop = dialogs.at(-1) === scrim;
    document.removeEventListener("keydown", onkey);
    dialogs.splice(dialogs.indexOf(scrim), 1);
    scrim.remove();
    if (dialogs.length) dialogs.at(-1).inert = false;
    else { for (const [el, inert] of backgroundInert) el.inert = inert; backgroundInert = []; }
    if (wasTop) {
      const target = previous?.isConnected && !previous.closest('[inert]') ? previous : dialogs.at(-1)?.querySelector('button') ?? document.getElementById('main');
      target?.focus?.();
    }
  };
  // Escape closes and Tab stays inside the box, wherever focus happens to be (it can sit on the page behind the scrim).
  const onkey = (e) => {
    if (dialogs.at(-1) !== scrim) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const stops = [...box.querySelectorAll("button, a[href], input, select, textarea")].filter((el) => !el.disabled);
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
    if (!box.contains(at) || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) { e.preventDefault(); (e.shiftKey && box.contains(at) ? last : first).focus(); }
  };
  const buttons = actions.map((a) => h("button", { class: `btn ${a.primary ? "primary" : ""} ${a.danger ? "danger" : ""}`, type: "button", onclick: async () => { if ((await a.run?.()) !== false) close(); } }, a.label));
  const box = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h2", null, title), body, h("div", { class: "row" }, buttons));
  const scrim = h("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) close(); } }, box);
  if (!dialogs.length) {
    backgroundInert = [...document.body.children].filter((el) => el !== root).map((el) => [el, el.inert]);
    for (const [el] of backgroundInert) el.inert = true;
  } else dialogs.at(-1).inert = true;
  dialogs.push(scrim);
  root.append(scrim);
  document.addEventListener("keydown", onkey);
  (box.querySelector("button.primary") ?? box.querySelector("button"))?.focus();
  return close;
}

let toastTimer;
export function toast(message) {
  document.querySelector(".toast")?.remove();
  const t = h("div", { class: "toast", role: "status" }, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4200);
}

// ---------- timer: runs in this browser only, pauses while the tab is hidden ----------

const tkey = (ref) => `pm.timer.${ref}`;
export const timer = {
  start(ref) { if (!store.get(tkey(ref))) store.set(tkey(ref), { startedAt: Date.now(), pausedAt: document.hidden ? Date.now() : null, pausedTotal: 0 }); },
  pause(ref) { const t = store.get(tkey(ref)); if (t && !t.pausedAt) { t.pausedAt = Date.now(); store.set(tkey(ref), t); } },
  resume(ref) { const t = store.get(tkey(ref)); if (t?.pausedAt) { t.pausedTotal += Date.now() - t.pausedAt; t.pausedAt = null; store.set(tkey(ref), t); } },
  /** Seconds left of `minutes`, or null if it has not started. */
  left(ref, minutes) {
    const t = store.get(tkey(ref));
    if (!t) return null;
    const now = t.pausedAt ?? Date.now();
    return Math.round(minutes * 60 - (now - t.startedAt - t.pausedTotal) / 1000);
  },
};
export function clock(seconds) {
  const s = Math.abs(seconds), mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  return `${seconds < 0 ? "−" : ""}${mm}:${ss}`;
}

export function theme() {
  const t = store.get("pm.theme");
  if (t) document.documentElement.dataset.theme = t;
  return {
    toggle() {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      store.set("pm.theme", next);
    },
  };
}
