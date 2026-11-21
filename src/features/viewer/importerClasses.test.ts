import * as FRAGS from '@thatopen/fragments';
import * as WEBIFC from 'web-ifc';
import { describe, expect, it } from 'vitest';
import { EXTRA_ELEMENT_CLASSES, addMissingElementClasses } from './importerClasses';

describe('addMissingElementClasses', () => {
  it('adds the distribution boards the importer leaves out by default', () => {
    const importer = new FRAGS.IfcImporter();
    expect(importer.classes.elements.has(WEBIFC.IFCELECTRICDISTRIBUTIONPOINT)).toBe(false);

    addMissingElementClasses(importer);

    expect(importer.classes.elements.has(WEBIFC.IFCELECTRICDISTRIBUTIONPOINT)).toBe(true);
    expect(importer.classes.elements.has(WEBIFC.IFCDISTRIBUTIONBOARD)).toBe(true);
  });

  it('never adds openings, which would be drawn as solid blocks', () => {
    expect(EXTRA_ELEMENT_CLASSES).not.toContain(WEBIFC.IFCOPENINGELEMENT);
  });

  it('only lists classes the importer does not already have', () => {
    const defaults = new FRAGS.IfcImporter().classes.elements;
    // When this fails after an upgrade, That Open added the class: remove it from the list.
    expect(EXTRA_ELEMENT_CLASSES.filter((c) => defaults.has(c))).toEqual([]);
  });
});
