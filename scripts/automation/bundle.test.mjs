import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_CONTENT_BYTES, MAX_BUNDLE_BYTES, allowedPath, validateBundle, parseBundle,
  readBundle, applyBundle, collectBundle, validateBaseTree, publishBundle,
} from './bundle.mjs';

const BASE = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BLOB = 'c'.repeat(40);
const NEW_TREE = 'd'.repeat(40);
const COMMIT = 'e'.repeat(40);
const LIB = 'frontend/src/lib/coachBrain.js';
const UI = 'frontend/src/components/ui/button.jsx';
const bundle = (files = [{ path: LIB, content: 'export const answer = 42;\n' }]) => ({ baseSha: BASE, files });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coach-automation-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'frontend/src/lib'), { recursive: true });
  await fs.mkdir(path.join(root, 'frontend/src/components/ui'), { recursive: true });
  await fs.writeFile(path.join(root, LIB), 'original\n');
  await fs.writeFile(path.join(root, UI), 'original UI\n');
  return root;
}

function git(root, args) {
  return execFileSync('git', ['-c', 'user.name=Automation Test', '-c', 'user.email=automation@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function repository(t) {
  const root = await fixture(t);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  return { root, expected: git(root, ['rev-parse', 'HEAD']) };
}

test('only explicit pure libraries and single-level UI source paths are allowed', () => {
  for (const filename of [LIB, LIB.replace('.js', '.test.js'), UI, 'frontend/src/components/ui/button.test.js', 'frontend/src/components/ui/button.css']) {
    assert.equal(allowedPath(filename), true, filename);
  }
  for (const filename of [
    '.github/workflows/ci.yml', 'CLAUDE.md', 'frontend/package.json',
    'frontend/src/lib/cloudStore.js', 'frontend/src/lib/localStore.js',
    'frontend/src/lib/coachBrain.jsx', 'frontend/src/lib/coachBrain.test.test.js',
    'frontend/src/lib/../lib/coachBrain.js', '/frontend/src/lib/coachBrain.js',
    'frontend\\src\\lib\\coachBrain.js', 'frontend/src/lib/%2e%2e/coachBrain.js',
    'frontend/src/components/ui/nested/button.jsx', 'frontend/src/components/ui/.config.js',
    'frontend/src/components/ui/auth.jsx', 'frontend/src/components/ui/cloud.js',
    'frontend/src/components/ui/payment-form.jsx', 'frontend/src/components/ui/button.js\n',
  ]) assert.equal(allowedPath(filename), false, filename);
});

test('strict schema, exact base, duplicates, and non-text content are rejected', () => {
  assert.deepEqual(validateBundle(bundle(), BASE), bundle());
  const invalid = [
    {}, { ...bundle(), delete: true }, { ...bundle(), baseSha: 'f'.repeat(40) },
    { ...bundle(), files: [] }, { ...bundle(), files: {} },
    bundle([{ path: LIB, content: '', mode: '120000' }]),
    bundle([{ path: LIB, content: '' }, { path: LIB, content: 'duplicate' }]),
    bundle([{ path: LIB, content: null }]),
    bundle([{ path: LIB, content: '\u0000' }]),
    bundle([{ path: LIB, content: '\u0001' }]),
    bundle([{ path: LIB, content: '\ud800' }]),
    bundle([{ path: LIB, content: '\udc00' }]),
    JSON.parse(`{"baseSha":"${BASE}","files":[],"__proto__":{}}`),
  ];
  for (const value of invalid) assert.throws(() => validateBundle(value, BASE));
  for (const expected of ['', BASE + '0', 'x'.repeat(40), null]) assert.throws(() => validateBundle(bundle(), expected));
  assert.doesNotThrow(() => validateBundle(bundle([{ path: LIB, content: '// 日本語 😀\n\t\r' }]), BASE));
});

test('size limits count UTF-8 bytes across all files, not characters', () => {
  assert.doesNotThrow(() => validateBundle(bundle([{ path: LIB, content: 'x'.repeat(MAX_CONTENT_BYTES) }]), BASE));
  assert.throws(() => validateBundle(bundle([{ path: LIB, content: 'x'.repeat(MAX_CONTENT_BYTES + 1) }]), BASE), /exceeds/);
  assert.throws(() => validateBundle(bundle([{ path: LIB, content: 'あ'.repeat(Math.floor(MAX_CONTENT_BYTES / 3) + 1) }]), BASE), /exceeds/);
  assert.throws(() => validateBundle(bundle([{ path: LIB, content: 'x'.repeat(MAX_CONTENT_BYTES) }, { path: UI, content: 'x' }]), BASE), /exceeds/);
  const files = Array.from({ length: 20 }, (_, index) => ({ path: `frontend/src/components/ui/button-${index}.js`, content: '' }));
  assert.doesNotThrow(() => validateBundle(bundle(files), BASE));
  files.push({ path: UI, content: '' });
  assert.throws(() => validateBundle(bundle(files), BASE), /1 to 20/);
});

test('raw artifact rejects malformed JSON, invalid UTF-8 and oversized input', () => {
  assert.deepEqual(parseBundle(Buffer.from(JSON.stringify(bundle())), BASE), bundle());
  assert.throws(() => parseBundle(Buffer.from([0xc3, 0x28]), BASE), /UTF-8/);
  assert.throws(() => parseBundle(Buffer.from('{'), BASE), /JSON/);
  assert.throws(() => parseBundle(Buffer.alloc(MAX_BUNDLE_BYTES + 1), BASE), /too large/);
});

test('artifact itself cannot be a symlink', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'data.json'), JSON.stringify(bundle()));
  await fs.symlink(path.join(root, 'data.json'), path.join(root, 'link.json'));
  await assert.rejects(readBundle(path.join(root, 'link.json'), BASE), /regular file/);
});

