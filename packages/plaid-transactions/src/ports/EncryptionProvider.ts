export interface EncryptionProvider {
  encrypt(plaintext: string): Promise<{ ciphertext: string; keyVersion: string }>;
  decrypt(ciphertext: string, keyVersion: string): Promise<string>;
}
