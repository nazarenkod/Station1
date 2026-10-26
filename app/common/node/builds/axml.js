// Android's binary XML (AndroidManifest.xml inside an APK), decoded into a
// plain element tree: {name, attrs, children}. Attribute names lose their
// namespace prefix; values are strings, numbers, booleans or "@0x7f..."
// references.

const CHUNK = {
  STRING_POOL: 0x0001,
  XML: 0x0003,
  START_ELEMENT: 0x0102,
  END_ELEMENT: 0x0103,
  RESOURCE_MAP: 0x0180,
};

const TYPE = {
  REFERENCE: 0x01,
  ATTRIBUTE: 0x02,
  STRING: 0x03,
  FLOAT: 0x04,
  INT_DEC: 0x10,
  INT_HEX: 0x11,
  BOOLEAN: 0x12,
};

const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

// manifests shrunk by R8 or protected by obfuscators drop attribute names;
// the framework resource id still tells which attribute it is
const ANDROID_ATTRS = {
  0x01010001: 'label',
  0x01010003: 'name',
  0x01010006: 'permission',
  0x0101000f: 'debuggable',
  0x01010010: 'exported',
  0x0101020c: 'minSdkVersion',
  0x0101021b: 'versionCode',
  0x0101021c: 'versionName',
  0x01010270: 'targetSdkVersion',
  0x01010272: 'testOnly',
  0x01010280: 'allowBackup',
  0x010104ec: 'usesCleartextTraffic',
  0x01010527: 'networkSecurityConfig',
};

function readStringPool(buf, start) {
  const count = buf.readUInt32LE(start + 8);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = start + buf.readUInt32LE(start + 20);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const strings = [];
  for (let i = 0; i < count; i++) {
    let p = stringsStart + buf.readUInt32LE(start + 28 + i * 4);
    if (utf8) {
      // the length in UTF-16 units, then in bytes; each 1 or 2 bytes long
      p += buf[p] & 0x80 ? 2 : 1;
      let bytes = buf[p];
      if (bytes & 0x80) {
        bytes = ((bytes & 0x7f) << 8) | buf[p + 1];
        p += 2;
      } else {
        p += 1;
      }
      strings.push(buf.toString('utf8', p, p + bytes));
    } else {
      let units = buf.readUInt16LE(p);
      if (units & 0x8000) {
        units = ((units & 0x7fff) << 16) | buf.readUInt16LE(p + 2);
        p += 4;
      } else {
        p += 2;
      }
      strings.push(buf.toString('utf16le', p, p + units * 2));
    }
  }
  return strings;
}

function typedValue(dataType, data, strings) {
  switch (dataType) {
    case TYPE.STRING:
      return strings[data] ?? '';
    case TYPE.BOOLEAN:
      return data !== 0;
    case TYPE.INT_DEC:
    case TYPE.INT_HEX:
      return data | 0;
    case TYPE.REFERENCE:
    case TYPE.ATTRIBUTE:
      return `@0x${(data >>> 0).toString(16).padStart(8, '0')}`;
    case TYPE.FLOAT: {
      const scratch = Buffer.alloc(4);
      scratch.writeUInt32LE(data >>> 0);
      return scratch.readFloatLE(0);
    }
    default:
      return data;
  }
}

/**
 * Decodes a binary XML document into its root element.
 */
export function parseAxml(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== CHUNK.XML) {
    throw new Error('Not an Android binary XML file');
  }
  let strings = [];
  let resourceIds = [];
  const root = {name: '#document', attrs: {}, children: []};
  const stack = [root];

  let p = buf.readUInt16LE(2);
  while (p + 8 <= buf.length) {
    const type = buf.readUInt16LE(p);
    const headerSize = buf.readUInt16LE(p + 2);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8) {
      break;
    }
    if (type === CHUNK.STRING_POOL) {
      strings = readStringPool(buf, p);
    } else if (type === CHUNK.RESOURCE_MAP) {
      resourceIds = [];
      for (let q = p + headerSize; q + 4 <= p + size; q += 4) {
        resourceIds.push(buf.readUInt32LE(q));
      }
    } else if (type === CHUNK.START_ELEMENT) {
      const ext = p + headerSize;
      const name = strings[buf.readUInt32LE(ext + 4)] ?? '';
      const attrStart = buf.readUInt16LE(ext + 8);
      const attrSize = buf.readUInt16LE(ext + 10);
      const attrCount = buf.readUInt16LE(ext + 12);
      const attrs = {};
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const nameIndex = buf.readUInt32LE(a + 4);
        const rawValue = buf.readUInt32LE(a + 8);
        const dataType = buf[a + 15];
        const data = buf.readUInt32LE(a + 16);
        const attrName = strings[nameIndex] || ANDROID_ATTRS[resourceIds[nameIndex]] || `attr${nameIndex}`;
        attrs[attrName] = rawValue !== NO_INDEX ? strings[rawValue] : typedValue(dataType, data, strings);
      }
      const element = {name, attrs, children: []};
      stack[stack.length - 1].children.push(element);
      stack.push(element);
    } else if (type === CHUNK.END_ELEMENT) {
      if (stack.length > 1) {
        stack.pop();
      }
    }
    p += size;
  }
  const [first] = root.children;
  if (!first) {
    throw new Error('The binary XML has no elements');
  }
  return first;
}

/**
 * Every descendant element with this name.
 */
export function findAll(element, name, found = []) {
  for (const child of element.children) {
    if (child.name === name) {
      found.push(child);
    }
    findAll(child, name, found);
  }
  return found;
}
