import type { WebMcpBrokerRequest } from './backend';
import { state } from './state';
import { assertLiveWebMcpDescriptor, invokeIntegrationWebMcpTool } from './integrationWebMcpRuntime';

export async function handleWebMcpBrokerRequest(request: WebMcpBrokerRequest): Promise<unknown> {
  if (request.integrationAccess === 'off') throw new Error('Web integration access is disabled in MCP Settings.');
  if (request.operation === 'list') {
    return {
      tools: Object.values(state.appSettings.integrationWebMcpApprovals).flatMap((approval) => {
        if (!approval.mcpExposed) return [];
        const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === approval.integrationId);
        const page = integration?.pages.find((candidate) => candidate.id === approval.pageId);
        const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === approval.profileId);
        if (!page || !profile) return [];
        return [{
          capabilityId: approval.capabilityId,
          integration: integration?.name,
          page: page.name,
          profile: profile.name,
          ...approval.descriptor,
        }];
      }),
    };
  }
  if (request.operation !== 'call') throw new Error('Unknown WebMCP broker operation.');
  const capabilityId = String(request.capabilityId ?? '').trim();
  const approval = state.appSettings.integrationWebMcpApprovals[capabilityId];
  if (!approval?.mcpExposed) throw new Error('The WebMCP capability is not exposed through MCP.');
  if (request.integrationAccess === 'read' && !approval.descriptor.annotations.readOnlyHint) {
    throw new Error('This WebMCP tool requires MCP integration action access.');
  }
  const integration = state.integrationRegistry.integrations.find((candidate) => candidate.id === approval.integrationId);
  const page = integration?.pages.find((candidate) => candidate.id === approval.pageId);
  const profile = state.integrationRegistry.profiles.find((candidate) => candidate.id === approval.profileId);
  if (!page || !profile) throw new Error('The approved WebMCP page or browser profile is unavailable.');
  const args = request.arguments ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('WebMCP arguments must be a JSON object.');
  const result = await invokeIntegrationWebMcpTool(approval, page, profile, args, false);
  return {
    value: assertLiveWebMcpDescriptor(approval, result),
    resultIsJson: Boolean(result && typeof result === 'object' && (result as { isJson?: unknown }).isJson === true),
    origin: approval.descriptor.origin,
    annotations: approval.descriptor.annotations,
  };
}
