import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginDocumentNavigation,
  cancelDocumentNavigation,
  documentNavigationSnapshot,
  recordDocumentNavigation,
  resetDocumentNavigationHistory,
} from './documentNavigationHistory';

describe('document navigation history', () => {
  beforeEach(resetDocumentNavigationHistory);

  it('moves backward and forward through visited documents', () => {
    recordDocumentNavigation('/a.hvy');
    recordDocumentNavigation('/b.hvy');
    recordDocumentNavigation('/c.hvy');
    expect(beginDocumentNavigation('back')).toBe('/b.hvy');
    recordDocumentNavigation('/b.hvy');
    expect(beginDocumentNavigation('back')).toBe('/a.hvy');
    recordDocumentNavigation('/a.hvy');
    expect(beginDocumentNavigation('forward')).toBe('/b.hvy');
  });

  it('drops the forward branch after a new navigation', () => {
    recordDocumentNavigation('/a.hvy');
    recordDocumentNavigation('/b.hvy');
    expect(beginDocumentNavigation('back')).toBe('/a.hvy');
    recordDocumentNavigation('/a.hvy');
    recordDocumentNavigation('/c.hvy');
    expect(documentNavigationSnapshot()).toEqual({ entries: ['/a.hvy', '/c.hvy'], index: 1 });
  });

  it('can roll back a failed traversal', () => {
    recordDocumentNavigation('/a.hvy');
    recordDocumentNavigation('/b.hvy');
    expect(beginDocumentNavigation('back')).toBe('/a.hvy');
    cancelDocumentNavigation('back');
    expect(documentNavigationSnapshot().index).toBe(1);
  });
});
