import fs from 'fs';
import path from 'path';

it('includes every statically read blog capability in the server feature projection', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '../src/routes/blogRoutes.ts'), 'utf8');
  const list = route.match(/const featureKeys = \[([\s\S]*?)\] as const/);
  expect(list).not.toBeNull();
  const declared = new Set([...list![1].matchAll(/'([^']+)'/g)].map(match => match[1]));
  const root = path.resolve(__dirname, '../../app');
  const visit = (folder: string): string[] => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() && !['node_modules', 'dist', 'tests', '.expo', 'android', 'ios'].includes(entry.name) ? visit(path.join(folder, entry.name))
      : entry.isFile() && /\.tsx?$/.test(entry.name) ? [path.join(folder, entry.name)] : []);
  const reads = new Set(visit(root).flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/capabilities(?:\?\.|\.)(trip_blog_[a-z_]+|activity_recap)|capabilities\[['"](trip_blog_[a-z_]+|activity_recap)['"]\]/g)].map(match => match[1] || match[2])));
  expect(reads.size).toBeGreaterThan(0);
  expect([...reads].filter(key => !declared.has(key))).toEqual([]);
});
