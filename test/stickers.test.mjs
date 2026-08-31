import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { MediaRuntime, MediaRuntimeApiError, StickerRuntime } from "../dist/index.js";


function json(data, status = 200) {
  // Keep mock responses aligned with the gateway's JSON content type.
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}


test("checked-in contract pins Sticker Runtime authentication boundaries", async () => {
  // Prevent SDK documentation from drifting toward bearer access on management APIs.
  const openapi = JSON.parse(await readFile(new URL("../contracts/v1/openapi.json", import.meta.url), "utf8"));
  const apiKeyOnly = [{ ProductionApiKey: [] }];
  const runtimeAuth = [{ ProductionApiKey: [] }, { StickerClientToken: [] }];

  assert.deepEqual(openapi.paths["/v1/sticker-collections"].get.security, apiKeyOnly);
  assert.deepEqual(openapi.paths["/v1/sticker-runtime/client-tokens"].post.security, apiKeyOnly);
  assert.deepEqual(openapi.paths["/v1/sticker-runtime/usage/current"].get.security, apiKeyOnly);
  assert.deepEqual(openapi.paths["/v1/stickers/search"].get.security, runtimeAuth);
  assert.deepEqual(openapi.paths["/v1/stickers/{sticker_id}/assets/{variant}"].get.security, runtimeAuth);
});


test("trusted client mints a collection-scoped Sticker Runtime token", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test_server_only",
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      // Token issuance must carry the master key only on the trusted server request.
      captured = { url: String(input), init };
      return json({
        access_token: "mrt_v1_header.payload.signature",
        token_type: "Bearer",
        expires_in: 300,
        expires_at: "2026-08-29T15:00:00Z",
        collection_id: "stc_11111111111111111111111111111111",
        scopes: ["assets:resolve", "stickers:search"],
      });
    },
  });

  const grant = await media.stickers.createClientToken({
    collectionId: "stc_11111111111111111111111111111111",
    expiresInSeconds: 300,
    scopes: ["stickers:search", "assets:resolve"],
  });

  assert.equal(captured.url, "https://api.example.test/v1/sticker-runtime/client-tokens");
  assert.equal(new Headers(captured.init.headers).get("x-api-key"), "sk_test_server_only");
  assert.equal(new Headers(captured.init.headers).get("authorization"), null);
  assert.deepEqual(JSON.parse(captured.init.body), {
    collection_id: "stc_11111111111111111111111111111111",
    expires_in_seconds: 300,
    scopes: ["assets:resolve", "stickers:search"],
  });
  assert.equal(grant.accessToken, "mrt_v1_header.payload.signature");
  assert.equal(grant.collectionId, "stc_11111111111111111111111111111111");
});


