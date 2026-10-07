import { cp, mkdir, rm, access } from 'node:fs/promises';

const source = new URL('../wegoinn/', import.meta.url);
const output = new URL('../dist/', import.meta.url);
const files = ['index.html', 'admin.html', 'css', 'js'];
for (const file of files) await access(new URL(file, source));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  await cp(new URL(file, source), new URL(file, output), { recursive: true });
}
console.log('Wegoinn guest/admin pages and assets built into dist/');
