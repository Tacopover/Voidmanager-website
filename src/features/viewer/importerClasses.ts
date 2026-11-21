import * as WEBIFC from 'web-ifc';

/**
 * Physical IFC element classes that the Fragments IfcImporter leaves out by default
 * (checked against @thatopen/fragments 3.4.5 and 3.6.1). Without them, elements of these
 * classes are missing from the viewer even though the IFC has geometry for them: an IFC2x3
 * MEP export lost all its distribution boards (IfcElectricDistributionPoint).
 *
 * Deliberately not added: IfcOpeningElement (would be drawn as solid blocks), abstract
 * supertypes, ports, spatial elements, structural analysis items and alignment/geo classes.
 */
export const EXTRA_ELEMENT_CLASSES: readonly number[] = [
  WEBIFC.IFCELECTRICDISTRIBUTIONPOINT, // IFC2x3 distribution board
  WEBIFC.IFCDISTRIBUTIONBOARD, // IFC4 distribution board
  WEBIFC.IFCELECTRICALELEMENT, // IFC2x3
  WEBIFC.IFCEQUIPMENTELEMENT, // IFC2x3
  WEBIFC.IFCELECTRICFLOWTREATMENTDEVICE,
  WEBIFC.IFCLIQUIDTERMINAL,
  WEBIFC.IFCMOBILETELECOMMUNICATIONSAPPLIANCE,
  WEBIFC.IFCVIBRATIONDAMPER,
  WEBIFC.IFCIMPACTPROTECTIONDEVICE,
  WEBIFC.IFCSIGNAL,
  WEBIFC.IFCKERB,
  WEBIFC.IFCCAISSONFOUNDATION,
  WEBIFC.IFCCONVEYORSEGMENT,
  WEBIFC.IFCREINFORCEDSOIL,
];

/** Something with the IfcImporter's `classes.elements` set. */
export interface ImporterWithClasses {
  classes: { elements: { add(value: number): unknown } };
}

/** Add the classes above to an IfcImporter before it processes a file. */
export function addMissingElementClasses(importer: ImporterWithClasses): void {
  for (const ifcClass of EXTRA_ELEMENT_CLASSES) importer.classes.elements.add(ifcClass);
}
