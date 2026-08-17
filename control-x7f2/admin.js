(() => {
  const { OWNER, REPO } = window.NOVA_CONFIG;
  const API = "https://api.github.com";
  const ROLE_ADMIN = "<!-- role:admin -->";
  const ROLE_USER = "<!-- role:user -->";
  const PASS_HASH =
    "5963e8a36b9458b1900f297d8204ce591f7a15abf3d019b0286de0bc4afe3281";

  const QUICK_REPLIES = [
    "Let me think about that for a second.",
    "Good question — one moment.",
    "Interesting, tell me more?",
    "Working on it…",
    "Can you clarify what you mean?",
  ];

  const $gate = document.getElementById("gate");
  const $passInput = document.getElementById("passInput");
  const $tokenInput = document.getElementById("tokenInput");
  const $gateBtn = document.getElementById("gateBtn");
  const $gateError = document.getElementById("gateError");
  const $app = document.getElementById("app");
  const $convList = document.getElementById("convList");
  const $thread = document.getElementById("thread");
  const $listStatus = document.getElementById("listStatus");

  let adminToken = localStorage.getItem("nova.admin.token") || "";
  let conversations = new Map(); // issueNumber -> {number, title, updated_at, body, comments:[]}
  let activeIssue = null;
  let lastSeen = JSON.parse(localStorage.getItem("nova.admin.lastSeen") || "{}");
  let passUnlocked = sessionStorage.getItem("nova.admin.unlocked") === "1";

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  if (passUnlocked && adminToken) {
    unlock();
  } else {
    $tokenInput.style.display = adminToken ? "none" : "block";
  }

  document.getElementById("resetTokenLink").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem("nova.admin.token");
    adminToken = "";
    $tokenInput.value = "";
    $tokenInput.style.display = "block";
    $gateBtn.textContent = passUnlocked ? "Save token" : "Enter";
    $gateError.textContent = "token cleared — paste a new one.";
  });

  $gateBtn.addEventListener("click", async () => {
    if (!passUnlocked) {
      const hash = await sha256($passInput.value);
      if (hash !== PASS_HASH) {
        $gateError.textContent = "nope.";
        return;
      }
      passUnlocked = true;
      sessionStorage.setItem("nova.admin.unlocked", "1");
      if (adminToken) return unlock();
      $passInput.style.display = "none";
      $tokenInput.style.display = "block";
      $gateError.textContent = "";
      $gateBtn.textContent = "Save token";
      return;
    }
    const t = $tokenInput.value.trim();
    if (t.length < 20) {
      $gateError.textContent = "that doesn't look like a token.";
      return;
    }
    adminToken = t;
    localStorage.setItem("nova.admin.token", adminToken);
    unlock();
  });

  function unlock() {
    $gate.style.display = "none";
    $app.classList.add("show");
    refresh();
    setInterval(refresh, 5000);
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function refresh() {
    try {
      const res = await fetch(
        `${API}/repos/${OWNER}/${REPO}/issues?labels=chat&state=open&sort=updated&direction=desc&per_page=50`,
        { headers: authHeaders() }
      );
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.json()).message || "";
        } catch (_) {}
        showListStatus(`Error ${res.status} loading conversations${detail ? ": " + detail : ""}`);
        return;
      }
      showListStatus("");
      const issues = await res.json();
      const openIds = new Set(issues.map((i) => i.number));
      for (const num of [...conversations.keys()]) {
        if (!openIds.has(num)) conversations.delete(num);
      }
      for (const issue of issues) {
        conversations.set(issue.number, {
          number: issue.number,
          title: issue.title,
          updated_at: issue.updated_at,
          body: issue.body || "",
        });
      }
      renderList();
      if (activeIssue) await loadThread(activeIssue);
    } catch (err) {
      showListStatus(`Network error: ${err.message}`);
    }
  }

  function showListStatus(text) {
    $listStatus.textContent = text;
    $listStatus.style.display = text ? "block" : "none";
  }

  function renderList() {
    $convList.innerHTML = "";
    const sorted = [...conversations.values()].sort(
      (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
    );
    for (const c of sorted) {
      const seen = lastSeen[c.number];
      const unread = !seen || new Date(c.updated_at) > new Date(seen);
      const el = document.createElement("div");
      el.className = "conv" + (activeIssue === c.number ? " active" : "");
      el.innerHTML = `<div class="title">${unread ? '<span class="unread"></span>' : ""}${escapeHtml(
        c.title
      )}</div><div class="preview">${escapeHtml(bodyPreview(c.body))}</div>`;
      el.addEventListener("click", () => {
        activeIssue = c.number;
        lastSeen[c.number] = new Date().toISOString();
        localStorage.setItem("nova.admin.lastSeen", JSON.stringify(lastSeen));
        renderList();
        loadThread(c.number);
      });
      $convList.appendChild(el);
    }
  }

  function bodyPreview(body) {
    return stripRole(body).slice(0, 60);
  }

  function stripRole(body) {
    if (!body) return "";
    return body.replace(ROLE_USER, "").replace(ROLE_ADMIN, "").trim();
  }

  async function loadThread(issueNumber) {
    try {
      const res = await fetch(
        `${API}/repos/${OWNER}/${REPO}/issues/${issueNumber}/comments?per_page=100`,
        { headers: authHeaders() }
      );
      if (!res.ok) return;
      const comments = await res.json();
      const conv = conversations.get(issueNumber);
      if (!conv) return;
      const msgs = [];
      if (conv.body && conv.body.startsWith(ROLE_USER)) {
        msgs.push({ role: "friend", text: stripRole(conv.body) });
      }
      for (const c of comments) {
        if (typeof c.body !== "string") continue;
        if (c.body.startsWith(ROLE_ADMIN)) {
          msgs.push({ role: "me", text: stripRole(c.body) });
        } else if (c.body.startsWith(ROLE_USER)) {
          msgs.push({ role: "friend", text: stripRole(c.body) });
        }
      }
      renderThread(issueNumber, msgs);
    } catch (_) {}
  }

  function renderThread(issueNumber, msgs) {
    if (activeIssue !== issueNumber) return;
    const conv = conversations.get(issueNumber);
    $thread.innerHTML = `
      <div class="thread-header">
        <div class="id">${escapeHtml(conv.title)} · #${issueNumber}</div>
        <button id="closeConvBtn">Close conversation</button>
      </div>
      <div class="thread-msgs" id="threadMsgs"></div>
      <div class="quick-replies" id="quickReplies"></div>
      <div class="reply-box">
        <textarea id="replyInput" rows="2" placeholder="Reply as Nova…"></textarea>
        <button id="replyBtn">Send</button>
      </div>
    `;
    const $threadMsgs = document.getElementById("threadMsgs");
    for (const m of msgs) {
      const el = document.createElement("div");
      el.className = "tmsg " + (m.role === "me" ? "me" : "friend");
      el.textContent = m.text;
      $threadMsgs.appendChild(el);
    }
    $threadMsgs.scrollTop = $threadMsgs.scrollHeight;

    const $quick = document.getElementById("quickReplies");
    for (const q of QUICK_REPLIES) {
      const b = document.createElement("button");
      b.textContent = q;
      b.addEventListener("click", () => sendReply(issueNumber, q));
      $quick.appendChild(b);
    }

    const $replyInput = document.getElementById("replyInput");
    const $replyBtn = document.getElementById("replyBtn");
    $replyBtn.addEventListener("click", () => {
      const text = $replyInput.value.trim();
      if (!text) return;
      $replyInput.value = "";
      sendReply(issueNumber, text);
    });
    $replyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $replyBtn.click();
      }
    });

    document.getElementById("closeConvBtn").addEventListener("click", async () => {
      await fetch(`${API}/repos/${OWNER}/${REPO}/issues/${issueNumber}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ state: "closed" }),
      });
      conversations.delete(issueNumber);
      activeIssue = null;
      renderList();
      $thread.innerHTML = '<div class="thread-empty">Select a conversation</div>';
    });
  }

  async function sendReply(issueNumber, text) {
    await fetch(`${API}/repos/${OWNER}/${REPO}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ body: `${ROLE_ADMIN}\n${text}` }),
    });
    lastSeen[issueNumber] = new Date().toISOString();
    localStorage.setItem("nova.admin.lastSeen", JSON.stringify(lastSeen));
    await loadThread(issueNumber);
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
})();
