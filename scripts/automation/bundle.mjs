#!/usr/bin/env node
// This file must come from the trusted workflow commit, never from model output.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_FILES = 20;
export const MAX_CONTENT_BYTES = 200 * 1024;
// JSON escaping can expand a text character to six bytes.
export const MAX_BUNDLE_BYTES = MAX_CONTENT_BYTES * 6 + 16 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const PURE_LIBRARIES = new Set([
  'coachBrain', 'generateAnalytics', 'mainSetPlanner', 'performanceDefinition',
  'performanceMetrics', 'performanceTime', 'seasonCalendar', 'seasonPlanner',
  'seasonPlannerInput', 'sessionDocument', 'sessionGenerator',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected an object`);
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    `${label}: invalid object prototype`);
  assert(Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label}: unexpected or missing fields`);
}

function expectedSha(value) {
  assert(typeof value === 'string' && SHA.test(value), 'EXPECTED_BASE_SHA must be exactly 40 lowercase hexadecimal characters');
  return value;
}

export function allowedPath(value) {
  if (typeof value !== 'string' || value.length > 180 || value.includes('..') || value.includes('\\')) return false;
  const library = /^frontend\/src\/lib\/([A-Za-z]+)(\.test)?\.js$/.exec(value);
  if (library) return PURE_LIBRARIES.has(library[1]);
  // A single UI filename; no subdirectories, dotfiles, config files, or executable suffixes.
  const ui = /^frontend\/src\/components\/ui\/([a-z][a-z0-9-]*)(?:\.test)?\.(?:js|jsx|css)$/.exec(value);
  return Boolean(ui && !/(?:auth|cloud|storage|permission|deploy|config|database|billing|payment|supabase|firebase|stripe|secret|migration)/.test(ui[1]));
}

function textContent(content, label) {
  assert(typeof content === 'string', `${label}: content must be a string`);
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content), `${label}: binary/control characters are forbidden`);
  // JSON permits lone surrogates, whereas UTF-8 source files do not.
  assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content),
    `${label}: invalid Unicode`);
  return Buffer.byteLength(content, 'utf8');
}

export function validateBundle(bundle, expected) {
  expectedSha(expected);
  exactKeys(bundle, ['baseSha', 'files'], 'bundle');
  assert(bundle.baseSha === expected, 'bundle baseSha does not match EXPECTED_BASE_SHA');
  assert(Array.isArray(bundle.files) && bundle.files.length > 0 && bundle.files.length <= MAX_FILES,
    `bundle must contain 1 to ${MAX_FILES} files`);
  const seen = new Set();
  let size = 0;
  const files = bundle.files.map((file, index) => {
    exactKeys(file, ['path', 'content'], `file ${index}`);
    assert(allowedPath(file.path), `file ${index}: path is outside the automation allowlist`);
    assert(!seen.has(file.path), `file ${index}: duplicate path`);
    seen.add(file.path);
    size += textContent(file.content, `file ${index}`);
    assert(size <= MAX_CONTENT_BYTES, `bundle exceeds ${MAX_CONTENT_BYTES} content bytes`);
    return { path: file.path, content: file.content };
  });
  // Return a new, canonical object rather than trusting properties added by callers.
  return { baseSha: expected, files };
}

export function parseBundle(bytes, expected) {
  assert(bytes.byteLength <= MAX_BUNDLE_BYTES, 'bundle JSON is too large');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('bundle is not valid UTF-8');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('bundle is not valid JSON');
  }
  return validateBundle(value, expected);
}

async function readRegularFile(filename, maxBytes) {
  const stat = await fs.lstat(filename);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'input must be a regular file, not a symlink');
  assert(stat.size <= maxBytes, 'input file is too large');
  return fs.readFile(filename);
}

export async function readBundle(filename, expected) {
  return parseBundle(await readRegularFile(filename, MAX_BUNDLE_BYTES), expected);
}

