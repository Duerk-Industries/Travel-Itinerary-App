const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'packages/domain/src/planningMapPoints.ts'), 'utf8');
fs.writeFileSync(path.join(root, 'server/src/utils/planningMapPoints.ts'), '// Generated from packages/domain/src/planningMapPoints.ts by scripts/sync-planning-points.cjs.\n' + source.replace("from '../../../server/src/types'", "from '../types'"));
