// Stand-in for the real "cloudflare:workers" module, which only exists
// inside the workerd runtime. Tests mutate `env`'s properties (e.g.
// `env.DB = fakeD1`) before invoking the worker so route handlers that read
// the module-level `env` import see the fake bindings.
export const env = {};
