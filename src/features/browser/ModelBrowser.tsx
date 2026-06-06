/**
 * ModelBrowser — custom React tree of the loaded IFC spatial structure(s).
 *
 * Fed by normalized TreeNodes (see spatialTree.ts) built from
 * FragmentsModel.getSpatialStructure().  Clicking a node that maps to an IFC
 * element (localId set) writes an `element` SelectionRef to the unified
 * selection store with source 'browser' — so it highlights in 3D and the
 * "Zoom to" button frames it (items 7 + 8).
 *
 * No third-party tree dependency: getSpatialStructure() gives us the data
 * directly, so a small recursive React component is all we need.
 */

import { useState } from 'react';
import type { TreeNode } from './spatialTree';
import { setSelection, useSelection, refKey } from '../../store/selectionStore';
import styles from './ModelBrowser.module.css';

export interface ModelBrowserProps {
  /** One root per loaded model. */
  trees: TreeNode[];
}

export default function ModelBrowser({ trees }: ModelBrowserProps) {
  const selection = useSelection();

  if (trees.length === 0) {
    return (
      <div className={styles.empty} data-testid="model-browser">
        No model loaded — use “Load IFC”.
      </div>
    );
  }

  return (
    <div className={styles.tree} role="tree" data-testid="model-browser">
      {trees.map((root) => (
        <TreeItem key={root.id} node={root} depth={0} selectedKeys={selection.keys} />
      ))}
    </div>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  selectedKeys: ReadonlySet<string>;
}

function TreeItem({ node, depth, selectedKeys }: TreeItemProps) {
  // Auto-expand the top couple of levels (project / site / building).
  const [open, setOpen] = useState(depth < 2);

  const hasChildren = node.children.length > 0;
  const selectable = node.localId != null;
  const selKey = selectable
    ? refKey({ kind: 'element', modelId: node.modelId, localId: node.localId as number })
    : null;
  const selected = selKey != null && selectedKeys.has(selKey);

  function handleRowClick() {
    if (selectable) {
      setSelection(
        [{ kind: 'element', modelId: node.modelId, localId: node.localId as number }],
        'browser',
      );
    } else if (hasChildren) {
      setOpen((o) => !o);
    }
  }

  return (
    <div className={styles.item} role="treeitem" aria-expanded={hasChildren ? (open ? 'true' : 'false') : undefined}>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
        style={{ paddingLeft: depth * 12 + 6 }}
        onClick={handleRowClick}
        data-testid="model-browser-node"
        data-selectable={selectable ? 'true' : undefined}
        data-localid={selectable ? String(node.localId) : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.twisty}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className={styles.twistySpacer} />
        )}
        <span className={styles.label} title={node.label}>
          {node.label}
        </span>
      </div>
      {hasChildren && open && (
        <div role="group">
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} selectedKeys={selectedKeys} />
          ))}
        </div>
      )}
    </div>
  );
}
