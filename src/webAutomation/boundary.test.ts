import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMockFlow } from '../test/webAutomation/flow';
import { ATS_ORIGIN, listingCollection } from '../test/webAutomation/sites';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** Names of functions or methods that carry a `// UI:` comment directly above them. */
function uiAnnotated(text: string): string[] {
  return [...text.matchAll(/\/\/ UI:[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*[(<]/g)].map((match) => match[1]);
}

describe('UI boundary', () => {
  const entryPoints = [...uiAnnotated(source('./entryPoints.ts')), ...uiAnnotated(source('./documentAutomation.ts'))];
  const flowSource = source('../test/webAutomation/flow.ts');
  const scenarioSource = source('./scenarios.test.ts');

  it('finds the annotated entry points', () => {
    expect(entryPoints).toEqual(expect.arrayContaining(['getState', 'beginSignIn', 'startCollection', 'enqueue', 'resumeQueue', 'openDocumentAutomation', 'close']));
  });

  it('every UI entry point is driven by the mock flow or a scenario', () => {
    const called = new Set([...`${flowSource}\n${scenarioSource}`.matchAll(/(?:(?:automation|runtime|opened)\.|\b(?=openDocumentAutomation))(\w+)\(/g)].map((match) => match[1]));
    expect(entryPoints.filter((name) => !called.has(name))).toEqual([]);
  });

  it('every UI-annotated flow step is used by a scenario', () => {
    const steps = uiAnnotated(flowSource);
    const used = new Set([...scenarioSource.matchAll(/flow!?\.(\w+)\(/g)].map((match) => match[1]));
    expect(steps.filter((name) => !used.has(name))).toEqual([]);
  });

  it('published state is plain data a renderer can take as a literal', async () => {
    const flow = createMockFlow();
    const boards = listingCollection([`${ATS_ORIGIN}/initech/jobs`]);
    flow.bindProfiles(boards);
    flow.approve();
    await flow.signIn();
    await flow.completeLogin();
    await flow.collect(boards);
    await flow.evaluate([], { settle: false });
    const state = flow.automation.getState();
    expect(state.runs[0].status).toBe('needs-attention');
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(structuredClone(state)).toEqual(state);
  });
});
