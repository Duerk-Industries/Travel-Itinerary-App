import { parseLodgingText } from '../utils/lodgingParser';
import fs from 'fs';
import path from 'path';

const fixturePath = path.join(__dirname, '../test_inputs/lodging/chic-stay.txt');
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '../test_inputs/lodging/Chic stay HANA Boutique hotel.json'), 'utf-8'));

const main = () => {
  const text = fs.readFileSync(fixturePath, 'utf-8');
  const parsed = parseLodgingText(text);
  const normalized = {
    ...parsed,
    checkInDate: parsed.checkInDate,
    checkOutDate: parsed.checkOutDate,
    freeCancelBy: parsed.freeCancelBy,
  };
  let pass = true;
  for (const [k, v] of Object.entries(expected)) {
    if ((normalized as any)[k] !== v) {
      pass = false;
      console.error(`Mismatch for ${k}: expected "${v}", got "${(normalized as any)[k]}"`);
    }
  }
  if (!pass) {
    process.exit(1);
  }
  console.log('Lodging parser test passed.');
};

main();
