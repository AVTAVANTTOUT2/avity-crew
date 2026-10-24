import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync, readlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [base] = process.argv.slice(2);
assert.ok(base, 'Expected the private validation directory');
const digest = (value) => createHash('sha256').update(value).digest('hex');
function tree(root, skipGit = false) {
  const entries = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (skipGit && name === '.git') continue;
      const file = join(dir, name), stat = lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else entries.push([relative(root, file), stat.isSymbolicLink() ? readlinkSync(file) : digest(readFileSync(file))]);
    }
  }
  walk(root);
  return { files: entries.length, sha256: digest(JSON.stringify(entries)) };
}
const data = join(base, 'data/avity-crew');
const projects = readdirSync(data).filter((name) => name.startsWith('project-')).sort().map((name) => {
  const db = new DatabaseSync(join(data, name, 'state.sqlite'), { readOnly: true });
  try {
    const rows = {};
    for (const table of ['project', 'runs', 'tasks']) rows[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    rows.records = db.prepare("SELECT kind,id,data FROM records WHERE kind IN ('decision','handoff','review','verification','acceptance','final','question','user_response','note') ORDER BY kind,id").all();
    const project = JSON.parse(rows.project[0].data);
    return { id: name, runs: rows.runs.map((run) => ({ id: run.id, status: run.status })), tasks: rows.tasks.length, durable_records: rows.records.length, business_sha256: digest(JSON.stringify(rows)), source_tree: tree(project.root, true) };
  } finally { db.close(); }
});
console.log(JSON.stringify({ data_tree: tree(data), projects }));
