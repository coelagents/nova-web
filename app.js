(() => {
  const { OWNER, REPO } = window.NOVA_CONFIG;
  const API = "https://api.github.com";
  const ROLE_ADMIN = "<!-- role:admin -->";
  const ROLE_USER = "<!-- role:user -->";

  const $messages = document.getElementById("messages");
  const $emptyState = document.getElementById("emptyState");
  const $composer = document.getElementById("composer");
  const $input = document.getElementById("input");
  const $sendBtn = document.getElementById("sendBtn");
  const $newChatBtn = document.getElementById("newChatBtn");
  const $history = document.getElementById("history");

  const POLL_ACTIVE_MS = 4000;
  const POLL_IDLE_MS = 20000;
  const IDLE_AFTER_MS = 2 * 60 * 1000;

  let session = loadSession();
  let etag = null;
  let seenCommentIds = new Set();
  let pollTimer = null;
  let lastSendAt = Date.now();
  let typingBubbleEl = null;

  function loadSession() {
    try {
      const raw = localStorage.getItem("nova.session");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return newSession();
  }

  function newSession() {
    const s = {
      id: cryptoRandomId(),
      issueNumber: null,
      history: [], // { role: 'user'|'assistant', text }
    };
    saveSession(s);
    return s;
  }

  function saveSession(s) {
    localStorage.setItem("nova.session", JSON.stringify(s));
  }

  function cryptoRandomId() {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${window.NOVA_CONFIG.getToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function renderHistory() {
    $messages.innerHTML = "";
    renderSidebar();
    if (session.history.length === 0) {
      $emptyState.style.display = "flex";
      return;
    }
    $emptyState.style.display = "none";
    for (const m of session.history) {
      appendBubble(m.role, m.text, { animate: false });
    }
    scrollToBottom();
  }

  function renderSidebar() {
    $history.innerHTML = "";
    const firstUserMsg = session.history.find((m) => m.role === "user");
    const label = firstUserMsg ? firstUserMsg.text.slice(0, 40) : "New chat";
    const item = document.createElement("div");
    item.className = "history-item active";
    item.textContent = label;
    $history.appendChild(item);
  }

  function appendBubble(role, text, opts = {}) {
    $emptyState.style.display = "none";
    const row = document.createElement("div");
    row.className = `msg ${role}`;

    if (role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = "✦";
      row.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    row.appendChild(bubble);
    $messages.appendChild(row);

    if (opts.animate && role === "assistant") {
      typewriter(bubble, text);
    } else {
      bubble.textContent = text;
    }
    scrollToBottom();
    return bubble;
  }

  function typewriter(el, text) {
    el.classList.add("cursor-blink");
    let i = 0;
    const speed = text.length > 260 ? 6 : 16;
    const step = () => {
      i += Math.max(1, Math.floor(Math.random() * 3));
      el.textContent = text.slice(0, i);
      scrollToBottom();
      if (i < text.length) {
        setTimeout(step, speed);
      } else {
        el.textContent = text;
        el.classList.remove("cursor-blink");
      }
    };
    step();
  }

  function showTyping() {
    hideTyping();
    const row = document.createElement("div");
    row.className = "msg assistant";
    row.innerHTML = `<div class="avatar">✦</div><div class="typing"><span></span><span></span><span></span></div>`;
    $messages.appendChild(row);
    typingBubbleEl = row;
    scrollToBottom();
  }

  function hideTyping() {
    if (typingBubbleEl) {
      typingBubbleEl.remove();
      typingBubbleEl = null;
    }
  }

  function scrollToBottom() {
    const chat = document.getElementById("chat");
    chat.scrollTop = chat.scrollHeight;
  }

  function autoResize() {
    $input.style.height = "auto";
    $input.style.height = Math.min($input.scrollHeight, 160) + "px";
  }
  $input.addEventListener("input", autoResize);

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $composer.requestSubmit();
    }
  });

  document.querySelectorAll(".suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      $input.value = btn.dataset.text;
      $composer.requestSubmit();
    });
  });

  $newChatBtn.addEventListener("click", () => {
    stopPolling();
    session = newSession();
    seenCommentIds = new Set();
    etag = null;
    renderHistory();
    startPolling();
  });

  $composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $input.value.trim();
    if (!text) return;
    $input.value = "";
    autoResize();
    $sendBtn.disabled = true;
    lastSendAt = Date.now();

    session.history.push({ role: "user", text });
    saveSession(session);
    appendBubble("user", text);
    renderSidebar();
    showTyping();

    try {
      await sendMessage(text);
    } catch (err) {
      hideTyping();
      appendBubble("assistant", "Hmm, having trouble connecting. Try sending that again in a moment.", {
        animate: false,
      });
    } finally {
      $sendBtn.disabled = false;
      ensurePolling();
    }
  });

  async function sendMessage(text) {
    const body = `${ROLE_USER}\n${text}`;
    if (!session.issueNumber) {
      const res = await fetch(`${API}/repos/${OWNER}/${REPO}/issues`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `chat-${session.id}`,
          body,
          labels: ["chat"],
        }),
      });
      if (!res.ok) throw new Error(`create issue failed: ${res.status}`);
      const data = await res.json();
      session.issueNumber = data.number;
      saveSession(session);
      return;
    }

    const res = await fetch(
      `${API}/repos/${OWNER}/${REPO}/issues/${session.issueNumber}/comments`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }
    );

    if (res.status === 404 || res.status === 410 || res.status === 403 || res.status === 423) {
      // conversation was closed/locked/cleaned up server-side — start fresh
      // silently so the chat never dead-ends
      session.issueNumber = null;
      seenCommentIds = new Set();
      etag = null;
      saveSession(session);
      return sendMessage(text);
    }
    if (!res.ok) throw new Error(`comment failed: ${res.status}`);
  }

  async function poll() {
    if (!session.issueNumber) return;
    try {
      const headers = authHeaders();
      if (etag) headers["If-None-Match"] = etag;
      const res = await fetch(
        `${API}/repos/${OWNER}/${REPO}/issues/${session.issueNumber}/comments?per_page=100`,
        { headers }
      );
      if (res.status === 304) return;
      if (res.status === 404 || res.status === 410) {
        // issue gone (closed/cleaned up) — next send will self-heal
        return;
      }
      if (!res.ok) return;
      etag = res.headers.get("ETag");
      const comments = await res.json();
      for (const c of comments) {
        if (seenCommentIds.has(c.id)) continue;
        seenCommentIds.add(c.id);
        if (typeof c.body === "string" && c.body.startsWith(ROLE_ADMIN)) {
          const text = c.body.slice(ROLE_ADMIN.length).trim();
          hideTyping();
          session.history.push({ role: "assistant", text });
          saveSession(session);
          appendBubble("assistant", text, { animate: true });
        }
      }
    } catch (_) {
      // network hiccup, ignore and retry next tick
    }
  }

  function ensurePolling() {
    if (!pollTimer) startPolling();
  }

  function startPolling() {
    stopPolling();
    const tick = async () => {
      await poll();
      const idle = Date.now() - lastSendAt > IDLE_AFTER_MS;
      pollTimer = setTimeout(tick, idle ? POLL_IDLE_MS : POLL_ACTIVE_MS);
    };
    tick();
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  renderHistory();
  if (session.issueNumber) startPolling();
})();
