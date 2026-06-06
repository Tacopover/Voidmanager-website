/**
 * Dev-only IFC inspection script — identifier reconnaissance for Stage B.
 *
 * Usage:
 *   node scripts/inspect-ifc.mjs "fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc"
 *
 * Outputs:
 *   - IFC schema version and source application (from header)
 *   - 8 representative elements: expressID, type name, GlobalId, Name, Tag
 *   - Property sets (looking for Revit ElementId / UniqueId)
 *   - Element type counts (walls vs ducts vs pipes etc.)
 *
 * Needs: web-ifc installed in node_modules (already a project dep).
 * web-ifc@0.0.77 ships a Node-compatible CJS build at web-ifc-api-node.js.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const ifcPath = process.argv[2] ?? resolve('fixtures/E_AIH_68_INS-KLI_HOM_Klimaat.ifc');
if (!existsSync(ifcPath)) {
  console.error(`IFC file not found: ${ifcPath}`);
  process.exit(1);
}

// Load web-ifc (Node build — the CJS export resolves to web-ifc-api-node.js)
const WebIFC = require('web-ifc');
const { IfcAPI, IFCPROJECT, LogLevel } = WebIFC;

const ifcApi = new IfcAPI();
// Use a custom locateFile handler so the wasm is found regardless of cwd.
const wasmDir = resolve('node_modules/web-ifc') + '/';
await ifcApi.Init((filename) => wasmDir + filename);

const data = readFileSync(ifcPath);
const modelId = ifcApi.OpenModel(data);

// ------------------------------------------------------------------
// 1. Header / schema version
// ------------------------------------------------------------------
console.log('\n========== IFC HEADER ==========');
try {
  const header = ifcApi.GetHeaderLine(modelId, 0);
  console.log('Header line 0:', JSON.stringify(header));
} catch { /* not all files expose this */ }

// Attempt to read FILE_DESCRIPTION / FILE_NAME / FILE_SCHEMA via raw lines
// web-ifc doesn't expose full header text API; detect schema from instance types
const allLines = ifcApi.GetAllLines(modelId);
console.log(`Total instances in model: ${allLines.size()}`);

// ------------------------------------------------------------------
// 2. Detect schema via IfcProject SchemaIdentifier
// ------------------------------------------------------------------
console.log('\n========== SCHEMA & SOURCE APP ==========');
try {
  const projects = ifcApi.GetLineIDsWithType(modelId, IFCPROJECT);
  if (projects.size() > 0) {
    const projLine = ifcApi.GetLine(modelId, projects.get(0), true);
    console.log('IfcProject:', JSON.stringify(projLine, null, 2));
  }
} catch (e) {
  console.log('Could not read IfcProject:', e.message);
}

// OwnerHistory for source application
try {
  const { IFCOWNERHISTORY, IFCAPPLICATION } = WebIFC;
  const ownerHistories = ifcApi.GetLineIDsWithType(modelId, IFCOWNERHISTORY);
  if (ownerHistories.size() > 0) {
    const oh = ifcApi.GetLine(modelId, ownerHistories.get(0), true);
    console.log('OwnerHistory[0]:', JSON.stringify(oh, null, 2));
  }
  const apps = ifcApi.GetLineIDsWithType(modelId, IFCAPPLICATION);
  for (let i = 0; i < Math.min(apps.size(), 3); i++) {
    const app = ifcApi.GetLine(modelId, apps.get(i), true);
    console.log(`IfcApplication[${i}]:`, JSON.stringify(app, null, 2));
  }
} catch (e) {
  console.log('Could not read OwnerHistory/Application:', e.message);
}

