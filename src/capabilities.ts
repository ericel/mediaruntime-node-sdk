import type { Capabilities } from "./types.js";
import type { Transport } from "./transport.js";
import { parseCapabilities } from "./wire.js";

export class CapabilitiesClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async retrieve(options: { signal?: AbortSignal } = {}): Promise<Capabilities> {
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: "/capabilities",
      authenticated: false,
      retry: "safe",
      signal: options.signal,
    });
    return parseCapabilities(value);
  }
}
