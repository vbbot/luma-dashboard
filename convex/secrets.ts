// Encrypts third-party credentials (e.g. a Habitica API token) before they are
// stored, so a leaked database or backup does not expose them. The key is
// INTEGRATIONS_KEY, set by the backend container from INSTANCE_SECRET; for
// `convex dev` set it with `npx convex env set INTEGRATIONS_KEY "$(openssl rand -hex 32)"`.
//
// encrypt needs real randomness for its IV, so call it from actions only:
// randomness inside queries and mutations is seeded.

declare const process: { env: Record<string, string | undefined> };

let cachedKey: Promise<CryptoKey> | undefined;

function key(): Promise<CryptoKey> {
  const hex = process.env.INTEGRATIONS_KEY;
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("INTEGRATIONS_KEY is not set on the deployment (64 hex characters)");
  }
  cachedKey ??= crypto.subtle.importKey(
    "raw",
    new Uint8Array(hex.match(/../g)!.map((byte) => parseInt(byte, 16))),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

// "v1.<iv>.<ciphertext>", both base64; AES-256-GCM.
export async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key(),
      new TextEncoder().encode(plaintext),
    ),
  );
  return `v1.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decrypt(sealed: string): Promise<string> {
  const [version, iv, ciphertext] = sealed.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("Unknown secret format");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await key(),
    fromBase64(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
