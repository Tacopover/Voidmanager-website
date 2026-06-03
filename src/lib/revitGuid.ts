/**
 * Revit UniqueId → IFC GlobalId (IfcGuid) conversion.
 *
 * The IFC GUID compression algorithm encodes a 128-bit UUID into a 22-character
 * string using a custom base-64 alphabet. This is the canonical implementation
 * based on the Jeremy Tammik "The Building Coder" post and the IfcOpenShell
 * `ifcopenshell.guid` module.
 *
 * Algorithm ("1+21 groups" variant):
 *   - Treat the 16 raw bytes as a big-endian 128-bit integer.
 *   - Output char 0  → bits [127:126] (top 2 bits)  → alphabet index 0..3
 *   - Output char 1..21 → each 6-bit group going down → alphabet index 0..63
 *   - Total: 2 + 21×6 = 128 bits → 22 chars.
 *
 * Alphabet (64 chars, in order — must match IFC spec exactly):
 *   digits (0-9), upper (A-Z), lower (a-z), underscore (_), dollar ($)
 *
 * Reference: Jeremy Tammik, "The Building Coder", June 2010
 *   https://thebuildingcoder.typepad.com/blog/2010/06/ifc-guid.html
 * See also: IfcOpenShell ifcopenshell/guid.py compress()/expand()
 *   https://github.com/IfcOpenShell/IfcOpenShell/blob/master/src/ifcopenshell-python/ifcopenshell/guid.py
 */

/** The 64-character IFC base-64 alphabet, in canonical order. */
const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** Reverse lookup: char → index in IFC_CHARS (built once). */
const IFC_CHAR_INDEX: Record<string, number> = {};
for (let i = 0; i < IFC_CHARS.length; i++) {
  IFC_CHAR_INDEX[IFC_CHARS[i]] = i;
}

// ---------------------------------------------------------------------------
// Core compress / decompress (operate on 16-byte Uint8Arrays)
// ---------------------------------------------------------------------------

function bytesToIfcGuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error('Expected exactly 16 bytes');

  // Build a BigInt from the 16 big-endian bytes.
  let n = BigInt(0);
  for (const b of bytes) {
    n = (n << BigInt(8)) | BigInt(b);
  }

  // Extract 22 IFC base-64 digits.
  // First digit: top 2 bits (mask = 3 = 0b11).
  // Remaining 21 digits: 6 bits each, descending.
  const result = new Array<string>(22);
  result[0] = IFC_CHARS[Number((n >> BigInt(126)) & BigInt(3))];
  for (let i = 1; i < 22; i++) {
    const shift = BigInt(126 - i * 6);
    result[i] = IFC_CHARS[Number((n >> shift) & BigInt(63))];
  }
  return result.join('');
}

function ifcGuidToBytes(ifcGuid: string): Uint8Array {
  if (ifcGuid.length !== 22) {
    throw new Error(`IfcGuid must be 22 characters, got ${ifcGuid.length}: "${ifcGuid}"`);
  }
  for (const ch of ifcGuid) {
    if (!(ch in IFC_CHAR_INDEX)) {
      throw new Error(`Invalid character in IfcGuid: "${ch}"`);
    }
  }

  // Reconstruct the 128-bit integer.
  // First digit → 2 bits; remaining 21 digits → 6 bits each.
  let n = BigInt(IFC_CHAR_INDEX[ifcGuid[0]]) << BigInt(126);
  for (let i = 1; i < 22; i++) {
    const shift = BigInt(126 - i * 6);
    n |= BigInt(IFC_CHAR_INDEX[ifcGuid[i]]) << shift;
  }

  // Extract 16 bytes big-endian.
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) {
    bytes[i] = Number(n & BigInt(0xff));
    n >>= BigInt(8);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress a 32-char hex string (UUID without dashes) to a 22-char IfcGuid.
 *
 * @param hex32 - 32 lowercase (or uppercase) hex characters representing a 128-bit UUID.
 * @returns 22-character IFC GlobalId string.
 */
export function ifcGuidCompress(hex32: string): string {
  if (!/^[0-9a-fA-F]{32}$/.test(hex32)) {
    throw new Error(
      `ifcGuidCompress: expected 32 hex chars (no dashes), got "${hex32}" (length ${hex32.length})`,
    );
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex32.slice(i * 2, i * 2 + 2), 16);
  }
  return bytesToIfcGuid(bytes);
}

/**
 * Decompress a 22-char IfcGuid to a 32-char lowercase hex string (UUID without dashes).
 *
 * @param ifcGuid - 22-character IFC GlobalId string.
 * @returns 32 lowercase hex characters.
 */
export function ifcGuidDecompress(ifcGuid: string): string {
  const bytes = ifcGuidToBytes(ifcGuid);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a dashed or plain GUID string to a 22-char IfcGuid.
 *
 * Accepts:
 *   - 36-char dashed form: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
 *   - 32-char hex (no dashes)
 *
 * @param guid - Standard UUID string (with or without dashes).
 * @returns 22-character IFC GlobalId string.
 */
export function guidToIfcGuid(guid: string): string {
  const stripped = guid.replace(/-/g, '');
  if (stripped.length !== 32) {
    throw new Error(
      `guidToIfcGuid: expected a 32-char hex or 36-char dashed GUID, got "${guid}"`,
    );
  }
  return ifcGuidCompress(stripped);
}

/**
 * Convert a Revit UniqueId to a 22-char IfcGuid.
 *
 * A Revit UniqueId has the form `<36-char-GUID>-<8-hex-episode>` (45 chars total).
 * Only the 36-char GUID part is used; the 8-hex episode suffix is ignored.
 *
 * ⚠️ UNVALIDATED FOR REAL MATCHING. Revit's IFC exporter does NOT simply compress
 * the first 36-char GUID: it derives the export GlobalId by combining the GUID's
 * trailing bytes with the element-id episode (an XOR of the last 4 bytes with the
 * trailing 8-hex value). This simplistic version is a placeholder — it must be
 * validated/corrected against a real UniqueId↔IFC-GlobalId pair from a matching
 * structural model before the host-matching path (#6.2) can be trusted. For the
 * current dataset the voids are not in the loaded IFC, so this path is dormant and
 * the fallback void meshes are used instead. See docs/IFC_FINDINGS.md.
 *
 * @param uniqueId - Revit UniqueId string (45 chars: 36-char GUID + "-" + 8 hex).
 * @returns 22-character IFC GlobalId string (NOT guaranteed to match Revit's export).
 * @throws Error if the input is not a valid Revit UniqueId format.
 */
export function revitUniqueIdToIfcGuid(uniqueId: string): string {
  // Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-xxxxxxxx (45 chars)
  // The GUID part is the first 36 chars; dash + 8 hex chars follows.
  if (typeof uniqueId !== 'string') {
    throw new Error(`revitUniqueIdToIfcGuid: expected a string, got ${typeof uniqueId}`);
  }

  // Validate overall structure: 36-char GUID + "-" + 8 hex chars = 45 chars.
  const REVIT_UNIQUEID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[0-9a-fA-F]{8}$/;
  if (!REVIT_UNIQUEID_RE.test(uniqueId)) {
    throw new Error(
      `revitUniqueIdToIfcGuid: malformed Revit UniqueId "${uniqueId}". ` +
        `Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-xxxxxxxx (45 chars)`,
    );
  }

  // Extract the 36-char GUID (first 36 chars).
  const guidPart = uniqueId.slice(0, 36);
  return guidToIfcGuid(guidPart);
}
