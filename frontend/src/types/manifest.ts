export * from "./manifest.generated";

export type ModelState = "stopped" | "loading" | "ready" | "inferring" | "unloading";

export const MODEL_STATES: readonly ModelState[] = [
  "stopped",
  "loading",
  "ready",
  "inferring",
  "unloading",
];

export function isModelState(value: unknown): value is ModelState {
  return typeof value === "string" && (MODEL_STATES as readonly string[]).includes(value);
}

export interface UploadedFile {
  name: string;
  base64: string;
  size: number;
}

export function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UploadedFile).name === "string" &&
    typeof (value as UploadedFile).base64 === "string"
  );
}
