import assert from "node:assert/strict";

const moduleUrl = new URL("../lib/distributed-action-lock.ts", import.meta.url).href;
const {
  acquireDistributedActionLock,
  distributedActionLockKey,
  DistributedActionLockError,
  withDistributedActionLock,
} = (await import(moduleUrl)) as typeof import("../lib/distributed-action-lock");

const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

try {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.throws(
    () => distributedActionLockKey("   "),
    (error: unknown) =>
      error instanceof DistributedActionLockError && error.code === "not_configured",
  );
  await assert.rejects(
    acquireDistributedActionLock("kid-trial:parent@example.com"),
    (error: unknown) =>
      error instanceof DistributedActionLockError && error.code === "not_configured",
  );

  process.env.UPSTASH_REDIS_REST_URL = "https://lock-test.upstash.io/";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-secret-token";

  const scope = "kid-trial:Parent@Example.com";
  const expectedKey = distributedActionLockKey(scope);
  assert.equal(expectedKey, distributedActionLockKey(scope.toLowerCase()));
  assert(!expectedKey.includes("parent@example.com"));

  const commands: string[][] = [];
  const successFetch: typeof fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-secret-token",
    );
    const command = JSON.parse(String(init?.body)) as string[];
    commands.push(command);
    const result = command[0] === "SET" ? "OK" : 1;
    return Response.json({ result });
  };

  const handle = await acquireDistributedActionLock(scope, {
    ttlSeconds: 60,
    fetchImpl: successFetch,
  });
  assert(handle);
  assert.equal(handle.key, expectedKey);
  await handle.release();
  await handle.release();
  assert.equal(commands.length, 2, "release must be idempotent within one handle");
  assert.deepEqual(commands[0].slice(0, 2), ["SET", expectedKey]);
  assert.deepEqual(commands[0].slice(3), ["NX", "EX", "60"]);
  assert.equal(commands[1][0], "EVAL");
  assert.equal(commands[1][2], "1");
  assert.equal(commands[1][3], expectedKey);
  assert.equal(commands[1][4], commands[0][2], "release must compare the owner token");
  assert(!JSON.stringify(commands).includes("parent@example.com"));

  let busyCalls = 0;
  const busyFetch: typeof fetch = async () => {
    busyCalls += 1;
    return Response.json({ result: null });
  };
  const busy = await acquireDistributedActionLock(scope, { fetchImpl: busyFetch });
  assert.equal(busy, null);
  assert.equal(busyCalls, 1);

  let heldOwner: string | undefined;
  const serializedFetch: typeof fetch = async (_input, init) => {
    const command = JSON.parse(String(init?.body)) as string[];
    if (command[0] === "SET") {
      if (heldOwner) return Response.json({ result: null });
      heldOwner = command[2];
      return Response.json({ result: "OK" });
    }
    const released = command[4] === heldOwner;
    if (released) heldOwner = undefined;
    return Response.json({ result: released ? 1 : 0 });
  };
  const first = await acquireDistributedActionLock(scope, {
    fetchImpl: serializedFetch,
  });
  assert(first);
  assert.equal(
    await acquireDistributedActionLock(scope, { fetchImpl: serializedFetch }),
    null,
    "a second instance must not acquire the same scope",
  );
  await first.release();
  const afterRelease = await acquireDistributedActionLock(scope, {
    fetchImpl: serializedFetch,
  });
  assert(afterRelease, "the scope must be acquirable after token-owned release");
  await afterRelease.release();

  let releaseWarning: unknown;
  let wrapperCalls = 0;
  const releaseFailureFetch: typeof fetch = async (_input, init) => {
    wrapperCalls += 1;
    const command = JSON.parse(String(init?.body)) as string[];
    return command[0] === "SET"
      ? Response.json({ result: "OK" })
      : new Response("unavailable", { status: 503 });
  };
  const wrapped = await withDistributedActionLock(
    scope,
    async () => "completed",
    {
      fetchImpl: releaseFailureFetch,
      onReleaseError: (error) => {
        releaseWarning = error;
      },
    },
  );
  assert.deepEqual(wrapped, { acquired: true, value: "completed" });
  assert.equal(wrapperCalls, 2);
  assert(releaseWarning instanceof DistributedActionLockError);

  const unavailableFetch: typeof fetch = async () => {
    throw new Error("network down");
  };
  await assert.rejects(
    acquireDistributedActionLock(scope, { fetchImpl: unavailableFetch }),
    (error: unknown) =>
      error instanceof DistributedActionLockError && error.code === "unavailable",
  );
} finally {
  if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
  if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
}

console.log("Distributed action-lock contract passed.");
