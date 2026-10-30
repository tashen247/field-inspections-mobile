import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASSESSOR_JHB,
  MANAGER,
  bearer,
  jobBody,
  login,
  setupTestApp,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.close());

describe('auth', () => {
  it('logs in with a case-insensitive email and returns a token pair', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: `  ${MANAGER.toUpperCase()} `, password: 'Inspect!2026' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ email: MANAGER, role: 'manager' });
    expect(body.expiresIn).toBe(900);
    expect(res.headers['x-correlation-id']).toBeTruthy();
  });

  it('rejects a wrong password and unknown email the same way', async () => {
    for (const email of [MANAGER, 'nobody@example.com']) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Email or password is incorrect',
      });
    }
  });

  it('validates the body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'x' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const first = await login(ctx.app, ASSESSOR_JHB);
    const r1 = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(r1.statusCode).toBe(200);
    const second = r1.json<{ refreshToken: string; accessToken: string }>();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Replaying the old token is treated as theft: it fails and kills the new one too.
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    const afterReuse = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: second.refreshToken },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('rejects unknown refresh tokens', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: 'x'.repeat(43) },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('role checks', () => {
  it('requires a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/inspections' });
    expect(res.statusCode).toBe(401);
    const bad = await ctx.app.inject({
      method: 'GET',
      url: '/v1/templates',
      headers: bearer('nope'),
    });
    expect(bad.statusCode).toBe(401);
  });

  it('stops assessors from manager actions', async () => {
    const { accessToken } = await login(ctx.app, ASSESSOR_JHB);
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/v1/inspections',
      headers: bearer(accessToken),
      payload: jobBody(ctx),
    });
    expect(create.statusCode).toBe(403);
    const usersRes = await ctx.app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: bearer(accessToken),
    });
    expect(usersRes.statusCode).toBe(403);
  });

  it('stops managers from assessor-only actions', async () => {
    const { accessToken } = await login(ctx.app, MANAGER);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/inspections/00000000-0000-4000-8000-000000000000/start',
      headers: bearer(accessToken),
      payload: { startedAt: new Date().toISOString(), location: { lat: 0, lng: 0 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets managers list assessors and register devices', async () => {
    const { accessToken } = await login(ctx.app, MANAGER);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/users?role=assessor',
      headers: bearer(accessToken),
    });
    expect(res.json().items).toHaveLength(2);
    const dev = await ctx.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(accessToken),
      payload: { expoPushToken: 'ExponentPushToken[abc123]', platform: 'android' },
    });
    expect(dev.statusCode).toBe(204);
  });

  it('serves health, templates and OpenAPI docs', async () => {
    const { accessToken } = await login(ctx.app, ASSESSOR_JHB);
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).json().status).toBe('ok');
    const t = await ctx.app.inject({
      method: 'GET',
      url: '/v1/templates',
      headers: bearer(accessToken),
    });
    expect(t.json().items.map((x: { type: string }) => x.type)).toEqual(['property', 'vehicle']);
    const docs = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(docs.json().paths['/v1/inspections/{id}/submission']).toBeDefined();
    const missing = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('reference images', () => {
  it('lists and serves cacheable SVG examples for guided shots', async () => {
    const list = await ctx.app.inject({ method: 'GET', url: '/v1/reference-images' });
    expect(list.json().items).toContain('vin_plate');
    for (const name of list.json().items as string[]) {
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/reference-images/${name}.svg` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.body.startsWith('<svg')).toBe(true);
    }
    const missing = await ctx.app.inject({ method: 'GET', url: '/v1/reference-images/nope.svg' });
    expect(missing.statusCode).toBe(404);
  });
});
