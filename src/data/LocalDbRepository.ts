/**
 * LocalDbRepository — implements VoidRepository over a sql.js Database.
 *
 * Constructor receives an already-opened Database so it is unit-testable in
 * Node without any browser WASM wiring.
 *
 * Dictionary-decoding strategy (confirmed against fixtures/sample.db via
 * AttributeDimensionTable + empirical checks):
 *
 *   Column          Dictionary
 *   ──────────────  ─────────────────────────────
 *   X, Y, Z         D_NumericOneDecimal  (signed mm, Revit internal coords)
 *   Elevation        D_NumericOneDecimal  (signed mm)
 *   Diameter         D_NumericOneDecimalUnsigned
 *   Width, Height    D_NumericOneDecimalUnsigned
 *   Thickness        D_NumericOneDecimalUnsigned
 *   Tolerance*       D_NumericOneDecimalUnsigned
 *   Level            D_NumericInteger
 *   ExternalId       D_GUID               (GUID string or Revit ElementId int-string)
 *   AssignedTo       User → D_EmailAddress
 *   StatusOfApproval D_StatusOfApproval
 *   SequenceName     D_SequenceName
 *   IsClosed/IsValid D_Boolean (ID=1→true, ID=2→false)
 *   Name             D_Name               (Project, Building, Story, HostElement)
 *   EmailAddress     D_EmailAddress       (User.EmailAddress column)
 *
 * Current-version filter:
 *   VoidCircle / VoidRectangle: MAX(ID) per ExternalId.
 *   All rows in these tables have IsValid=2 (false) regardless of version;
 *   the highest primary key is always the latest mutation.
 *   Other entity tables (Story, Building, Project, User, HostElementSuper) use IsValid=1 normally.
 */

import type { Database, QueryExecResult } from 'sql.js';
import { DICT, TABLE, DB_BOOLEAN, isApprovalStatus } from './schema';
import type { VoidRepository, VoidRow, ProjectSummary, ListVoidsOptions } from './VoidRepository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = Record<string, number | string | null>;

/** Execute a SQL query and return rows as plain objects. */
function query(db: Database, sql: string, params: (string | number | null)[] = []): Row[] {
  let results: QueryExecResult[];
  try {
    results = db.exec(sql, params);
  } catch (e) {
    throw new Error(`SQL error: ${String(e)}\nQuery: ${sql}`);
  }
  if (results.length === 0) return [];
  const { columns, values } = results[0];
  return values.map((row) => {
    const obj: Row = {};
    columns.forEach((col, i) => {
      obj[col] = row[i] as number | string | null;
    });
    return obj;
  });
}

