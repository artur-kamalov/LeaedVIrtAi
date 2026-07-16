const apiBase = (process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api").replace(/\/$/, "");
const runId = Date.now();
const email = `rate-limit-${runId}@mail.ru`;
const firstForwardedFor = `198.51.100.${runId % 200}`;
const secondForwardedFor = `203.0.113.${runId % 200}`;

async function postResetRequest(emailValue, forwardedFor) {
  const response = await fetch(`${apiBase}/auth/password-reset/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor,
      "user-agent": "leadvirt-auth-rate-limit-smoke",
    },
    body: JSON.stringify({ email: emailValue }),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

const first = await postResetRequest(email, firstForwardedFor);
if (first.response.status !== 200 || first.payload?.data?.sent !== true) {
  throw new Error(
    `Expected the first reset request to pass, got ${first.response.status}: ${JSON.stringify(first.payload)}`,
  );
}

const limited = await postResetRequest(email.toUpperCase(), secondForwardedFor);
if (limited.response.status !== 429) {
  throw new Error(
    `Expected normalized per-recipient cooldown across IPs, got ${limited.response.status}: ${JSON.stringify(limited.payload)}`,
  );
}

console.log("PASS: auth password-reset request applies a normalized per-recipient cooldown.");
