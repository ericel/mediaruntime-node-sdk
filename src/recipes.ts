import { ValidationError } from "./errors.js";
import type {
  CreateRecipeParams,
  CreateRecipeVersionParams,
  HostedRecipe,
  JobOutput,
  OutputAlias,
  RecipeTemplate,
} from "./types.js";
import type { Transport } from "./transport.js";
import { serializeOutput } from "./wire.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function recipeName(value: string): string {
  const name = value.trim();
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) {
    throw new ValidationError("recipe name must use lowercase letters, numbers, and hyphens", {
      status: 400,
      field: "name",
    });
  }
  return encodeURIComponent(name);
}

function serializeTemplate(template: RecipeTemplate): UnknownRecord {
  const value: UnknownRecord = {};
  if (template.outputs !== undefined) value.outputs = template.outputs.map(serializeOutput);
  if (template.moderation !== undefined) value.moderation = template.moderation;
  if (template.watermark !== undefined) value.watermark = template.watermark;
  return value;
}

function parseOutput(value: unknown): JobOutput | OutputAlias {
  if (typeof value === "string") return value as OutputAlias;
  const data = record(value);
  const output: JobOutput = { type: String(data.type ?? "") as JobOutput["type"] };
  const scalar: Array<[keyof JobOutput, string]> = [
    ["preset", "preset"], ["pathSuffix", "path_suffix"], ["removeBg", "remove_bg"],
    ["smartCrop", "smart_crop"], ["posterTimeSec", "poster_time_sec"],
    ["posterFormat", "poster_format"],
  ];
  for (const [clientKey, wireKey] of scalar) {
    if (data[wireKey] !== undefined) {
      (output as unknown as UnknownRecord)[clientKey] = data[wireKey];
    }
  }
  if (data.video !== undefined) {
    const video = record(data.video);
    output.video = {
      ...(video.codec !== undefined ? { codec: String(video.codec) } : {}),
      ...(video.height !== undefined ? { height: Number(video.height) } : {}),
      ...(video.bitrate_bps !== undefined ? { bitrateBps: Number(video.bitrate_bps) } : {}),
      ...(video.preset !== undefined ? { preset: String(video.preset) } : {}),
      ...(video.fps !== undefined ? { fps: Number(video.fps) } : {}),
      ...(video.two_pass !== undefined ? { twoPass: video.two_pass === true } : {}),
    };
  }
  if (data.audio !== undefined) {
    const audio = record(data.audio);
    output.audio = {
      ...(audio.codec !== undefined ? { codec: String(audio.codec) } : {}),
      ...(audio.bitrate_bps !== undefined ? { bitrateBps: Number(audio.bitrate_bps) } : {}),
      ...(audio.channels !== undefined ? { channels: Number(audio.channels) } : {}),
    };
  }
  if (data.thumbnails !== undefined) {
    const thumbnails = record(data.thumbnails);
    output.thumbnails = {
      ...(thumbnails.enabled !== undefined ? { enabled: thumbnails.enabled === true } : {}),
      ...(thumbnails.format !== undefined ? { format: String(thumbnails.format) as NonNullable<JobOutput["thumbnails"]>["format"] } : {}),
      ...(thumbnails.interval_sec !== undefined ? { intervalSec: Number(thumbnails.interval_sec) } : {}),
      ...(thumbnails.tile_width !== undefined ? { tileWidth: Number(thumbnails.tile_width) } : {}),
      ...(thumbnails.tile_height !== undefined ? { tileHeight: Number(thumbnails.tile_height) } : {}),
      ...(thumbnails.cols !== undefined ? { cols: Number(thumbnails.cols) } : {}),
      ...(thumbnails.rows !== undefined ? { rows: Number(thumbnails.rows) } : {}),
      ...(thumbnails.max_sheets !== undefined ? { maxSheets: Number(thumbnails.max_sheets) } : {}),
    };
  }
  if (data.subtitles !== undefined) {
    const subtitles = record(data.subtitles);
    output.subtitles = {
      ...(subtitles.enabled !== undefined ? { enabled: subtitles.enabled === true } : {}),
      ...(subtitles.format !== undefined ? { format: String(subtitles.format) as NonNullable<JobOutput["subtitles"]>["format"] } : {}),
      ...(Array.isArray(subtitles.languages) ? { languages: subtitles.languages.map(String) } : {}),
      ...(subtitles.model !== undefined ? { model: String(subtitles.model) } : {}),
      ...(subtitles.translate_to_english !== undefined ? { translateToEnglish: subtitles.translate_to_english === true } : {}),
      ...(subtitles.max_audio_minutes !== undefined ? { maxAudioMinutes: Number(subtitles.max_audio_minutes) } : {}),
    };
  }
  if (data.gif_preview !== undefined) {
    const gif = record(data.gif_preview);
    output.gifPreview = {
      ...(gif.enabled !== undefined ? { enabled: gif.enabled === true } : {}),
      ...(gif.width !== undefined ? { width: Number(gif.width) } : {}),
      ...(gif.fps !== undefined ? { fps: Number(gif.fps) } : {}),
      ...(gif.start_time !== undefined ? { startTime: Number(gif.start_time) } : {}),
      ...(gif.duration !== undefined ? { duration: Number(gif.duration) } : {}),
    };
  }
  if (Array.isArray(data.images)) {
    output.images = data.images.map((value) => {
      const image = record(value);
      return {
        width: Number(image.width),
        height: Number(image.height),
        format: String(image.format) as NonNullable<JobOutput["images"]>[number]["format"],
        ...(image.mode !== undefined ? { mode: String(image.mode) } : {}),
        ...(image.quality !== undefined ? { quality: Number(image.quality) } : {}),
      };
    });
  }
  return output;
}

