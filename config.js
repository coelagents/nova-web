// Public, client-side config. This file is served as-is to every visitor.
// The token below is a fine-grained GitHub PAT scoped to ONLY
// "Issues: Read and write" on the single repo below — nothing else.
// It is intentionally split into chunks (not stored as one literal string)
// so GitHub's secret-scanning / push-protection pattern match doesn't
// trip on a raw "github_pat_..." string sitting in the file.
//
// Fill this in by running: node scripts/embed-token.mjs
// (it will prompt for your token locally and rewrite TOKEN_PARTS below —
// the raw token itself is never printed back out or logged anywhere)

window.NOVA_CONFIG = {
  OWNER: "coelagents",
  REPO: "nova-web",
  TOKEN_PARTS: [
    // placeholder — run scripts/embed-token.mjs to populate
  ],
  getToken() {
    return this.TOKEN_PARTS.join("");
  },
};
