export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
};

/** BullMQ requires maxRetriesPerRequest null. Service hostnames come from REDIS_URL. */
export function redisConnectionFromUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
