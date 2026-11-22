/**
 * RFC 8785 (JSON Canonicalization Scheme) and frozen batches (S12 design §4.5 Rev 3 item 2):
 * the body is built once as an object, serialized canonically, and those exact UTF-8 bytes are
 * stored and sent byte for byte on every attempt. Credentials never go in the body.
 *
 * Numbers use ECMAScript's Number-to-String, which is what RFC 8785 §3.2.2.3 specifies; strings use
 * JSON.stringify's escaping, which matches RFC 8785 §3.2.2.2 for every code point. Keys are sorted
 * by UTF-16 code units (§3.2.3), which is JavaScript's default string comparison.
 */
import { createHash } from "node:crypto";
import type { FrozenBatch } from "./types.js";

function ser(value: unknown, path: string): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalize: non-finite number at ${path}`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "undefined":
      return undefined;
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => ser(v, `${path}[${i}]`) ?? "null").join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(`canonicalize: only plain objects and arrays are allowed (at ${path})`);
      }
      const obj = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const k of Object.keys(obj).sort()) {
        const v = ser(obj[k], `${path}.${k}`);
        if (v !== undefined) parts.push(`${JSON.stringify(k)}:${v}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`canonicalize: unsupported ${typeof value} at ${path}`);
  }
}

export function canonicalize(value: unknown): string {
  const out = ser(value, "$");
  if (out === undefined) throw new Error("canonicalize: the top-level value is undefined");
  return out;
}

export function freezeBatch(input: { id: string; endpoint: string; apiVersion: string; request: unknown }): FrozenBatch {
  if (typeof input.id !== "string" || input.id.trim() === "") throw new Error("freezeBatch: id is required");
  if (typeof input.endpoint !== "string" || input.endpoint.trim() === "") throw new Error("freezeBatch: endpoint is required");
  if (typeof input.apiVersion !== "string" || input.apiVersion.trim() === "") throw new Error("freezeBatch: apiVersion is required");
  const body = new TextEncoder().encode(canonicalize(input.request));
  return {
    id: input.id,
    endpoint: input.endpoint,
    apiVersion: input.apiVersion,
    body,
    bodySha256: createHash("sha256").update(body).digest("hex"),
  };
}

/** True when `body` still hashes to `bodySha256`. A mismatch is never sent. */
export function frozenBodyMatches(batch: FrozenBatch): boolean {
  if (!(batch.body instanceof Uint8Array) || typeof batch.bodySha256 !== "string") return false;
  return createHash("sha256").update(batch.body).digest("hex") === batch.bodySha256;
}