test("trusted client uses API-key auth for every collection-bound runtime operation", async () => {
  const requests = [];
  const media = new MediaRuntime({
    apiKey: "sk_test_server_only",
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      // Return endpoint-specific wire payloads so every public operation exercises parsing.
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname.endsWith("/stickers/packs")) {
        return json({
          items: [{
            pack_id: "sage-summer-v1",
            slug: "sage-summer",
            name: "Sage Summer",
            version: "1.0.0",
            asset_count: 24,
            animated: true,
            categories: ["vacation"],
            characters: [{ id: "sage", name: "Sage" }],
            activation_id: "sta_123",
          }],
        });
      }
      if (url.pathname.endsWith("/stickers/search")) {
        return json({
          query: "beach",
          total: 1,
          items: [{
            sticker_id: "sage-summer-beach-day",
            semantic_id: "sage.summer.beach-day",
            pack_id: "sage-summer-v1",
            pack_slug: "sage-summer",
            pack_version: "1.0.0",
            label: "Beach day",
            emoji: null,
            category: "vacation",
            keywords: ["beach"],
            animated: true,
            variants: [{ name: "small_160", state: "compact", media_type: "image/webp", bytes: 121650 }],
          }],
        });
      }
      if (url.pathname.endsWith("/stickers/typeahead")) {
        return json({ query: "bea", locale: "en", suggestions: [{ text: "beach", asset_count: 1 }] });
      }
      if (url.pathname.includes("/assets/")) {
        return json({
          sticker_id: "sage-summer-beach-day",
          pack_id: "sage-summer-v1",
          pack_version: "1.0.0",
          variant: "small_160",
          media_type: "image/webp",
          bytes: 121650,
          sha256: "a".repeat(64),
          url: "https://storage.example.test/signed",
          expires_in_seconds: 300,
          expires_at: "2026-08-29T15:00:00Z",
        });
      }
      // Stable metadata retrieval uses the same projection as search without a score.
      return json({
        sticker_id: "sage-summer-beach-day",
        semantic_id: "sage.summer.beach-day",
        pack_id: "sage-summer-v1",
        pack_slug: "sage-summer",
        pack_version: "1.0.0",
        label: "Beach day",
        emoji: null,
        category: "vacation",
        keywords: ["beach"],
        animated: true,
        variants: [],
      });
    },
  });

  // One collection binding is shared across all server-side runtime operations.
  const stickers = media.stickers.collection("stc_11111111111111111111111111111111");
  const packs = await stickers.listPacks();
  const search = await stickers.search("beach", { packId: "sage-summer-v1", animated: true, limit: 4 });
  const typeahead = await stickers.typeahead("bea", { locale: "en", limit: 3 });
  const retrieved = await stickers.retrieve("sage-summer-beach-day");
  const resolution = await stickers.resolve("sage-summer-beach-day", "small_160");

  assert.equal(packs[0].characters[0].name, "Sage");
  assert.equal(search.items[0].label, "Beach day");
  assert.equal(typeahead.suggestions[0].assetCount, 1);
  assert.equal(retrieved.semanticId, "sage.summer.beach-day");
  assert.equal(resolution.url, "https://storage.example.test/signed");
  assert.equal(requests.length, 5);
  for (const request of requests) {
    // API-key mode must never add the optional browser client's bearer credential.
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("x-api-key"), "sk_test_server_only");
    assert.equal(headers.get("authorization"), null);
    assert.equal(request.url.searchParams.get("collection_id"), "stc_11111111111111111111111111111111");
  }
  assert.equal(requests[1].url.searchParams.get("q"), "beach");
  assert.equal(requests[1].url.searchParams.get("animated"), "true");
  assert.equal(requests[2].url.searchParams.get("locale"), "en");
});


test("trusted client reads workspace-pooled Sticker Runtime usage", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test_server_only",
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      // Usage remains a server-side workspace operation on the normal API key.
      captured = { url: String(input), init };
      return json({
        month: "2026-08",
        operations: 80_000,
        included_operations: 100_000,
        remaining_operations: 20_000,
        operations_utilization_percent: 80,
        authorized_delivery_bytes: 1_000_000_000,
        included_delivery_bytes: 5_000_000_000,
        remaining_delivery_bytes: 4_000_000_000,
        delivery_utilization_percent: 20,
        overage_charged_cents: 0,
        currency: "USD",
        status: "approaching_limit",
      });
    },
  });

  const usage = await media.stickers.usage();

  assert.equal(captured.url, "https://api.example.test/v1/sticker-runtime/usage/current");
  assert.equal(new Headers(captured.init.headers).get("x-api-key"), "sk_test_server_only");
  assert.equal(usage.includedOperations, 100_000);
  assert.equal(usage.remainingDeliveryBytes, 4_000_000_000);
  assert.equal(usage.status, "approaching_limit");
});


