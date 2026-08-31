import { ValidationError } from "./errors.js";
import { Transport } from "./transport.js";
import type {
  AddStickerCollectionPackParams,
  CreateStickerCollectionParams,
  CreateStickerClientTokenParams,
  FetchImplementation,
  RuntimeSticker,
  RuntimeStickerPack,
  RuntimeStickerVariant,
  StickerAssetResolution,
  StickerClientToken,
  StickerCollection,
  StickerCollectionList,
  StickerCollectionPackBinding,
  StickerCollectionPackBindingList,
  StickerRuntimeOptions,
  StickerRuntimeScope,
  StickerRuntimeUsage,
  StickerSearchOptions,
  StickerSearchResult,
  StickerTypeaheadOptions,
  StickerTypeaheadResult,
  StickerVariantName,
  UpdateStickerCollectionParams,
} from "./types.js";


const DEFAULT_BASE_URL = "https://mediaruntime.com";
const COLLECTION_PATTERN = /^stc_[0-9a-f]{32}$/;
const ACTIVATION_PATTERN = /^rpa_[0-9a-f]{32}$/;
const STICKER_PATTERN = /^[a-z0-9][a-z0-9.-]{1,159}$/;
const ALLOWED_SCOPES = new Set<StickerRuntimeScope>([
  "packs:read",
  "stickers:search",
  "stickers:read",
  "assets:resolve",
]);
const ALLOWED_VARIANTS = new Set<StickerVariantName>([
  "animated",
  "reduced_motion",
  "small_80",
  "small_100",
  "small_160",
  "thumbnail",
]);


type UnknownRecord = Record<string, unknown>;


function record(value: unknown): UnknownRecord {
  // Runtime parsing rejects primitive and array values before reading wire fields.
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}


function collectionId(value: string): string {
  // Collection identity is server-issued and cannot contain a path separator.
  const normalized = String(value || "").trim();
  if (!COLLECTION_PATTERN.test(normalized)) {
    throw new ValidationError("collectionId must be a MediaRuntime sticker collection ID", {
      status: 400,
      field: "collectionId",
    });
  }
  return normalized;
}


function activationId(value: string): string {
  // Activation bindings use opaque server IDs, never storefront slugs.
  const normalized = String(value || "").trim();
  if (!ACTIVATION_PATTERN.test(normalized)) {
    throw new ValidationError("activationId must be a MediaRuntime pack activation ID", {
      status: 400,
      field: "activationId",
    });
  }
  return normalized;
}


function packId(value: string): string {
  // Pack identifiers are catalog-defined, so only the gateway's length boundary is imposed.
  const normalized = String(value || "").trim();
  if (normalized.length < 2 || normalized.length > 160) {
    throw new ValidationError("packId must contain between 2 and 160 characters", {
      status: 400,
      field: "packId",
    });
  }
  return encodeURIComponent(normalized);
}


function boundedText(value: string, field: string, minimum: number, maximum: number): string {
  // Mirror Pydantic's public length constraints before any collection request is sent.
  const normalized = String(value);
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ValidationError(`${field} must contain between ${minimum} and ${maximum} characters`, {
      status: 400,
      field,
    });
  }
  return normalized;
}


function boundedInteger(
  value: number | undefined,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  // Fail locally with the same numeric bounds exposed by the gateway contract.
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ValidationError(`${field} must be an integer between ${minimum} and ${maximum}`, {
      status: 400,
      field,
    });
  }
  return value;
}


function stickerId(value: string): string {
  // Stable sticker IDs are encoded again at the URL boundary for future grammar safety.
  const normalized = String(value || "").trim();
  if (!STICKER_PATTERN.test(normalized)) {
    throw new ValidationError("stickerId is invalid", { status: 400, field: "stickerId" });
  }
  return encodeURIComponent(normalized);
}


function parseVariant(value: unknown): RuntimeStickerVariant {
  // Convert the gateway's snake_case asset metadata into the SDK's public casing.
  const data = record(value);
  return {
    name: String(data.name ?? "") as StickerVariantName,
    state: String(data.state ?? ""),
    mediaType: String(data.media_type ?? "") as "image/webp",
    bytes: Number(data.bytes ?? 0),
  };
}


