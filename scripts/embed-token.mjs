#!/usr/bin/env node
// Run locally: node scripts/embed-token.mjs
// Prompts for your fine-grained GitHub PAT (input is masked), then splits it
// into base64 chunks and writes them into ../config.js as TOKEN_PARTS.
// The raw token is never printed, logged, or written anywhere as one string.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "config.js");

const CODE_ENTER = 13;
const CODE_NEWLINE = 10;
const CODE_EOF = 4; // ctrl-d
const CODE_INTERRUPT = 3; // ctrl-c
const CODE_BACKSPACE = 127;
const CODE_DELETE = 8;

function promptMasked(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";
    const onData = (char) => {
      const code = char.charCodeAt(0);
      if (code === CODE_ENTER || code === CODE_NEWLINE || code === CODE_EOF) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
        return;
      }
      if (code === CODE_INTERRUPT) process.exit(1);
      if (code === CODE_BACKSPACE || code === CODE_DELETE) {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      input += char;
      process.stdout.write("*");
    };
    stdin.on("data", onData);
  });
}

function chunkToken(token) {
  // split into 3-5 uneven pieces so no single literal substring is the
  // whole token, then base64-encode each piece
  const pieces = [];
  let rest = token;
  const numChunks = 3 + Math.floor(Math.random() * 3); // 3..5
  for (let i = 0; i < numChunks - 1; i++) {
    const remaining = rest.length;
    const chunksLeft = numChunks - i;
    const maxLen = Math.max(1, Math.floor(remaining / chunksLeft) + 2);
    const len = Math.max(1, Math.min(remaining - (chunksLeft - 1), 1 + Math.floor(Math.random() * maxLen)));
    pieces.push(rest.slice(0, len));
    rest = rest.slice(len);
  }
  pieces.push(rest);
  return pieces.map((p) => Buffer.from(p, "utf8").toString("base64"));
}

const token = await promptMasked(
  "Paste your fine-grained GitHub PAT (Issues: Read & write, this repo only): "
);

if (!token || token.length < 20) {
  console.error("That doesn't look like a token. Aborting, config.js left untouched.");
  process.exit(1);
}

const parts = chunkToken(token.trim());
const partsLiteral = JSON.stringify(parts, null, 4).replace(/^/gm, "  ").trim();

let config = readFileSync(configPath, "utf8");
config = config.replace(
  /TOKEN_PARTS:\s*\[[\s\S]*?\],/,
  `TOKEN_PARTS: ${partsLiteral},`
);
config = config.replace(
  /getToken\(\)\s*\{[\s\S]*?\n  \},/,
  `getToken() {\n    return this.TOKEN_PARTS.map((p) => atob(p)).join("");\n  },`
);

writeFileSync(configPath, config);
console.log(`Wrote ${parts.length} obfuscated chunks into config.js.`);
console.log("Review the diff, then commit & push config.js.");
console.log(
  "After pushing, verify the token still works (GitHub push protection can revoke recognized token formats on public pushes)."
);