function parseTemplate(value: unknown): RecipeTemplate | undefined {
  const data = record(value);
  if (Object.keys(data).length === 0) return undefined;
  return {
    ...(Array.isArray(data.outputs) ? { outputs: data.outputs.map(parseOutput) } : {}),
    ...(data.moderation !== undefined ? { moderation: record(data.moderation) } : {}),
    ...(data.watermark !== undefined ? { watermark: record(data.watermark) } : {}),
  };
}

function parseRecipe(value: unknown): HostedRecipe {
  const data = record(value);
  const template = parseTemplate(data.template);
  return {
    name: String(data.name ?? ""),
    version: Number(data.version ?? 0),
    reference: String(data.reference ?? ""),
    description: String(data.description ?? ""),
    builtIn: data.built_in === true,
    status: String(data.status ?? "active") as HostedRecipe["status"],
    sha256: String(data.sha256 ?? ""),
    ...(template ? { template } : {}),
  };
}

export class RecipesClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async list(options: { signal?: AbortSignal } = {}): Promise<HostedRecipe[]> {
    const value = record(await this.#transport.request<unknown>({
      method: "GET", path: "/recipes", retry: "safe", signal: options.signal,
    }));
    return Array.isArray(value.recipes) ? value.recipes.map(parseRecipe) : [];
  }

  async get(name: string, options: { version?: number; signal?: AbortSignal } = {}): Promise<HostedRecipe> {
    if (options.version !== undefined && (!Number.isInteger(options.version) || options.version < 1)) {
      throw new ValidationError("recipe version must be a positive integer", { status: 400, field: "version" });
    }
    const path = options.version === undefined
      ? `/recipes/${recipeName(name)}`
      : `/recipes/${recipeName(name)}/versions/${options.version}`;
    return parseRecipe(await this.#transport.request<unknown>({
      method: "GET", path, retry: "safe", signal: options.signal,
    }));
  }

  async create(params: CreateRecipeParams): Promise<HostedRecipe> {
    const name = recipeName(params.name);
    return parseRecipe(await this.#transport.request<unknown>({
      method: "POST",
      path: "/recipes",
      body: { name, description: params.description ?? "", template: serializeTemplate(params.template) },
      retry: "never",
      signal: params.signal,
    }));
  }

  async createVersion(name: string, params: CreateRecipeVersionParams): Promise<HostedRecipe> {
    if (!Number.isInteger(params.expectedLatestVersion) || params.expectedLatestVersion < 1) {
      throw new ValidationError("expectedLatestVersion must be a positive integer", {
        status: 400,
        field: "expectedLatestVersion",
      });
    }
    return parseRecipe(await this.#transport.request<unknown>({
      method: "POST",
      path: `/recipes/${recipeName(name)}/versions`,
      body: {
        expected_latest_version: params.expectedLatestVersion,
        ...(params.description !== undefined ? { description: params.description } : {}),
        template: serializeTemplate(params.template),
      },
      retry: "never",
      signal: params.signal,
    }));
  }

  async archive(name: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    await this.#transport.request<unknown>({
      method: "DELETE", path: `/recipes/${recipeName(name)}`, retry: "never", signal: options.signal,
    });
  }
}