test("trusted client manages collection lifecycle and retained pack bindings", async () => {
  const requests = [];
  const collection = {
    collection_id: "stc_11111111111111111111111111111111",
    workspace_id: "acc_test",
    name: "Support chat",
    description: "Customer-facing reactions",
    status: "active",
    packs: [],
    created_at: "2026-08-29T14:00:00Z",
    archived_at: null,
    updated_at: "2026-08-29T14:00:00Z",
  };
  const binding = {
    binding_id: "spb_33333333333333333333333333333333",
    collection_id: collection.collection_id,
    activation_id: "rpa_22222222222222222222222222222222",
    pack_id: "sage-summer-v1",
    pack_slug: "sage-summer",
    pack_name: "Sage Summer",
    pack_version: "1.0.0",
    status: "enabled",
    historical_access: "preserve",
    first_enabled_at: "2026-08-29T14:30:00Z",
    enabled_at: "2026-08-29T14:30:00Z",
    disabled_at: null,
    updated_at: "2026-08-29T14:30:00Z",
  };
  const media = new MediaRuntime({
    apiKey: "sk_test_server_only",
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      // Reuse canonical fixtures while recording each verb, path, query, and body.
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname.endsWith("/packs")) {
        return init.method === "GET" ? json({ items: [binding], total: 1 }) : json(binding);
      }
      if (url.pathname.includes("/packs/")) return json(binding);
      if (url.pathname.endsWith("/sticker-collections")) {
        return init.method === "GET" ? json({ items: [collection], total: 1 }) : json(collection);
      }
      return json(init.method === "DELETE"
        ? { ...collection, status: "archived", archived_at: "2026-08-29T15:00:00Z" }
        : collection);
    },
  });

  // Exercise every API-key collection-management endpoint exposed by the gateway.
  const listed = await media.stickers.listCollections({ includeArchived: true });
  const created = await media.stickers.createCollection({
    name: "Support chat",
    description: "Customer-facing reactions",
  });
  const retrieved = await media.stickers.getCollection(collection.collection_id);
  const updated = await media.stickers.updateCollection(collection.collection_id, {
    description: null,
    status: "active",
  });
  const archived = await media.stickers.archiveCollection(collection.collection_id);
  const bindings = await media.stickers.listCollectionPacks(collection.collection_id);
  const added = await media.stickers.addCollectionPack(collection.collection_id, {
    activationId: binding.activation_id,
  });
  const enabled = await media.stickers.enableCollectionPack(collection.collection_id, binding.pack_id);
  const disabled = await media.stickers.disableCollectionPack(collection.collection_id, binding.pack_id);

  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].workspaceId, "acc_test");
  assert.equal(created.description, "Customer-facing reactions");
  assert.equal(retrieved.collectionId, collection.collection_id);
  assert.equal(updated.status, "active");
  assert.equal(archived.archivedAt, "2026-08-29T15:00:00Z");
  assert.equal(bindings.items[0].historicalAccess, "preserve");
  assert.equal(added.activationId, binding.activation_id);
  assert.equal(enabled.packId, binding.pack_id);
  assert.equal(disabled.bindingId, binding.binding_id);
  assert.deepEqual(requests.map(({ init }) => init.method), [
    "GET", "POST", "GET", "PATCH", "DELETE", "GET", "POST", "PUT", "DELETE",
  ]);
  assert.equal(requests[0].url.searchParams.get("include_archived"), "true");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    name: "Support chat",
    description: "Customer-facing reactions",
  });
  assert.deepEqual(JSON.parse(requests[3].init.body), { description: null, status: "active" });
  assert.deepEqual(JSON.parse(requests[6].init.body), { activation_id: binding.activation_id });
  for (const request of requests) {
    // Management endpoints support only the trusted workspace API-key path.
    assert.equal(new Headers(request.init.headers).get("x-api-key"), "sk_test_server_only");
    assert.equal(new Headers(request.init.headers).get("authorization"), null);
  }
});