test('apply validates all paths before writing and rejects unexpected fields', async t => {
  const root = await fixture(t);
  const malicious = bundle([{ path: LIB, content: 'changed' }, { path: '../escaped.js', content: 'escape' }]);
  await assert.rejects(applyBundle(malicious, { root, expected: BASE }), /allowlist/);
  assert.equal(await fs.readFile(path.join(root, LIB), 'utf8'), 'original\n');
  await assert.rejects(applyBundle({ ...bundle(), extra: true }, { root, expected: BASE }), /fields/);
});

test('apply rejects symlink destinations before touching any earlier file', async t => {
  const root = await fixture(t);
  const target = path.join(root, 'untouched.txt');
  await fs.writeFile(target, 'do not change');
  await fs.rm(path.join(root, UI));
  await fs.symlink(target, path.join(root, UI));
  await assert.rejects(applyBundle(bundle([{ path: LIB, content: 'changed' }, { path: UI, content: 'bad' }]), { root, expected: BASE }), /symlink/);
  assert.equal(await fs.readFile(path.join(root, LIB), 'utf8'), 'original\n');
  assert.equal(await fs.readFile(target, 'utf8'), 'do not change');
});

test('apply rejects a symlink parent, executable destination, and missing parents', async t => {
  const root = await fixture(t);
  await fs.chmod(path.join(root, LIB), 0o755);
  await assert.rejects(applyBundle(bundle(), { root, expected: BASE }), /executable/);
  await fs.chmod(path.join(root, LIB), 0o644);
  const uiDirectory = path.join(root, 'frontend/src/components/ui');
  await fs.rename(uiDirectory, path.join(root, 'original-ui'));
  await fs.symlink(path.join(root, 'original-ui'), uiDirectory);
  await assert.rejects(applyBundle(bundle([{ path: UI, content: 'bad' }]), { root, expected: BASE }), /symlink/);
  await fs.rm(uiDirectory);
  await assert.rejects(applyBundle(bundle([{ path: UI, content: 'bad' }]), { root, expected: BASE }), /ENOENT/);
});

test('apply supports ordinary updates and additions, always non-executable', async t => {
  const root = await fixture(t);
  const addition = 'frontend/src/lib/coachBrain.test.js';
  const safe = bundle([{ path: LIB, content: 'updated\n' }, { path: addition, content: 'new test\n' }]);
  await applyBundle(safe, { root, expected: BASE });
  assert.equal(await fs.readFile(path.join(root, LIB), 'utf8'), 'updated\n');
  assert.equal(await fs.readFile(path.join(root, addition), 'utf8'), 'new test\n');
  assert.equal((await fs.stat(path.join(root, addition))).mode & 0o111, 0);
});

