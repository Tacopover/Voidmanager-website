/**
 * VoidRepository — backend-agnostic interface for reading VoidManager data.
 *
 * All UI code depends only on this interface. LocalDbRepository implements it
 * over a sql.js Database; a future CloudRepository can swap in behind the same
 * contract without touching any UI.
 *
 * READ-ONLY v1: no write/update/delete methods.
 */

import type { ApprovalStatus } from './schema';

// ---------------------------------------------------------------------------
// DTO types
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  /** VoidManager internal numeric ID. */
  id: number;
  /** Decoded project name (D_Name value). */
  name: string;
}

/** A single void row as displayed in the datagrid. */
export interface VoidRow {
  /** VoidCircle / VoidRectangle primary key of the current version. */
  id: number;
  /** Decoded ExternalId string from D_GUID (Revit ElementId int-as-string or GUID). */
  externalId: string | null;
  type: 'circle' | 'rectangle';
  status: ApprovalStatus;
  /** Decoded email address of the assigned user, or null if unresolvable. */
  assignedTo: string | null;
  /**
   * Parent story resolved via HostId → Story.
   * elevation is in Revit internal mm (D_NumericOneDecimal).
   */
  story: { name: string; elevation: number | null } | null;
  /**
   * Name of the primary (super) host element, resolved via
   * SuperSubHostIntersection → HostElementSuper → D_Name.
   * Null when no intersection exists for this void.
   */
  host: string | null;
  /**
   * Decoded sizes in mm (D_NumericOneDecimalUnsigned).
   * circle → diameter; rectangle → width + height.
   */
  sizeMm: {
    diameter?: number;
    width?: number;
    height?: number;
  };
  /** Void thickness in mm (D_NumericOneDecimalUnsigned), or null. */
  thicknessMm: number | null;
  /**
   * Center location in Revit internal mm (X/Y/Z from D_NumericOneDecimal).
   * Null when the Point3D row or its coordinate references are missing.
   */
  location: { x: number; y: number; z: number } | null;
  /**
   * Void extrusion direction (unit vector, Revit internal units) decoded from
   * Vector3D → D_NumericOneDecimal X/Y/Z.
   * Null when the Vector3D row or its coordinate references are missing.
   * Used by Stage B2 to orient fallback void meshes.
   */
  direction: { x: number; y: number; z: number } | null;
  /** Sequence / zone name (D_SequenceName value), or null. */
  sequenceName: string | null;
  /**
   * True when the void is closed (IsClosed FK → D_Boolean.ID=1 → Value=1 → true).
   * False when IsClosed FK → D_Boolean.ID=2 → Value=0 → false.
   */
  isClosed: boolean;
}

export interface ListVoidsOptions {
  /**
   * Filter voids to a specific project by name.
   * The HostId→Story→Building→Project chain is walked to resolve project membership.
   * When omitted, voids from ALL projects are returned.
   */
  projectName?: string;
  /**
   * When false (default) only open voids (isClosed=false) are returned.
   * Pass true to include closed voids as well.
   */
  includeClosed?: boolean;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface VoidRepository {
  /**
   * List all valid projects in the DB (IsValid=1).
   * Returns at least one entry when a valid DB is loaded.
   */
  listProjects(): Promise<ProjectSummary[]>;

  /**
   * List current void versions with fully decoded fields.
   *
   * "Current version" strategy:
   *   • VoidCircle / VoidRectangle: MAX(ID) per ExternalId (all rows have IsValid=2
   *     regardless of version; the highest PK is the latest mutation).
   *   • Only rows where StatusOfApproval resolves to a known APPROVAL_STATUSES value
   *     are returned (fails loudly if D_StatusOfApproval is missing).
   */
  listVoids(opts?: ListVoidsOptions): Promise<VoidRow[]>;
}
