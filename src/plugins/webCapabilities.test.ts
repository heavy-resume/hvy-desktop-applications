import { describe, expect, test, vi } from 'vitest';
import {
  claimRenderedRecordActionButton,
  claimRenderedRecordTemplate,
  applyWebRecordCommandChange,
  emptyRecordTemplateReason,
  webRecordContentIdentity,
} from './webCapabilities';
import { getWebRecordResults, setWebRecordResults } from '../webRecordResults';
import { queueWebCapabilityScriptOperation } from './webCapabilityScripting';
import type { VisualBlock } from '../../../heavy-file-format/src/editor/types';

test('record template actions are claimed from the built-in viewer dispatcher', () => {
  const actionRoot = { dataset: { visibleState: 'pending' }, removeAttribute: vi.fn() };
  const actionButton = {
    closest: vi.fn(() => actionRoot),
    removeAttribute: vi.fn(),
  } as unknown as HTMLButtonElement;

  claimRenderedRecordActionButton(actionButton);

  expect(actionButton.removeAttribute).toHaveBeenCalledWith('data-action');
  expect(actionButton.closest).toHaveBeenCalledWith('[data-hvy-button="true"]');
  expect(actionRoot.removeAttribute).toHaveBeenCalledWith('data-hvy-button');
  expect(actionRoot.dataset.visibleState).toBe('visible');
});

test('record templates are claimed from document block visibility evaluation', () => {
  const renderedBlock = {
    dataset: { visibleState: 'pending' },
    removeAttribute: vi.fn(),
  };
  const template = {
    querySelectorAll: vi.fn(() => [renderedBlock]),
  } as unknown as HTMLElement;

  claimRenderedRecordTemplate(template);

  expect(template.querySelectorAll).toHaveBeenCalledWith('[data-hvy-dynamic-visibility="true"]');
  expect(renderedBlock.removeAttribute).toHaveBeenCalledWith('data-hvy-dynamic-visibility');
  expect(renderedBlock.dataset.visibleState).toBe('visible');
});

test.each([
  [{ editorOnly: true, hideIfYes: '' }, 'the selected record template is marked Editor only'],
  [{ editorOnly: false, hideIfYes: 'yes' }, 'the selected record template is hidden by its Hide if yes condition'],
  [{ editorOnly: false, hideIfYes: '' }, 'the selected record template produced no visible content'],
])('explains an empty rendered record template', (schema, expected) => {
  expect(emptyRecordTemplateReason({ schema } as unknown as VisualBlock)).toBe(expected);
});

test('applies watched record changes and removals to cached results', () => {
  const document = {};
  setWebRecordResults(document, 'messages', [
    { parent: '#first', targets: [{ label: 'Status', value: 'Unread' }] },
    { parent: '#second', targets: [{ label: 'Status', value: 'Unread' }] },
  ]);

  applyWebRecordCommandChange(document, 'messages', '#second', 'changed', {
    parent: '#second', targets: [{ label: 'Status', value: 'Read' }],
  });
  expect(getWebRecordResults(document, 'messages')).toEqual([
    { parent: '#first', targets: [{ label: 'Status', value: 'Unread' }] },
    { parent: '#second', targets: [{ label: 'Status', value: 'Read' }] },
  ]);

  applyWebRecordCommandChange(document, 'messages', '#first', 'removed', undefined);
  expect(getWebRecordResults(document, 'messages')).toEqual([
    { parent: '#second', targets: [{ label: 'Status', value: 'Read' }] },
  ]);
});

test('builds record identity from extracted field labels and values', () => {
  expect(webRecordContentIdentity({
    parent: '#message-2',
    targets: [{ label: 'Subject', value: 'Hello' }, { label: 'Unread', value: true }],
  })).toBe('[["Subject","Hello"],["Unread",true]]');
});

describe('web capability scripting callbacks', () => {
  test('returns synchronously and invokes on_complete after queued work settles', async () => {
    let resolveOperation!: (value: unknown) => void;
    const operation = new Promise((resolve) => {
      resolveOperation = resolve;
    });
    const onComplete = vi.fn();

    const queued = queueWebCapabilityScriptOperation(
      () => operation,
      { onComplete, onError: null },
    );

    expect(queued).toMatchObject({ status: 'queued' });
    expect(queued.jobId).toEqual(expect.any(String));
    expect(onComplete).not.toHaveBeenCalled();

    resolveOperation({ records: [{ values: { Subject: 'Hello' } }] });
    await operation;
    await Promise.resolve();

    expect(onComplete).toHaveBeenCalledWith({
      jobId: queued.jobId,
      status: 'completed',
      result: { records: [{ values: { Subject: 'Hello' } }] },
    });
  });

  test('invokes on_error for a failed queued operation', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const operation = Promise.reject(new Error('Page unavailable'));

    const queued = queueWebCapabilityScriptOperation(
      () => operation,
      { onComplete, onError },
    );

    await operation.catch(() => undefined);
    await Promise.resolve();

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({
      jobId: queued.jobId,
      status: 'failed',
      error: 'Page unavailable',
    });
  });

  test('reports failure through on_complete when no error callback is supplied', async () => {
    const onComplete = vi.fn();
    const operation = Promise.reject(new Error('No matching control'));

    const queued = queueWebCapabilityScriptOperation(
      () => operation,
      { onComplete, onError: null },
    );

    await operation.catch(() => undefined);
    await Promise.resolve();

    expect(onComplete).toHaveBeenCalledWith({
      jobId: queued.jobId,
      status: 'failed',
      error: 'No matching control',
    });
  });
});
