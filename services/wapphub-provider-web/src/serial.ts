/** All mutations of a scope are ordered; failures do not poison subsequent work. */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending >= 128) return Promise.reject(new ServiceError("SYNC_BACKPRESSURE", 503));
    this.pending++;
    const result = this.tail.then(operation).finally(() => { this.pending--; });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
import { ServiceError } from "./errors.js";
