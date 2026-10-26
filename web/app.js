// pm-sim in the browser: routes, the top bar and the timer. Nobody gets past the first request without an account (api() sends them to /login.html).
import { api, clock, h, session, theme, timer, toast } from "./lib.js";
import { catalogue, intro } from "./catalogue.js";
import { runScreen } from "./play.js";
import { finalScreen, reportScreen } from "./report.js";

const main = document.getElementById("main");
const topbar = document.getElementById("topbar");
const th = theme();
// The skip link is an in-page anchor, which the hash router would read as a page called "main".
document.querySelector(".skip")?.addEventListener("click", (e) => { e.preventDefault(); main.focus(); });
const cases = new Map();
let cleanups = [];
let active = null; // the run the top bar is showing: { ref, minutes, rewindsLeft, onRewind }
let clockEl = null;
const timerRefs = new Set(); // Timer ownership survives navigation away from the run.

let routeId = 0; // the navigation that is current; a screen still loading for an earlier one must not draw over the one that replaced it

const ctx = {
  scenario: async (id) => { if (!cases.has(id)) cases.set(id, await api("GET", `/api/cases/${id}`)); return cases.get(id); },
  refresh: () => route(),
  go: (hash) => { if (location.hash === hash) route(); else location.hash = hash; },
  top({ crumb, run }) {
    active = run ?? null;
    clockEl = run ? h("span", { class: "timer", role: "timer", "aria-label": "Time left" }) : null;
    topbar.replaceChildren(...[
      h("a", { class: "brand", href: "#/" }, "pm", h("span", null, "-sim")),
      crumb ? h("span", { class: "crumb" }, crumb) : null,
      h("span", { class: "grow" }),
      clockEl,
      run ? h("button", { class: "btn small ghost", type: "button", disabled: run.rewindsLeft === 0, onclick: run.onRewind, title: "Take a locked cycle again" }, `Rewind (${run.rewindsLeft})`) : null,
      h("span", { class: "who" }, session.user),
      h("button", { class: "btn small ghost", type: "button", onclick: deleteAccount }, "Delete account"),
      h("button", { class: "btn small ghost", type: "button", onclick: signOut }, "Sign out"),
      h("button", { class: "btn small ghost", type: "button", "aria-label": "Switch light and dark", onclick: () => th.toggle() }, "◐"),
    ].filter(Boolean));
    if (run) { timerRefs.add(run.ref); timer.start(run.ref); if (!document.hidden) timer.resume(run.ref); }
    tick();
  },
};

/**
 * What a screen is given for one navigation. Once the player has moved on, everything the screen still does is dropped: its drawing goes
 * to an element nobody sees, and it cannot change the top bar, raise a toast, move the page or leave a cleanup behind.
 */
function routeCtx(mine) {
  const live = () => mine === routeId;
  return {
    get main() { return live() ? main : document.createElement("main"); },
    scenario: ctx.scenario,
    top: (o) => { if (live()) ctx.top(o); },
    toast: (message) => { if (live()) toast(message); },
    go: (hash) => { if (live()) ctx.go(hash); },
    refresh: () => { if (live()) ctx.refresh(); },
    cleanup: (fn) => { if (live()) cleanups.push(fn); else fn(); },
  };
}

async function signOut() {
  try { await api("POST", "/api/auth/logout", {}); } catch { /* the session was already gone */ }
  location.replace("/login.html");
}

async function deleteAccount() {
  if (!confirm("Permanently delete this account and all its runs? This cannot be undone.")) return;
  try { await api("POST", "/api/auth/delete", {}); location.replace("/login.html"); }
  catch (e) { toast(e.message); }
}

function tick() {
  if (!document.hidden) for (const ref of timerRefs) timer.resume(ref);
  if (!clockEl || !active) return;
  // The clock is shared by every tab on this run, and another tab closing or hiding pauses it for all of them: a tab that is on screen runs it again.
  if (!document.hidden) timer.resume(active.ref);
  const left = timer.left(active.ref, active.minutes);
  if (left == null) { clockEl.textContent = `${active.minutes}:00`; return; }
  clockEl.textContent = clock(left);
  clockEl.classList.toggle("over", left < 0);
}
setInterval(tick, 1000);
document.addEventListener("visibilitychange", () => {
  for (const ref of timerRefs) { if (document.hidden) timer.pause(ref); else timer.resume(ref); }
});
addEventListener("pagehide", () => { for (const ref of timerRefs) timer.pause(ref); });
addEventListener("pageshow", tick);

async function route() {
  const mine = ++routeId, here = routeCtx(mine);
  for (const fn of cleanups) fn();
  cleanups = [];
  document.querySelector(".toast")?.remove();
  main.className = "";
  main.replaceChildren();
  ctx.top({});
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  try {
    if (!parts.length) await catalogue(here);
    else if (parts[0] === "play" && parts[1]) await intro(here, parts[1]);
    else if (parts[0] === "run" && /^\d+$/.test(parts[1] ?? "")) {
      if (parts[2] === "report") await reportScreen(here, parts[1], Number(parts[3]));
      else if (parts[2] === "final") await finalScreen(here, parts[1]);
      else await runScreen(here, parts[1]);
    } else main.append(h("div", { class: "card" }, h("h2", null, "Nothing here"), h("p", null, "That page does not exist."), h("a", { class: "btn", href: "#/" }, "All cases")));
  } catch (e) {
    if (mine !== routeId) return; // the player has moved on, so this failure is not theirs to see
    console.error(e);
    main.replaceChildren(h("div", { class: "card stack" }, h("h2", null, e.status === 404 ? "That run is not here any more" : "Something went wrong"),
      h("p", { class: "muted" }, e.message), h("a", { class: "btn primary", href: "#/" }, "Back to the cases")));
  }
  if (mine !== routeId) return;
  scrollTo(0, 0);
  main.focus({ preventScroll: true });
}
try { session.user = (await api("GET", "/api/auth/me")).user; } catch { /* a 401 has already sent the browser to the sign-in page */ }
if (session.user) {
  addEventListener("hashchange", route);
  route();
}
