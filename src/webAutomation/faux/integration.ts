import type { DocumentItem } from '../recordSink';
import type { WebApiCapability } from '../webApi';
import type { FauxSite } from './fauxHost';

/**
 * A simulated signed-in API that the faux flow evaluates items against.
 * Generic tests use the neutral analysis service; site-specific contracts
 * (such as a real product's API) plug in through the same shape.
 */
export interface FauxApiIntegration<State> {
  site: FauxSite;
  /** Inspectable server-side state for assertions. */
  state: State;
  /** The galaxy.web-api block snapshot for this service. */
  capability: WebApiCapability;
  /** Endpoint that starts an evaluation, and endpoint that polls it. */
  createEndpointId: string;
  statusEndpointId: string;
  /** Session cookie value that signs in as a second account. */
  secondAccountSession: string;
  /** Create input for one item. The source document's text and revision are filled when the call runs. */
  createInput(item: DocumentItem): Record<string, unknown>;
  /** Interprets create and status response bodies. */
  readResult(body: unknown): { id: string; status: 'pending' | 'ready'; url: string; fields: Record<string, unknown> };
  /** Other sites the service relies on, such as its storage. */
  extraSites?: FauxSite[];
}