async function inspectDestination(root, filename) {
  const rootStat = await fs.lstat(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'checkout root must be a real directory');
  const parts = filename.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT' && index === parts.length - 1) return current;
      throw error;
    }
    assert(!stat.isSymbolicLink(), 'symlink files and parents are forbidden');
    if (index < parts.length - 1) {
      assert(stat.isDirectory(), 'destination parent must be an existing directory');
    } else {
      assert(stat.isFile(), 'destination must be a regular file');
      assert((stat.mode & 0o111) === 0, 'executable file modes are forbidden');
    }
  }
  return current;
}

export async function applyBundle(bundle, { root = process.cwd(), expected } = {}) {
  const safe = validateBundle(bundle, expected);
  // Validate every destination before writing even the first file.
  const plan = [];
  for (const file of safe.files) {
    plan.push({ ...file, destination: await inspectDestination(root, file.path) });
  }
  for (const file of plan) {
    const temporary = path.join(path.dirname(file.destination), `.automation-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, file.content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
      // Rename replaces a destination entry instead of following a symlink at it.
      await fs.rename(temporary, file.destination);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  return safe;
}

function git(root, args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function diagnosticPath(filename) {
  // Bound before escaping (at most 1094 ASCII bytes, including quotes/marker).
  // Neutralize terminal controls and both modern and legacy Actions commands.
  const limit = 180;
  const quoted = JSON.stringify(filename.slice(0, limit))
    .replace(/[:#%\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return quoted + (filename.length > limit ? ' [truncated]' : '');
}

export async function collectBundle({ root = process.cwd(), expected } = {}) {
  expectedSha(expected);
  // Compare against the workflow commit, including any commits Claude made locally.
  const raw = git(root, ['diff', '--raw', '--no-abbrev', '--no-ext-diff', '--no-textconv', '--no-renames', '-z', expected, '--']);
  const fields = raw.split('\0');
  if (fields.at(-1) === '') fields.pop();
  assert(fields.length % 2 === 0, 'unexpected git diff format');
  const changed = new Set();
  for (let index = 0; index < fields.length; index += 2) {
    const header = /^:(\d{6}) (\d{6}) [0-9a-f]{40} [0-9a-f]{40} ([A-Z])$/.exec(fields[index]);
    assert(header && ['A', 'M'].includes(header[3]), 'deletions, renames, and file-type changes are unsupported');
    assert(['000000', '100644'].includes(header[1]) && header[2] === '100644', 'only ordinary non-executable files are supported');
    changed.add(fields[index + 1]);
  }
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const filename of untracked) changed.add(filename);
  assert(changed.size > 0 && changed.size <= MAX_FILES, `collect requires 1 to ${MAX_FILES} changed files`);
  const files = [];
  for (const filename of [...changed].sort()) {
    assert(allowedPath(filename), `changed file is outside the automation allowlist: ${diagnosticPath(filename)}`);
    const destination = await inspectDestination(root, filename);
    const bytes = await readRegularFile(destination, MAX_CONTENT_BYTES);
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('changed file is not valid UTF-8');
    }
    files.push({ path: filename, content });
  }
  return validateBundle({ baseSha: expected, files }, expected);
}

export function validateBaseTree(bundle, tree) {
  assert(tree && tree.truncated === false && Array.isArray(tree.tree), 'cannot validate an incomplete GitHub tree');
  const entries = new Map(tree.tree.map(entry => [entry.path, entry]));
  for (const file of bundle.files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const parent = entries.get(parts.slice(0, index).join('/'));
      assert(parent && parent.type === 'tree' && parent.mode === '040000', 'base tree has a missing or unsafe destination parent');
    }
    const entry = entries.get(file.path);
    assert(!entry || (entry.type === 'blob' && entry.mode === '100644'), 'base tree contains a symlink, executable, or unsupported destination');
  }
}

export async function publishBundle(bundle, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const safe = validateBundle(bundle, env.EXPECTED_BASE_SHA);
  assert(env.GITHUB_REF === 'refs/heads/main', 'publishing is allowed only from main');
  assert(env.GITHUB_SHA === safe.baseSha, 'workflow SHA does not match EXPECTED_BASE_SHA');
  assert(!env.GITHUB_SERVER_URL || env.GITHUB_SERVER_URL === 'https://github.com', 'only github.com is supported');
  assert(typeof env.GITHUB_REPOSITORY === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(env.GITHUB_REPOSITORY), 'invalid GITHUB_REPOSITORY');
  assert(/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || ''), 'invalid GITHUB_RUN_ID');
  assert(/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'invalid GITHUB_RUN_ATTEMPT');
  assert(typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0, 'GH_TOKEN is required');
  const repository = env.GITHUB_REPOSITORY;
  const branch = `claude/automation-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const api = async (method, suffix, body) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${suffix}`, {
      method, redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    // Do not echo raw API response bodies or credentials into CI logs.
    assert(response.ok, `GitHub ${method} ${suffix} failed (HTTP ${response.status})`);
    return response.json();
  };
  const checkMain = async () => {
    const ref = await api('GET', '/git/ref/heads/main');
    assert(ref?.object?.type === 'commit' && ref.object.sha === safe.baseSha, 'main changed since this run started; dispatch a new run');
  };
  await checkMain();
  const commit = await api('GET', `/git/commits/${safe.baseSha}`);
  assert(commit?.sha === safe.baseSha && SHA.test(commit?.tree?.sha || ''), 'invalid base commit returned by GitHub');
  const baseTree = await api('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
  validateBaseTree(safe, baseTree);
  // No remote mutation occurs until all artifact paths and base metadata pass.
  const entries = [];
  for (const file of safe.files) {
    const blob = await api('POST', '/git/blobs', { content: file.content, encoding: 'utf-8' });
    assert(SHA.test(blob?.sha || ''), 'invalid blob SHA returned by GitHub');
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await api('POST', '/git/trees', { base_tree: commit.tree.sha, tree: entries });
  assert(SHA.test(tree?.sha || ''), 'invalid tree SHA returned by GitHub');
  const proposed = await api('POST', '/git/commits', {
    message: `chore: Claude automation proposal ${env.GITHUB_RUN_ID}/${env.GITHUB_RUN_ATTEMPT}`,
    tree: tree.sha, parents: [safe.baseSha],
  });
  assert(SHA.test(proposed?.sha || ''), 'invalid commit SHA returned by GitHub');
  await checkMain();
  // Create only: a collision fails. Never update a ref, force push, or merge.
  await api('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: proposed.sha });
  let pr;
  try {
    pr = await api('POST', '/pulls', {
      title: `Claude automation proposal (run ${env.GITHUB_RUN_ID})`,
      head: branch, base: 'main', draft: true, maintainer_can_modify: false,
      body: [
        'This draft contains a bounded Claude Code proposal from the cloud automation workflow.',
        '',
        `Base commit: ${safe.baseSha}`,
        `Workflow run: https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}`,
        '',
        'Human review and passing required checks are required before merge. This workflow does not merge or deploy.',
        'Production, credentials, billing, dependencies, database, and workflow changes are outside the permitted file paths.',
        'Review code behavior as well as paths: a path allowlist cannot prove that source changes are safe.',
      ].join('\n'),
    });
  } catch (error) {
    throw new Error(`Branch ${branch} was created, but draft PR creation failed: ${error.message}`);
  }
  assert(Number.isSafeInteger(pr?.number) && pr.number > 0, `Branch ${branch} created; GitHub returned an invalid PR number`);
  return { branch, number: pr.number, url: `https://github.com/${repository}/pull/${pr.number}` };
}

async function main() {
  const [command, filename, ...rest] = process.argv.slice(2);
  assert(filename && rest.length === 0 && ['collect', 'apply', 'publish'].includes(command),
    'usage: node scripts/automation/bundle.mjs <collect|apply|publish> <bundle-path>');
  const expected = expectedSha(process.env.EXPECTED_BASE_SHA);
  if (command === 'collect') {
    const bundle = await collectBundle({ expected });
    // The workflow should place this output outside the checkout (RUNNER_TEMP).
    await fs.writeFile(filename, `${JSON.stringify(bundle)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Collected ${bundle.files.length} approved-path files.`);
  } else {
    const bundle = await readBundle(filename, expected);
    if (command === 'apply') {
      await applyBundle(bundle, { expected });
      console.log(`Applied ${bundle.files.length} approved-path files.`);
    } else {
      console.log(JSON.stringify(await publishBundle(bundle)));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Automation stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
