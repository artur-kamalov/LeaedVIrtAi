import assert from "node:assert/strict";
import { requestMetricRoute } from "../../apps/api/src/common/interceptors/request-logging.interceptor.js";

const telegramRoute = {
  baseUrl: "",
  route: { path: "/api/public/channels/telegram/:publicKey/webhook" },
};

assert.equal(
  requestMetricRoute(telegramRoute),
  "/api/public/channels/telegram/:publicKey/webhook",
);
assert.equal(
  requestMetricRoute({ baseUrl: "/api", route: { path: "/integrations/:provider/connect" } }),
  "/api/integrations/:provider/connect",
);
assert.equal(requestMetricRoute({ route: undefined }), "/unmatched");
assert.equal(requestMetricRoute({ route: { path: /client-controlled/ } }), "/unmatched");

for (let index = 0; index < 1_000; index += 1) {
  assert.equal(requestMetricRoute({ route: undefined }), "/unmatched");
}

console.log("Request metrics route smoke: registered templates retained; unmatched cardinality bounded.");
