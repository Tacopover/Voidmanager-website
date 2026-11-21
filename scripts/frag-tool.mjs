/**
 * Dev-only Fragments tool: convert an IFC to .frag, and report what a .frag contains.
 *
 * Usage:
 *   node scripts/frag-tool.mjs convert <input.ifc> <output.frag> [--default-classes]
 *   node scripts/frag-tool.mjs inspect <model.frag> [<model.ifc>]
 *
 * `inspect` opens the file with the installed @thatopen/fragments version and prints the
 * element count per IFC class (items with geometry), the model coordinates, and, when the
 * source IFC is given, which product classes of the IFC have no geometry in the .frag.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as FRAGS from '@thatopen/fragments';
// Same extra classes as the viewer (Node 24 strips the TypeScript types).
import { addMissingElementClasses } from '../src/features/viewer/importerClasses.ts';

const require = createRequire(import.meta.url);
const pkg = (name) => JSON.parse(readFileSync(resolve('node_modules', name, 'package.json'), 'utf8')).version;
const fragsVersion = pkg('@thatopen/fragments');
const webIfcVersion = pkg('web-ifc');
const [, , command, ...args] = process.argv;
const NO_GEOMETRY = /^Ifc(Site|Building|BuildingStorey|Space|DistributionPort|OpeningElement)$/i;

if (command === 'convert' && args.length >= 2) {
  const [input, output] = args;
  const importer = new FRAGS.IfcImporter();
  importer.wasm = { absolute: true, path: resolve('node_modules/web-ifc') + '/' };
  if (!args.includes('--default-classes')) addMissingElementClasses(importer);
  const started = performance.now();
  const bytes = await importer.process({ bytes: new Uint8Array(readFileSync(input)) });
  writeFileSync(output, bytes);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`fragments ${fragsVersion}, web-ifc ${webIfcVersion}: ${input} -> ${output}`);
  console.log(`${(readFileSync(input).length / 1e6).toFixed(1)} MB IFC -> ${(bytes.length / 1e6).toFixed(1)} MB .frag in ${seconds} s`);
} else if (command === 'inspect' && args.length >= 1) {
  const [fragPath, ifcPath] = args;
  const model = new FRAGS.SingleThreadedFragmentsModel('inspect', new Uint8Array(readFileSync(fragPath)));
  const withGeometry = new Set(model.getItemsWithGeometry());
  const byCategory = model.getItemsOfCategories(model.getCategories().map((c) => new RegExp(`^${c}$`)));
  const counts = Object.entries(byCategory)
    .map(([category, ids]) => [category, ids.filter((id) => withGeometry.has(id)).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  console.log(`opened with fragments ${fragsVersion}: ${fragPath}`);
  console.log(`items with geometry: ${withGeometry.size}, coordinates: [${model.getCoordinates().map((v) => +v.toFixed(3)).join(', ')}]`);
  for (const [category, n] of counts) console.log(`  ${String(n).padStart(6)}  ${category}`);

  if (ifcPath) {
    const WebIFC = require('web-ifc');
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const modelId = api.OpenModel(new Uint8Array(readFileSync(ifcPath)));
    const missing = [];
    for (const typeCode of api.GetIfcEntityList(modelId)) {
      const name = api.GetNameFromTypeCode(typeCode);
      // Spatial structure, ports and openings normally have no geometry of their own.
      if (!api.IsIfcElement(typeCode) || NO_GEOMETRY.test(name)) continue;
      const n = api.GetLineIDsWithType(modelId, typeCode).size();
      const inFrag = counts.find(([c]) => c === name.toUpperCase())?.[1] ?? 0;
      if (n > 0 && inFrag < n) missing.push(`  ${name}: ${n} in IFC, ${inFrag} with geometry in .frag`);
    }
    api.CloseModel(modelId);
    console.log(missing.length ? `IFC element classes not fully in the .frag:\n${missing.join('\n')}` : 'every IFC element class is fully in the .frag');
  }
  model.dispose();
} else {
  console.error('usage: node scripts/frag-tool.mjs convert <in.ifc> <out.frag> | inspect <model.frag> [<model.ifc>]');
  process.exit(2);
}

// web-ifc keeps handles open after conversion; exit explicitly.
process.exit(0);
