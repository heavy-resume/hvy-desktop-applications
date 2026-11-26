// Development only (see src/webAutomation/devHost.ts): runs the app's web
// automation over the mock host, with the simulated job boards and the neutral
// mock analysis service. The host is on window.mockWeb for the dev tools
// console, for example to complete a sign-in.
import { setWebAutomationHost } from '../../webAutomation/app';
import { mockAnalysisService } from './analysisService';
import { mockWebSites } from './sites';
import { MockHost } from './mockHost';
import { showMockWindows } from './mockWindows';

const api = mockAnalysisService();
const host = new MockHost(mockWebSites(api));
host.log = (message) => console.info(`[mock web] ${message}`);
showMockWindows(host);
setWebAutomationHost(host);
(window as unknown as { mockWeb: unknown }).mockWeb = { host, api };
