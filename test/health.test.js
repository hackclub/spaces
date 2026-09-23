import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

let app;
let server;
let baseUrl;

before(async () => {
  process.env.AIRTABLE_API_KEY = 'test-key';
  process.env.AIRTABLE_BASE_ID = 'test-base';
  process.env.PG_CONNECTION_STRING = 'postgres://test:test@127.0.0.1:5432/test';

  ({ default: app } = await import('../src/app.js'));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('GET /api/v1/up exposes public API liveness', async () => {
  const response = await fetch(`${baseUrl}/api/v1/up`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'up',
    service: 'api',
  });
});

test('API liveness does not require authorization', async () => {
  const response = await fetch(`${baseUrl}/api/v1/up`, {
    headers: { authorization: 'invalid-token' },
  });

  assert.equal(response.status, 200);
});
