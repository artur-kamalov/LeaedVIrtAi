import { createServer } from "node:http";
import { renderPrometheusMetrics } from "./metrics.js";

export interface WorkerHealthState {
  ready: boolean;
  active: boolean;
  processorsEnabled: boolean;
  deploymentPaused: boolean;
}

export type WorkerDependencyState = "up" | "down" | "not_required";

export interface WorkerReadinessProbes {
  database?: () => Promise<void>;
  redis?: () => Promise<void>;
}

export interface WorkerReadinessState extends WorkerHealthState {
  status: "ready" | "not_ready";
  dependencies: {
    database: WorkerDependencyState;
    redis: WorkerDependencyState;
  };
}

function workerMetricsPort() {
  const value = Number(process.env.WORKER_METRICS_PORT ?? "4002");
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 4002;
}

async function dependencyState(probe: (() => Promise<void>) | undefined) {
  if (!probe) return "down" as const;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(probe),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Worker readiness probe timed out.")), 1500);
      }),
    ]);
    return "up" as const;
  } catch {
    return "down" as const;
  } finally {
    clearTimeout(timeout);
  }
}

export async function evaluateWorkerReadiness(
  state: WorkerHealthState,
  probes: WorkerReadinessProbes = {},
): Promise<WorkerReadinessState> {
  let database: WorkerDependencyState = "not_required";
  let redis: WorkerDependencyState = "not_required";
  if (state.processorsEnabled) {
    [database, redis] = await Promise.all([
      dependencyState(probes.database),
      dependencyState(probes.redis),
    ]);
  }

  const ready =
    state.ready &&
    database !== "down" &&
    redis !== "down" &&
    (!state.processorsEnabled || state.active || state.deploymentPaused);
  return {
    ...state,
    status: ready ? "ready" : "not_ready",
    dependencies: { database, redis },
  };
}

export function startWorkerMetricsServer(
  getHealth: () => WorkerHealthState,
  probes: WorkerReadinessProbes = {},
) {
  if (process.env.WORKER_METRICS_ENABLED === "false") return;

  const port = workerMetricsPort();
  let readinessPromise: Promise<WorkerReadinessState> | undefined;
  const readReadiness = () => {
    if (readinessPromise) return readinessPromise;
    const promise = evaluateWorkerReadiness(getHealth(), probes).finally(() => {
      if (readinessPromise === promise) readinessPromise = undefined;
    });
    readinessPromise = promise;
    return promise;
  };
  const server = createServer((request, response) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/health" || pathname === "/health/live") {
      const health = getHealth();
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`${JSON.stringify({ status: "alive", ...health })}\n`);
      return;
    }

    if (pathname === "/health/ready") {
      void readReadiness().then((health) => {
        response.writeHead(health.status === "ready" ? 200 : 503, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(`${JSON.stringify(health)}\n`);
      });
      return;
    }

    if (pathname !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
    response.end(renderPrometheusMetrics());
  });

  server.listen(port, () => {
    console.log(
      JSON.stringify({
        service: "LeadVirt.ai worker",
        status: "metrics_listening",
        url: `http://localhost:${port}/metrics`,
      }),
    );
  });
  return server;
}
