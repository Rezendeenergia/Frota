import fs from 'node:fs';
import { computeFromBuffer } from './lib/manutencaoService.js';

const buf = fs.readFileSync(new URL('./test-fixture.xlsx', import.meta.url));
const result = computeFromBuffer(buf);
console.log(JSON.stringify(result, null, 2));
