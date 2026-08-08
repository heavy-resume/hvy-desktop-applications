/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'virtual:hvy-built-in-plugins' {
  import type { HvyPlugin } from '../../heavy-file-format/src/plugins/types';

  export const builtInPluginIds: string[];
  export const builtInPlugins: HvyPlugin[];
  export const builtInPluginMap: Readonly<{
    dbTable?: HvyPlugin;
    form?: HvyPlugin;
    progressBar?: HvyPlugin;
    scripting?: HvyPlugin;
    canvas?: HvyPlugin;
    powerScripting?: HvyPlugin;
    graph?: HvyPlugin;
    diagram?: HvyPlugin;
    qrCode?: HvyPlugin;
    video?: HvyPlugin;
    editableText?: HvyPlugin;
  }>;
  export const builtInPluginById: Readonly<Record<string, HvyPlugin | undefined>>;
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
