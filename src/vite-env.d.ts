/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

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

declare module 'pdfmake/build/pdfmake.js';
declare module 'pdfmake/build/vfs_fonts.js';

interface Window {
  HVY?: any;
  HVY_CHAT_CLIENT?: any;
}