test('collect includes working-tree changes, new files and local commits against expected base', async t => {
  const { root, expected } = await repository(t);
  await fs.writeFile(path.join(root, LIB), 'committed change\n');
  git(root, ['add', LIB]);
  git(root, ['commit', '-m', 'local model commit']);
  await fs.writeFile(path.join(root, UI), 'working change\n');
  await fs.writeFile(path.join(root, 'frontend/src/lib/coachBrain.test.js'), 'new test\n');
  const result = await collectBundle({ root, expected });
  assert.equal(result.baseSha, expected);
  assert.equal(result.files.length, 3);
  assert.equal(result.files.find(file => file.path === LIB).content, 'committed change\n');
});

test('collect refuses unrelated, deleted, renamed, executable, symlink and invalid UTF-8 files', async t => {
  for (const scenario of ['protected', 'deleted', 'renamed', 'executable', 'symlink', 'binary']) {
    await t.test(scenario, async child => {
      const { root, expected } = await repository(child);
      if (scenario === 'protected') await fs.writeFile(path.join(root, 'package.json'), '{}');
      if (scenario === 'deleted') await fs.rm(path.join(root, LIB));
      if (scenario === 'renamed') await fs.rename(path.join(root, LIB), path.join(root, 'frontend/src/lib/mainSetPlanner.js'));
      if (scenario === 'executable') { await fs.chmod(path.join(root, LIB), 0o755); git(root, ['update-index', '--chmod=+x', LIB]); }
      if (scenario === 'symlink') { await fs.rm(path.join(root, LIB)); await fs.symlink(path.join(root, UI), path.join(root, LIB)); }
      if (scenario === 'binary') await fs.writeFile(path.join(root, LIB), Buffer.from([0xff, 0xfe]));
      await assert.rejects(collectBundle({ root, expected }));
    });
  }
});

test('collect names forbidden tracked, staged, committed and untracked paths without content', async t => {
  for (const scenario of ['tracked', 'staged', 'committed', 'untracked']) {
    await t.test(scenario, async child => {
      const { root, expected: original } = await repository(child);
      const forbidden = 'z-forbidden.txt';
      let expected = original;
      if (scenario === 'tracked') {
        await fs.writeFile(path.join(root, forbidden), 'original\n');
        git(root, ['add', forbidden]);
        git(root, ['commit', '-m', 'tracked fixture']);
        expected = git(root, ['rev-parse', 'HEAD']);
      }
      await fs.writeFile(path.join(root, 'frontend/src/lib/performanceTime.test.js'), 'test("small allowed test", () => {});\n');
      await fs.writeFile(path.join(root, forbidden), 'FILE_CONTENT_MUST_NOT_APPEAR\n');
      if (scenario === 'staged' || scenario === 'committed') git(root, ['add', forbidden]);
      if (scenario === 'committed') git(root, ['commit', '-m', 'forbidden fixture']);
      await assert.rejects(collectBundle({ root, expected }), {
        message: 'changed file is outside the automation allowlist: "z-forbidden.txt"',
      });
    });
  }
});

test('collect CLI escapes hostile pathnames, bounds output and creates no rejected artifact', async t => {
  const cases = [
    ['controls', 'bad\n::error::x\r\t\x1b[31m\x7f\x85\u2028\u2029\u202e.txt',
      '"bad\\n\\u003a\\u003aerror\\u003a\\u003ax\\r\\t\\u001b[31m\\u007f\\u0085\\u2028\\u2029\\u202e.txt"'],
    ['commands', '::error::x##[error]%0A.txt',
      '"\\u003a\\u003aerror\\u003a\\u003ax\\u0023\\u0023[error]\\u00250A.txt"'],
    ['quotes', 'quote"back\\slash.txt', '"quote\\"back\\\\slash.txt"'],
    ['long path', `${'\u202e'.repeat(60)}/${'\u202e'.repeat(60)}/${'\u202e'.repeat(60)}/tail.txt`,
      `"${'\\u202e'.repeat(60)}/${'\\u202e'.repeat(60)}/${'\\u202e'.repeat(58)}" [truncated]`],
  ];
  for (const [label, filename, escaped] of cases) {
    await t.test(label, async child => {
      const { root, expected } = await repository(child);
      const destination = path.join(root, filename);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, 'FILE_CONTENT_MUST_NOT_APPEAR\n');
      const output = path.join(root, 'candidate.json');
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./bundle.mjs', import.meta.url)), 'collect', output], {
        cwd: root, encoding: 'utf8', env: { ...process.env, EXPECTED_BASE_SHA: expected },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `Automation stopped: changed file is outside the automation allowlist: ${escaped}\n`);
      assert.match(result.stderr, /^[\x20-\x7e]+\n$/);
      assert.doesNotMatch(result.stderr, /::|##\[|%|FILE_CONTENT_MUST_NOT_APPEAR/);
      assert.ok(Buffer.byteLength(result.stderr) < 1200);
      await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    });
  }
});