// ------------------------------------------------------------------
// 3. Element type counts
// ------------------------------------------------------------------
console.log('\n========== ELEMENT TYPE COUNTS ==========');
const INTERESTING_TYPES = [
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCCOLUMN', 'IFCBEAM',
  'IFCPLATE', 'IFCMEMBER',
  'IFCDUCTFITTING', 'IFCDUCTSEGMENT', 'IFCPIPEFITTING', 'IFCPIPESEGMENT',
  'IFCFLOWTERMINAL', 'IFCFLOWSEGMENT', 'IFCFLOWFITTING',
  'IFCBUILDINGELEMENTPROXY',
  'IFCOPENINGELEMENT', 'IFCDOOR', 'IFCWINDOW',
  'IFCSPACE', 'IFCBUILDINGSTOREY', 'IFCBUILDING',
  'IFCSITE', 'IFCFURNISHINGELEMENT',
];
for (const typeName of INTERESTING_TYPES) {
  const typeConst = WebIFC[typeName];
  if (typeConst === undefined) continue;
  try {
    const ids = ifcApi.GetLineIDsWithType(modelId, typeConst);
    if (ids.size() > 0) {
      console.log(`  ${typeName}: ${ids.size()}`);
    }
  } catch { /* type not present in this model */ }
}

// ------------------------------------------------------------------
// 4. Sample 8 representative elements (any with a GlobalId)
// ------------------------------------------------------------------
console.log('\n========== SAMPLE ELEMENTS (up to 8) ==========');
const { IFCPRODUCT } = WebIFC;

// Collect some element type IDs to sample from
const sampleTypes = [
  'IFCDUCTSEGMENT', 'IFCDUCTFITTING', 'IFCPIPESEGMENT', 'IFCPIPEFITTING',
  'IFCFLOWSEGMENT', 'IFCBUILDINGELEMENTPROXY', 'IFCWALL', 'IFCSLAB',
  'IFCFLOWTERMINAL', 'IFCFLOWFITTING',
];

let sampled = 0;
const targetSample = 8;

for (const typeName of sampleTypes) {
  if (sampled >= targetSample) break;
  const typeConst = WebIFC[typeName];
  if (typeConst === undefined) continue;
  try {
    const ids = ifcApi.GetLineIDsWithType(modelId, typeConst);
    for (let i = 0; i < Math.min(ids.size(), 2) && sampled < targetSample; i++) {
      const expressID = ids.get(i);
      const line = ifcApi.GetLine(modelId, expressID, false);
      console.log(`  [expressID=${expressID}] ${typeName}`);
      if (line) {
        console.log(`    GlobalId: ${line.GlobalId?.value ?? line.GlobalId}`);
        console.log(`    Name:     ${line.Name?.value ?? line.Name}`);
        console.log(`    Tag:      ${line.Tag?.value ?? line.Tag}`);
        console.log(`    ObjectType: ${line.ObjectType?.value ?? line.ObjectType}`);
      }
      sampled++;
    }
  } catch { /* skip */ }
}

// Also sample IFCPRODUCT base class if we need more
if (sampled < targetSample) {
  try {
    const allProducts = ifcApi.GetLineIDsWithType(modelId, IFCPRODUCT);
    for (let i = 0; i < Math.min(allProducts.size(), targetSample - sampled); i++) {
      const expressID = allProducts.get(i);
      const line = ifcApi.GetLine(modelId, expressID, false);
      if (!line) continue;
      console.log(`  [expressID=${expressID}] IFCPRODUCT`);
      console.log(`    GlobalId: ${line.GlobalId?.value ?? line.GlobalId}`);
      console.log(`    Name:     ${line.Name?.value ?? line.Name}`);
      console.log(`    Tag:      ${line.Tag?.value ?? line.Tag}`);
      sampled++;
    }
  } catch { /* skip */ }
}

// ------------------------------------------------------------------
// 5. Search for Revit identifiers in property sets
// ------------------------------------------------------------------
console.log('\n========== REVIT IDENTIFIER SEARCH ==========');
const { IFCPROPERTYSINGLEVALUE, IFCRELDEFINESBYPROPERTIES, IFCPROPERTYSET } = WebIFC;

