import type { DocumentItem } from '../../webAutomation/recordSink';
import type { WebApiCapability } from '../../webAutomation/webApi';
import type { MockSite } from './mockHost';

/**
 * A simulated signed-in API that the mock flow evaluates items against.
 * Generic tests use the neutral analysis service; site-specific contracts
 * (such as a real product's API) plug in through the same shape.
 */
export interface MockApiIntegration<State> {
  site: MockSite;
  /** Inspectable server-side state for assertions. */
  state: State;
  /** The galaxy.web-api block snapshot for this service. */
  capability: WebApiCapability;
  /** Endpoint that starts an evaluation, and endpoint that polls it, for a service whose evaluations finish later. */
  createEndpointId: string;
  statusEndpointId?: string;
  /** Session cookie value that signs in as a second account. */
  secondAccountSession: string;
  /** Create input for one item. The source document's text and revision are filled when the call runs. */
  createInput(item: DocumentItem): Record<string, unknown>;
  /** Interprets create and status response bodies. */
  readResult(body: unknown): { id: string; status: 'pending' | 'ready'; url: string; fields: Record<string, unknown> };
  /** Other sites the service relies on, such as its storage. */
  extraSites?: MockSite[];
}
