import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeRoutes } from "../../scripts/runtime-routes.ts";

test("route extraction reads registrations, including multiline and nested generic declarations", () => {
  const source = `
    // app.get("/v1/commented", handle);
    const sample = 'app.get("/v1/text-example", handle)';
    app.get<{ Querystring: Partial<Scope>; Reply: ReturnType<() => string> }>(
      '/v1/snapshots/:id', handle,
    );
    app.post(\`/v1/snapshots\`, handle);
  `;
  assert.deepEqual([...runtimeRoutes(source)], ["get /v1/snapshots/{id}", "post /v1/snapshots"]);
});
