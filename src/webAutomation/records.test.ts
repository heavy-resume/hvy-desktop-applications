import { describe, expect, it } from 'vitest';
import { findJsonLdEntities, htmlToText, normalizeJsonLdEntity } from './jsonLd';
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

  it('validates only the values a collection requires', () => {
    expect(validateRecord({ title: 'x' })).toBeNull();
    expect(validateRecord({ title: 'x' }, [{ field: 'body' }])).toBe('"body" is missing.');
    expect(validateRecord({ body: 'short' }, [{ field: 'body', minLength: 10 }])).toBe('"body" is shorter than 10 characters.');
    expect(validateRecord({ body: 'long enough text' }, [{ field: 'body', minLength: 10 }])).toBeNull();
  });
});

describe('JSON-LD entities', () => {
  const page = [{ '@graph': [
    { '@type': 'WebPage', name: 'Page' },
    { '@type': ['JobPosting'], title: 'Engineer', hiringOrganization: 'Acme', identifier: { value: 'R-1' }, description: 'Hi &amp; welcome' },
    { '@type': 'Event', name: 'Launch', startDate: '2026-10-01', location: { '@type': 'Place', name: 'Hall A' }, organizer: { name: 'Acme' } },
  ] }, 'junk', null];

  it('finds entities of the requested type in arrays and @graph', () => {
    expect(findJsonLdEntities(page, 'JobPosting')).toHaveLength(1);
    expect(findJsonLdEntities(page, 'Event')).toHaveLength(1);
    expect(findJsonLdEntities(page, 'Product')).toEqual([]);
  });

  it('uses a registered normalizer when there is one, and flattens other types', () => {
    expect(normalizeJsonLdEntity('JobPosting', findJsonLdEntities(page, 'JobPosting')[0]))
      .toEqual({ title: 'Engineer', company: 'Acme', identifier: 'R-1', description: 'Hi & welcome' });
    expect(normalizeJsonLdEntity('Event', findJsonLdEntities(page, 'Event')[0]))
      .toEqual({ name: 'Launch', startDate: '2026-10-01', location: 'Hall A', organizer: 'Acme' });
  });

  it('turns HTML into readable text', () => {
    expect(htmlToText('<p>One&nbsp;two</p><ul><li>Three</li><li>Four &#8211; five</li></ul><br/>Six'))
      .toBe('One two\nThree\nFour – five\n\nSix');
  });
});
