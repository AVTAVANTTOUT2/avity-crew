import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, directory, , moduleUrl] = process.argv.slice(2);
if (mode === 'same-group-probe') {
  const code = `import {observeProcess,stopOwnedProcess} from ${JSON.stringify(moduleUrl)};import {writeFileSync} from 'node:fs';const identity=await observeProcess(${process.pid});try{await stopOwnedProcess(identity);writeFileSync(${JSON.stringify(join(directory, 'probe'))},'unexpected success')}catch(error){writeFileSync(${JSON.stringify(join(directory, 'probe'))},error.code)}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: 'ignore',
  });
  writeFileSync(join(directory, 'child-pid'), String(child.pid));
} else if (mode === 'zombie-holder') {
  writeFileSync(join(directory, 'beat'), '.');
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
    stdio: 'ignore',
  });
  writeFileSync(join(directory, 'child-pid'), String(child.pid));
  // Prevent libuv from reaping its child until the test observes the zombie.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
} else if (mode === 'tree-exit' || mode === 'tree-ignore') {
  if (mode === 'tree-ignore') process.on('SIGTERM', () => {});
  const child = spawn(
    process.execPath,
    [import.meta.filename, 'leaf', directory],
    {
      stdio: 'ignore',
    },
  );
  child.unref();
  writeFileSync(join(directory, 'child-pid'), String(child.pid));
} else if (mode === 'leaf') process.on('SIGTERM', () => {});

const heartbeat = join(directory, mode === 'leaf' ? 'leaf-beat' : 'beat');
writeFileSync(heartbeat, '.');
setInterval(() => appendFileSync(heartbeat, '.'), 25);
// A guard also ends the laboratory if the test runner itself is interrupted.
setTimeout(() => process.exit(0), 10_000);
