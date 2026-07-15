import * as Automerge from '@automerge/automerge';
import type { VisualDocument } from '../../heavy-file-format/src/types';
import type { JsonObject } from '../../heavy-file-format/src/hvy/types';

export interface RevisionAuthor {
  userId: string;
  displayName: string;
  deviceId: string;
}

export interface RevisionAnnotation {
  id: string;
  type: string;
  userId: string;
  displayName: string;
  createdAt: string;
  metadata: JsonObject;
}

export interface RevisionAttachmentRef {
  id: string;
  objectId: string;
  byteLength: number;
  meta: JsonObject;
}

export interface RevisionComponent {
  id: string;
  text: string;
  schema: JsonObject;
  annotations: Record<string, RevisionAnnotation>;
}

export interface RevisionSection {
  id: string;
  title: string;
  metadata: JsonObject;
  components: RevisionComponent[];
  children: RevisionSection[];
}

export interface RevisionDocument {
  [key: string]: unknown;
  formatVersion: 1;
  extension: VisualDocument['extension'];
  metadata: JsonObject;
  serializedSource: string;
  sections: RevisionSection[];
  attachments: Record<string, RevisionAttachmentRef>;
  authors: Record<string, RevisionAuthor>;
}

export type RevisionDoc = Automerge.Doc<RevisionDocument>;

export interface RevisionChangeMetadata {
  userId: string;
  displayName: string;
  deviceId: string;
  action: string;
}

export interface SavedVersion {
  id: string;
  documentPath: string;
  createdAt: string;
  heads: string[];
  userId: string;
  displayName: string;
}

export function createRevisionDocument(
  document: VisualDocument,
  author: RevisionAuthor,
  attachmentRefs: RevisionAttachmentRef[],
  serializedSource = '',
): RevisionDoc {
  const initial: RevisionDocument = {
    formatVersion: 1,
    extension: document.extension,
    metadata: cloneJsonObject(document.meta),
    serializedSource,
    sections: document.sections.map(projectSection),
    attachments: Object.fromEntries(attachmentRefs.map((attachment) => [attachment.id, cloneValue(attachment)])),
    authors: { [author.deviceId]: cloneValue(author) },
  };
  return Automerge.from(initial, { actor: actorIdForDevice(author.deviceId) });
}

export function updateRevisionSource(
  document: RevisionDoc,
  author: RevisionAuthor,
  serializedSource: string,
): RevisionDoc {
  if (document.serializedSource === serializedSource) return document;
  return changeRevisionDocument(document, author, 'update-serialized-source', (draft) => {
    Automerge.updateText(draft, ['serializedSource'], serializedSource);
  });
}

export function updateRevisionSnapshot(
  document: RevisionDoc,
  author: RevisionAuthor,
  serializedSource: string,
  attachmentRefs: RevisionAttachmentRef[],
): RevisionDoc {
  const nextAttachments = Object.fromEntries(attachmentRefs.map((attachment) => [attachment.id, attachment]));
  return changeRevisionDocument(document, author, 'update-saved-document', (draft) => {
    if (draft.serializedSource !== serializedSource) {
      Automerge.updateText(draft, ['serializedSource'], serializedSource);
    }
    for (const id of Object.keys(draft.attachments)) {
      if (!nextAttachments[id]) delete draft.attachments[id];
    }
    for (const [id, attachment] of Object.entries(nextAttachments)) {
      const current = draft.attachments[id];
      if (!current || current.objectId !== attachment.objectId || current.byteLength !== attachment.byteLength) {
        draft.attachments[id] = cloneValue(attachment);
      }
    }
  });
}

export function createSavedVersion(
  document: RevisionDoc,
  documentPath: string,
  author: RevisionAuthor,
  createdAt = new Date().toISOString(),
): SavedVersion {
  const heads = Automerge.getHeads(document);
  return {
    id: heads.join(':'),
    documentPath,
    createdAt,
    heads,
    userId: author.userId,
    displayName: author.displayName,
  };
}

