/**
 * Clip flood-hazard.geojson to a bounding box (Minglanilla) and simplify.
 * Does NOT overwrite the original — outputs to flood-hazard-clipped.geojson only.
 *
 * Run: npm run clip-flood
 *
 * After it finishes:
 *   1. Rename flood-hazard.geojson → flood-hazard.geojson.backup (optional backup)
 *   2. Rename flood-hazard-clipped.geojson → flood-hazard.geojson
 *
 * Change BBOX below to clip a different area.
 * Format: [west, south, east, north] (longitude, latitude)
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const inputPath = path.join(projectRoot, 'static/geojson/flood-hazard.geojson');
const outputPath = path.join(projectRoot, 'static/geojson/flood-hazard-clipped.geojson');

/* Minglanilla, Cebu [west, south, east, north] */
const BBOX = [123.74, 10.21, 123.90, 10.33];

if (!existsSync(inputPath)) {
  console.error('Input file not found:', inputPath);
  console.error('Put your large flood-hazard.geojson there first.');
  process.exit(1);
}

console.log('Clipping to bbox:', BBOX.join(', '));
console.log('Output will be flood-hazard-clipped.geojson (original unchanged).');
console.log('This may take 1–2 minutes for large files…\n');

try {
  const bboxArg = BBOX.join(',');
  execSync(
    `npx mapshaper "${inputPath}" -clip bbox=${bboxArg} -simplify 5% -o "${outputPath}"`,
    { stdio: 'inherit', cwd: projectRoot }
  );

  console.log('\nDone! Output:', outputPath);
  console.log('To use it: update hazard-overlays to use flood-hazard-clipped.geojson');
  console.log('Or manually rename: flood-hazard-clipped.geojson → flood-hazard.geojson');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
