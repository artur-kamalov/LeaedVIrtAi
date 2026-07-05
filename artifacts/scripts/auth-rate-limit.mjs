const apiBase = (process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api").replace(/\/$/, "");
const runId = Date.now();
const email = `rate-limit-${runId}@mail.ru`;
const forwardedFor = `198.51.100.${runId % 200}`;

async function postResetRequest() {
  const response = await fetch(`${apiBase}/auth/password-reset/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor,
      "user-agent": "leadvirt-auth-rate-limit-smoke"
    },
    body: JSON.stringify({ email })
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

for (let index = 0; index < 8; index += 1) {
  const { response, payload } = await postResetRequest();
  if (response.status !== 200 || payload?.data?.sent !== true) {
    throw new Error(`Expected reset request ${index + 1} to pass, got ${response.status}: ${JSON.stringify(payload)}`);
  }
}

const limited = await postResetRequest();
if (limited.response.status !== 429) {
  throw new Error(`Expected ninth reset request to be rate limited, got ${limited.response.status}: ${JSON.stringify(limited.payload)}`);
}

console.log("PASS: auth password-reset request rate limit returns 429 after repeated attempts.");
