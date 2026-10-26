import {open} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_COMMENT = 0xffff;

/**
 * Reads entries of a zip file (APK, AAB, IPA, GitLab artifacts) without
 * unpacking the whole archive: the central directory first, then only the
 * entries asked for. Stored and deflated entries, zip64 archives.
 */
export class ZipFile {
  static async open(path) {
    const handle = await open(path, 'r');
    try {
      const zip = new ZipFile(handle);
      await zip.readDirectory();
      return zip;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  constructor(handle) {
    this.handle = handle;
    this.entries = [];
  }

  async read(position, length) {
    const buffer = Buffer.alloc(length);
    const {bytesRead} = await this.handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  }

  async readDirectory() {
    const {size} = await this.handle.stat();
    const tailLength = Math.min(size, MAX_COMMENT + 22);
    const tail = await this.read(size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      throw new Error('Not a zip archive');
    }
    let count = tail.readUInt16LE(eocd + 10);
    let dirSize = tail.readUInt32LE(eocd + 12);
    let dirOffset = tail.readUInt32LE(eocd + 16);

    // zip64: the real numbers are in the zip64 end record the locator points to
    const locator = eocd - 20;
    if (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
      const record = await this.read(Number(tail.readBigUInt64LE(locator + 8)), 56);
      count = Number(record.readBigUInt64LE(32));
      dirSize = Number(record.readBigUInt64LE(40));
      dirOffset = Number(record.readBigUInt64LE(48));
    }

    const dir = await this.read(dirOffset, dirSize);
    let p = 0;
    for (let i = 0; i < count && p + 46 <= dir.length; i++) {
      if (dir.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
        break;
      }
      const method = dir.readUInt16LE(p + 10);
      let compressedSize = dir.readUInt32LE(p + 20);
      let uncompressedSize = dir.readUInt32LE(p + 24);
      const nameLength = dir.readUInt16LE(p + 28);
      const extraLength = dir.readUInt16LE(p + 30);
      const commentLength = dir.readUInt16LE(p + 32);
      let localOffset = dir.readUInt32LE(p + 42);
      const name = dir.toString('utf8', p + 46, p + 46 + nameLength);

      // zip64 extra field: the sizes and offset that did not fit in 32 bits, in this order
      let extra = p + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = dir.readUInt16LE(extra);
        const length = dir.readUInt16LE(extra + 2);
        if (id === 0x0001) {
          let q = extra + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(dir.readBigUInt64LE(q));
            q += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(dir.readBigUInt64LE(q));
            q += 8;
          }
          if (localOffset === 0xffffffff) {
            localOffset = Number(dir.readBigUInt64LE(q));
          }
        }
        extra += 4 + length;
      }

      this.entries.push({name, method, compressedSize, uncompressedSize, localOffset});
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  find(predicate) {
    return this.entries.find((entry) => (typeof predicate === 'string' ? entry.name === predicate : predicate(entry)));
  }

  /**
   * The bytes of one entry, uncompressed.
   */
  async readEntry(entry) {
    const header = await this.read(entry.localOffset, 30);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error(`Broken zip entry ${entry.name}`);
    }
    const dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const data = await this.read(dataStart, entry.compressedSize);
    if (entry.method === 0) {
      return data;
    }
    if (entry.method === 8) {
      return inflateRawSync(data);
    }
    throw new Error(`Unsupported compression ${entry.method} in ${entry.name}`);
  }

  async close() {
    await this.handle.close();
  }
}

/**
 * Opens a zip, runs `fn` with it and closes it whatever happens.
 */
export async function withZip(path, fn) {
  const zip = await ZipFile.open(path);
  try {
    return await fn(zip);
  } finally {
    await zip.close();
  }
}
