/**
 * Bundled Lua plugins — vendored from cliamp's plugins/ directory, imported
 * eagerly as raw text and loaded through the host. Load order matters only in
 * that each registers independently; the host dispatches events to all enabled
 * plugins.
 */
// Eagerly import every vendored .lua plugin as raw text.
const modules = import.meta.glob("./plugins/*.lua", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface BundledPlugin {
  name: string; // file stem
  source: string;
}

export const BUNDLED_PLUGINS: BundledPlugin[] = Object.entries(modules)
  .map(([path, source]) => ({
    name: path.split("/").pop()!.replace(/\.lua$/, ""),
    source,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