test("collection management validates mutation inputs before transport", async () => {
  const media = new MediaRuntime({
    apiKey: "sk_test_server_only",
    fetch: async () => {
      // Every invalid call below must stop before a workspace mutation is attempted.
      throw new Error("unexpected request");
    },
  });
  const collectionId = "stc_11111111111111111111111111111111";

  await assert.rejects(
    () => media.stickers.createCollection({ name: "" }),
    { name: "ValidationError" },
  );
  await assert.rejects(
    () => media.stickers.updateCollection(collectionId, {}),
    { name: "ValidationError", message: "At least one collection field must be updated" },
  );
  await assert.rejects(
    () => media.stickers.addCollectionPack(collectionId, { activationId: "bad" }),
    { name: "ValidationError" },
  );
  await assert.rejects(
    () => media.stickers.enableCollectionPack(collectionId, "x"),
    { name: "ValidationError" },
  );
});


test("unfunded Sticker Runtime overage preserves the structured gateway error", async () => {
  const media = new MediaRuntime({
    apiKey: "sk_test_server_only",
    baseUrl: "https://api.example.test",
    maxRetries: 0,
    fetch: async () => json({
      detail: {
        code: "sticker_runtime_quota_exceeded",
        message: "Add workspace wallet credit to continue beyond the included Sticker Runtime allowance.",
        dimension: "operations",
        required_overage_cents: 100,
        currency: "USD",
      },
    }, 402),
  });

  await assert.rejects(
    () => media.stickers.collection("stc_11111111111111111111111111111111").search("beach"),
    (error) => {
      // SDK consumers can branch on code and inspect funding details without
      // parsing FastAPI's response envelope or human-readable message.
      assert.ok(error instanceof MediaRuntimeApiError);
      assert.equal(error.status, 402);
      assert.equal(error.code, "sticker_runtime_quota_exceeded");
      assert.equal(error.details.dimension, "operations");
      assert.equal(error.details.required_overage_cents, 100);
      return true;
    },
  );
});


test("collection binding validates its server-issued identity before sending requests", () => {
  const media = new MediaRuntime({
    apiKey: "sk_test_server_only",
    fetch: async () => {
      // Validation must fail locally, so this transport should remain unused.
      throw new Error("unexpected request");
    },
  });

  assert.throws(
    () => media.stickers.collection("another-workspace/collection"),
    { name: "ValidationError", message: "collectionId must be a MediaRuntime sticker collection ID" },
  );
});


test("scoped runtime sends bearer auth and keeps collection identity constructor-bound", async () => {
  const requests = [];
  const stickers = new StickerRuntime({
    accessToken: "mrt_v1_header.payload.signature",
    collectionId: "stc_11111111111111111111111111111111",
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      // Search and resolution share one bearer credential and never send X-API-Key.
      requests.push({ url: String(input), init });
      if (String(input).includes("/assets/")) {
        return json({
          sticker_id: "sage-summer-beach-day",
          pack_id: "sage-summer-v1",
          pack_version: "1.0.0",
          variant: "small_160",
          media_type: "image/webp",
          bytes: 121650,
          sha256: "a".repeat(64),
          url: "https://storage.example.test/signed",
          expires_in_seconds: 300,
          expires_at: "2026-08-29T15:00:00Z",
        });
      }
      return json({
        query: "beach",
        total: 1,
        items: [{
          sticker_id: "sage-summer-beach-day",
          semantic_id: "sage.summer.beach-day",
          pack_id: "sage-summer-v1",
          pack_slug: "sage-summer",
          pack_version: "1.0.0",
          label: "Beach day",
          emoji: null,
          category: "vacation",
          keywords: ["beach"],
          animated: true,
          variants: [{ name: "small_160", state: "compact", media_type: "image/webp", bytes: 121650 }],
          score: 1000,
        }],
      });
    },
  });

  const search = await stickers.search("beach", { animated: true, limit: 4 });
  const resolution = await stickers.resolve(search.items[0].stickerId, "small_160");

  assert.equal(search.items[0].packId, "sage-summer-v1");
  assert.equal(search.items[0].variants[0].mediaType, "image/webp");
  assert.equal(resolution.bytes, 121650);
  for (const request of requests) {
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("authorization"), "Bearer mrt_v1_header.payload.signature");
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(new URL(request.url).searchParams.get("collection_id"), "stc_11111111111111111111111111111111");
  }
});
