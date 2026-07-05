import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  message: string;
};

function nowMs() {
  return Date.now();
}

function disabled() {
  return process.env.AUTH_RATE_LIMIT_DISABLED === "true";
}

@Injectable()
export class AuthRateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  private lastPruneAt = 0;

  assert(options: RateLimitOptions) {
    if (disabled()) return;

    const now = nowMs();
    this.prune(now);

    const existing = this.buckets.get(options.key);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + options.windowMs };
    bucket.count += 1;
    this.buckets.set(options.key, bucket);

    if (bucket.count > options.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: options.message,
          retryAfterSeconds
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  private prune(now: number) {
    if (now - this.lastPruneAt < 60_000) return;
    this.lastPruneAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
