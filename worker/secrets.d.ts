/* Secrets are not bindings in wrangler.jsonc — that is the point of them — so
 * `wrangler types` cannot see them and the generated Env has no idea they
 * exist. Declared here instead, optional, because the code must handle the
 * secret being unset: /api/questions fails closed and says which command sets
 * it rather than assuming it is there.
 *
 *   npx wrangler secret put ADMIN_TOKEN      (deployed)
 *   echo ADMIN_TOKEN=... >> .dev.vars        (local, gitignored)
 */

declare global {
  interface Env {
    /** Gate for the question editor's write API. Unset means locked. */
    ADMIN_TOKEN?: string;
    /** Credentials for the Claude semantic grouping path. Unset => fuzzy
     *  fallback grouping, exactly as on the Node server. */
    ANTHROPIC_API_KEY?: string;
  }
}

export {};
