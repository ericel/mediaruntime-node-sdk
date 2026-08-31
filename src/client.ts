import { CapabilitiesClient } from "./capabilities.js";
import { JobsClient } from "./jobs.js";
import { RecipesClient } from "./recipes.js";
import { HostedStickersClient } from "./stickers.js";
import { Transport } from "./transport.js";
import type { FetchImplementation, MediaRuntimeOptions } from "./types.js";
import { UploadsClient } from "./uploads.js";
import { WatermarkLogoClient } from "./watermark-logo.js";
import { WebhooksClient } from "./webhooks.js";

const DEFAULT_BASE_URL = "https://mediaruntime.com";

export class MediaRuntime {
  readonly jobs: JobsClient;
  readonly uploads: UploadsClient;
  readonly capabilities: CapabilitiesClient;
  readonly recipes: RecipesClient;
  readonly stickers: HostedStickersClient;
  readonly watermarkLogo: WatermarkLogoClient;
  readonly webhooks: WebhooksClient;

  constructor(options: MediaRuntimeOptions = {}) {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be a positive finite number");
    }
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
      throw new TypeError("maxRetries must be an integer between 0 and 10");
    }
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== "function") {
      throw new TypeError("A fetch implementation is required");
    }

    // Explicit options override environment configuration for predictable service startup.
    const transport = new Transport({
      apiKey: options.apiKey ?? process.env.MEDIARUNTIME_API_KEY,
      baseUrl: options.baseUrl ?? process.env.MEDIARUNTIME_API_URL ?? DEFAULT_BASE_URL,
      timeoutMs,
      maxRetries,
      fetch: fetchImplementation as FetchImplementation,
    });

    // Resource clients share one transport, retry policy, and authentication boundary.
    this.uploads = new UploadsClient(transport);
    this.jobs = new JobsClient(transport, this.uploads);
    this.capabilities = new CapabilitiesClient(transport);
    this.recipes = new RecipesClient(transport);
    // Server-side collection reads and token issuance stay on the trusted API-key
    // transport; untrusted clients can construct a separate StickerRuntime grant.
    this.stickers = new HostedStickersClient(transport);
    this.watermarkLogo = new WatermarkLogoClient(transport);
    this.webhooks = new WebhooksClient(
      options.webhookSecret ?? process.env.MEDIARUNTIME_WEBHOOK_SECRET,
    );
  }
}
