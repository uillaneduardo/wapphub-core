import type { Scope } from "./vault.js";
import type { SyncItem } from "../../../contracts/provider.js";
import type { SyncObservation } from "../../../contracts/provider-internal.js";
export type ConnectionUpdate = { state?: "open" | "close"; qr?: string; code?: number; authenticating?: boolean };
export type TransportCallbacks = {
  connection(update: ConnectionUpdate): void;
  text(message: { id: string; chatId: string; body: string; fromMe: boolean; timestamp: number }): void;
  receipt(id: string, status: "SENT" | "DELIVERED" | "READ", chatId?: string): void;
  sync?(items: SyncItem[], historical: boolean, completed?: boolean, failures?: number, limited?: boolean, observation?: SyncObservation): void | Promise<void>;
  bootstrapPage?(items: SyncItem[], digest: string, next: number): Promise<void>;
  failure(): void;
};
import type { HistoryControl } from "../../../contracts/history.js";
import type { SendIntent } from "../../../contracts/provider-outbound.js";
export type Transport = { resolveRecipient?(phone: string): Promise<{ state: "VALID" | "NOT_FOUND" | "UNKNOWN"; jid?: string }>; send?(intent: SendIntent): Promise<void>; close(): void; logout(): Promise<void>; history?(control: HistoryControl): Promise<void> };
export type TransportFactory = (scope: Scope, callbacks: TransportCallbacks) => Promise<Transport>;
