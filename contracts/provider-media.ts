import { z } from "zod";
export const mediaUploadSchema = z.strictObject({ mediaId: z.uuid(), type: z.enum(["IMAGE", "AUDIO", "VOICE", "VIDEO"]), mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm", "video/mp4"]), fileName: z.string().min(1).max(200).refine(value => [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && char !== "/" && char !== "\\")), size: z.number().int().min(1).max(25 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export type MediaUpload = z.infer<typeof mediaUploadSchema>;
export const mediaLimit = (type: MediaUpload["type"]) => (type === "IMAGE" ? 8 : type === "VIDEO" ? 25 : 16) * 1024 * 1024;
export function validMediaKind(type: MediaUpload["type"], mime: string) { return type === "IMAGE" ? mime.startsWith("image/") : type === "VIDEO" ? mime === "video/mp4" : mime.startsWith("audio/"); }
