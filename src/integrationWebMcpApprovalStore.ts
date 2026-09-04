import { saveAppSettings } from './backend';
import { state } from './state';

export function disableIntegrationWebMcpApproval(capabilityId: string): void {
  const approval = state.appSettings.integrationWebMcpApprovals[capabilityId];
  if (!approval || (!approval.scriptingEnabled && !approval.mcpExposed)) return;
  const settings = {
    ...state.appSettings,
    integrationWebMcpApprovals: {
      ...state.appSettings.integrationWebMcpApprovals,
      [capabilityId]: { ...approval, scriptingEnabled: false, mcpExposed: false },
    },
  };
  state.appSettings = settings;
  void saveAppSettings(settings);
}
