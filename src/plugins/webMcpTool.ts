import type { JsonObject } from '../../../heavy-file-format/src/hvy/types';
import type { HvyPlugin, HvyPluginContext, HvyPluginInstance } from '../../../heavy-file-format/src/plugins/types';
import { state } from '../state';
import { WEB_MCP_TOOL_PLUGIN_ID, readWebMcpToolCapabilityConfig, webMcpDescriptorHash, type WebMcpToolCapabilityConfig } from '../integrationWebMcp';
import { assertLiveWebMcpDescriptor, invokeIntegrationWebMcpTool } from '../integrationWebMcpRuntime';
import { queueWebCapabilityScriptOperation } from './webCapabilityScripting';
import './webCapabilities.css';

const documentExecutions = new WeakMap<object, Set<AbortController>>();
const documentMounts = new WeakMap<object, number>();
let activeDocument: object | null = null;

function abortDocumentExecutions(document: object): void {
  for (const controller of documentExecutions.get(document) ?? []) controller.abort(new Error('The HVY document was unloaded.'));
  documentExecutions.delete(document);
}

function trackDocumentExecution<T>(document: object, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const controllers = documentExecutions.get(document) ?? new Set<AbortController>();
  controllers.add(controller);
  documentExecutions.set(document, controllers);
  return operation(controller.signal).finally(() => {
    controllers.delete(controller);
    if (!controllers.size) documentExecutions.delete(document);
  });
}

function approvalFor(config: WebMcpToolCapabilityConfig) {
  const approval = state.appSettings.integrationWebMcpApprovals[config.capabilityId];
  if (!approval?.scriptingEnabled || approval.descriptorHash !== webMcpDescriptorHash(config.tool)) {
    throw new Error('This WebMCP tool must be reviewed in Integrations before it can run.');
  }
  return approval;
}

function execution(config: WebMcpToolCapabilityConfig, args: Record<string, unknown>, foreground = false, signal?: AbortSignal): Promise<unknown> {
  const approval = approvalFor(config);
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === approval.integrationId);
  const page = integration?.pages.find((candidate) => candidate.id === approval.pageId);
  const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === approval.profileId);
  if (!page || !profile) return Promise.reject(new Error('The approved WebMCP page or browser profile is unavailable.'));
  return invokeIntegrationWebMcpTool(approval, page, profile, args, foreground, signal).then((value) => assertLiveWebMcpDescriptor(approval, value));
}

function inputValue(input: HTMLInputElement | HTMLTextAreaElement, schema: Record<string, unknown>): unknown {
  if (schema.type === 'boolean' && input instanceof HTMLInputElement) return input.checked;
  if (schema.type === 'number' || schema.type === 'integer') return Number(input.value);
  if (schema.type === 'object' || schema.type === 'array') return JSON.parse(input.value || (schema.type === 'array' ? '[]' : '{}'));
  return input.value;
}

function schemaFields(config: WebMcpToolCapabilityConfig): { element: HTMLElement; values(): Record<string, unknown> } {
  const wrapper = document.createElement('div');
  wrapper.className = 'hvy-web-definition';
  const properties = config.tool.inputSchema.properties && typeof config.tool.inputSchema.properties === 'object'
    ? config.tool.inputSchema.properties as Record<string, Record<string, unknown>>
    : {};
  const required = new Set(Array.isArray(config.tool.inputSchema.required) ? config.tool.inputSchema.required : []);
  const controls = new Map<string, { input: HTMLInputElement | HTMLTextAreaElement; schema: Record<string, unknown> }>();
  for (const [name, schema] of Object.entries(properties)) {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = typeof schema.title === 'string' ? schema.title : name;
    const complex = schema.type === 'object' || schema.type === 'array';
    const input = complex ? document.createElement('textarea') : document.createElement('input');
    input.className = 'hvy-galaxy-input';
    input.required = required.has(name);
    if (input instanceof HTMLInputElement) {
      if (schema.type === 'boolean') input.type = 'checkbox';
      else if (schema.type === 'number' || schema.type === 'integer') input.type = 'number';
      else input.type = 'text';
    } else {
      input.rows = 4;
      input.value = schema.type === 'array' ? '[]' : '{}';
    }
    if (typeof schema.description === 'string') input.title = schema.description;
    controls.set(name, { input, schema });
    label.append(title, input);
    wrapper.appendChild(label);
  }
  return {
    element: wrapper,
    values: () => Object.fromEntries([...controls].map(([name, value]) => [name, inputValue(value.input, value.schema)])),
  };
}

