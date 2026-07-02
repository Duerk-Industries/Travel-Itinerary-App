import fs from 'fs';
import path from 'path';
import { generateCostModelRows, loadCostModelConfig, rowsToCsv } from '../src/costModel';

const usage = (): never => {
  throw new Error('Usage: tsx server/scripts/cost-model.ts --config <cost-model.yaml> --output <costs.csv>');
};

const getArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
};

const resolveFromInvocationDirectory = (filePath: string): string =>
  path.resolve(process.env.INIT_CWD ?? process.cwd(), filePath);

const main = (): void => {
  const configPath = getArg('--config') ?? getArg('-c') ?? usage();
  const outputPath = getArg('--output') ?? getArg('-o') ?? usage();
  const resolvedOutputPath = resolveFromInvocationDirectory(outputPath);
  const config = loadCostModelConfig(resolveFromInvocationDirectory(configPath));
  const csv = rowsToCsv(generateCostModelRows(config), config);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, csv, 'utf8');
};

main();
