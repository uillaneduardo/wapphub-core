import { sendIntentSchema } from "../../contracts/provider-outbound.js";
import { AppError } from "../domain/errors.js";

/** Compose once at enqueue time. Retries must use the persisted snapshot. */
export function outboundSignature(body: string, attendantName: string, media = false): string {
  const name = attendantName.normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}*_~`]/gu, "")
    .replace(/ +/g, " ")
    .trim();
  if ((!media || body.trim()) && !name) throw new AppError(400, "INVALID_ATTENDANT_NAME");
  const transmittedBody = media && !body.trim() ? body : `*${name}*\n${body}`;
  if (!sendIntentSchema.shape.body.safeParse(transmittedBody).success)
    throw new AppError(400, "MESSAGE_PRESENTATION_TOO_LONG");
  return transmittedBody;
}
