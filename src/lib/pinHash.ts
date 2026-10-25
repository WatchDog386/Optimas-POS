// PIN hashing: PBKDF2-HMAC-SHA256 implemented in plain JS so it works on every
// till, including ones opened over plain http://<shop-pc>:8787 where the
// browser withholds crypto.subtle. The server verifies the same records with
// node:crypto, so a hash made on a till is valid on the server and vice versa.
//
// Record format: pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>

export const PIN_HASH_ITERATIONS = 30_000
const PREFIX = 'pbkdf2-sha256'

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const W = new Uint32Array(64)

/** One SHA-256 compression round over a 64-byte block at `off`. */
function compress(state: Uint32Array, block: Uint8Array, off: number) {
  for (let i = 0; i < 16; i++) {
    const j = off + i * 4
    W[i] = (block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]
  }
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15]
    const b = W[i - 2]
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
  }
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7]
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (h + S1 + ch + K[i] + W[i]) | 0
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (S0 + maj) | 0
    h = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d
  state[4] += e; state[5] += f; state[6] += g; state[7] += h
}

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

export function sha256(data: Uint8Array): Uint8Array {
  const state = new Uint32Array(IV)
  const len = data.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  padded.set(data)
  padded[len] = 0x80
  const bits = len * 8
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(padded.length - 4, bits >>> 0)
  for (let off = 0; off < padded.length; off += 64) compress(state, padded, off)
  return stateBytes(state)
}

function stateBytes(state: Uint32Array): Uint8Array {
  const out = new Uint8Array(32)
  const v = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) v.setUint32(i * 4, state[i])
  return out
}

/**
 * PBKDF2-HMAC-SHA256 with a single 32-byte output block. The inner/outer HMAC
 * key states are precomputed so each iteration costs exactly two compressions.
 */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array {
  let key = password
  if (key.length > 64) key = sha256(key)
  const ipad = new Uint8Array(64)
  const opad = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    const k = key[i] ?? 0
    ipad[i] = k ^ 0x36
    opad[i] = k ^ 0x5c
  }
  const inner = new Uint32Array(IV)
  compress(inner, ipad, 0)
  const outer = new Uint32Array(IV)
  compress(outer, opad, 0)

  // HMAC over a message that may be longer than one block (salt || INT(1)).
  const hmacLong = (msg: Uint8Array): Uint8Array => {
    const st = new Uint32Array(inner)
    const total = 64 + msg.length
    const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6)
    padded.set(msg)
    padded[msg.length] = 0x80
    const v = new DataView(padded.buffer)
    v.setUint32(padded.length - 4, (total * 8) >>> 0)
    v.setUint32(padded.length - 8, Math.floor((total * 8) / 0x100000000))
    for (let off = 0; off < padded.length; off += 64) compress(st, padded, off)
    return finishOuter(stateBytes(st))
  }

  // A 32-byte message after the 64-byte key block fits one padded block.
  const block = new Uint8Array(64)
  block[32] = 0x80
  block[62] = ((64 + 32) * 8) >> 8
  block[63] = ((64 + 32) * 8) & 0xff
  const finishOuter = (innerDigest: Uint8Array): Uint8Array => {
    const st = new Uint32Array(outer)
    block.set(innerDigest, 0)
    compress(st, block, 0)
    return stateBytes(st)
  }
  const hmac32 = (msg: Uint8Array): Uint8Array => {
    const st = new Uint32Array(inner)
    block.set(msg, 0)
    compress(st, block, 0)
    return finishOuter(stateBytes(st))
  }

  const first = new Uint8Array(salt.length + 4)
  first.set(salt)
  first[salt.length + 3] = 1
  let u = hmacLong(first)
  const out = u.slice()
  for (let i = 1; i < iterations; i++) {
    u = hmac32(u)
    for (let j = 0; j < 32; j++) out[j] ^= u[j]
  }
  return out
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

export function hashPin(pin: string, iterations = PIN_HASH_ITERATIONS): string {
  const salt = randomBytes(16)
  const hash = pbkdf2Sha256(new TextEncoder().encode(pin), salt, iterations)
  return `${PREFIX}$${iterations}$${toB64(salt)}$${toB64(hash)}`
}

export function isPinHash(value: unknown): value is string {
  return typeof value === 'string' && /^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(value)
}

/** Constant-time comparison of a PIN against a stored record. */
export function verifyPin(pin: string, record: string | undefined): boolean {
  if (!isPinHash(record)) return false
  const [, iterStr, saltB64, hashB64] = record.split('$')
  const iterations = Number(iterStr)
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false
  const expected = fromB64(hashB64)
  const actual = pbkdf2Sha256(new TextEncoder().encode(pin), fromB64(saltB64), iterations)
  if (expected.length !== actual.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}

export const PIN_MIN = 4
export const PIN_MAX = 6

/** Reject PINs that are trivially guessable. Returns an error message or null. */
export function weakPinReason(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin)) return `PIN must be ${PIN_MIN} to ${PIN_MAX} digits`
  if (/^(\d)\1+$/.test(pin)) return 'PIN cannot be the same digit repeated'
  const asc = '01234567890123456789'
  const desc = '98765432109876543210'
  if (asc.includes(pin) || desc.includes(pin)) return 'PIN cannot be a straight sequence like 1234'
  return null
}
