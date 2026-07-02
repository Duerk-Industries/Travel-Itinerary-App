/**
 * Jest mock for socket.io-client. The real module pulls in engine.io-client,
 * which has `.node.js` transport files that call require('fs') and similar
 * Node-only modules at module-evaluation time. Tests don't exercise the
 * socket layer, so a no-op stub is safer and keeps `App.tsx` importable in
 * the jsdom/node test environment without bundler interop concerns.
 */

type Listener = (...args: unknown[]) => void;

class FakeSocket {
  connected = false;
  auth: Record<string, unknown> = {};
  private listeners = new Map<string, Set<Listener>>();

  connect(): this {
    this.connected = true;
    return this;
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  emit(_event: string, ..._args: unknown[]): boolean {
    return true;
  }

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener?: Listener): this {
    if (!listener) {
      this.listeners.delete(event);
      return this;
    }
    this.listeners.get(event)?.delete(listener);
    return this;
  }
}

export type Socket = FakeSocket;

export const io = (..._args: unknown[]): FakeSocket => new FakeSocket();

export default io;
