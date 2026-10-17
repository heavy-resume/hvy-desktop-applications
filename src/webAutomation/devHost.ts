/**
 * Development only: when the dev server runs with VITE_MOCK_WEB set to a
 * module path, that module installs a mock browser host (simulated sites and
 * services), so the web automation plugins run in the app without real
 * websites. Production builds drop this, since import.meta.env.DEV is false.
 *
 *   VITE_MOCK_WEB=/src/test/webAutomation/mockWeb.ts npm run electron:dev
 */
export async function installDevWebAutomationHost(): Promise<void> {
  const modulePath = import.meta.env.DEV ? import.meta.env.VITE_MOCK_WEB : undefined;
  if (!modulePath) return;
  await import(/* @vite-ignore */ modulePath);
}
