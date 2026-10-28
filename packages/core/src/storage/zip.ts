import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Buffer;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/**
 * Minimal ZIP writer (PKWARE APPNOTE 6.3: local headers, central directory, end record) with
 * DEFLATE from node:zlib and UTF-8 names. No ZIP64, so the archive and every entry must stay
 * under 4 GiB and 65,535 entries, far above the export row caps.
 */
export function buildZip(entries: ZipEntry[], modified: Date = new Date()): Buffer {
  if (entries.length > 0xffff) throw new Error("Too many ZIP entries");
  const { time, date } = dosDateTime(modified);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    // Relative, forward-slash names only: no absolute paths, drive letters, backslashes (Windows
    // extractors treat them as separators) or parent segments, so unpacking cannot escape its folder.
    if (
      !entry.name ||
      entry.name.startsWith("/") ||
      /^[A-Za-z]:/.test(entry.name) ||
      entry.name.includes("\\") ||
      entry.name.split("/").includes("..")
    ) {
      throw new Error(`Invalid ZIP entry name ${entry.name}`);
    }
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const crc = crc32(entry.data) >>> 0;
    if (compressed.length >= 0xffffffff || entry.data.length >= 0xffffffff)
      throw new Error("ZIP entry too large");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra length, comment length, disk number, internal and external attributes stay 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  if (offset >= 0xffffffff) throw new Error("ZIP archive too large");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}
