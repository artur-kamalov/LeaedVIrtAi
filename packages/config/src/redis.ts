export interface RedisConnectionConfiguration {
  host: string;
  port: number;
  db: number;
  tls: boolean;
  username?: string;
  password?: string;
}

const redisDefaultPort = 6379;

function decodeCredential(value: string, label: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Redis URL has an invalid percent-encoded ${label}.`);
  }
}

function databaseFromPath(pathname: string) {
  if (!pathname || pathname === "/") return 0;
  if (!/^\/\d+$/u.test(pathname)) {
    throw new Error("Redis URL database must be a non-negative integer path.");
  }

  const db = Number(pathname.slice(1));
  if (!Number.isSafeInteger(db)) {
    throw new Error("Redis URL database is outside the supported integer range.");
  }
  return db;
}

export function parseRedisConnectionUrl(value: string): RedisConnectionConfiguration {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Redis URL is invalid.");
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("Redis URL must use redis:// or rediss://.");
  }
  if (!url.hostname) throw new Error("Redis URL must include a hostname.");
  if (url.search || url.hash) {
    throw new Error("Redis URL query parameters and fragments are not supported.");
  }

  const port = url.port ? Number(url.port) : redisDefaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Redis URL port must be between 1 and 65535.");
  }

  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  const username = url.username ? decodeCredential(url.username, "username") : undefined;
  const password = url.password ? decodeCredential(url.password, "password") : undefined;

  return {
    host,
    port,
    db: databaseFromPath(url.pathname),
    tls: url.protocol === "rediss:",
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password }),
  };
}

export function describeRedisEndpoint(value: string) {
  const connection = parseRedisConnectionUrl(value);
  const host = connection.host.includes(":") ? `[${connection.host}]` : connection.host;
  return `${connection.tls ? "rediss" : "redis"}://${host}:${connection.port}/${connection.db}`;
}
