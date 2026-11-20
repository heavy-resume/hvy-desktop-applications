// The file picker, through the reference implementation's scripting: a document's load script registers a handler,
// and a file the user picks reaches it as text, its database writes kept. The button itself is the browser's file
// chooser; what it hands on is what deliverPickedFile is given here.
import { describe, expect, it } from 'vitest';
import { executeHvyCliCommand, createHvyCliSession, executeHvyCliCommandSync, writeHvyVirtualFileSync } from '../../../heavy-file-format/src/cli-core';
import { createScriptingDbRuntime } from '../../../heavy-file-format/src/plugins/db-table';
import { registerHostPlugin } from '../../../heavy-file-format/src/plugins/registry';
import { deserializeDocument } from '../../../heavy-file-format/src/serialization';
import type { VisualDocument } from '../../../heavy-file-format/src/types';
import { createDocumentState, openDocumentHost } from '../test/webAutomation/documentHost';
import { declareScriptingPlugins, insertPluginBlock } from '../test/webAutomation/listingDocument';
import { DEFAULT_FILE_PICKER_MAX_BYTES, deliverFiles, deliverPickedFile, FILE_PICKER_PLUGIN_ID, filePickerPlugin, readFilePickerConfig, readPickedFile } from './filePicker';

const LOAD_SCRIPT = [
  'def imported(file):',
  '    lines = file["text"].split("\\n")',
  '    doc.db.execute("INSERT INTO imported (name, size, media_type, lines, first) VALUES (?, ?, ?, ?, ?)", [file["name"], file["size"], file["mediaType"], len(lines), lines[0]])',
  '',
  'doc.plugins.call("galaxy.file-picker", "on_file", {"pickerId": "history", "handler": imported})',
].join('\n');

async function documentWithPicker(): Promise<VisualDocument> {
  const document = deserializeDocument('---\nhvy_version: 0.1\ntitle: Import\n---\n', '.hvy');
  const database = await createScriptingDbRuntime(document);
  database.api.execute('CREATE TABLE imported (name TEXT, size INTEGER, media_type TEXT, lines INTEGER, first TEXT)');
  database.dispose();
  declareScriptingPlugins(document, [FILE_PICKER_PLUGIN_ID]);
  executeHvyCliCommandSync(document, 'hvy insert -1 section /body main Main');
  insertPluginBlock(document, '/body/main', 'history-picker', FILE_PICKER_PLUGIN_ID, { pickerId: 'history', label: 'Import History', accept: ['.csv'] });
  executeHvyCliCommandSync(document, 'hvy insert -1 plugin /body/main load hvy.scripting');
  writeHvyVirtualFileSync(document, '/body/main/load/script.py', LOAD_SCRIPT);
  return document;
}

async function rows(document: VisualDocument, sql: string): Promise<Array<Record<string, unknown>>> {
  const { api, dispose } = await createScriptingDbRuntime(document);
  try {
    return api.query(sql, []).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !/^\d+$/.test(key))));
  } finally {
    dispose();
  }
}

describe('file picker', () => {
  it('hands a picked file, as text, to the handler the document\'s script registered, and keeps what it writes', async () => {
    registerHostPlugin(filePickerPlugin);
    const document = await documentWithPicker();
    const host = openDocumentHost(document, { stateRuntime: createDocumentState(document, { getAcceptance: () => true, onAcceptanceChanged: () => undefined }) });
    await host.idle();

    const text = 'date,symbol,score\n2026-11-17,AAA,82.56\n2026-11-17,BBB,66.25';
    expect(deliverPickedFile(document, 'history', { name: 'history.csv', size: text.length, mediaType: 'text/csv', text })).toBe(true);
    await host.idle();
    expect(await rows(document, 'SELECT * FROM imported')).toEqual([{ name: 'history.csv', size: text.length, media_type: 'text/csv', lines: 3, first: 'date,symbol,score' }]);

    // A picker no script registered for says so, rather than dropping the file quietly.
    expect(deliverPickedFile(document, 'other', { name: 'x.csv', size: 1, mediaType: 'text/csv', text: 'x' })).toBe(false);

    // Several files at once: each handed over in turn.
    const several = readFilePickerConfig({ pickerId: 'history', multiple: true });
    const read = await deliverFiles(document, several, [new File(['a\nb'], 'one.csv', { type: 'text/csv' }), new File(['c'], 'two.csv', { type: 'text/csv' })]);
    expect(read?.map((file) => file.name)).toEqual(['one.csv', 'two.csv']);
    await host.idle();
    expect((await rows(document, 'SELECT name, lines FROM imported ORDER BY rowid')).slice(1)).toEqual([{ name: 'one.csv', lines: 2 }, { name: 'two.csv', lines: 1 }]);
  });

  it('reads its settings with defaults, refuses a file over its limit, and lint asks for its id', async () => {
    expect(readFilePickerConfig({})).toEqual({ pickerId: '', label: 'Choose File', accept: [], maxBytes: DEFAULT_FILE_PICKER_MAX_BYTES, multiple: false });
    expect(readFilePickerConfig({ pickerId: ' history ', label: 'Import', accept: '.csv, text/csv', maxBytes: 10, multiple: true })).toEqual({ pickerId: 'history', label: 'Import', accept: ['.csv', 'text/csv'], maxBytes: 10, multiple: true });
    const config = readFilePickerConfig({ pickerId: 'history', maxBytes: 4 });
    await expect(readPickedFile(new File(['too long'], 'big.csv', { type: 'text/csv' }), config)).rejects.toThrow('big.csv is 8 bytes; the most this reads is 4 bytes.');
    expect(await readPickedFile(new File(['a,b'], 'ok.csv', { type: 'text/csv' }), config)).toEqual({ name: 'ok.csv', size: 3, mediaType: 'text/csv', text: 'a,b' });

    const document = deserializeDocument('---\nhvy_version: 0.1\ntitle: Import\n---\n', '.hvy');
    executeHvyCliCommandSync(document, 'hvy insert -1 section /body main Main');
    insertPluginBlock(document, '/body/main', 'picker', FILE_PICKER_PLUGIN_ID, {});
    expect((await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint')).output).toContain('A file picker needs a pickerId');
  });
});
