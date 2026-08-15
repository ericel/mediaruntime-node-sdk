import { basename, extname, resolve } from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  MediaRuntimeApiError,
  MediaRuntimeConnectionError,
  ValidationError,
} from "./errors.js";
import type { Source, UploadFileResult, UploadTarget } from "./types.js";
import type { Transport } from "./transport.js";

interface UploadFileOptions {
  contentType?: string;
  signal?: AbortSignal;
}

const CONTENT_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".avif": "image/avif",
  ".avi": "video/x-msvideo",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function inferContentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function parseUploadTarget(value: unknown): UploadTarget {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawHeaders =
    data.upload_headers && typeof data.upload_headers === "object"
      ? (data.upload_headers as Record<string, unknown>)
      : {};
  const uploadHeaders = Object.fromEntries(
    Object.entries(rawHeaders).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    uploadUrl: String(data.upload_url ?? ""),
    fileUri: String(data.file_uri ?? ""),
    uploadHeaders,
  };
}

async function uploadResponseError(response: Response): Promise<MediaRuntimeApiError> {
  const body = await response.text();
  return new MediaRuntimeApiError(
    body || `Signed upload failed with status ${response.status}`,
    { status: response.status, details: body, headers: response.headers },
  );
}

export class UploadsClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async createTarget(
    filename: string,
    contentType = "application/octet-stream",
    signal?: AbortSignal,
  ): Promise<UploadTarget> {
    if (!filename.trim()) {
      throw new ValidationError("filename must not be empty", { status: 400, field: "filename" });
    }
    const value = await this.#transport.request<unknown>({
      method: "POST",
      path: "/upload-url",
      body: { filename, content_type: contentType },
      retry: "never",
      signal,
    });
    return parseUploadTarget(value);
  }

  async uploadFile(path: string, options: UploadFileOptions = {}): Promise<UploadFileResult> {
    const absolutePath = resolve(path);
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw new ValidationError(`Source is not a regular file: ${absolutePath}`, {
        status: 400,
        field: "source",
      });
    }
    const filename = basename(absolutePath);
    const contentType = options.contentType ?? inferContentType(absolutePath);
    const target = await this.createTarget(filename, contentType, options.signal);
    await this.putFile(target, absolutePath, info.size, options.signal);
    return { ...target, filename, contentType };
  }

  async resolveSource(source: Source, signal?: AbortSignal): Promise<string> {
    if (source instanceof URL) {
      if (source.protocol === "http:" || source.protocol === "https:" || source.protocol === "gs:") {
        return source.toString();
      }
      if (source.protocol === "file:") {
        return (await this.uploadFile(fileURLToPath(source), { signal })).fileUri;
      }
      throw new ValidationError(`Unsupported source protocol: ${source.protocol}`, {
        status: 400,
        field: "source",
      });
    }

    const value = String(source).trim();
    if (!value) {
      throw new ValidationError("source must not be empty", { status: 400, field: "source" });
    }
    if (/^(https?:\/\/|gs:\/\/)/i.test(value)) return value;
    if (/^file:\/\//i.test(value)) {
      return (await this.uploadFile(fileURLToPath(new URL(value)), { signal })).fileUri;
    }
    return (await this.uploadFile(value, { signal })).fileUri;
  }

  private async putFile(
    target: UploadTarget,
    absolutePath: string,
    size: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const headers = new Headers(target.uploadHeaders);
    if (!headers.has("Content-Length")) headers.set("Content-Length", String(size));
    const nodeStream = createReadStream(absolutePath);
    const body = Readable.toWeb(nodeStream);
    const init = {
      method: "PUT",
      headers,
      body,
      duplex: "half",
      signal,
      redirect: "follow",
    } as RequestInit & { duplex: "half" };
    let response: Response;
    try {
      response = await this.#transport.fetch(target.uploadUrl, init);
    } catch (error) {
      nodeStream.destroy();
      if (signal?.aborted) throw signal.reason ?? error;
      throw new MediaRuntimeConnectionError("Could not upload the local source", {
        cause: error,
      });
    }
    if (!response.ok) throw await uploadResponseError(response);
  }
}
