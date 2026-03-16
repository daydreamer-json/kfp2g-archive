import { createHash } from 'node:crypto';
import config from '../../config.js';
import logger from '../../logger.js';

const defaultEncKey = config.network.api.parade.encryptKey.default;
const md5 = (data: Uint8Array | string) => createHash('md5').update(data);

function isValidUtf8(buffer: Buffer | Uint8Array): boolean {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(buffer);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Encrypt the request param
 * @param param If it is not a string, serialize it to JSON
 * @param encryptKey Any string
 * @returns Encrypted hex string
 */
function encrypt(param: string | object | any[], encryptKey: string = defaultEncKey) {
  const input = typeof param !== 'string' ? JSON.stringify(param) : param;

  const md5Value = md5(input).digest();
  const seed = md5Value.subarray(0, 4);
  const text = seed.toString('hex');

  const xorKey = md5(seed).digest();

  const bytes = Buffer.from(input, 'utf-8');
  for (let i = 0; i < bytes.length; i++) {
    bytes[i]! ^= xorKey[i % xorKey.length]!;
  }
  const text2 = bytes.toString('hex');

  const salt = (encryptKey + 'ABCDEFGHIJKL').substring(2, 9) + ' ';
  const verifyMd5 = md5(input + salt).digest('hex');

  return text + text2 + verifyMd5;
}

/**
 * Decrypt the request param
 * @param encrypted Encrypted hex string
 * @param encryptKey Any string
 * @returns Raw request param string
 */
function decrypt(encrypted: string, encryptKey: string = defaultEncKey): string | null {
  // text(8) + md5(32)
  if (encrypted.length < 40) return null;

  const text = encrypted.substring(0, 8);
  const verifyMd5 = encrypted.substring(encrypted.length - 32);
  const text2 = encrypted.substring(8, encrypted.length - 32);

  const seed = Buffer.from(text, 'hex');
  const xorKey = md5(seed).digest();

  const encBytes = Buffer.from(text2, 'hex');
  for (let i = 0; i < encBytes.length; i++) {
    encBytes[i]! ^= xorKey[i % xorKey.length]!;
  }

  const param = encBytes.toString('utf-8');

  const salt = (encryptKey + 'ABCDEFGHIJKL').substring(2, 9) + ' ';
  const expectedMd5 = md5(param + salt).digest('hex');

  if (verifyMd5 === expectedMd5) return param;
  if (verifyMd5 !== expectedMd5) {
    if (isValidUtf8(encBytes)) {
      logger.warn(`API req decrypt: MD5 mismatch! Encrypt key is invalid`);
      return param;
    } else {
      logger.warn(`API req decrypt: MD5 mismatch! Cannot decrypt`);
      return null;
    }
  }

  return verifyMd5 === expectedMd5 ? param : null;
}

/**
 * Decode the API response data.
 * If data is gzip (which is usually the case), it will be gunzip
 * @param data Raw binary
 * @returns JSON data
 */
function decode(data: ArrayBuffer) {
  // check gzip magic number
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return JSON.parse(new TextDecoder().decode(Bun.gunzipSync(data)));
  }
  return JSON.parse(new TextDecoder().decode(data));
}

export default { encrypt, decrypt, decode };