test('collect accepts the intended test path and still excludes ignored untracked files', async t => {
  const { root, expected: original } = await repository(t);
  await fs.writeFile(path.join(root, '.gitignore'), 'frontend/node_modules/\n');
  git(root, ['add', '.gitignore']);
  git(root, ['commit', '-m', 'ignore fixture dependencies']);
  const expected = git(root, ['rev-parse', 'HEAD']);
  const filename = 'frontend/src/lib/performanceTime.test.js';
  const content = 'test("small allowed test", () => {});\n';
  await fs.mkdir(path.join(root, 'frontend/node_modules'), { recursive: true });
  await fs.writeFile(path.join(root, 'frontend/node_modules/ignored.txt'), 'ignored fixture\n');
  await fs.writeFile(path.join(root, filename), content);
  assert.deepEqual(await collectBundle({ root, expected }), { baseSha: expected, files: [{ path: filename, content }] });
  // An unignored change to the ignore rules remains forbidden.
  await assert.rejects(collectBundle({ root, expected: original }), {
    message: 'changed file is outside the automation allowlist: ".gitignore"',
  });
});

function baseTree() {
  return { truncated: false, tree: [
    ...['frontend', 'frontend/src', 'frontend/src/lib', 'frontend/src/components', 'frontend/src/components/ui']
      .map(filename => ({ path: filename, mode: '040000', type: 'tree' })),
    { path: LIB, mode: '100644', type: 'blob' },
  ] };
}

test('remote base validation rejects truncated trees, symlinks, submodules and executable files', () => {
  assert.doesNotThrow(() => validateBaseTree(bundle(), baseTree()));
  assert.throws(() => validateBaseTree(bundle(), { ...baseTree(), truncated: true }), /incomplete/);
  for (const mode of ['120000', '100755', '160000']) {
    const tree = baseTree();
    tree.tree.at(-1).mode = mode;
    assert.throws(() => validateBaseTree(bundle(), tree), /unsupported/);
  }
  const tree = baseTree();
  tree.tree.find(entry => entry.path === 'frontend/src/lib').mode = '120000';
  assert.throws(() => validateBaseTree(bundle(), tree), /unsafe/);
});

function environment() {
  return {
    EXPECTED_BASE_SHA: BASE, GITHUB_SHA: BASE, GITHUB_REF: 'refs/heads/main',
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'CoachTree/coach-brain-swim-planner-pro',
    GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2', GH_TOKEN: 'test-token-never-send',
  };
}

function mockApi({ staleAt = 0, unsafeTree = false, failRef = false, failPr = false } = {}) {
  const calls = [];
  let mainReads = 0;
  const fetchImpl = async (url, options) => {
    const suffix = url.replace('https://api.github.com/repos/CoachTree/coach-brain-swim-planner-pro', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method: options.method, suffix, body, options });
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-token-never-send');
    let result;
    let status = 200;
    if (options.method === 'GET' && suffix === '/git/ref/heads/main') {
      mainReads += 1;
      result = { object: { type: 'commit', sha: staleAt === mainReads ? 'f'.repeat(40) : BASE } };
    } else if (options.method === 'GET' && suffix === `/git/commits/${BASE}`) result = { sha: BASE, tree: { sha: TREE } };
    else if (options.method === 'GET' && suffix === `/git/trees/${TREE}?recursive=1`) {
      result = baseTree();
      if (unsafeTree) result.tree.at(-1).mode = '120000';
    } else if (options.method === 'POST' && suffix === '/git/blobs') result = { sha: BLOB };
    else if (options.method === 'POST' && suffix === '/git/trees') result = { sha: NEW_TREE };
    else if (options.method === 'POST' && suffix === '/git/commits') result = { sha: COMMIT };
    else if (options.method === 'POST' && suffix === '/git/refs') { result = {}; status = failRef ? 422 : 201; }
    else if (options.method === 'POST' && suffix === '/pulls') { result = { number: 77 }; status = failPr ? 403 : 201; }
    else assert.fail(`unexpected API call ${options.method} ${suffix}`);
    return { ok: status < 400, status, json: async () => result };
  };
  return { calls, fetchImpl };
}

