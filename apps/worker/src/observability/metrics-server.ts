import { createServer } from "node:http";
import { renderPrometheusMetrics } from "./metrics.js";

function workerMetricsPort() {
  const value = Number(process.env.WORKER_METRICS_PORT ?? "4002");
  return Number.isFinite(value) && value > 0 ? value : 4002;
}

export function startWorkerMetricsServer() {
  if (process.env.WORKER_METRICS_ENABLED === "false") return;

  const port = workerMetricsPort();
  const server = createServer((request, response) => {
    if (request.url?.split("?")[0] !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
    response.end(renderPrometheusMetrics());
  });

  server.listen(port, () => {
    console.log(JSON.stringify({ service: "LeadVirt.ai worker", status: "metrics_listening", url: `http://localhost:${port}/metrics` }));
  });
}
