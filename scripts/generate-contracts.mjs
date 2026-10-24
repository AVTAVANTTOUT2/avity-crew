import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const root = new URL('../', import.meta.url);
const schema = JSON.parse(
  await readFile(
    new URL('packages/contracts/schema/runtime.schema.json', root),
    'utf8',
  ),
);
const directory = new URL('packages/contracts/src/generated/', root);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL('runtime-schema.ts', directory),
  '// Generated from packages/contracts/schema/runtime.schema.json.\n' +
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

const projectSchema = JSON.parse(
  await readFile(
    new URL('packages/contracts/schema/project-config.schema.json', root),
    'utf8',
  ),
);
await writeFile(
  new URL('project-schema.ts', directory),
  'export const projectSchema = ' + JSON.stringify(projectSchema) + ';\n',
);
await writeFile(
  new URL('project-config.ts', directory),
  await compile({ ...projectSchema, title: 'ProjectConfig' }, 'ProjectConfig', {
    bannerComment:
      '/* Generated from the project configuration schema. Do not edit. */',
    additionalProperties: false,
  }),
);

const names = Object.keys(schema.$defs);
await writeFile(
  new URL('contract-map.ts', directory),
  `import type { ${names.join(', ')} } from './runtime.ts';\n` +
    `import type { ProjectConfig } from './project-config.ts';\n` +
    `export const contractDefinitions = ${JSON.stringify([...names, 'ProjectConfig'])} as const;\n` +
    `export interface ContractMap { ${names.map((name) => `${name}: ${name};`).join(' ')} ProjectConfig: ProjectConfig; }\n`,
);