function editor(ctx: HvyPluginContext): HTMLElement {
  const label = document.createElement('label');
  label.className = 'hvy-web-definition';
  const title = document.createElement('span');
  title.textContent = 'Approved WebMCP tool';
  const select = document.createElement('select');
  select.className = 'hvy-galaxy-select';
  select.append(new Option('Choose an approved scripting tool', ''));
  for (const approval of Object.values(state.appSettings.integrationWebMcpApprovals).filter((item) => item.scriptingEnabled)) {
    const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === approval.integrationId);
    const page = integration?.pages.find((candidate) => candidate.id === approval.pageId);
    if (!page) continue;
    const config: WebMcpToolCapabilityConfig = {
      schemaVersion: 1,
      capabilityId: approval.capabilityId,
      name: approval.descriptor.title ?? approval.descriptor.name,
      description: approval.descriptor.description,
      page: { name: page.name, url: page.url, allowedOrigins: [...page.allowedOrigins] },
      tool: structuredClone(approval.descriptor),
      source: { integrationId: approval.integrationId, pageId: approval.pageId },
      mcp: { exposed: approval.mcpExposed },
    };
    const option = new Option(`${page.name} — ${config.name}`, JSON.stringify(config));
    option.selected = readWebMcpToolCapabilityConfig(ctx.block.schema.pluginConfig)?.capabilityId === approval.capabilityId;
    select.append(option);
  }
  select.addEventListener('change', () => { if (select.value) ctx.setConfig(JSON.parse(select.value) as JsonObject); });
  label.append(title, select);
  return label;
}

function create(ctx: HvyPluginContext): HvyPluginInstance {
  documentMounts.set(ctx.rawDocument, (documentMounts.get(ctx.rawDocument) ?? 0) + 1);
  const root = document.createElement('div');
  root.className = 'hvy-web-capability';
  let result: unknown;
  let error = '';
  let pending = false;
  const render = () => {
    root.replaceChildren();
    if (ctx.mode === 'editor') root.appendChild(editor(ctx));
    const config = readWebMcpToolCapabilityConfig(ctx.block.schema.pluginConfig);
    if (!config) {
      const empty = document.createElement('p');
      empty.textContent = 'Choose an approved WebMCP tool to make this block interactive.';
      root.appendChild(empty);
      return;
    }
    const heading = document.createElement('strong');
    heading.textContent = config.name;
    const description = document.createElement('p');
    description.textContent = config.description;
    const fields = schemaFields(config);
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'hvy-galaxy-button primary-button';
    run.textContent = pending ? 'Running…' : 'Run';
    run.disabled = pending;
    run.addEventListener('click', () => {
      try {
        pending = true;
        error = '';
        const args = fields.values();
        render();
        void trackDocumentExecution(ctx.rawDocument, (signal) => execution(config, args, true, signal)).then((value) => { result = value; }).catch((caught) => { error = caught instanceof Error ? caught.message : String(caught); }).finally(() => { pending = false; render(); });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        pending = false;
        render();
      }
    });
    root.append(heading, description, fields.element, run);
    if (error) {
      const message = document.createElement('p');
      message.className = 'hvy-web-error';
      message.textContent = error;
      root.appendChild(message);
    } else if (result !== undefined) {
      const output = document.createElement('pre');
      output.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      root.appendChild(output);
    }
  };
  render();
  return {
    element: root,
    refresh: render,
    unmount: () => {
      const mounts = Math.max(0, (documentMounts.get(ctx.rawDocument) ?? 1) - 1);
      if (mounts) documentMounts.set(ctx.rawDocument, mounts);
      else {
        documentMounts.delete(ctx.rawDocument);
        abortDocumentExecutions(ctx.rawDocument);
      }
    },
  };
}

function configForScript(capabilityId: unknown): WebMcpToolCapabilityConfig {
  const id = String(capabilityId ?? '').trim();
  const approval = state.appSettings.integrationWebMcpApprovals[id];
  if (!approval?.scriptingEnabled) throw new Error('This WebMCP tool is not enabled for HVY scripts.');
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === approval.integrationId);
  const page = integration?.pages.find((candidate) => candidate.id === approval.pageId);
  if (!page) throw new Error('The approved WebMCP page is unavailable.');
  return {
    schemaVersion: 1,
    capabilityId: id,
    name: approval.descriptor.title ?? approval.descriptor.name,
    description: approval.descriptor.description,
    page: { name: page.name, url: page.url, allowedOrigins: [...page.allowedOrigins] },
    tool: structuredClone(approval.descriptor),
    source: { integrationId: approval.integrationId, pageId: approval.pageId },
    mcp: { exposed: approval.mcpExposed },
  };
}

export const webMcpToolPlugin: HvyPlugin = {
  id: WEB_MCP_TOOL_PLUGIN_ID,
  version: '0.1.0',
  hvyApiVersion: '0.1',
  displayName: 'WebMCP Tool',
  create,
  hooks: {
    documentLoad: {
      run: (ctx) => {
        if (activeDocument && activeDocument !== ctx.document) abortDocumentExecutions(activeDocument);
        activeDocument = ctx.document;
      },
    },
  },
  scripting: {
    methods: {
      invoke: (args, ctx) => {
        const config = configForScript(args.capabilityId);
        const operation = () => trackDocumentExecution(ctx.rawDocument, (signal) => execution(config, args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? args.arguments as Record<string, unknown> : {}, false, signal));
        if (typeof args.on_complete !== 'function') return operation();
        return queueWebCapabilityScriptOperation(
          operation,
          { onComplete: args.on_complete as (value: Record<string, unknown>) => unknown, onError: typeof args.on_error === 'function' ? args.on_error as (value: Record<string, unknown>) => unknown : null },
        );
      },
    },
  },
  aiHint: 'Invokes one explicitly approved site-provided WebMCP tool. The browser profile and authorization remain local to Galaxy.',
};