function parseSticker(value: unknown): RuntimeSticker {
  // Keep exact sticker and pack identities so applications can persist references.
  const data = record(value);
  return {
    stickerId: String(data.sticker_id ?? ""),
    semanticId: String(data.semantic_id ?? ""),
    packId: String(data.pack_id ?? ""),
    packSlug: String(data.pack_slug ?? ""),
    packVersion: String(data.pack_version ?? ""),
    label: String(data.label ?? ""),
    emoji: data.emoji === null || data.emoji === undefined ? null : String(data.emoji),
    category: data.category === null || data.category === undefined ? null : String(data.category),
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
    animated: data.animated === true,
    variants: Array.isArray(data.variants) ? data.variants.map(parseVariant) : [],
    ...(data.score === undefined || data.score === null ? {} : { score: Number(data.score) }),
  };
}


function parsePack(value: unknown): RuntimeStickerPack {
  // Pack projections intentionally omit billing and private publication coordinates.
  const data = record(value);
  return {
    packId: String(data.pack_id ?? ""),
    slug: String(data.slug ?? ""),
    name: String(data.name ?? ""),
    version: String(data.version ?? ""),
    assetCount: Number(data.asset_count ?? 0),
    animated: data.animated === true,
    categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
    characters: Array.isArray(data.characters)
      ? data.characters.map((item) => {
        const character = record(item);
        return { id: String(character.id ?? ""), name: String(character.name ?? "") };
      })
      : [],
    activationId: String(data.activation_id ?? ""),
  };
}


function nullableString(value: unknown): string | null {
  // Preserve absent timestamps as null instead of producing the string "undefined".
  return value === null || value === undefined ? null : String(value);
}


function parseCollectionPackBinding(value: unknown): StickerCollectionPackBinding {
  // Translate retained binding history, including disabled and historical-access state.
  const data = record(value);
  return {
    bindingId: String(data.binding_id ?? ""),
    collectionId: String(data.collection_id ?? ""),
    activationId: String(data.activation_id ?? ""),
    packId: String(data.pack_id ?? ""),
    packSlug: String(data.pack_slug ?? ""),
    packName: String(data.pack_name ?? ""),
    packVersion: String(data.pack_version ?? ""),
    status: String(data.status ?? "disabled") as StickerCollectionPackBinding["status"],
    historicalAccess: String(data.historical_access ?? "preserve") as StickerCollectionPackBinding["historicalAccess"],
    firstEnabledAt: nullableString(data.first_enabled_at),
    enabledAt: nullableString(data.enabled_at),
    disabledAt: nullableString(data.disabled_at),
    updatedAt: nullableString(data.updated_at),
  };
}


function parseCollection(value: unknown): StickerCollection {
  // Collection responses embed active pack bindings while the audit endpoint returns all.
  const data = record(value);
  return {
    collectionId: String(data.collection_id ?? ""),
    workspaceId: String(data.workspace_id ?? ""),
    name: String(data.name ?? ""),
    description: String(data.description ?? ""),
    status: String(data.status ?? "active") as StickerCollection["status"],
    packs: Array.isArray(data.packs) ? data.packs.map(parseCollectionPackBinding) : [],
    createdAt: String(data.created_at ?? ""),
    archivedAt: nullableString(data.archived_at),
    updatedAt: String(data.updated_at ?? ""),
  };
}


function normalizedScopes(scopes: StickerRuntimeScope[] | undefined): StickerRuntimeScope[] | undefined {
  // Validate scopes before a trusted server sends them to the token issuer.
  if (scopes === undefined) return undefined;
  const unique = [...new Set(scopes)];
  if (unique.length === 0 || unique.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    throw new ValidationError("scopes must contain supported Sticker Runtime permissions", {
      status: 400,
      field: "scopes",
    });
  }
  return unique.sort();
}


function parseUsage(value: unknown): StickerRuntimeUsage {
  // Convert the private workspace aggregate while retaining byte and cent precision.
  const data = record(value);
  return {
    month: String(data.month ?? ""),
    operations: Number(data.operations ?? 0),
    includedOperations: Number(data.included_operations ?? 0),
    remainingOperations: Number(data.remaining_operations ?? 0),
    operationsUtilizationPercent: Number(data.operations_utilization_percent ?? 0),
    authorizedDeliveryBytes: Number(data.authorized_delivery_bytes ?? 0),
    includedDeliveryBytes: Number(data.included_delivery_bytes ?? 0),
    remainingDeliveryBytes: Number(data.remaining_delivery_bytes ?? 0),
    deliveryUtilizationPercent: Number(data.delivery_utilization_percent ?? 0),
    overageChargedCents: Number(data.overage_charged_cents ?? 0),
    currency: "USD",
    status: String(data.status ?? "healthy") as StickerRuntimeUsage["status"],
  };
}