/** Assert a table exists and has the expected columns; throws loudly if not. */
function assertTable(db: Database, table: string, requiredCols: string[]): void {
  let colRows: QueryExecResult[];
  try {
    colRows = db.exec(`PRAGMA table_info("${table}")`);
  } catch {
    throw new Error(`[LocalDbRepository] Required table "${table}" is missing from the database.`);
  }
  if (colRows.length === 0 || colRows[0].values.length === 0) {
    throw new Error(`[LocalDbRepository] Required table "${table}" is missing from the database.`);
  }
  const existing = new Set(colRows[0].values.map((r) => r[1] as string));
  for (const col of requiredCols) {
    if (!existing.has(col)) {
      throw new Error(
        `[LocalDbRepository] Table "${table}" is missing required column "${col}".`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LocalDbRepository implements VoidRepository {
  constructor(private readonly db: Database) {
    this.#validateSchema();
  }

  /** Fail loudly if any critical table or column is missing. */
  #validateSchema(): void {
    assertTable(this.db, TABLE.project, ['ID', 'IsValid', 'Name']);
    assertTable(this.db, TABLE.building, ['ID', 'HostId', 'IsValid', 'Name']);
    assertTable(this.db, TABLE.story, ['ID', 'HostId', 'IsValid', 'Name', 'Elevation']);
    assertTable(this.db, TABLE.user, ['ID', 'EmailAddress']);
    assertTable(this.db, TABLE.voidCircle, [
      'ID', 'HostId', 'IsValid', 'IsClosed', 'ExternalId', 'AssignedTo',
      'StatusOfApproval', 'Location', 'Direction', 'Thickness', 'Diameter', 'SequenceName',
    ]);
    assertTable(this.db, TABLE.voidRectangle, [
      'ID', 'HostId', 'IsValid', 'IsClosed', 'ExternalId', 'AssignedTo',
      'StatusOfApproval', 'Location', 'Direction', 'Thickness', 'Width', 'Height', 'SequenceName',
    ]);
    assertTable(this.db, TABLE.point3D, ['ID', 'X', 'Y', 'Z']);
    assertTable(this.db, TABLE.vector3D, ['ID', 'X', 'Y', 'Z']);
    assertTable(this.db, DICT.boolean, ['ID', 'Value']);
    assertTable(this.db, DICT.statusOfApproval, ['ID', 'Value']);
    assertTable(this.db, DICT.guid, ['ID', 'Value']);
    assertTable(this.db, DICT.emailAddress, ['ID', 'Value']);
    assertTable(this.db, DICT.name, ['ID', 'Value']);
    assertTable(this.db, DICT.numericOneDecimal, ['ID', 'Value']);
    assertTable(this.db, DICT.numericOneDecimalUnsigned, ['ID', 'Value']);
  }

  // -------------------------------------------------------------------------
  // listProjects
  // -------------------------------------------------------------------------

  async listProjects(): Promise<ProjectSummary[]> {
    /*
     * Project.IsValid uses D_Boolean normally (ID=1 → true).
     * Project.Name → D_Name.Value.
     */
    const rows = query(
      this.db,
      `SELECT p.ID AS id, dn.Value AS name
       FROM "${TABLE.project}" p
       JOIN "${DICT.boolean}" b ON b.ID = p.IsValid AND b.Value = ${DB_BOOLEAN.true}
       LEFT JOIN "${DICT.name}" dn ON dn.ID = p.Name
       ORDER BY p.ID`,
    );

    return rows.map((r) => ({
      id: r.id as number,
      name: (r.name as string | null) ?? `Project #${r.id as number}`,
    }));
  }

  // -------------------------------------------------------------------------
  // listVoids
  // -------------------------------------------------------------------------

  async listVoids(opts: ListVoidsOptions = {}): Promise<VoidRow[]> {
    const { projectName, includeClosed = false } = opts;

    // Resolve optional project filter to a set of valid Story IDs.
    let storyFilter: Set<number> | null = null;
    if (projectName !== undefined) {
      storyFilter = this.#storyIdsForProject(projectName);
      if (storyFilter.size === 0) return [];
    }

    // Build lazy lookup maps (populated on demand).
    const storyMap = this.#buildStoryMap();
    const userEmailMap = this.#buildUserEmailMap();
    const hostMap = this.#buildHostMap();

    const circles = this.#queryCurrentVoids('circle', storyFilter, includeClosed);
    const rects = this.#queryCurrentVoids('rectangle', storyFilter, includeClosed);

    return [...circles, ...rects].map((raw) =>
      this.#decodeVoidRow(raw, storyMap, userEmailMap, hostMap),
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Returns the set of Story IDs that belong to a project identified by name.
   * The chain is: Story.HostId → Building.HostId → Project.Name.
   */
  #storyIdsForProject(name: string): Set<number> {
    const rows = query(
      this.db,
      `SELECT s.ID
       FROM "${TABLE.story}" s
       JOIN "${TABLE.building}" b ON b.ID = s.HostId
       JOIN "${TABLE.project}" p ON p.ID = b.HostId
       JOIN "${DICT.name}" dn ON dn.ID = p.Name AND dn.Value = ?
       JOIN "${DICT.boolean}" bv ON bv.ID = p.IsValid AND bv.Value = ${DB_BOOLEAN.true}`,
      [name],
    );
    return new Set(rows.map((r) => r.ID as number));
  }

  /** Map: Story.ID → { name, elevation } */
  #buildStoryMap(): Map<number, { name: string; elevation: number | null }> {
    const rows = query(
      this.db,
      `SELECT s.ID,
              dn.Value  AS name,
              ne.Value  AS elevation
       FROM "${TABLE.story}" s
       JOIN "${DICT.boolean}" bv ON bv.ID = s.IsValid AND bv.Value = ${DB_BOOLEAN.true}
       LEFT JOIN "${DICT.name}" dn ON dn.ID = s.Name
       LEFT JOIN "${DICT.numericOneDecimal}" ne ON ne.ID = s.Elevation`,
    );
    const map = new Map<number, { name: string; elevation: number | null }>();
    for (const r of rows) {
      map.set(r.ID as number, {
        name: (r.name as string | null) ?? `Story #${r.ID as number}`,
        elevation: r.elevation != null ? (r.elevation as number) : null,
      });
    }
    return map;
  }

  /** Map: User.ID → email string */
  #buildUserEmailMap(): Map<number, string> {
    const rows = query(
      this.db,
      `SELECT u.ID, de.Value AS email
       FROM "${TABLE.user}" u
       LEFT JOIN "${DICT.emailAddress}" de ON de.ID = u.EmailAddress`,
    );
    const map = new Map<number, string>();
    for (const r of rows) {
      if (r.email != null) map.set(r.ID as number, r.email as string);
    }
    return map;
  }

  /**
   * Map: VoidCircle/VoidRectangle row ID → host name string.
   *
   * Resolved via SuperSubHostIntersection.HostId (= void table PK) →
   * HostElementSuper → D_Name. Only the first (lowest ID) intersection is used.
   */
  #buildHostMap(): Map<number, string> {
    // Check if SuperSubHostIntersection table exists (fail loudly if it does but is malformed)
    let sshi: Row[];
    try {
      sshi = query(
        this.db,
        `SELECT si.HostId AS voidId, dn.Value AS hostName
         FROM "${TABLE.superSubHostIntersection}" si
         JOIN "${TABLE.hostElementSuper}" hes ON hes.ID = si.HostElementSuper
         LEFT JOIN "${DICT.name}" dn ON dn.ID = hes.Name
         WHERE si.HostId IS NOT NULL
         ORDER BY si.HostId, si.ID`,
      );
    } catch {
      // SuperSubHostIntersection absent in some stripped DBs — degrade gracefully.
      return new Map();
    }

    const map = new Map<number, string>();
    for (const r of sshi) {
      const voidId = r.voidId as number;
      if (!map.has(voidId) && r.hostName != null) {
        // keep first (lowest ID) host name per void
        map.set(voidId, r.hostName as string);
      }
    }
    return map;
  }

  /**
   * Query current void versions (MAX ID per ExternalId) from VoidCircle or VoidRectangle.
   *
   * Returns raw rows with decoded size references still as integer IDs
   * (diameter / width / height / thickness) — decoded in #decodeVoidRow.
   */
  #queryCurrentVoids(
    type: 'circle' | 'rectangle',
    storyFilter: Set<number> | null,
    includeClosed: boolean,
  ): RawVoidRow[] {
    const table = type === 'circle' ? TABLE.voidCircle : TABLE.voidRectangle;

    // IsClosed filter: IsClosed FK = DB_BOOLEAN.false (2) means not closed.
    const closedClause = includeClosed ? '' : `AND v.IsClosed = ${DB_BOOLEAN.false}`;

    const storyClause =
      storyFilter !== null && storyFilter.size > 0
        ? `AND v.HostId IN (${[...storyFilter].join(',')})`
        : '';

    const sizeColumns =
      type === 'circle'
        ? 'v.Diameter AS diameterRef, NULL AS widthRef, NULL AS heightRef'
        : 'NULL AS diameterRef, v.Width AS widthRef, v.Height AS heightRef';

    const sql = `
      SELECT
        v.ID,
        v.HostId,
        v.IsClosed,
        v.ExternalId  AS externalIdRef,
        v.AssignedTo  AS assignedToRef,
        v.StatusOfApproval AS statusRef,
        v.Location    AS locationRef,
        v.Direction   AS directionRef,
        v.Thickness   AS thicknessRef,
        v.SequenceName AS seqRef,
        ${sizeColumns}
      FROM "${table}" v
      JOIN (
        SELECT ExternalId, MAX(ID) AS maxId
        FROM "${table}"
        GROUP BY ExternalId
      ) latest ON v.ID = latest.maxId
      JOIN "${DICT.statusOfApproval}" sa ON sa.ID = v.StatusOfApproval
      ${closedClause}
      ${storyClause}
      ORDER BY v.ID
    `;

    const rows = query(this.db, sql);
    return rows.map((r) => ({ ...r, type } as RawVoidRow));
  }

  /** Decode a raw void row into a fully typed VoidRow. */
  #decodeVoidRow(
    raw: RawVoidRow,
    storyMap: Map<number, { name: string; elevation: number | null }>,
    userEmailMap: Map<number, string>,
    hostMap: Map<number, string>,
  ): VoidRow {
    // --- status ---
    const statusRows = query(
      this.db,
      `SELECT Value FROM "${DICT.statusOfApproval}" WHERE ID = ?`,
      [raw.statusRef as number],
    );
    const statusStr = statusRows[0]?.Value as string | undefined;
    if (!statusStr || !isApprovalStatus(statusStr)) {
      throw new Error(
        `[LocalDbRepository] Unknown StatusOfApproval ID=${raw.statusRef as number} value="${statusStr ?? 'NULL'}". ` +
          `Expected one of: ${['concept','open for review','approved','rejected','released for execution','executed'].join(', ')}`,
      );
    }

    // --- externalId ---
    const guidRows = raw.externalIdRef != null
      ? query(this.db, `SELECT Value FROM "${DICT.guid}" WHERE ID = ?`, [raw.externalIdRef as number])
      : [];
    const externalId = (guidRows[0]?.Value as string | null | undefined) ?? null;

    // --- assignedTo ---
    const assignedTo =
      raw.assignedToRef != null
        ? (userEmailMap.get(raw.assignedToRef as number) ?? null)
        : null;

    // --- story ---
    const story =
      raw.HostId != null ? (storyMap.get(raw.HostId as number) ?? null) : null;

    // --- host ---
    const host = hostMap.get(raw.ID as number) ?? null;

    // --- isClosed ---
    // IsClosed FK: 1 → D_Boolean.ID=1 → Value=1 → true (closed)
    //              2 → D_Boolean.ID=2 → Value=0 → false (open)
    const isClosed = (raw.IsClosed as number) === DB_BOOLEAN.true;

    // --- location ---
    const location = this.#decodeLocation(raw.locationRef as number | null);

    // --- direction ---
    const direction = this.#decodeDirection(raw.directionRef as number | null);

    // --- sizes (D_NumericOneDecimalUnsigned) ---
    const sizeMm: VoidRow['sizeMm'] = {};
    if (raw.diameterRef != null) {
      const v = this.#lookupUnsigned(raw.diameterRef as number);
      if (v != null) sizeMm.diameter = v;
    }
    if (raw.widthRef != null) {
      const v = this.#lookupUnsigned(raw.widthRef as number);
      if (v != null) sizeMm.width = v;
    }
    if (raw.heightRef != null) {
      const v = this.#lookupUnsigned(raw.heightRef as number);
      if (v != null) sizeMm.height = v;
    }

    // --- thickness ---
    const thicknessMm =
      raw.thicknessRef != null ? this.#lookupUnsigned(raw.thicknessRef as number) : null;

    // --- sequenceName ---
    const seqRows = raw.seqRef != null
      ? query(this.db, `SELECT Value FROM "${DICT.sequenceName}" WHERE ID = ?`, [raw.seqRef as number])
      : [];
    const sequenceName = (seqRows[0]?.Value as string | null | undefined) ?? null;

    return {
      id: raw.ID as number,
      externalId,
      type: raw.type,
      status: statusStr,
      assignedTo,
      story,
      host,
      sizeMm,
      thicknessMm,
      location,
      direction,
      sequenceName,
      isClosed,
    };
  }

  /** Resolve a Point3D ID to x/y/z coordinates via D_NumericOneDecimal. */
  #decodeLocation(locationRef: number | null): { x: number; y: number; z: number } | null {
    if (locationRef == null) return null;
    const pts = query(
      this.db,
      `SELECT p.X, p.Y, p.Z,
              nx.Value AS xVal,
              ny.Value AS yVal,
              nz.Value AS zVal
       FROM "${TABLE.point3D}" p
       LEFT JOIN "${DICT.numericOneDecimal}" nx ON nx.ID = p.X
       LEFT JOIN "${DICT.numericOneDecimal}" ny ON ny.ID = p.Y
       LEFT JOIN "${DICT.numericOneDecimal}" nz ON nz.ID = p.Z
       WHERE p.ID = ?`,
      [locationRef],
    );
    if (!pts[0]) return null;
    const { xVal, yVal, zVal } = pts[0];
    if (xVal == null || yVal == null || zVal == null) return null;
    return { x: xVal as number, y: yVal as number, z: zVal as number };
  }

  /**
   * Resolve a Vector3D ID to x/y/z components via D_NumericOneDecimal.
   * Vector3D has the same (ID, X, Y, Z) shape as Point3D; X/Y/Z are refs
   * into D_NumericOneDecimal (signed Revit internal units).
   */
  #decodeDirection(directionRef: number | null): { x: number; y: number; z: number } | null {
    if (directionRef == null) return null;
    const vecs = query(
      this.db,
      `SELECT v.X, v.Y, v.Z,
              nx.Value AS xVal,
              ny.Value AS yVal,
              nz.Value AS zVal
       FROM "${TABLE.vector3D}" v
       LEFT JOIN "${DICT.numericOneDecimal}" nx ON nx.ID = v.X
       LEFT JOIN "${DICT.numericOneDecimal}" ny ON ny.ID = v.Y
       LEFT JOIN "${DICT.numericOneDecimal}" nz ON nz.ID = v.Z
       WHERE v.ID = ?`,
      [directionRef],
    );
    if (!vecs[0]) return null;
    const { xVal, yVal, zVal } = vecs[0];
    if (xVal == null || yVal == null || zVal == null) return null;
    return { x: xVal as number, y: yVal as number, z: zVal as number };
  }

  /** Look up a value from D_NumericOneDecimalUnsigned by ID. */
  #lookupUnsigned(id: number): number | null {
    const rows = query(
      this.db,
      `SELECT Value FROM "${DICT.numericOneDecimalUnsigned}" WHERE ID = ?`,
      [id],
    );
    return rows[0]?.Value != null ? (rows[0].Value as number) : null;
  }
}

// ---------------------------------------------------------------------------
// Internal raw type (before decoding)
// ---------------------------------------------------------------------------

interface RawVoidRow extends Row {
  type: 'circle' | 'rectangle';
  statusRef: number | null;
  externalIdRef: number | null;
  assignedToRef: number | null;
  locationRef: number | null;
  directionRef: number | null;
  thicknessRef: number | null;
  diameterRef: number | null;
  widthRef: number | null;
  heightRef: number | null;
  seqRef: number | null;
}
