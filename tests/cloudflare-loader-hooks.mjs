// Node module customization hook (see node:module `register`). Redirects the
// "cloudflare:workers" specifier -- which only resolves inside the workerd
// runtime -- to a local shim so the built worker bundle can be imported and
// exercised under plain `node --test`.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: new URL("./cloudflare-workers-shim.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
