import { basename } from "node:path";
import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  MediaRuntimeApiError,
  MediaRuntimeConnectionError,
  ValidationError,
} from "./errors.js";
import type {
  UploadTarget,
  WatermarkLogo,
  WatermarkLogoConfirmParams,
  WatermarkLogoUploadOptions,
  WatermarkPosition,
} from "./types.js";
import type { Transport } from "./transport.js";

function parseTarget(value: unknown): UploadTarget {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const headerData =
    data.upload_headers && typeof data.upload_headers === "object"
      ? (data.upload_headers as Record<string, unknown>)
      : {};
  return {
    uploadUrl: String(data.upload_url ?? ""),
    fileUri: String(data.file_uri ?? ""),
    uploadHeaders: Object.fromEntries(
      Object.entries(headerData).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
}

function parseLogo(value: unknown): WatermarkLogo {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    logoUrl: String(data.logo_url ?? ""),
    position: String(data.position ?? "bottom_right") as WatermarkPosition,
    opacityPct: Number(data.opacity_pct ?? 100),
    scalePct: Number(data.scale_pct ?? 12),
  };
}

export class WatermarkLogoClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async createUploadTarget(
    contentType = "image/png",
    signal?: AbortSignal,
  ): Promise<UploadTarget> {
    const value = await this.#transport.request<unknown>({
      method: "POST",
      path: "/account/watermark-logo/upload-url",
      body: { content_type: contentType },
      retry: "never",
      signal,
    });
    return parseTarget(value);
  }

  async confirm(params: WatermarkLogoConfirmParams): Promise<WatermarkLogo> {
    const value = await this.#transport.request<unknown>({
      method: "POST",
      path: "/account/watermark-logo/confirm",
      body: {
        file_uri: params.fileUri,
        position: params.position ?? "bottom_right",
        opacity_pct: params.opacityPct ?? 100,
        scale_pct: params.scalePct ?? 12,
      },
      retry: "never",
      signal: params.signal,
    });
    return parseLogo(value);
  }

  async upload(path: string, options: WatermarkLogoUploadOptions = {}): Promise<WatermarkLogo> {
    const absolutePath = resolve(path);
    const info = await stat(absolutePath);
    if (!info.isFile() || !basename(absolutePath).toLowerCase().endsWith(".png")) {
      throw new ValidationError("Watermark logo must be a PNG file", {
        status: 400,
        field: "path",
      });
    }
    // Watermark setup is two-phase: upload bytes first, then confirm account configuration.
    const target = await this.createUploadTarget("image/png", options.signal);
    const headers = new Headers(target.uploadHeaders);
    if (!headers.has("Content-Length")) headers.set("Content-Length", String(info.size));
    const nodeStream = createReadStream(absolutePath);
    let response: Response;
    try {
      response = await this.#transport.fetch(target.uploadUrl, {
        method: "PUT",
        headers,
        body: Readable.toWeb(nodeStream),
        duplex: "half",
        signal: options.signal,
      } as RequestInit & { duplex: "half" });
    } catch (error) {
      nodeStream.destroy();
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      throw new MediaRuntimeConnectionError("Could not upload the watermark logo", {
        cause: error,
      });
    }
    if (!response.ok) {
      const details = await response.text();
      throw new MediaRuntimeApiError(details || `Watermark upload failed (${response.status})`, {
        status: response.status,
        details,
        headers: response.headers,
      });
    }
    return this.confirm({
      fileUri: target.fileUri,
      ...(options.position !== undefined ? { position: options.position } : {}),
      ...(options.opacityPct !== undefined ? { opacityPct: options.opacityPct } : {}),
      ...(options.scalePct !== undefined ? { scalePct: options.scalePct } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }
}
