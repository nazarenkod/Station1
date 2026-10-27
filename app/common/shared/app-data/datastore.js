// Jetpack DataStore Preferences: files/datastore/<name>.preferences_pb, a
// protobuf PreferenceMap {map<string, Value> preferences = 1}. Value is a
// oneof: boolean 1, float 2, integer 3, long 4, string 5, string_set 6
// (StringSet {repeated string strings = 1}), double 7, bytes 8.

const FIELD_TYPES = {1: 'boolean', 2: 'float', 3: 'int', 4: 'long', 5: 'string', 6: 'set', 7: 'double', 8: 'data'};
const TYPE_FIELDS = Object.fromEntries(Object.entries(FIELD_TYPES).map(([field, type]) => [type, Number(field)]));

const utf8 = new TextDecoder();
const encoder = new TextEncoder();

// base64 with what both Node and the browser have
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => [...atob(text)].map((char) => char.charCodeAt(0));

function reader(bytes) {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (pos >= bytes.length) {
        throw new Error('Broken protobuf');
      }
      const byte = bytes[pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) {
        return result;
      }
      shift += 7n;
    }
  };
  const take = (length) => {
    if (pos + length > bytes.length) {
      throw new Error('Broken protobuf');
    }
    const part = bytes.subarray(pos, pos + length);
    pos += length;
    return part;
  };
  return {
    done: () => pos >= bytes.length,
    // each field as [number, wire type, raw value]
    field() {
      const tag = Number(varint());
      const wire = tag & 7;
      const number = tag >> 3;
      if (wire === 0) {
        return [number, wire, varint()];
      }
      if (wire === 1) {
        const value = view.getFloat64(pos, true);
        take(8);
        return [number, wire, value];
      }
      if (wire === 2) {
        return [number, wire, take(Number(varint()))];
      }
      if (wire === 5) {
        const value = view.getFloat32(pos, true);
        take(4);
        return [number, wire, value];
      }
      throw new Error(`Unknown protobuf wire type ${wire}`);
    },
  };
}

function decodeValue(bytes) {
  const read = reader(bytes);
  while (!read.done()) {
    const [number, , raw] = read.field();
    const type = FIELD_TYPES[number];
    if (type === 'boolean') {
      return {type, value: raw !== 0n};
    }
    if (type === 'int') {
      return {type, value: Number(BigInt.asIntN(32, raw))};
    }
    if (type === 'long') {
      return {type, value: BigInt.asIntN(64, raw).toString()};
    }
    if (type === 'float') {
      // a float32 shown with the digits it really has
      return {type, value: Number(raw.toPrecision(7))};
    }
    if (type === 'double') {
      return {type, value: raw};
    }
    if (type === 'string') {
      return {type, value: utf8.decode(raw)};
    }
    if (type === 'data') {
      return {type, value: toBase64(raw)};
    }
    if (type === 'set') {
      const items = [];
      const set = reader(raw);
      while (!set.done()) {
        const [, , item] = set.field();
        items.push(utf8.decode(item));
      }
      return {type, value: items};
    }
  }
  return {type: 'null', value: null};
}

/**
 * The entries of a DataStore Preferences file.
 * @returns {{key: string, type: string, value: any}[]}
 */
export function parseDataStore(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = [];
  const read = reader(bytes);
  while (!read.done()) {
    const [number, wire, raw] = read.field();
    if (number !== 1 || wire !== 2) {
      continue;
    }
    let key = '';
    let value = {type: 'null', value: null};
    const entry = reader(raw);
    while (!entry.done()) {
      const [field, , part] = entry.field();
      if (field === 1) {
        key = utf8.decode(part);
      } else if (field === 2) {
        value = decodeValue(part);
      }
    }
    entries.push({key, ...value});
  }
  return entries;
}

function varintBytes(value) {
  let rest = BigInt.asUintN(64, BigInt(value));
  const out = [];
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (rest);
  return out;
}

const tag = (number, wire) => varintBytes((number << 3) | wire);
const lengthDelimited = (number, bytes) => [...tag(number, 2), ...varintBytes(bytes.length), ...bytes];

function encodeValue(type, value) {
  const number = TYPE_FIELDS[type];
  if (type === 'boolean') {
    return [...tag(number, 0), value ? 1 : 0];
  }
  if (type === 'int' || type === 'long') {
    return [...tag(number, 0), ...varintBytes(BigInt(value))];
  }
  if (type === 'float') {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, Number(value), true);
    return [...tag(number, 5), ...new Uint8Array(view.buffer)];
  }
  if (type === 'double') {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, Number(value), true);
    return [...tag(number, 1), ...new Uint8Array(view.buffer)];
  }
  if (type === 'string') {
    return lengthDelimited(number, encoder.encode(String(value ?? '')));
  }
  if (type === 'data') {
    return lengthDelimited(number, fromBase64(String(value ?? '')));
  }
  if (type === 'set') {
    const strings = (value ?? []).flatMap((item) => lengthDelimited(1, encoder.encode(String(item))));
    return lengthDelimited(number, strings);
  }
  return [];
}

/** A DataStore Preferences file with these entries. */
export function writeDataStore(entries) {
  const out = [];
  for (const {key, type, value} of entries) {
    const entry = [...lengthDelimited(1, encoder.encode(key)), ...lengthDelimited(2, encodeValue(type, value))];
    out.push(...lengthDelimited(1, entry));
  }
  return Uint8Array.from(out);
}
