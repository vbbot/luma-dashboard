import { inflateSync } from "fflate";

// Reads the package name out of a remote APK without downloading it: fetches
// the zip's central directory and the AndroidManifest.xml entry with HTTP
// Range requests, then decodes the binary XML manifest.

const MAX_FULL_DOWNLOAD = 150 * 1024 * 1024;

type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

async function rangeReader(url: string): Promise<{ read: RangeReader; size: number }> {
  const head = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (head.status !== 206) {
    // The server ignores Range; fall back to one full download.
    const length = Number(head.headers.get("content-length") ?? 0);
    if (length > MAX_FULL_DOWNLOAD) {
      throw new Error("APK too large to inspect");
    }
    const body = new Uint8Array(await head.arrayBuffer());
    return { size: body.length, read: async (start, end) => body.subarray(start, end + 1) };
  }
  await head.arrayBuffer();
  const total = Number(head.headers.get("content-range")?.split("/")[1]);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Unknown APK size");
  }
  return {
    size: total,
    read: async (start, end) => {
      const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
      if (response.status !== 206) {
        throw new Error(`Range request failed: ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function readManifest(url: string): Promise<Uint8Array> {
  const { read, size } = await rangeReader(url);

  // End of central directory record: within the last 64 KiB + 22 bytes.
  const tailStart = Math.max(0, size - 65_557);
  const tail = await read(tailStart, size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view(tail).getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const directorySize = view(tail).getUint32(eocd + 12, true);
  const directoryOffset = view(tail).getUint32(eocd + 16, true);

  const directory = await read(directoryOffset, directoryOffset + directorySize - 1);
  const dir = view(directory);
  const decoder = new TextDecoder();
  for (let p = 0; p + 46 <= directory.length; ) {
    if (dir.getUint32(p, true) !== 0x02014b50) break;
    const method = dir.getUint16(p + 10, true);
    const compressedSize = dir.getUint32(p + 20, true);
    const nameLength = dir.getUint16(p + 28, true);
    const extraLength = dir.getUint16(p + 30, true);
    const commentLength = dir.getUint16(p + 32, true);
    const localOffset = dir.getUint32(p + 42, true);
    const name = decoder.decode(directory.subarray(p + 46, p + 46 + nameLength));
    if (name === "AndroidManifest.xml") {
      const local = await read(localOffset, localOffset + 29);
      const dataStart =
        localOffset + 30 + view(local).getUint16(26, true) + view(local).getUint16(28, true);
      const data = await read(dataStart, dataStart + compressedSize - 1);
      if (method === 0) return data;
      if (method === 8) return inflateSync(data);
      throw new Error(`Unsupported compression method ${method}`);
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("AndroidManifest.xml not found");
}

// Minimal Android binary XML reader: returns the "package" attribute of the
// first element (<manifest>).
export function packageFromBinaryManifest(xml: Uint8Array): string {
  const data = view(xml);
  let strings: string[] = [];
  for (let p = 8; p + 8 <= xml.length; ) {
    const type = data.getUint16(p, true);
    const chunkSize = data.getUint32(p + 4, true);
    if (chunkSize === 0) break;

    if (type === 0x0001) {
      strings = readStringPool(xml, p);
    } else if (type === 0x0102) {
      const attributeStart = data.getUint16(p + 24, true);
      const attributeSize = data.getUint16(p + 26, true);
      const attributeCount = data.getUint16(p + 28, true);
      const first = p + 16 + attributeStart;
      for (let i = 0; i < attributeCount; i++) {
        const a = first + i * attributeSize;
        const nameIndex = data.getUint32(a + 4, true);
        const rawValue = data.getUint32(a + 8, true);
        const dataType = data.getUint8(a + 15);
        const typedValue = data.getUint32(a + 16, true);
        if (strings[nameIndex] === "package") {
          const index = rawValue !== 0xffffffff ? rawValue : dataType === 0x03 ? typedValue : -1;
          const value = strings[index];
          if (value) return value;
        }
      }
      throw new Error("Manifest has no package attribute");
    }
    p += chunkSize;
  }
  throw new Error("No manifest element");
}

function readStringPool(xml: Uint8Array, offset: number): string[] {
  const data = view(xml);
  const stringCount = data.getUint32(offset + 8, true);
  const flags = data.getUint32(offset + 16, true);
  const stringsStart = offset + data.getUint32(offset + 20, true);
  const utf8 = (flags & 0x100) !== 0;
  const decoder = new TextDecoder();
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    let p = stringsStart + data.getUint32(offset + 28 + i * 4, true);
    if (utf8) {
      // UTF-16 length then UTF-8 byte length, each 1 or 2 bytes.
      p += (xml[p] & 0x80) !== 0 ? 2 : 1;
      let length = xml[p];
      if ((length & 0x80) !== 0) {
        length = ((length & 0x7f) << 8) | xml[p + 1];
        p += 2;
      } else {
        p += 1;
      }
      strings.push(decoder.decode(xml.subarray(p, p + length)));
    } else {
      let length = data.getUint16(p, true);
      if ((length & 0x8000) !== 0) {
        length = ((length & 0x7fff) << 16) | data.getUint16(p + 2, true);
        p += 4;
      } else {
        p += 2;
      }
      let value = "";
      for (let c = 0; c < length; c++) value += String.fromCharCode(data.getUint16(p + c * 2, true));
      strings.push(value);
    }
  }
  return strings;
}

export async function resolveApkPackage(apkUrl: string): Promise<string> {
  return packageFromBinaryManifest(await readManifest(apkUrl));
}
