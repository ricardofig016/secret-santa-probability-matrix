import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { validateGroup } from './group.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const resources = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']], ...['app', 'solver', 'worker', 'group'].map(name => [`/${name}.js`, [`${name}.js`, 'text/javascript']]),
]);
const validId = /^[a-z0-9][a-z0-9_-]{0,79}\.ya?ml$/i;
const failure = (status, message) => Object.assign(new Error(message), { status });
const digest = source => createHash('sha256').update(source).digest('hex');

export function makeServer(directory = join(root, 'data')) {
  let pending = Promise.resolve();
  const serial = fn => {
    const operation = pending.then(fn);
    pending = operation.catch(() => {});
    return operation;
  };
  async function load(id) {
    const source = await readFile(join(directory, id), 'utf8');
    try {
      return { id, revision: digest(source), group: validateGroup(parse(source, { maxAliasCount: 0 })) };
    } catch (error) {
      throw failure(422, `${id}: ${error.message}`);
    }
  }
  async function save(id, group) {
    const source = stringify(group);
    const tmp = join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, source, { flag: 'wx' });
      await rename(tmp, join(directory, id));
    } finally {
      await unlink(tmp).catch(() => {});
    }
    return { id, revision: digest(source), group };
  }
  async function body(req) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw failure(415, 'Expected application/json.');
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      if ((size += chunk.length) > 1024 * 1024) {
        req.resume();
        throw failure(413, 'This group is too large.');
      }
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
    throw failure(400, 'Invalid JSON object.');
  }
  function validated(value) {
    try { return validateGroup(value); } catch (error) { throw failure(400, error.message); }
  }
  return createServer(async (req, res) => {
    const send = (status, data, mime = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(mime === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      const host = `127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) throw failure(403, 'Open the app at its displayed local address.');
      const pathname = new URL(req.url, `http://${host}`).pathname;
      const { method } = req;
      if (method === 'GET' && resources.has(pathname)) {
        const [filename, mime] = resources.get(pathname);
        return send(200, await readFile(join(root, filename)), mime);
      }
      if (pathname === '/api/groups') {
        await mkdir(directory, { recursive: true });
        if (method === 'GET') {
          const groups = [], warnings = [];
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (!entry.isFile() || !validId.test(entry.name)) continue;
            try {
              const { id, group } = await load(entry.name);
              groups.push({ id, name: group.name });
            } catch (error) { warnings.push(error.message); }
          }
          groups.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
          return send(200, { groups, warnings });
        }
        if (method === 'POST') {
          const { name } = await body(req);
          const group = validated({ name, participants: [], team: false, pairs: [] });
          return send(201, await serial(() => save(`${randomUUID()}.yaml`, group)));
        }
      }
      const id = pathname.match(/^\/api\/groups\/([^/]+)$/)?.[1];
      if (id && validId.test(id)) {
        if (method === 'GET') return send(200, await load(id));
        if (method === 'PUT') {
          const update = await body(req);
          const group = validated(update.group);
          return send(200, await serial(async () => {
            const current = await load(id);
            if (current.revision !== update.revision) {
              if (JSON.stringify(current.group) === JSON.stringify(group)) return current;
              throw failure(409, 'This YAML changed elsewhere. Reload before editing it again.');
            }
            return save(id, group);
          }));
        }
      }
      throw failure(404, 'Not found.');
    } catch (error) {
      if (!error.status && error.code !== 'ENOENT') console.error(error);
      send(error.status ?? (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.message : error.code === 'ENOENT' ? 'File not found.' : 'Could not access local storage.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8765);
  makeServer().listen(port, '127.0.0.1', function () {
    console.log(`Secret Santa: http://127.0.0.1:${this.address().port}/`);
  });
}