export function revisionAtSavedVersion(document: RevisionDoc, version: SavedVersion): RevisionDoc {
  return Automerge.view(document, version.heads);
}

export function forkRevisionDocument(document: RevisionDoc, author: RevisionAuthor): RevisionDoc {
  let fork = Automerge.clone(document, { actor: actorIdForDevice(author.deviceId) });
  if (!fork.authors[author.deviceId]) {
    fork = changeRevisionDocument(fork, author, 'register-author', (draft) => {
      draft.authors[author.deviceId] = cloneValue(author);
    });
  }
  return fork;
}

export function changeRevisionDocument(
  document: RevisionDoc,
  author: RevisionAuthor,
  action: string,
  callback: Automerge.ChangeFn<RevisionDocument>,
): RevisionDoc {
  const metadata: RevisionChangeMetadata = { ...author, action };
  return Automerge.change(document, {
    message: JSON.stringify(metadata),
    time: Math.floor(Date.now() / 1000),
  }, callback);
}

export function addComponentAnnotation(
  document: RevisionDoc,
  author: RevisionAuthor,
  sectionId: string,
  componentId: string,
  annotation: Omit<RevisionAnnotation, 'userId' | 'displayName'>,
): RevisionDoc {
  return changeRevisionDocument(document, author, `annotate:${annotation.type}`, (draft) => {
    const component = findComponent(draft.sections, sectionId, componentId);
    component.annotations[annotation.id] = {
      ...cloneValue(annotation),
      userId: author.userId,
      displayName: author.displayName,
    };
  });
}

export function mergeRevisionDocuments(local: RevisionDoc, remote: RevisionDoc): RevisionDoc {
  return Automerge.merge(local, remote);
}

export function saveRevisionIncrement(document: RevisionDoc): Uint8Array {
  return Automerge.saveIncremental(document);
}

export function saveRevisionDocument(document: RevisionDoc): Uint8Array {
  return Automerge.save(document);
}

function projectSection(section: VisualDocument['sections'][number]): RevisionSection {
  return {
    id: section.customId,
    title: section.title,
    metadata: cloneJsonObject(Object.fromEntries(
      Object.entries(section).filter(([key]) => !['blocks', 'children', 'title', 'customId'].includes(key)),
    )),
    components: section.blocks.map((block) => ({
      id: block.id,
      text: block.text,
      schema: projectComponentSchema(block.schema as unknown as JsonObject),
      annotations: {},
    })),
    children: section.children.map(projectSection),
  };
}

function projectComponentSchema(schema: JsonObject): JsonObject {
  const projected = cloneJsonObject(schema);
  if (projected.kind === 'encrypted') {
    delete projected.encryptedBlock;
    delete projected.encryptedDirty;
    delete projected.encryptedError;
  }
  return projected;
}

function findComponent(
  sections: RevisionSection[],
  sectionId: string,
  componentId: string,
): RevisionComponent {
  const component = findComponentOrNull(sections, sectionId, componentId);
  if (component) return component;
  throw new Error(`Component ${componentId} was not found in section ${sectionId}.`);
}

function findComponentOrNull(
  sections: RevisionSection[],
  sectionId: string,
  componentId: string,
): RevisionComponent | null {
  for (const section of sections) {
    if (section.id === sectionId) {
      const component = section.components.find((candidate) => candidate.id === componentId);
      if (component) return component;
    }
    const nested = findComponentOrNull(section.children, sectionId, componentId);
    if (nested) return nested;
  }
  return null;
}

function actorIdForDevice(deviceId: string): string {
  const bytes = new TextEncoder().encode(deviceId);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') || '00';
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneValue(value);
}

function cloneValue<T>(value: T): T {
  if (value instanceof Uint8Array) return Uint8Array.from(value) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined && typeof entry !== 'function')
        .map(([key, entry]) => [key, cloneValue(entry)]),
    ) as T;
  }
  return value;
}
