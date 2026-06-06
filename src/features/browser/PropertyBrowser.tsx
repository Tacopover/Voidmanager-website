/**
 * PropertyBrowser — shows IFC attributes for the currently selected element.
 * Driven by the unified selection store: ThreeDViewer fetches properties whenever
 * an element ref enters the selection and passes them down as props.
 */

import styles from './PropertyBrowser.module.css';

export interface PropertyBrowserProps {
  /** Flat IFC attribute map for the selected element; null means nothing selected. */
  properties: Record<string, string> | null;
  /** True while the async fetch is in flight. */
  loading: boolean;
  /** Human-readable label for the selected element (e.g. its Name attribute). */
  elementLabel?: string;
}

export default function PropertyBrowser({ properties, loading, elementLabel }: PropertyBrowserProps) {
  if (loading) {
    return (
      <div className={styles.wrap} data-testid="property-browser">
        <span className={styles.hint}>Loading…</span>
      </div>
    );
  }

  if (!properties) {
    return (
      <div className={styles.wrap} data-testid="property-browser">
        <span className={styles.hint}>Select an IFC element to view its properties.</span>
      </div>
    );
  }

  const entries = Object.entries(properties).filter(([, v]) => v !== '');

  if (entries.length === 0) {
    return (
      <div className={styles.wrap} data-testid="property-browser">
        {elementLabel && <div className={styles.elementLabel}>{elementLabel}</div>}
        <span className={styles.hint}>No properties found.</span>
      </div>
    );
  }

  return (
    <div className={styles.wrap} data-testid="property-browser">
      {elementLabel && <div className={styles.elementLabel}>{elementLabel}</div>}
      <table className={styles.table}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className={styles.row}>
              <td className={styles.key}>{k}</td>
              <td className={styles.val}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
