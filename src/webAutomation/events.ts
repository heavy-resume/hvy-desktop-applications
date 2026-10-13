import type { Clock } from './clock';

export type AutomationEventSource = 'host' | 'scheduler' | 'session' | 'api' | 'collection' | 'queue' | 'user' | 'document';

export interface AutomationEvent {
  at: number;
  source: AutomationEventSource;
  message: string;
  data?: Record<string, unknown>;
}

export type AutomationEmit = (source: AutomationEventSource, message: string, data?: Record<string, unknown>) => void;

export function createEventChannel(clock: Clock): {
  emit: AutomationEmit;
  subscribe(listener: (event: AutomationEvent) => void): () => void;
} {
  const listeners = new Set<(event: AutomationEvent) => void>();
  return {
    emit: (source, message, data) => {
      const event: AutomationEvent = { at: clock.now(), source, message, ...(data ? { data } : {}) };
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
