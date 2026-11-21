import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script without type declarations
import { VIEWER_ASSETS } from '../../../scripts/sync-viewer-assets.mjs';

describe('viewer assets in public/', () => {
  it.each(VIEWER_ASSETS as [string, string][])('%s matches the copy in %s', (from, to) => {
    // Out of date? Run `npm run sync:viewer-assets`.
    expect(readFileSync(to).equals(readFileSync(from))).toBe(true);
  });
});
