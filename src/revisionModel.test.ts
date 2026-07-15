import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { defaultBlockSchema } from '../../heavy-file-format/src/document-factory';
import { fernetDecryptBytes, fernetEncryptBytes, generateFernetKey } from '../../heavy-file-format/src/encryption';
import type { VisualDocument } from '../../heavy-file-format/src/types';
import {
  addComponentAnnotation,
  changeRevisionDocument,
  createSavedVersion,
  createRevisionDocument,
  forkRevisionDocument,
  mergeRevisionDocuments,
  revisionAtSavedVersion,
  saveRevisionDocument,
  saveRevisionIncrement,
  updateRevisionSource,
  type RevisionAttachmentRef,
  type RevisionAuthor,
} from './revisionModel';

const alice: RevisionAuthor = { userId: 'user-alice', displayName: 'Alice', deviceId: 'alice-laptop' };
const bob: RevisionAuthor = { userId: 'user-bob', displayName: 'Bob', deviceId: 'bob-desktop' };

describe('revision model prototype', () => {
  it('keeps large attachment bytes outside Automerge history', () => {
    const attachment: RevisionAttachmentRef = {
      id: 'attachment-1',
      objectId: 'sha256:large-object',
      byteLength: 45 * 1024 * 1024,
      meta: { mediaType: 'application/octet-stream' },
    };
    const revision = createRevisionDocument(sampleDocument(), alice, [attachment]);

    expect(saveRevisionDocument(revision).byteLength).toBeLessThan(32 * 1024);
    expect(revision.attachments['attachment-1'].byteLength).toBe(45 * 1024 * 1024);
  });

  it('records small authored increments instead of whole-document snapshots', () => {
    let revision = createRevisionDocument(sampleDocument(), alice, []);
    saveRevisionIncrement(revision);
    let incrementalBytes = 0;
    for (let index = 0; index < 100; index += 1) {
      revision = changeRevisionDocument(revision, alice, 'edit-component-text', (draft) => {
        Automerge.splice(draft, ['sections', 0, 'components', 0, 'text'], draft.sections[0].components[0].text.length, 0, '!');
      });
      incrementalBytes += saveRevisionIncrement(revision).byteLength;
    }

    expect(incrementalBytes).toBeLessThan(128 * 1024);
    expect(revision.sections[0].components[0].text.endsWith('!'.repeat(100))).toBe(true);
  });

  it('merges independent user changes without exposing branches', () => {
    const base = createRevisionDocument(sampleDocument(), alice, []);
    const aliceRevision = changeRevisionDocument(forkRevisionDocument(base, alice), alice, 'rename-section', (draft) => {
      draft.sections[0].title = 'Alice title';
    });
    const bobRevision = changeRevisionDocument(forkRevisionDocument(base, bob), bob, 'edit-component-text', (draft) => {
      draft.sections[0].components[0].text = 'Bob text';
    });

    const merged = mergeRevisionDocuments(aliceRevision, bobRevision);

    expect(merged.sections[0].title).toBe('Alice title');
    expect(merged.sections[0].components[0].text).toBe('Bob text');
    expect(merged.authors['bob-desktop'].userId).toBe('user-bob');
    expect(Automerge.getHeads(merged)).toHaveLength(2);
  });

  it('stores component-defined annotation metadata with user attribution', () => {
    const revision = addComponentAnnotation(
      createRevisionDocument(sampleDocument(), alice, []),
      alice,
      'section-1',
      'block-1',
      {
        id: 'annotation-1',
        type: 'review-note',
        createdAt: '2026-07-14T00:00:00.000Z',
        metadata: { severity: 'question', componentOwnedValue: { line: 3 } },
      },
    );

    expect(revision.sections[0].components[0].annotations['annotation-1']).toMatchObject({
      userId: 'user-alice',
      displayName: 'Alice',
      type: 'review-note',
      metadata: { severity: 'question', componentOwnedValue: { line: 3 } },
    });
  });

  it('encrypts immutable increments independently without rewriting earlier history', async () => {
    const key = generateFernetKey();
    let revision = createRevisionDocument(sampleDocument(), alice, []);
    const initialIncrement = saveRevisionIncrement(revision);
    const encryptedInitial = await fernetEncryptBytes(initialIncrement, key);
    revision = changeRevisionDocument(revision, alice, 'edit-component-text', (draft) => {
      Automerge.splice(draft, ['sections', 0, 'components', 0, 'text'], 0, 0, 'Small edit. ');
    });
    const nextIncrement = saveRevisionIncrement(revision);
    const encryptedNext = await fernetEncryptBytes(nextIncrement, key);

    expect(await fernetDecryptBytes(encryptedInitial, key)).toEqual(initialIncrement);
    expect(await fernetDecryptBytes(encryptedNext, key)).toEqual(nextIncrement);
    expect(encryptedNext.byteLength).toBeLessThan(4 * 1024);
    expect(encryptedInitial).not.toEqual(encryptedNext);
  });

  it('does not leak decrypted encrypted-component runtime state into the root history', () => {
    const document = sampleDocument();
    document.sections[0].blocks[0].schema = {
      ...defaultBlockSchema('encrypted'),
      kind: 'encrypted',
      keyId: 'component-key',
      encryptedAttachmentId: 'encrypted:component-key',
      encryptedBlock: {
        id: 'secret-block',
        text: 'plaintext secret',
        schema: defaultBlockSchema('text'),
        schemaMode: false,
      },
      encryptedDirty: false,
      encryptedError: '',
    };

    const revision = createRevisionDocument(document, alice, []);
    const schema = revision.sections[0].components[0].schema;

    expect(schema.encryptedAttachmentId).toBe('encrypted:component-key');
    expect(schema).not.toHaveProperty('encryptedBlock');
    expect(new TextDecoder().decode(saveRevisionDocument(revision))).not.toContain('plaintext secret');
  });

  it('materializes exact source from an earlier successful-save head', () => {
    let revision = createRevisionDocument(sampleDocument(), alice, [], 'version one');
    const firstSave = createSavedVersion(revision, '/documents/example.hvy', alice, '2026-07-14T01:00:00.000Z');
    revision = updateRevisionSource(revision, alice, 'version two with a small edit');
    const secondSave = createSavedVersion(revision, '/documents/example.hvy', alice, '2026-07-14T02:00:00.000Z');

    expect(revisionAtSavedVersion(revision, firstSave).serializedSource).toBe('version one');
    expect(revisionAtSavedVersion(revision, secondSave).serializedSource).toBe('version two with a small edit');
    expect(firstSave.id).not.toBe(secondSave.id);
  });
});

function sampleDocument(): VisualDocument {
  return {
    extension: '.hvy',
    meta: { title: 'Revision prototype' },
    attachments: [],
    sections: [{
      key: 'section-1',
      customId: 'section-1',
      contained: false,
      editorOnly: false,
      lock: false,
      idEditorOpen: false,
      isGhost: false,
      title: 'Section',
      level: 1,
      expanded: true,
      highlight: false,
      css: '',
      tags: '',
      description: '',
      location: 'main',
      blocks: [{
        id: 'block-1',
        text: 'Initial text',
        schema: { ...defaultBlockSchema('text'), id: 'block-1' },
        schemaMode: false,
      }],
      children: [],
    }],
  };
}
