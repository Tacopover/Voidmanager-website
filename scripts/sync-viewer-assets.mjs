/**
 * Copy the files the viewer serves from public/ out of the installed packages, so they always
 * match the pinned versions: the Fragments worker and the web-ifc WASM files.
 * Run after changing @thatopen/fragments or web-ifc: `npm run sync:viewer-assets`.
 * src/features/viewer/viewerAssets.test.ts fails when the copies are out of date.
 */
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const VIEWER_ASSETS = [
  ['node_modules/@thatopen/fragments/dist/Worker/worker.mjs', 'public/fragments-worker.mjs'],
  ['node_modules/web-ifc/web-ifc.wasm', 'public/wasm/web-ifc.wasm'],
  ['node_modules/web-ifc/web-ifc-mt.wasm', 'public/wasm/web-ifc-mt.wasm'],
];

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/sync-viewer-assets.mjs')) {
  for (const [from, to] of VIEWER_ASSETS) {
    copyFileSync(from, to);
    console.log(`${from} -> ${to}`);
  }
}
