import { actionPatternPayload, integrationPageReadyChecks, type IntegrationActionDefinition, type IntegrationPageDefinition, type IntegrationProfileDefinition } from './integrationRegistry';
import { DEFAULT_WEB_RECORD_LIMIT } from './webCapabilities';
import { fetchWebRecords } from './webCapabilityRuntime';

export function fetchIntegrationRecords(
  integrationId: string,
  page: IntegrationPageDefinition,
  action: IntegrationActionDefinition,
  profile: IntegrationProfileDefinition,
) {
  const pattern = actionPatternPayload(action);
  if (action.source || !pattern) throw new Error('This record definition does not contain an executable page pattern.');
  return fetchWebRecords({
    capabilityId: action.id,
    source: { integrationId, pageId: page.id, actionId: action.id },
    page: { ...page, readyChecks: integrationPageReadyChecks(page) },
    record: {
      id: action.id, name: action.name, version: action.version,
      resultSchema: action.resultSchema, permissions: action.permissions,
      pattern, commands: action.commands ?? [], limit: DEFAULT_WEB_RECORD_LIMIT,
      scrollPage: action.scrollPage !== false,
    },
  }, { profile, foreground: false });
}
