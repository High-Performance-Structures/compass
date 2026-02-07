// netsuite-specific encrypt/decrypt that delegates to shared crypto
// with the netsuite-specific PBKDF2 salt.

import {
  encrypt as sharedEncrypt,
  decrypt as sharedDecrypt,
} from "@/lib/crypto"

const NETSUITE_SALT = "compass-netsuite-tokens"

export async function encrypt(
  plaintext: string,
  secret: string
): Promise<string> {
  return sharedEncrypt(plaintext, secret, NETSUITE_SALT)
}

export async function decrypt(
  encoded: string,
  secret: string
): Promise<string> {
  return sharedDecrypt(encoded, secret, NETSUITE_SALT)
}
