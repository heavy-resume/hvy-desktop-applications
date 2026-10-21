import { describe, expect, it } from 'vitest';
import { canonicalUrl, recordKey, validateRecord } from './records';

describe('record keys', () => {
  it('canonicalizes URLs, ignoring tracking parameters by default and others on request', () => {
    expect(canonicalUrl('https://Boards.Example.test/acme/items/1/?utm_source=x&ref=a&b=2&a=1#apply'))
      .toBe('https://boards.example.test/acme/items/1?a=1&b=2&ref=a');
    expect(canonicalUrl('https://example.test/items/1?ref=a&session=9', ['ref', 'session'])).toBe('https://example.test/items/1');
  });

  it('derives keys from the URL, one field, or several fields', () => {
    const url = 'https://example.test/items/1?utm_medium=mail';
    expect(recordKey({ kind: 'url' }, url, {})).toBe('https://example.test/items/1');
    expect(recordKey({ kind: 'field', field: 'identifier' }, url, { identifier: ' R-1 ' })).toBe('R-1');
    expect(recordKey({ kind: 'fields', fields: ['company', 'title'] }, url, { company: 'Acme', title: 'Engineer' })).toBe('Acme\u001fEngineer');
    expect(recordKey({ kind: 'field', field: 'identifier' }, url, {})).toBeNull();
  });

  it('validates only the fields a collection requires, naming them by their labels', () => {
    const body = { id: 'body', label: 'Body', kind: 'long-text' as const };
    expect(validateRecord({ title: 'x' })).toBeNull();
    expect(validateRecord({ title: 'x' }, [body])).toBeNull();
    expect(validateRecord({ title: 'x' }, [{ ...body, required: true }])).toBe('"Body" is missing.');
    expect(validateRecord({ body: 'short' }, [{ ...body, required: true, minLength: 10 }])).toBe('"Body" is shorter than 10 characters.');
    expect(validateRecord({ body: 'long enough text' }, [{ ...body, required: true, minLength: 10 }])).toBeNull();
  });
});
