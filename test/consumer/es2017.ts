import {
  MediaRuntime,
  MediaRuntimeApiError,
  MediaRuntimeError,
  StickerRuntime,
  WebhookVerificationError,
} from "@mediaruntime/node";

const client = new MediaRuntime({
  apiKey: "test_key",
  baseUrl: "https://example.com",
});

void client.jobs.list({ limit: 1 });
void client.jobs.create({ source: "https://example.com/video.mp4", outputs: ["video.web"] });
void client.jobs.create({
  source: "https://example.com/poster.png",
  outputs: [{
    type: "image",
    preset: "image_placeholders_v1",
    placeholders: { maxDimension: 32, lqipMaxBytes: 4096 },
  }],
});
void client.jobs.create({
  source: "https://example.com/video.mp4",
  outputs: [{
    type: "frames",
    preset: "contact_sheet_v1",
    contactSheet: { columns: 4, rows: 4, intervalSec: 10, format: "jpg" },
    audiogram: {
      artworkSource: "https://cdn.example.com/cover.png",
      captionsSource: "https://cdn.example.com/captions.vtt",
      layout: "square",
      burnCaptions: true,
    },
  }],
});
void client.jobs.create({
  inputs: [
    { source: "https://example.com/a.mp4", inputId: "asset-a" },
    { source: new URL("https://example.com/b.mp4"), metadata: { position: 1 } },
  ],
  outputs: ["video.web"],
});
void client.webhooks.fastify(async (event, _request, reply) => {
  console.log(event.id);
  if (event.status === "COMPLETED") {
    console.log(event.data.delivery?.bundle?.download.url);
  }
  reply.code(204).send();
});
void new MediaRuntimeError("consumer-compatible error", { cause: new Error("cause") });
void client.jobs.get("job_123").catch((error: unknown) => {
  if (error instanceof MediaRuntimeApiError) {
    console.log(error.code, error.status, error.retryable, error.requestId, error.details);
  }
});
void client.jobs.getCompatibilityReport("job_123").then((result) => {
  console.log(result.jobId, result.report, result.downloadUrl);
});
void client.jobs.getCodeDetections("job_123").then((result) => {
  const decoded: string | undefined = result.report?.detections?.[0]?.decoded_text;
  void decoded;
});
void new WebhookVerificationError("invalid_body", "invalid body", { cause: new Error("cause") });

// Trusted server code can use its existing API key for every runtime read.
const stickerCollection = client.stickers.collection("stc_11111111111111111111111111111111");
void stickerCollection.listPacks().then((packs) => packs[0]?.packId);
void stickerCollection.search("beach").then((result) => result.items[0]?.stickerId);
void stickerCollection.typeahead("bea").then((result) => result.suggestions[0]?.text);
void stickerCollection.retrieve("sage-summer-beach-day").then((sticker) => sticker.label);
void stickerCollection.resolve("sage-summer-beach-day", "small_160").then((asset) => asset.url);
// Workspace usage is available only on the trusted API-key root client.
void client.stickers.usage().then((usage) => {
  console.log(usage.status, usage.remainingOperations, usage.overageChargedCents);
});
// Collection lifecycle and pack bindings are API-key-only management operations.
void client.stickers.listCollections({ includeArchived: true }).then((page) => page.items[0]?.name);
void client.stickers.createCollection({ name: "Support chat" }).then((collection) => {
  void client.stickers.enableCollectionPack(collection.collectionId, "sage-summer-v1");
});
void client.stickers.updateCollection("stc_11111111111111111111111111111111", {
  description: "Customer-facing reactions",
});
void client.stickers.listCollectionPacks("stc_11111111111111111111111111111111");

void client.stickers.createClientToken({
  // Direct browser or mobile access remains available through a narrow client grant.
  collectionId: "stc_11111111111111111111111111111111",
  scopes: ["stickers:search", "assets:resolve"],
}).then((grant) => {
  const stickers = new StickerRuntime({
    accessToken: grant.accessToken,
    collectionId: grant.collectionId,
  });
  void stickers.search("beach").then((result) => result.items[0]?.stickerId);
});
