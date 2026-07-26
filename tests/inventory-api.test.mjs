import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
// After the loader hook (registered via --import, see package.json's "test"
// script) redirects this specifier, `cloudflareEnv` is the same object
// instance app/api/inventory/route.ts reads its `env.DB` from -- route.ts
// gets its bindings from this module-level import, not from worker.fetch's
// `env` parameter, so DB must be attached here rather than passed to fetch().
import { env as cloudflareEnv } from "cloudflare:workers";

// Each import gets a fresh module instance (esbuild/Vite treat differing
// query strings as distinct module identities), which matters here because
// route.ts memoizes ensureSchema() in a module-scoped flag -- reusing one
// worker instance across tests with different fake databases would skip
// table creation on every database after the first.
let importCounter = 0;
async function importWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${importCounter++}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

// A minimal D1Database shim backed by Node's built-in SQLite, covering just
// the prepare/bind/first/all/run/batch surface app/api/inventory/route.ts
// actually calls -- enough to exercise the real route logic (including its
// atomic overcommit checks and delete guards) without pulling in Miniflare.
function createFakeD1() {
  const db = new DatabaseSync(":memory:");
  function wrap(sql) {
    // Prepared lazily, at call time rather than here: ensureSchema() builds
    // a batch of statements (CREATE TABLE x3, then CREATE INDEX on one of
    // them) as one array before any of them run, so preparing eagerly would
    // have SQLite validate the CREATE INDEX's target table before the
    // CREATE TABLE ahead of it in the same batch has actually executed.
    let args = [];
    const api = {
      bind(...bound) {
        args = bound;
        return api;
      },
      async first() {
        const row = db.prepare(sql).get(...args);
        return row === undefined ? null : row;
      },
      async all() {
        return { results: db.prepare(sql).all(...args) };
      },
      async run() {
        const info = db.prepare(sql).run(...args);
        return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
      },
    };
    return api;
  }
  return {
    prepare: wrap,
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

async function setupEnv() {
  const worker = await importWorker();
  cloudflareEnv.DB = createFakeD1();
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  return { worker, env };
}

async function callApi(worker, env, method, body) {
  const request = new Request("http://localhost/api/inventory", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const response = await worker.fetch(request, env, ctx);
  return { status: response.status, body: await response.json() };
}

async function addGroup(worker, env, overrides = {}) {
  return callApi(worker, env, "POST", {
    action: "add-group",
    zoneId: "F70-FRONT-01",
    species: "Test Oak",
    height: "10 ft",
    caliper: "2 in",
    quantity: 10,
    priceCents: 500,
    plantedOn: "2024-01-01",
    ...overrides,
  });
}

test("add-allocation refuses to overcommit beyond a group's available quantity", async () => {
  const { worker, env } = await setupEnv();
  const group = await addGroup(worker, env, { quantity: 10 });
  assert.equal(group.status, 201);
  const groupId = group.body.id;

  const first = await callApi(worker, env, "POST", { action: "add-allocation", groupId, quantity: 10, status: "Tagged", client: "Acme" });
  assert.equal(first.status, 201);

  const second = await callApi(worker, env, "POST", { action: "add-allocation", groupId, quantity: 1, status: "Tagged", client: "Acme" });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /not enough trees/i);
});

test("concurrent add-allocation requests never overcommit a group", async () => {
  const { worker, env } = await setupEnv();
  const group = await addGroup(worker, env, { species: "Test Elm", quantity: 5 });
  const groupId = group.body.id;

  const attempts = await Promise.all(
    [3, 3, 3].map((quantity) =>
      callApi(worker, env, "POST", { action: "add-allocation", groupId, quantity, status: "Tagged", client: "Acme" })
    )
  );
  const succeeded = attempts.filter((result) => result.status === 201);
  assert.equal(succeeded.length, 1, "only one 3-unit allocation should fit in a 5-unit group");

  const state = await callApi(worker, env, "GET");
  const committed = state.body.allocations
    .filter((allocation) => allocation.groupId === groupId)
    .reduce((sum, allocation) => sum + allocation.quantity, 0);
  assert.ok(committed <= 5, `committed quantity ${committed} must never exceed the group's 5 trees`);
});

test("update-allocation refuses to raise a commitment past what's available", async () => {
  const { worker, env } = await setupEnv();
  const group = await addGroup(worker, env, { species: "Test Pine", quantity: 10 });
  const groupId = group.body.id;

  const allocA = await callApi(worker, env, "POST", { action: "add-allocation", groupId, quantity: 5, status: "Tagged", client: "A" });
  const allocB = await callApi(worker, env, "POST", { action: "add-allocation", groupId, quantity: 5, status: "Tagged", client: "B" });
  assert.equal(allocA.status, 201);
  assert.equal(allocB.status, 201);

  const bump = await callApi(worker, env, "POST", {
    action: "update-allocation", allocationId: allocA.body.id, groupId, quantity: 6, status: "Tagged", client: "A",
  });
  assert.equal(bump.status, 409);
  assert.match(bump.body.error, /could not be updated/i);
});

test("delete-group refuses while trees are tagged or sold, succeeds once cleared", async () => {
  const { worker, env } = await setupEnv();
  const group = await addGroup(worker, env, { species: "Test Maple", quantity: 4 });
  const groupId = group.body.id;

  const alloc = await callApi(worker, env, "POST", { action: "add-allocation", groupId, quantity: 4, status: "Sold", client: "C" });
  assert.equal(alloc.status, 201);

  const blocked = await callApi(worker, env, "POST", { action: "delete-group", groupId, confirmGroupId: groupId });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /tagged or sold/i);

  const received = await callApi(worker, env, "POST", { action: "receive-allocation", allocationId: alloc.body.id });
  assert.equal(received.status, 200);

  const deleted = await callApi(worker, env, "POST", { action: "delete-group", groupId, confirmGroupId: groupId });
  assert.equal(deleted.status, 200);
});

test("bulk-add-groups applies valid rows and reports invalid ones without failing the batch", async () => {
  const { worker, env } = await setupEnv();
  const result = await callApi(worker, env, "POST", {
    action: "bulk-add-groups",
    rows: [
      { zoneId: "F70-FRONT-01", species: "Bulk Cedar", height: "8 ft", caliper: "1.5 in", quantity: 5, priceCents: 200, plantedOn: "2024-01-01" },
      { zoneId: "NOT-A-REAL-ZONE", species: "Ghost Tree", height: "1 ft", caliper: "1 in", quantity: 1, priceCents: 100, plantedOn: "2024-01-01" },
    ],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.created, 1);
  assert.equal(result.body.errors.length, 1);
  assert.equal(result.body.errors[0].row, 2);
});