// Known Revit DB void ExternalId examples to match against:
const KNOWN_REVIT_ELEMENT_IDS = new Set(['826492', '826510']);
const KNOWN_REVIT_GUID = 'ec9e90e7-684d-4a6d-9d5d-3b9c464f33ad';

let foundRevitIds = 0;
let foundRevitGuids = 0;
let psetCount = 0;

try {
  const psets = ifcApi.GetLineIDsWithType(modelId, IFCPROPERTYSET);
  psetCount = psets.size();
  console.log(`  Total IfcPropertySet instances: ${psetCount}`);

  // Check first 200 psets for Revit-style properties
  const checkCount = Math.min(psets.size(), 200);
  for (let i = 0; i < checkCount; i++) {
    const psetExpressId = psets.get(i);
    const pset = ifcApi.GetLine(modelId, psetExpressId, true);
    const psetName = pset?.Name?.value ?? '';

    if (!pset?.HasProperties) continue;
    for (const propRef of pset.HasProperties) {
      const propId = typeof propRef === 'number' ? propRef : propRef?.value;
      if (!propId) continue;
      try {
        const prop = ifcApi.GetLine(modelId, propId, false);
        const propName = prop?.Name?.value ?? prop?.Name ?? '';
        const propVal = prop?.NominalValue?.value ?? '';

        // Look for ElementId, Revit UniqueId, or matching known IDs
        if (/elementid|element id|revit|uniqueid|unique id/i.test(propName)) {
          console.log(`  Revit-ish prop [pset="${psetName}"] "${propName}" = "${propVal}"`);
          foundRevitIds++;
        }
        // Check if value matches our known IDs
        if (KNOWN_REVIT_ELEMENT_IDS.has(String(propVal))) {
          console.log(`  *** MATCH: pset="${psetName}" prop="${propName}" value="${propVal}" (matches known void ExternalId)`);
        }
        if (String(propVal).toLowerCase() === KNOWN_REVIT_GUID.toLowerCase()) {
          console.log(`  *** GUID MATCH: pset="${psetName}" prop="${propName}" value="${propVal}"`);
          foundRevitGuids++;
        }
      } catch { /* skip bad refs */ }
    }
  }
  if (foundRevitIds === 0) {
    console.log('  No Revit ElementId/UniqueId properties found in first 200 psets');
  }
} catch (e) {
  console.log('  Property set scan failed:', e.message);
}

// ------------------------------------------------------------------
// 6. Tag value survey — are Tags numeric (Revit ElementId pattern)?
// ------------------------------------------------------------------
console.log('\n========== TAG VALUE SURVEY (first 20 non-null Tags) ==========');
let tagCount = 0;
let numericTagCount = 0;
const tagSample = [];

try {
  for (let i = 0; i < allLines.size() && tagSample.length < 20; i++) {
    const expressID = allLines.get(i);
    try {
      const line = ifcApi.GetLine(modelId, expressID, false);
      if (!line?.Tag) continue;
      const tag = line.Tag?.value ?? line.Tag;
      if (tag == null || tag === '') continue;
      tagSample.push({ expressID, tag, type: line.type });
      tagCount++;
      if (/^\d+$/.test(String(tag))) numericTagCount++;
    } catch { /* skip */ }
  }
  for (const { expressID, tag, type } of tagSample) {
    console.log(`  expressID=${expressID} type=${type} Tag="${tag}" ${/^\d+$/.test(String(tag)) ? '<-- NUMERIC' : ''}`);
  }
  console.log(`  Tags found in sample: ${tagCount}, numeric (ElementId-pattern): ${numericTagCount}`);
} catch (e) {
  console.log('  Tag survey failed:', e.message);
}

// ------------------------------------------------------------------
// Done
// ------------------------------------------------------------------
ifcApi.CloseModel(modelId);
console.log('\n========== DONE ==========');
