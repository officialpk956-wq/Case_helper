// Every API route but sign-in needs a session, so a test creates an account first and sends its cookie.
export async function signIn(base: string, username = "tester"): Promise<string> {
  const res = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  if (!res.ok) throw new Error(`could not create ${username}: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie()[0]!.split(";")[0]!;
}
