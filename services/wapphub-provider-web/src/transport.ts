import type { Scope } from "./vault.js";
export type ConnectionUpdate = { state?: "open" | "close"; qr?: string; code?: number };
export type TransportCallbacks = {
  connection(update: ConnectionUpdate): void;
  text(message: { id: string; chatId: string; body: string; fromMe: boolean; timestamp: number }): void;
  receipt(id: string, status: "SENT" | "DELIVERED" | "READ"): void;
  failure(): void;
};
export type Transport = { close(): void; logout(): Promise<void> };
export type TransportFactory = (scope: Scope, callbacks: TransportCallbacks) => Promise<Transport>;
