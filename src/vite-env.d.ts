/// <reference types="vite/client" />

declare module 'virtual:hvy-built-in-plugins' {
  export const builtInPluginIds: string[];
  export const builtInPlugins: any[];
  export const builtInPluginMap: Record<string, any>;
  export const builtInPluginById: Record<string, any>;
}

declare module 'virtual:hvy-brython-minimal-vfs' {
  const source: string;
  export default source;
}
