// Preload module (see the "test" script in package.json, which passes this
// via `node --import`). Registers the loader hook that redirects
// "cloudflare:workers" imports to a local shim, before any test file's own
// top-level imports are resolved.
import { register } from "node:module";

register("./cloudflare-loader-hooks.mjs", import.meta.url);