export class HostedStickersClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async listCollections(
    options: { includeArchived?: boolean; signal?: AbortSignal } = {},
  ): Promise<StickerCollectionList> {
    // Archived collections are excluded by default to match the management UI.
    const data = record(await this.#transport.request<unknown>({
      method: "GET",
      path: "/sticker-collections",
      query: { include_archived: options.includeArchived === undefined ? undefined : String(options.includeArchived) },
      retry: "safe",
      signal: options.signal,
    }));
    return {
      items: Array.isArray(data.items) ? data.items.map(parseCollection) : [],
      total: Number(data.total ?? 0),
    };
  }

  async createCollection(params: CreateStickerCollectionParams): Promise<StickerCollection> {
    // Creation is intentionally non-retried because a collection ID is server-generated.
    const name = boundedText(params.name, "name", 1, 80);
    const description = params.description === null || params.description === undefined
      ? params.description
      : boundedText(params.description, "description", 0, 500);
    return parseCollection(await this.#transport.request<unknown>({
      method: "POST",
      path: "/sticker-collections",
      body: {
        name,
        ...(description !== undefined ? { description } : {}),
      },
      retry: "never",
      signal: params.signal,
    }));
  }

  async getCollection(
    selectedCollectionId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<StickerCollection> {
    // This is the management projection, distinct from collection() runtime reads.
    const selectedCollection = collectionId(selectedCollectionId);
    return parseCollection(await this.#transport.request<unknown>({
      method: "GET",
      path: `/sticker-collections/${selectedCollection}`,
      retry: "safe",
      signal: options.signal,
    }));
  }

  async updateCollection(
    selectedCollectionId: string,
    params: UpdateStickerCollectionParams,
  ): Promise<StickerCollection> {
    // Preserve omitted fields; explicit null clears the optional description.
    const selectedCollection = collectionId(selectedCollectionId);
    const body: UnknownRecord = {};
    if (params.name !== undefined) body.name = boundedText(params.name, "name", 1, 80);
    if (params.description !== undefined) {
      body.description = params.description === null
        ? null
        : boundedText(params.description, "description", 0, 500);
    }
    if (params.status !== undefined) {
      if (params.status !== "active" && params.status !== "archived") {
        throw new ValidationError("status must be active or archived", { status: 400, field: "status" });
      }
      body.status = params.status;
    }
    if (Object.keys(body).length === 0) {
      throw new ValidationError("At least one collection field must be updated", { status: 400 });
    }
    return parseCollection(await this.#transport.request<unknown>({
      method: "PATCH",
      path: `/sticker-collections/${selectedCollection}`,
      body,
      retry: "safe",
      signal: params.signal,
    }));
  }

  async archiveCollection(
    selectedCollectionId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<StickerCollection> {
    // DELETE is recoverable here: the gateway archives rather than erasing history.
    const selectedCollection = collectionId(selectedCollectionId);
    return parseCollection(await this.#transport.request<unknown>({
      method: "DELETE",
      path: `/sticker-collections/${selectedCollection}`,
      retry: "safe",
      signal: options.signal,
    }));
  }

  async listCollectionPacks(
    selectedCollectionId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<StickerCollectionPackBindingList> {
    // Return enabled and disabled bindings so management tools retain audit history.
    const selectedCollection = collectionId(selectedCollectionId);
    const data = record(await this.#transport.request<unknown>({
      method: "GET",
      path: `/sticker-collections/${selectedCollection}/packs`,
      retry: "safe",
      signal: options.signal,
    }));
    return {
      items: Array.isArray(data.items) ? data.items.map(parseCollectionPackBinding) : [],
      total: Number(data.total ?? 0),
    };
  }

  async addCollectionPack(
    selectedCollectionId: string,
    params: AddStickerCollectionPackParams,
  ): Promise<StickerCollectionPackBinding> {
    // The activation-ID form is useful when the caller just completed paid activation.
    const selectedCollection = collectionId(selectedCollectionId);
    return parseCollectionPackBinding(await this.#transport.request<unknown>({
      method: "POST",
      path: `/sticker-collections/${selectedCollection}/packs`,
      body: { activation_id: activationId(params.activationId) },
      retry: "never",
      signal: params.signal,
    }));
  }

  async enableCollectionPack(
    selectedCollectionId: string,
    selectedPackId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<StickerCollectionPackBinding> {
    // Stable pack IDs make PUT idempotent for configuration-as-code workflows.
    const selectedCollection = collectionId(selectedCollectionId);
    return parseCollectionPackBinding(await this.#transport.request<unknown>({
      method: "PUT",
      path: `/sticker-collections/${selectedCollection}/packs/${packId(selectedPackId)}`,
      retry: "safe",
      signal: options.signal,
    }));
  }

  async disableCollectionPack(
    selectedCollectionId: string,
    selectedPackId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<StickerCollectionPackBinding> {
    // Disabling blocks new discovery but leaves historical rendering policy intact.
    const selectedCollection = collectionId(selectedCollectionId);
    return parseCollectionPackBinding(await this.#transport.request<unknown>({
      method: "DELETE",
      path: `/sticker-collections/${selectedCollection}/packs/${packId(selectedPackId)}`,
      retry: "safe",
      signal: options.signal,
    }));
  }

  collection(selectedCollectionId: string): StickerCollectionClient {
    // Server-side runtime calls reuse the MediaRuntime client's API-key transport.
    return new StickerCollectionClient(this.#transport, selectedCollectionId);
  }

  async usage(options: { signal?: AbortSignal } = {}): Promise<StickerRuntimeUsage> {
    // Usage is workspace-pooled and therefore belongs to the trusted root client,
    // not to an individual collection or browser-scoped token.
    return parseUsage(await this.#transport.request<unknown>({
      method: "GET",
      path: "/sticker-runtime/usage/current",
      retry: "safe",
      signal: options.signal,
    }));
  }

  async createClientToken(params: CreateStickerClientTokenParams): Promise<StickerClientToken> {
    // This method runs on a trusted server transport carrying the workspace API key.
    const selectedCollection = collectionId(params.collectionId);
    const ttl = params.expiresInSeconds ?? 900;
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) {
      throw new ValidationError("expiresInSeconds must be an integer between 60 and 3600", {
        status: 400,
        field: "expiresInSeconds",
      });
    }
    const scopes = normalizedScopes(params.scopes);
    const data = record(await this.#transport.request<unknown>({
      method: "POST",
      path: "/sticker-runtime/client-tokens",
      body: {
        collection_id: selectedCollection,
        expires_in_seconds: ttl,
        ...(scopes ? { scopes } : {}),
      },
      retry: "never",
      signal: params.signal,
    }));
    return {
      accessToken: String(data.access_token ?? ""),
      tokenType: "Bearer",
      expiresIn: Number(data.expires_in ?? 0),
      expiresAt: String(data.expires_at ?? ""),
      collectionId: String(data.collection_id ?? ""),
      scopes: Array.isArray(data.scopes) ? data.scopes.map(String) as StickerRuntimeScope[] : [],
    };
  }
}


