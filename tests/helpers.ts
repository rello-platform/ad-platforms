import * as net from "node:net";
import { generateKeyPairSync } from "node:crypto";

/** A base URL on a port nothing listens on: connecting fails before any byte is written. */
export async function deadBase(): Promise<string> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise<void>((r) => srv.close(() => r()));
  return `http://127.0.0.1:${port}/x`;
}

export const noSleep = async (): Promise<void> => {};

/** A throwaway service-account key for the fake's token endpoint. Never a real credential. */
export function testServiceAccount(tokenUri: string): { json: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    json: JSON.stringify({
      type: "service_account",
      client_email: "s12a-test@fake.iam.example",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      token_uri: tokenUri,
    }),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
