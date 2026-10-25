import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outputDirectory = join(process.cwd(), 'public', 'tessdata');
const languages = ['ara', 'eng'];
const baseUrl = 'https://tessdata.projectnaptha.com/4.0.0';

await mkdir(outputDirectory, { recursive: true });

for (const language of languages) {
  const filename = `${language}.traineddata.gz`;
  const destination = join(outputDirectory, filename);
  const response = await fetch(`${baseUrl}/${filename}`, { redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Could not download pinned OCR language data (${language}): HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 100_000 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error(`Downloaded OCR language data failed basic gzip validation: ${language}`);
  }
  await writeFile(destination, bytes);
  console.log(`Prepared local OCR language data: ${filename} (${bytes.length} bytes)`);
}
