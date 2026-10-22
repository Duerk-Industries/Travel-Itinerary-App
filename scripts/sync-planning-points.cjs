const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Files the server needs verbatim from the shared domain package (server code cannot import outside server/).
for (const name of ['dayOrder', 'planningMapPoints']) {
  const source = fs.readFileSync(path.join(root, `packages/domain/src/${name}.ts`), 'utf8');
  fs.writeFileSync(
    path.join(root, `server/src/utils/${name}.ts`),
    `// Generated from packages/domain/src/${name}.ts by scripts/sync-planning-points.cjs.
` + source.replace("from '../../../server/src/types'", "from '../types'")
  );
}
