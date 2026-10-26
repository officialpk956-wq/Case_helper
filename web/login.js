// The sign-in page: one form that either signs in or creates an account, then goes to the app.
import { theme } from "./lib.js";

const $ = (id) => document.getElementById(id);
const th = theme();
$("theme").addEventListener("click", () => th.toggle());

let mode = "login";
function setMode(next) {
  mode = next;
  const register = mode === "register";
  $("tab-login").classList.toggle("primary", !register);
  $("tab-register").classList.toggle("primary", register);
  $("tab-login").setAttribute("aria-pressed", String(!register));
  $("tab-register").setAttribute("aria-pressed", String(register));
  $("form").action = register ? "/api/auth/register" : "/api/auth/login";
  $("password").autocomplete = register ? "new-password" : "current-password";
  $("username-hint").hidden = $("password-hint").hidden = $("agree").hidden = !register;
  $("submit").textContent = register ? "Create account and enter" : "Sign in";
  $("error").hidden = true;
}
$("tab-login").addEventListener("click", () => setMode("login"));
$("tab-register").addEventListener("click", () => setMode("register"));

function fail(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error").hidden = true;
  $("submit").disabled = true;
  try {
    const res = await fetch(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("username").value, password: $("password").value }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return fail(data?.error ?? "something went wrong; try again");
    location.replace("/");
  } catch {
    fail("the server did not answer; is it still running?");
  } finally {
    $("submit").disabled = false;
  }
});

// Already signed in: go straight to the cases.
fetch("/api/auth/me").then((res) => { if (res.ok) location.replace("/"); }).catch(() => {});
