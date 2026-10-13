import { describe, expect, it } from 'vitest';
import { idempotencyKey, readJsonPointer, resolveEndpointRequest, type ApiEndpointDefinition } from './endpoints';

const report: ApiEndpointDefinition = {
  id: 'get-report',
  name: 'Get report',
  description: '',
  method: 'GET',
  path: '/api/reports/{id}',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
};

const create: ApiEndpointDefinition = {
  id: 'create',
  name: 'Create',
  description: '',
  method: 'POST',
  path: '/api/reports',
  inputSchema: { type: 'object', properties: { url: { type: 'string' }, description: { type: 'string' } } },
  idempotency: { header: 'Idempotency-Key', fromInputs: ['url'] },
};

describe('endpoint requests', () => {
  it('locks requests to the page origin and encodes path parameters', () => {
    expect(resolveEndpointRequest('https://app.example.test/home', report, { id: 'a/b?c' })).toEqual({
      url: 'https://app.example.test/api/reports/a%2Fb%3Fc',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    expect(() => resolveEndpointRequest('https://app.example.test', { ...report, path: '//evil.test/x' }, { id: '1' })).toThrow(/same-origin/);
    expect(() => resolveEndpointRequest('https://app.example.test', { ...report, path: 'https://evil.test/x' }, { id: '1' })).toThrow(/same-origin/);
  });

  it('accepts only declared inputs and sends a JSON body for writes', () => {
    expect(() => resolveEndpointRequest('https://app.example.test', report, { id: '1', extra: true })).toThrow(/does not accept: extra/);
    expect(() => resolveEndpointRequest('https://app.example.test', report, {})).toThrow(/needs "id"/);
    const request = resolveEndpointRequest('https://app.example.test', create, { url: 'https://jobs.test/1', description: 'Build things.' });
    expect(request.headers).toMatchObject({ Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(JSON.parse(request.body!)).toEqual({ url: 'https://jobs.test/1', description: 'Build things.' });
  });

  it('derives a stable idempotency key from the declared inputs only', () => {
    const first = idempotencyKey(create, { url: 'https://jobs.test/1', description: 'v1' });
    expect(first).toBe(idempotencyKey(create, { url: 'https://jobs.test/1', description: 'v2' }));
    expect(first).not.toBe(idempotencyKey(create, { url: 'https://jobs.test/2', description: 'v1' }));
    expect(resolveEndpointRequest('https://app.example.test', create, { url: 'https://jobs.test/1' }).headers['Idempotency-Key']).toBe(first);
  });

  it('reads JSON pointers', () => {
    expect(readJsonPointer({ user: { name: 'Pat', 'a/b': 1 } }, '/user/name')).toBe('Pat');
    expect(readJsonPointer({ user: { 'a/b': 1 } }, '/user/a~1b')).toBe(1);
    expect(readJsonPointer({ user: null }, '/user/name')).toBeUndefined();
  });
});