export class StickerCollectionClient {
  readonly #transport: Transport;
  readonly #collectionId: string;

  constructor(transport: Transport, selectedCollectionId: string) {
    // Binding collection identity once avoids accidentally mixing collections per call.
    this.#transport = transport;
    this.#collectionId = collectionId(selectedCollectionId);
  }

  async listPacks(options: { signal?: AbortSignal } = {}): Promise<RuntimeStickerPack[]> {
    // The collection is constructor-bound and cannot be changed per request.
    const data = record(await this.#transport.request<unknown>({
      method: "GET",
      path: "/stickers/packs",
      query: { collection_id: this.#collectionId },
      retry: "safe",
      signal: options.signal,
    }));
    return Array.isArray(data.items) ? data.items.map(parsePack) : [];
  }

  async search(query: string, options: StickerSearchOptions = {}): Promise<StickerSearchResult> {
    // Search remains metadata-only; asset delivery requires a separate resolve call.
    const normalizedQuery = boundedText(query, "query", 1, 100);
    const selectedPack = options.packId === undefined
      ? undefined
      : boundedText(options.packId, "packId", 0, 160);
    const category = options.category === undefined
      ? undefined
      : boundedText(options.category, "category", 0, 80);
    const limit = boundedInteger(options.limit, "limit", 1, 50);
    const data = record(await this.#transport.request<unknown>({
      method: "GET",
      path: "/stickers/search",
      query: {
        q: normalizedQuery,
        collection_id: this.#collectionId,
        pack_id: selectedPack,
        category,
        animated: options.animated === undefined ? undefined : String(options.animated),
        limit,
      },
      retry: "safe",
      signal: options.signal,
    }));
    return {
      query: String(data.query ?? ""),
      items: Array.isArray(data.items) ? data.items.map(parseSticker) : [],
      total: Number(data.total ?? 0),
    };
  }

  async typeahead(query: string, options: StickerTypeaheadOptions = {}): Promise<StickerTypeaheadResult> {
    // Suggestions share search permission and never reveal private asset locations.
    const normalizedQuery = boundedText(query, "query", 1, 100);
    const selectedPack = options.packId === undefined
      ? undefined
      : boundedText(options.packId, "packId", 0, 160);
    const locale = options.locale === undefined
      ? undefined
      : boundedText(options.locale, "locale", 2, 16);
    const limit = boundedInteger(options.limit, "limit", 1, 20);
    const data = record(await this.#transport.request<unknown>({
      method: "GET",
      path: "/stickers/typeahead",
      query: {
        q: normalizedQuery,
        collection_id: this.#collectionId,
        pack_id: selectedPack,
        locale,
        limit,
      },
      retry: "safe",
      signal: options.signal,
    }));
    return {
      query: String(data.query ?? ""),
      locale: String(data.locale ?? ""),
      suggestions: Array.isArray(data.suggestions)
        ? data.suggestions.map((item) => {
          const suggestion = record(item);
          return { text: String(suggestion.text ?? ""), assetCount: Number(suggestion.asset_count ?? 0) };
        })
        : [],
    };
  }

  async retrieve(stableStickerId: string, options: { signal?: AbortSignal } = {}): Promise<RuntimeSticker> {
    // Metadata retrieval applies new-use authorization to the source pack.
    return parseSticker(await this.#transport.request<unknown>({
      method: "GET",
      path: `/stickers/${stickerId(stableStickerId)}`,
      query: { collection_id: this.#collectionId },
      retry: "safe",
      signal: options.signal,
    }));
  }

  async resolve(
    stableStickerId: string,
    variant: StickerVariantName,
    options: { signal?: AbortSignal } = {},
  ): Promise<StickerAssetResolution> {
    // Exact resolution is the historical-safe path and returns a short-lived GCS URL.
    if (!ALLOWED_VARIANTS.has(variant)) {
      throw new ValidationError("variant must be a supported Sticker Runtime asset", {
        status: 400,
        field: "variant",
      });
    }
    const data = record(await this.#transport.request<unknown>({
      method: "GET",
      path: `/stickers/${stickerId(stableStickerId)}/assets/${encodeURIComponent(variant)}`,
      query: { collection_id: this.#collectionId },
      retry: "safe",
      signal: options.signal,
    }));
    return {
      stickerId: String(data.sticker_id ?? ""),
      packId: String(data.pack_id ?? ""),
      packVersion: String(data.pack_version ?? ""),
      variant: String(data.variant ?? "") as StickerVariantName,
      mediaType: String(data.media_type ?? "") as "image/webp",
      bytes: Number(data.bytes ?? 0),
      sha256: String(data.sha256 ?? ""),
      url: String(data.url ?? ""),
      expiresInSeconds: Number(data.expires_in_seconds ?? 0),
      expiresAt: String(data.expires_at ?? ""),
    };
  }
}


export class StickerRuntime extends StickerCollectionClient {
  constructor(options: StickerRuntimeOptions) {
    const accessToken = String(options.accessToken || "").trim();
    if (!accessToken.startsWith("mrt_v1_")) {
      throw new ValidationError("accessToken must be a scoped Sticker Runtime token", {
        status: 401,
        field: "accessToken",
      });
    }
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
    // A dedicated bearer transport structurally prevents this optional client from
    // sending the server-side X-API-Key while sharing all collection operations.
    super(new Transport({
      bearerToken: accessToken,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs,
      maxRetries,
      fetch: fetchImplementation as FetchImplementation,
    }), options.collectionId);
  }
}
