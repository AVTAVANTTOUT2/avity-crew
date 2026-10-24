import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const root = new URL('../', import.meta.url);
const schema = JSON.parse(
  await readFile(
    new URL('avity-crew-workpack/schemas/runtime.schema.json', root),
    'utf8',
  ),
);
const directory = new URL('packages/contracts/src/generated/', root);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL('runtime-schema.ts', directory),
  '// Generated from avity-crew-workpack/schemas/runtime.schema.json.\n' +
    'export const runtimeSchema = ' +
    JSON.stringify(schema) +
    ';\n',
);
const types = await compile(
  {
    ...schema,
    title: 'RuntimeContracts',
    oneOf: Object.keys(schema.$defs).map((name) => ({
      $ref: `#/$defs/${name}`,
    })),
  },
  'RuntimeContracts',
  {
    bannerComment: '/* Generated from the runtime schema. Do not edit. */',
    additionalProperties: false,
  },
);
await writeFile(new URL('runtime.ts', directory), types);
