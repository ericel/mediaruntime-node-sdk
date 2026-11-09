// An operation deadline is separate from the transport's per-attempt timeout.
// Keep its controller, timer, and caller listener local to each invocation.
export async function withDeadline<T>(
  timeoutMs: number,
  caller: AbortSignal | undefined,
  timeoutError: () => Error,
  operation: (signal: AbortSignal, checkActive: () => void) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expire = () => {
    if (!controller.signal.aborted) controller.abort(timeoutError());
  };
  const checkActive = () => {
    // The clock is authoritative even if the event loop has not delivered the
    // deadline timer. Once cancelled, retain the first cancellation reason.
    if (Date.now() >= deadline) expire();
    controller.signal.throwIfAborted();
  };
  const abort = () => {
    if (Date.now() >= deadline) expire();
    else controller.abort(caller?.reason);
  };
  const schedule = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) expire();
    else {
      // Node clamps overflowing delays to 1ms. Re-arm long budgets instead.
      timer = setTimeout(schedule, Math.min(remaining, 2 ** 31 - 1));
    }
  };

  try {
    if (caller?.aborted) controller.abort(caller.reason);
    else caller?.addEventListener("abort", abort, { once: true });
    checkActive();
    schedule();
    return await operation(controller.signal, checkActive);
  } catch (error) {
    checkActive();
    throw error;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", abort);
  }
}

// Observe cancellation even when an injected fetch or response body ignores its
// signal. Attach both handlers so a late rejection cannot become unhandled.
export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
