# Evidence Vault encryption: design (not deployed)

Status: **design for review. No new cryptography is shipped.** Rule: SAAHI does not deploy encryption code that hasn't been reviewed by someone qualified, because a subtle mistake here either loses a survivor's evidence or gives false assurance. This document is what that reviewer should check.

## 1. What protects the vault today (verified in code)

| Layer | Today |
| --- | --- |
| In transit | HTTPS to Vercel; Vercel to Turso over HTTPS |
| At rest | Whatever the Turso plan provides for the database files. Confirm on the account before claiming it to users. |
| Access | Every vault query is scoped to `owner_id`; guardians and other accounts get 404 (tested: `safety.test.mjs` "Evidence vault") |
| Integrity | SHA-256 of the whole file computed on the phone before upload; the server recomputes it on `finish` and refuses a mismatch; exports include the hash |
| Partial uploads | Never downloadable; swept after 24 h |
| Quota | 25 MB per file, 500 MB per person |
| Audit | `vault.saved`, `vault.viewed`, `vault.deleted`, `vault.exported` in her activity log |

What this does **not** protect against: someone with database access (a leaked Turso token, an insider, a legal demand to the operator) can read every file. A stolen session token can download files until she signs out everywhere.

## 2. Threats the design addresses

1. Database or backup leak: files and labels must be unreadable without her key.
2. Operator access or compelled disclosure: SAAHI's operators must not be able to decrypt.
3. Stolen session token: a token alone must not reveal content.
4. Integrity: she, a lawyer or a court must be able to verify a file hasn't changed since capture.

Out of scope: a person who has her unlocked phone and app PIN; malware on her phone; coercion to unlock (duress mode for the vault is a separate product decision).

## 3. Proposed design: client-side envelope encryption

Keys:

- **Item key (DEK)**: random 256-bit per vault item, made on the device.
- **Vault key (VK)**: random 256-bit per person, made on the device at first use.
- **Wrapping keys**: `KEK_pw = Argon2id(password, salt_pw)` and `KEK_rc = Argon2id(recovery_code, salt_rc)`; parameters at least m = 64 MiB, t = 3, p = 1 (tune on a low-end Android phone; target < 1.5 s).
- Server stores only `wrap(VK, KEK_pw)`, `wrap(VK, KEK_rc)`, the salts and parameters, and per item `wrap(DEK, VK)`. Wrapping is AES-256-GCM with a random 96-bit nonce.

Files:

- Each 1.5 MB chunk is encrypted with AES-256-GCM under the DEK. Nonce = 64-bit random item prefix ‖ 32-bit chunk index. Associated data = `item_id ‖ chunk_index ‖ chunk_count ‖ format_version`, so chunks can't be reordered, swapped between items or truncated.
- Label, MIME type, capture time and the plaintext SHA-256 go in one encrypted metadata blob per item (same DEK, its own nonce). The server keeps only: size, chunk count, created time and the SHA-256 **of the ciphertext** (for transfer integrity).
- Why the plaintext hash is encrypted: a plaintext hash on the server would let anyone holding the database confirm whether a known image is in her vault.

Flows:

- **Save**: hash plaintext → make DEK → encrypt chunks and metadata → upload → server verifies ciphertext hash.
- **View / export**: unwrap VK with her password (cached in memory only while the app is unlocked) → unwrap DEK → decrypt → verify plaintext hash → show. Export writes the decrypted file plus a manifest with the plaintext hash, capture time and export time.
- **Password change**: re-wrap VK under the new `KEK_pw`; files are untouched.
- **Password reset with recovery code** (existing `auth/recover`): unwrap VK with `KEK_rc`, re-wrap under the new password **and** under the new recovery code that the reset issues. The current server flow must then accept the new wrapped keys in the same request.
- **Lost password and recovery code**: the vault cannot be opened by anyone, including SAAHI. The setup screen must say this plainly, and offer an export first.
- **New device**: sign in, enter password, unwrap VK. No key escrow.

Libraries (to be confirmed by the reviewer, not chosen by this document): WebCrypto `AES-GCM` on web; a maintained native AES-GCM module on React Native (Expo's `expo-crypto` has hashing and random bytes, not AES); Argon2id from an audited implementation on both. No home-made primitives.

## 4. Migration of existing items

Existing items are plaintext. After release, the app offers "Protect my vault": it downloads each item, encrypts it as above, uploads the new version, verifies, then deletes the old row and its chunks. Until every item is migrated, the vault screen shows which items are protected. Nothing is deleted before its encrypted copy verifies.

## 5. What must happen before this ships

1. Independent review of this design and of the implementation, including nonce handling, AAD, Argon2id parameters and the recovery flow.
2. Known-answer test vectors shared between web and native, run in CI.
3. Fault tests: wrong password, corrupted chunk, swapped chunk, truncated upload, reset with recovery code, password change mid-upload.
4. Usability test of the "if you lose both, it's gone" warning with real users, in English, Hindi and Bengali.
5. A decision on what happens to evidence if she dies or is incapacitated (a nominated person; that needs legal input).
6. Update the privacy notice and the in-app claims only after 1–4 pass.

## 6. Hashes and chain of custody (works today)

SAAHI records a SHA-256 fingerprint at capture and the server verifies it on upload. That proves the file hasn't changed since it reached SAAHI. It does not prove when or where the photo was taken, or that it wasn't edited before. The export says exactly that. A court may still require the original device; the app tells her to keep originals where she can.
