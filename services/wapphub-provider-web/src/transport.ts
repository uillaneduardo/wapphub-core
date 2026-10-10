import type { Scope } from "./vault.js";
import type { SyncItem } from "../../../contracts/provider.js";
export type ConnectionUpdate = { state?: "open" | "close"; qr?: string; code?: number; authenticating?: boolean };
export type TransportCallbacks = {
  connection(update: ConnectionUpdate): void;
  text(message: { id: string; chatId: string; body: string; fromMe: boolean; timestamp: number }): void;
  receipt(id: string, status: "SENT" | "DELIVERED" | "READ", chatId?: string): void;
  sync?(items: SyncItem[], historical: boolean, completed?: boolean, failures?: number, limited?: boolean): void | Promise<void>;
  failure(): void;
};
export type Transport = { close(): void; logout(): Promise<void> };
export type TransportFactory = (scope: Scope, callbacks: TransportCallbacks) => Promise<Transport>;