test('publisher creates only a new branch and draft PR with fixed trusted metadata', async () => {
  const { calls, fetchImpl } = mockApi();
  const result = await publishBundle(bundle(), { env: environment(), fetchImpl });
  assert.deepEqual(result, { branch: 'claude/automation-12345-2', number: 77, url: 'https://github.com/CoachTree/coach-brain-swim-planner-pro/pull/77' });
  assert.equal(calls.filter(call => call.method === 'GET' && call.suffix === '/git/ref/heads/main').length, 2);
  assert.deepEqual(calls.find(call => call.suffix === '/git/refs').body, { ref: 'refs/heads/claude/automation-12345-2', sha: COMMIT });
  assert.deepEqual(calls.find(call => call.suffix === '/git/commits' && call.method === 'POST').body.parents, [BASE]);
  const pr = calls.find(call => call.suffix === '/pulls').body;
  assert.equal(pr.base, 'main'); assert.equal(pr.draft, true); assert.equal(pr.maintainer_can_modify, false);
  assert.ok(calls.every(call => ['GET', 'POST'].includes(call.method)));
  assert.ok(calls.every(call => !/merge|deployment|secret|variable|dispatch/.test(call.suffix)));
  assert.equal(calls.find(call => call.suffix === '/git/trees' && call.method === 'POST').body.tree[0].mode, '100644');
});

test('publisher rejects invalid job context and invalid artifacts before any network request', async () => {
  for (const overrides of [
    { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_SHA: 'f'.repeat(40) },
    { GITHUB_SERVER_URL: 'https://evil.invalid' }, { GITHUB_REPOSITORY: '../evil' },
    { GITHUB_RUN_ID: '1/../../main' }, { GITHUB_RUN_ATTEMPT: '0' }, { GH_TOKEN: '' },
  ]) {
    let count = 0;
    await assert.rejects(publishBundle(bundle(), { env: { ...environment(), ...overrides }, fetchImpl: async () => { count += 1; } }));
    assert.equal(count, 0);
  }
  const mock = mockApi();
  await assert.rejects(publishBundle(bundle([{ path: '.github/workflows/evil.yml', content: 'bad' }]), { env: environment(), fetchImpl: mock.fetchImpl }));
  assert.equal(mock.calls.length, 0);
});

test('stale main and unsafe base fail before any GitHub write', async () => {
  for (const options of [{ staleAt: 1 }, { unsafeTree: true }]) {
    const mock = mockApi(options);
    await assert.rejects(publishBundle(bundle(), { env: environment(), fetchImpl: mock.fetchImpl }));
    assert.ok(mock.calls.every(call => call.method === 'GET'));
  }
});

test('main moving during upload prevents branch and PR creation', async () => {
  const mock = mockApi({ staleAt: 2 });
  await assert.rejects(publishBundle(bundle(), { env: environment(), fetchImpl: mock.fetchImpl }), /main changed/);
  assert.ok(!mock.calls.some(call => ['/git/refs', '/pulls'].includes(call.suffix)));
});

test('branch collision never updates a ref or creates a PR; PR failure reports the created branch', async () => {
  const collision = mockApi({ failRef: true });
  await assert.rejects(publishBundle(bundle(), { env: environment(), fetchImpl: collision.fetchImpl }), /HTTP 422/);
  assert.ok(!collision.calls.some(call => call.suffix === '/pulls' || call.method === 'PATCH'));
  const rejectedPr = mockApi({ failPr: true });
  await assert.rejects(publishBundle(bundle(), { env: environment(), fetchImpl: rejectedPr.fetchImpl }), /Branch claude\/automation-12345-2 was created/);
});
