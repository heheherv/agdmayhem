const AVATARS = Array.from({ length: 8 }, (_, index) => `Avatar${index + 1}.png`);

const state = {
  view: "menu",
  role: null,
  room: null,
  joinPreview: null,
  code: "",
  playerId: localStorage.getItem("agdPlayerId") || "",
  playerName: localStorage.getItem("agdPlayerName") || "",
  selectedAvatar: localStorage.getItem("agdAvatar") || "Avatar1.png",
  lastEventId: "",
  lastNarrationKey: "",
  pendingAnswers: {},
  clockOffset: 0,
  soundOn: localStorage.getItem("agdSound") === "1",
  error: "",
  copyMessage: "",
};

const app = document.getElementById("app");
const query = new URLSearchParams(location.search);
if (query.get("join")) {
  state.view = "join";
  state.role = "player";
  state.code = query.get("join").toUpperCase();
}

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  },
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = state.soundOn;
    this.loopTimer = null;
    this.mode = "menu";
    this.lastTimerSecond = null;
    this.lastAway = false;
  }

  async ensure() {
    if (!this.enabled) return;
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async toggle() {
    this.enabled = !this.enabled;
    state.soundOn = this.enabled;
    localStorage.setItem("agdSound", this.enabled ? "1" : "0");
    if (this.enabled) {
      await this.ensure();
      this.startLoop(this.mode);
    } else {
      this.stopLoop();
    }
    render();
  }

  beep(freq, duration = 0.1, type = "square", gain = 0.05, when = 0) {
    if (!this.enabled || !this.ctx) return;
    const start = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    amp.connect(this.ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  click() {
    this.ensure().then(() => {
      this.beep(320, 0.04, "square", 0.04);
      this.beep(540, 0.05, "square", 0.035, 0.04);
    });
  }

  correct() {
    this.ensure().then(() => {
      this.beep(520, 0.08, "triangle", 0.06);
      this.beep(740, 0.1, "triangle", 0.06, 0.08);
      this.beep(980, 0.13, "triangle", 0.06, 0.18);
    });
  }

  wrong() {
    this.ensure().then(() => {
      this.beep(220, 0.12, "sawtooth", 0.05);
      this.beep(150, 0.18, "sawtooth", 0.045, 0.11);
    });
  }

  points() {
    this.ensure().then(() => {
      [660, 880, 1100].forEach((freq, index) => this.beep(freq, 0.08, "square", 0.05, index * 0.07));
    });
  }

  winner() {
    this.ensure().then(() => {
      [392, 494, 587, 784, 988].forEach((freq, index) => this.beep(freq, 0.16, "triangle", 0.07, index * 0.12));
    });
  }

  away() {
    this.ensure().then(() => {
      this.beep(1240, 0.08, "sine", 0.05);
      this.beep(1560, 0.08, "sine", 0.04, 0.07);
    });
  }

  timer(second) {
    if (second === this.lastTimerSecond) return;
    this.lastTimerSecond = second;
    this.ensure().then(() => {
      const urgent = second <= 5;
      this.beep(urgent ? 900 : 520, urgent ? 0.08 : 0.04, "square", urgent ? 0.055 : 0.03);
      if (urgent) this.beep(1120, 0.05, "square", 0.04, 0.08);
    });
  }

  startLoop(mode) {
    this.mode = mode;
    this.stopLoop();
    if (!this.enabled) return;
    const pattern = () => {
      this.ensure().then(() => {
        const base = mode === "fraud" ? 196 : mode === "miles" ? 262 : mode === "cup" ? 330 : 247;
        const accent = mode === "fraud" ? 311 : mode === "miles" ? 392 : mode === "cup" ? 494 : 370;
        this.beep(base, 0.06, "square", 0.025);
        this.beep(accent, 0.04, "triangle", 0.02, 0.18);
        this.beep(base * 1.5, 0.04, "square", 0.018, 0.36);
      });
    };
    pattern();
    this.loopTimer = setInterval(pattern, mode === "miles" ? 520 : mode === "fraud" ? 760 : 680);
  }

  stopLoop() {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
  }
}

const audio = new AudioEngine();
if (state.soundOn) audio.startLoop("menu");

function html(strings, ...values) {
  return strings.reduce((result, part, index) => result + part + (values[index] ?? ""), "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function asset(name) {
  return `/assets/${name}`;
}

function modeClass(mode) {
  if (mode === "fraud") return "mode-fraud";
  if (mode === "miles") return "mode-miles";
  return "mode-cup";
}

function nowServer() {
  return Date.now() + state.clockOffset;
}

function isJoinFieldFocused() {
  const active = document.activeElement;
  return Boolean(!state.room && state.view === "join" && active?.matches?.("[data-field]"));
}

function secondsLeft(target) {
  if (!target) return 0;
  return Math.max(0, Math.ceil((target - nowServer()) / 1000));
}

function progress(start, end) {
  if (!start || !end) return 0;
  const span = end - start;
  return Math.max(0, Math.min(1, (end - nowServer()) / span));
}

function topbar(title = "AGD Mayhem", code = "") {
  return html`
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark">AGD</div>
        <div>
          <div class="brand-title">${escapeHtml(title)}</div>
          <div class="muted">${state.role === "host" ? "Host screen" : state.role === "player" ? "Player screen" : "Party trivia classroom"}</div>
        </div>
      </div>
      <div style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;">
        ${code ? `<div class="room-code"><span>Room</span><strong>${escapeHtml(code)}</strong></div>` : ""}
        <button class="sound-toggle" data-action="sound" title="Toggle sound">${state.soundOn ? "Sound On" : "Sound Off"}</button>
      </div>
    </div>
  `;
}

function render() {
  const room = state.room;
  if (!room) {
    if (state.view === "join") renderJoin();
    else renderMenu();
    bindActions();
    return;
  }
  if (room.status === "lobby") {
    if (state.role === "host") renderHostLobby(room);
    else renderPlayerLobby(room);
  } else if (room.status === "ended") {
    renderWinner(room);
  } else {
    renderGame(room);
  }
  bindActions();
  handleAudioAndNarration(room);
}

function renderMenu() {
  app.className = "app classroom";
  app.innerHTML = html`
    <div class="screen">
      ${topbar()}
      <main class="main-menu">
        <section class="chalkboard">
          <h1 class="hero-title">AGD<br />Mayhem</h1>
          <p class="hero-copy">A local Jackbox-style classroom party game for 4 to 8 players with pixel avatars, room codes, voice narration, perks, impostors, and Maam Miles watching the class.</p>
        </section>
        <section class="menu-actions">
          <button class="mode-button" data-action="create" data-mode="cup">
            <strong>Code & Render Cup</strong>
            <span>Spin topics, answer fast, earn badges, and unleash perks.</span>
          </button>
          <button class="mode-button" data-action="create" data-mode="fraud">
            <strong>De-Bugged: Find the Fraud</strong>
            <span>Answer questions, spot the glitched student, and vote before the day ends.</span>
          </button>
          <button class="mode-button" data-action="create" data-mode="miles">
            <strong>Miles Apart: The AI Detector</strong>
            <span>Answer only while Maam Miles looks away. Last student standing wins.</span>
          </button>
          <button class="mode-button" data-action="join-screen">
            <strong>Join With Code</strong>
            <span>Use this when a host already flashed a room code.</span>
          </button>
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        </section>
      </main>
    </div>
  `;
}

function renderJoin() {
  const taken = new Set((state.joinPreview?.players || []).map((player) => player.avatar));
  app.className = "app classroom";
  app.innerHTML = html`
    <div class="screen">
      ${topbar("Join AGD Mayhem", state.code)}
      <main class="join-panel">
        <h2 class="panel-title">Enter the classroom</h2>
        ${state.joinPreview ? `<p class="muted">${state.joinPreview.players.length} player${state.joinPreview.players.length === 1 ? "" : "s"} already joined ${escapeHtml(state.joinPreview.modeTitle)}.</p>` : ""}
        <div class="form-grid">
          <label>
            <div class="muted">Room code</div>
            <input data-field="code" maxlength="4" value="${escapeHtml(state.code)}" />
          </label>
          <label>
            <div class="muted">Name</div>
            <input data-field="name" maxlength="18" value="${escapeHtml(state.playerName)}" />
          </label>
          <div class="wide">
            <div class="muted" style="margin-bottom:.45rem;">Avatar</div>
            <div class="avatar-grid">
              ${AVATARS.map((avatar) => {
                const isTaken = taken.has(avatar);
                const selected = state.selectedAvatar === avatar;
                return `<button class="avatar-choice ${selected ? "selected" : ""} ${isTaken ? "taken" : ""}" data-action="avatar" data-avatar="${avatar}" ${isTaken ? "disabled" : ""}>
                  <img src="${asset(avatar)}" alt="${avatar}" />
                  ${isTaken ? `<span class="taken-label">Taken</span>` : ""}
                </button>`;
              }).join("")}
            </div>
          </div>
          <button class="wide" data-action="join">Join Room</button>
        </div>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
      </main>
    </div>
  `;
}

function renderHostLobby(room) {
  app.className = `app classroom ${modeClass(room.mode)}`;
  const min = room.mode === "fraud" ? 6 : 4;
  const ready = room.players.length >= min;
  const links = [room.links.local, ...(room.links.lan || [])].filter(Boolean);
  app.innerHTML = html`
    <div class="screen">
      ${topbar(room.modeTitle, room.code)}
      <main class="lobby-panel host-lobby">
        <section>
          <h2 class="panel-title">${escapeHtml(room.modeTitle)}</h2>
          <div class="room-code" style="font-size:1.4rem; margin:.4rem 0;"><span>Code</span><strong>${room.code}</strong></div>
          <div class="join-links">
            <div class="muted">Join links for players</div>
            ${links.map((url) => html`
              <div class="join-link-row">
                <div class="join-link">${escapeHtml(url)}</div>
                <button class="copy-link" data-action="copy-link" data-url="${escapeHtml(url)}">Copy</button>
              </div>
            `).join("")}
            ${state.copyMessage ? `<div class="copy-status">${escapeHtml(state.copyMessage)}</div>` : ""}
          </div>
          <button data-action="start" ${ready ? "" : "disabled"}>All Set!</button>
          <p class="muted">${room.players.length}/${room.mode === "fraud" ? 8 : 8} players joined. Minimum: ${min}.</p>
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        </section>
        <section>
          <h3 class="panel-title">Players</h3>
          <div class="player-roster">${renderRoster(room.players)}</div>
        </section>
      </main>
    </div>
  `;
}

function renderPlayerLobby(room) {
  app.className = `app classroom ${modeClass(room.mode)}`;
  app.innerHTML = html`
    <div class="screen">
      ${topbar(room.modeTitle, room.code)}
      <main class="lobby-panel">
        <h2 class="panel-title">Waiting for the host</h2>
        <p class="muted">${room.players.length} player${room.players.length === 1 ? "" : "s"} in the classroom.</p>
        <div class="player-roster">${renderRoster(room.players)}</div>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
      </main>
    </div>
  `;
}

function renderRoster(players) {
  if (!players.length) return `<div class="muted">No students yet.</div>`;
  return players.map((player) => html`
    <div class="player-card ${player.alive === false || player.votedOut ? "out" : ""}">
      <img class="avatar-img" src="${asset(player.avatar)}" alt="${escapeHtml(player.name)}" />
      <div>
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="player-meta">${player.score ? `${player.score} pts` : player.role ? escapeHtml(player.role) : "Ready"}</div>
      </div>
    </div>
  `).join("");
}

function renderGame(room) {
  app.className = `app classroom ${modeClass(room.mode)}`;
  if (room.phase === "tutorial") {
    app.innerHTML = html`
      <div class="screen">
        ${topbar(room.modeTitle, room.code)}
        ${renderTutorial(room)}
      </div>
    `;
    return;
  }
  let content = "";
  if (room.mode === "cup") content = renderCup(room);
  if (room.mode === "fraud") content = renderFraud(room);
  if (room.mode === "miles") content = renderMiles(room);
  app.innerHTML = html`
    <div class="screen">
      ${topbar(room.modeTitle, room.code)}
      ${content}
    </div>
  `;
}

function renderTutorial(room) {
  const tutorial = room.game?.tutorial || {};
  const skipped = tutorial.selfSkipped;
  return html`
    <main class="game-layout">
      <section class="stage">
        <section class="question-panel tutorial-panel">
          <div class="question-topic">Tutorial</div>
          <h2 class="question-text">${escapeHtml(tutorial.title || `${room.modeTitle} Tutorial`)}</h2>
          <div class="tutorial-list">
            ${(tutorial.bullets || []).map((item) => `<div class="tutorial-step">${escapeHtml(item)}</div>`).join("")}
          </div>
          <button data-action="skip-tutorial" ${skipped ? "disabled" : ""}>${skipped ? "Ready" : "Skip Tutorial"}</button>
          <p class="muted">${tutorial.skippedCount || 0}/${tutorial.totalSkips || room.players.length + 1} ready. The game starts when the host and all players are ready.</p>
        </section>
      </section>
      ${renderSidePanel(room)}
    </main>
  `;
}

function renderCup(room) {
  const game = room.game;
  const q = game.question;
  const timer = game.phase === "cup_answer" ? renderTimer(game.answerStart, game.answerEnd) : "";
  const stage = game.phase === "cup_topic"
    ? renderWheel(game)
    : html`
      <section class="question-panel">
        ${q ? `<div class="question-topic">${escapeHtml(q.topic)} ${game.currentIgnored ? "- Null Pointer" : ""}</div>` : ""}
        <h2 class="question-text">${q ? escapeHtml(q.question) : "Preparing question..."}</h2>
        ${timer}
        ${q ? renderChoices(room, q, {
          endpoint: "answer",
          disabled: state.role === "host" || game.phase !== "cup_answer",
          reveal: game.phase === "cup_reveal",
          answerMap: game.answers,
          correctIndex: q.correctIndex,
          selectedIndex: selectedChoiceIndex(room),
        }) : ""}
      </section>
      ${renderCupPerkWindow(room)}
    `;
  return html`
    <main class="game-layout">
      <section class="stage">${stage}</section>
      ${renderSidePanel(room)}
    </main>
  `;
}

function renderWheel(game) {
  const spinning = nowServer() < game.topicSpinEnd;
  const topics = game.topics || [];
  const chosenIndex = Math.max(0, topics.findIndex((topic) => topic.id === game.pendingTopic?.id));
  const segment = topics.length ? 360 / topics.length : 72;
  const finalRotation = 90 - (chosenIndex * segment + segment / 2);
  const elapsed = Math.max(0, nowServer() - (game.topicSpinStart || nowServer()));
  const duration = Math.max(1, (game.topicSpinEnd || nowServer()) - (game.topicSpinStart || nowServer()));
  const t = Math.min(1, elapsed / duration);
  const eased = 1 - Math.pow(1 - t, 3);
  const rotation = spinning ? 1440 * (1 - eased) + finalRotation * eased : finalRotation;
  return html`
    <section class="question-panel wheel">
      <div class="wheel-arrow">&lt;</div>
      <div class="wheel-disc segmented" style="transform:rotate(${rotation}deg);">
        ${topics.map((topic, index) => {
          const angle = index * segment + segment / 2;
          return `<div class="wheel-topic" style="--angle:${angle}deg;">${escapeHtml(topic.name)}</div>`;
        }).join("")}
        <div class="wheel-label">${spinning ? "SPIN" : escapeHtml(game.pendingTopic?.name || "Topic")}</div>
      </div>
    </section>
  `;
}

function renderCupPerkWindow(room) {
  const game = room.game;
  if (game.phase !== "cup_perk") return "";
  const self = room.self;
  if (state.role === "host") {
    return `<section class="notice-panel question-panel"><h3 class="panel-title">Perk Window</h3><p class="muted">${secondsLeft(game.perkEnd)} seconds left for players to use badges.</p></section>`;
  }
  const perks = self?.perks || [];
  return html`
    <section class="question-panel">
      <h3 class="panel-title">Use a Perk</h3>
      <div class="perk-list">
        ${perks.length ? perks.map((perk) => `<button class="perk-button" data-action="perk" data-perk="${perk.instanceId}"><strong>${escapeHtml(perk.name)}</strong><br /><span>${escapeHtml(perk.description)}</span></button>`).join("") : `<div class="muted">No perks stored yet.</div>`}
      </div>
      <p class="muted">${secondsLeft(game.perkEnd)} seconds left.</p>
    </section>
  `;
}

function renderFraud(room) {
  const game = room.game;
  const q = game.question;
  const self = room.self;
  const active = room.players.filter((player) => !player.votedOut);
  return html`
    <main class="game-layout">
      <section class="stage">
        <section class="question-panel">
          <div style="display:flex; gap:.6rem; flex-wrap:wrap; align-items:center; margin-bottom:.65rem;">
            <span class="question-topic">Round ${game.round}/${game.maxRounds}</span>
            ${self?.role ? `<span class="role-badge ${self.role === "fraud" ? "fraud-badge" : ""}">${self.role === "fraud" ? "The Fraud" : "Innocent Student"}</span>` : ""}
          </div>
          <h2 class="question-text">${q ? escapeHtml(q.question) : "Loading class file..."}</h2>
          ${game.phase === "fraud_answer" ? renderTimer(game.answerStart, game.answerEnd) : ""}
          ${q ? renderChoices(room, q, {
            endpoint: "answer",
            disabled: state.role === "host" || game.phase !== "fraud_answer" || self?.votedOut,
          reveal: game.phase === "fraud_reveal",
          answerMap: game.answers,
          correctIndex: q.correctIndex,
          selectedIndex: selectedChoiceIndex(room),
        }) : ""}
          ${renderFraudActions(room, active)}
        </section>
      </section>
      ${renderSidePanel(room)}
    </main>
  `;
}

function renderFraudActions(room, active) {
  const game = room.game;
  const self = room.self;
  if (game.phase === "fraud_vote" && state.role === "player" && !self?.votedOut) {
    return html`
      <div class="vote-grid">
        ${active.filter((player) => player.id !== self.id).map((player) => `<button data-action="vote" data-target="${player.id}">${escapeHtml(player.name)}</button>`).join("")}
      </div>
      <p class="muted">Vote timer: ${secondsLeft(game.voteEnd)} seconds.</p>
    `;
  }
  if (game.phase === "fraud_answer" && self?.role === "fraud") {
    return html`
      <h3 class="panel-title" style="margin-top:1rem;">Sabotage</h3>
      <div class="target-grid">
        ${active.filter((player) => player.id !== self.id).map((player) => `<button data-action="sabotage" data-target="${player.id}">${escapeHtml(player.name)}</button>`).join("")}
      </div>
    `;
  }
  if (game.phase === "fraud_vote") {
    return `<p class="muted">Voting ends in ${secondsLeft(game.voteEnd)} seconds.</p>`;
  }
  return "";
}

function renderMiles(room) {
  const game = room.game;
  const q = game.question;
  const away = game.isLookingAway;
  const milesImage = asset(away ? "Miles_LooksAway.webp" : "Miles_Front.webp");
  return html`
    <main class="game-layout">
      <section class="stage">
        <section class="question-panel miles-question-panel">
          <div class="miles-watch ${away ? "away" : ""}">
            <img class="miles-question-teacher ${away ? "away" : ""}" src="${milesImage}" alt="Maam Miles" />
            <div>
              <div class="question-topic">${away ? "Maam Miles looked away!" : "Maam Miles is watching"}</div>
              ${game.phase === "miles_reveal" ? `<div class="miles-announcement">${escapeHtml(game.announcement || "Next question incoming.")}</div>` : ""}
            </div>
          </div>
          <h2 class="question-text">${q ? escapeHtml(q.question) : "Preparing question..."}</h2>
          ${game.phase === "miles_round" ? renderTimer(game.roundStart, game.roundEnd) : ""}
          ${q ? renderChoices(room, q, {
            endpoint: "answer",
            disabled: state.role === "host" || game.phase !== "miles_round",
            reveal: game.phase === "miles_reveal",
            answerMap: game.answers,
            correctIndex: q.correctIndex,
            selectedIndex: selectedChoiceIndex(room),
          }) : ""}
        </section>
        <section class="miles-room">
          <div class="desks">
            ${room.players.map((player) => html`
              <div class="desk ${player.alive ? "" : "out"}">
                <img src="${asset(player.avatar)}" alt="${escapeHtml(player.name)}" />
                <div>
                  <div class="player-name">${escapeHtml(player.name)}</div>
                  <span class="status-pill">${player.alive ? "In class" : `Out ${player.comeback}/2`}</span>
                </div>
              </div>
            `).join("")}
          </div>
        </section>
      </section>
      ${renderSidePanel(room)}
    </main>
  `;
}

function renderChoices(room, question, options) {
  return html`
    <div class="choices">
      ${question.choices.map((choice, index) => {
        const hidden = choice.hidden;
        const correct = options.reveal && options.correctIndex === index;
        const wrong = options.reveal && options.correctIndex !== null && options.correctIndex !== index;
        const selected = options.selectedIndex === index;
        const choiceDisabled = options.disabled || hidden || (Number.isInteger(options.selectedIndex) && !options.reveal);
        return html`
          <div class="choice-wrap">
            <button class="choice ${correct ? "correct-choice" : ""} ${wrong ? "wrong-choice" : ""} ${selected ? "selected-choice" : ""} ${hidden ? "hidden-choice" : ""}"
              data-action="${options.endpoint}" data-choice="${index}" ${choiceDisabled ? "disabled" : ""}>
              <span class="letter">${escapeHtml(choice.label || String.fromCharCode(65 + index))}</span>
              <span>${hidden ? "Erased option" : escapeHtml(choice.text)}</span>
            </button>
            ${options.reveal ? renderChoiceAvatars(room, options.answerMap, index) : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderChoiceAvatars(room, answerMap, choiceIndex) {
  const players = room.players.filter((player) => answerMap?.[player.id]?.choiceIndex === choiceIndex);
  if (!players.length) return "";
  return `<div class="choice-avatars">${players.map((player) => `<img class="mini-face" title="${escapeHtml(player.name)}" src="${asset(player.avatar)}" alt="${escapeHtml(player.name)}" />`).join("")}</div>`;
}

function renderTimer(start, end) {
  const left = secondsLeft(end);
  audio.timer(left);
  const pct = progress(start, end);
  return html`
    <div style="display:flex; align-items:center; gap:.7rem; margin:.85rem 0;">
      <div class="timer-bar" style="flex:1;"><div class="timer-fill" style="transform:scaleX(${pct});"></div></div>
      <strong>${left}s</strong>
    </div>
  `;
}

function renderSidePanel(room) {
  return html`
    <aside class="side-panel">
      <h3 class="panel-title" style="font-size:1.35rem; margin:0;">Class Board</h3>
      <div class="leaderboard">
        ${[...room.players].sort((a, b) => (b.score || 0) - (a.score || 0)).map((player) => html`
          <div class="score-row ${player.alive === false || player.votedOut ? "out" : ""}">
            <img src="${asset(player.avatar)}" alt="${escapeHtml(player.name)}" />
            <span class="name">${escapeHtml(player.name)}</span>
            <span>${room.mode === "cup" ? `${player.score || 0}` : player.votedOut ? "Voted" : player.alive === false ? "Out" : "In"}</span>
          </div>
        `).join("")}
      </div>
      ${state.role === "player" && room.self?.perks?.length ? html`
        <h3 class="panel-title" style="font-size:1.1rem; margin:.2rem 0 0;">Perks</h3>
        <div class="perk-list">${room.self.perks.map((perk) => `<div class="event">${escapeHtml(perk.name)}</div>`).join("")}</div>
      ` : ""}
      <h3 class="panel-title" style="font-size:1.1rem; margin:.2rem 0 0;">Notifications</h3>
      <div class="events">${room.events.slice(-8).reverse().map((event) => `<div class="event ${event.type}">${escapeHtml(event.text)}</div>`).join("")}</div>
    </aside>
  `;
}

function renderWinner(room) {
  app.className = `app classroom ${modeClass(room.mode)}`;
  const result = room.game?.result || {};
  let winners = [];
  if (room.mode === "cup") winners = room.players.filter((player) => result.winnerIds?.includes(player.id));
  if (room.mode === "miles") winners = room.players.filter((player) => player.id === room.game.winnerId);
  if (room.mode === "fraud") {
    winners = result.winner === "fraud"
      ? room.players.filter((player) => player.role === "fraud")
      : room.players.filter((player) => player.role !== "fraud");
  }
  app.innerHTML = html`
    <div class="screen">
      ${topbar(room.modeTitle, room.code)}
      <main class="winner-screen">
        <section class="question-panel">
          <h1 class="winner-title">${escapeHtml(result.title || "Game over!")}</h1>
          <div class="big-avatars">${winners.map((player) => `<img src="${asset(player.avatar)}" alt="${escapeHtml(player.name)}" />`).join("")}</div>
          ${state.role === "host" ? `<button data-action="menu">Return to Main Menu</button>` : `<p class="muted">Waiting for the host.</p>`}
        </section>
        <section class="side-panel">${renderRoster(room.players)}</section>
      </main>
    </div>
  `;
}

function bindActions() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", async () => {
      const action = element.dataset.action;
      try {
        state.error = "";
        audio.click();
        if (action === "sound") {
          await audio.toggle();
          return;
        }
        if (action === "join-screen") {
          state.view = "join";
          state.role = "player";
          state.room = null;
          state.joinPreview = null;
          render();
          return;
        }
        if (action === "copy-link") {
          await copyText(element.dataset.url || "");
          state.copyMessage = "Copied link.";
          render();
          setTimeout(() => {
            if (state.copyMessage === "Copied link.") {
              state.copyMessage = "";
              render();
            }
          }, 1800);
          return;
        }
        if (action === "avatar") {
          state.selectedAvatar = element.dataset.avatar;
          localStorage.setItem("agdAvatar", state.selectedAvatar);
          render();
          return;
        }
        if (action === "create") {
          const data = await api.request("/api/rooms", { method: "POST", body: { mode: element.dataset.mode } });
          state.role = "host";
          receiveRoom(data);
          audio.startLoop(element.dataset.mode);
          return;
        }
        if (action === "join") {
          await joinRoom();
          return;
        }
        if (action === "start") {
          const data = await api.request(`/api/rooms/${state.room.code}/start`, { method: "POST", body: {} });
          receiveRoom(data);
          audio.startLoop(state.room.mode);
          return;
        }
        if (action === "skip-tutorial") {
          const data = await api.request(`/api/rooms/${state.room.code}/skip-tutorial`, {
            method: "POST",
            body: state.role === "host" ? { host: true } : { playerId: state.playerId },
          });
          receiveRoom(data);
          return;
        }
        if (action === "answer") {
          rememberPendingAnswer(Number(element.dataset.choice));
          render();
          await api.request(`/api/rooms/${state.room.code}/answer`, {
            method: "POST",
            body: { playerId: state.playerId, choiceIndex: Number(element.dataset.choice) },
          });
          await poll();
          return;
        }
        if (action === "perk") {
          await api.request(`/api/rooms/${state.room.code}/perk`, {
            method: "POST",
            body: { playerId: state.playerId, instanceId: element.dataset.perk },
          });
          await poll();
          return;
        }
        if (action === "sabotage") {
          await api.request(`/api/rooms/${state.room.code}/sabotage`, {
            method: "POST",
            body: { playerId: state.playerId, targetId: element.dataset.target },
          });
          await poll();
          return;
        }
        if (action === "vote") {
          await api.request(`/api/rooms/${state.room.code}/vote`, {
            method: "POST",
            body: { playerId: state.playerId, targetId: element.dataset.target },
          });
          await poll();
          return;
        }
        if (action === "menu") {
          await api.request(`/api/rooms/${state.room.code}/reset`, { method: "POST", body: {} });
          state.room = null;
          state.role = null;
          state.view = "menu";
          state.code = "";
          history.replaceState(null, "", "/");
          audio.startLoop("menu");
          render();
        }
      } catch (error) {
        state.error = error.message;
        audio.wrong();
        render();
      }
    });
  });

  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.dataset.field === "code") {
        state.code = input.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
        state.joinPreview = null;
        input.value = state.code;
      }
      if (input.dataset.field === "name") {
        state.playerName = input.value;
      }
    });
  });
}

function answerKey(room = state.room) {
  const questionId = room?.game?.question?.id;
  return room && questionId ? `${room.code}:${questionId}` : "";
}

function rememberPendingAnswer(choiceIndex) {
  const key = answerKey();
  if (key) state.pendingAnswers[key] = choiceIndex;
}

function selectedChoiceIndex(room) {
  const key = answerKey(room);
  const serverChoice = room?.game?.selfAnswer?.choiceIndex;
  if (Number.isInteger(serverChoice)) return serverChoice;
  return Number.isInteger(state.pendingAnswers[key]) ? state.pendingAnswers[key] : null;
}

async function joinRoom() {
  const code = state.code.trim().toUpperCase();
  const name = state.playerName.trim();
  const data = await api.request(`/api/rooms/${code}/join`, {
    method: "POST",
    body: { name, avatar: state.selectedAvatar },
  });
  state.playerId = data.playerId;
  state.role = "player";
  localStorage.setItem("agdPlayerId", state.playerId);
  localStorage.setItem("agdPlayerName", name);
  localStorage.setItem("agdAvatar", state.selectedAvatar);
  receiveRoom(data.room);
  history.replaceState(null, "", `/?join=${code}`);
}

function receiveRoom(data) {
  const previous = state.room;
  state.room = data.room || data;
  state.code = state.room.code;
  state.clockOffset = state.room.serverTime - Date.now();
  processNewEvents(previous, state.room);
  render();
}

function processNewEvents(previous, room) {
  const previousIds = new Set((previous?.events || []).map((event) => event.id));
  const newEvents = (room.events || []).filter((event) => !previousIds.has(event.id));
  for (const event of newEvents) {
    if (event.type === "correct") audio.correct();
    if (event.type === "wrong") audio.wrong();
    if (event.type === "perk") audio.points();
    if (event.type === "winner") audio.winner();
  }
}

async function poll() {
  if (!state.room) return;
  const code = state.room.code;
  const qs = state.role === "host" ? "?host=1" : `?playerId=${encodeURIComponent(state.playerId)}`;
  try {
    const data = await api.request(`/api/rooms/${code}${qs}`);
    receiveRoom(data);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function pollJoinPreview() {
  if (state.room || state.view !== "join" || state.code.length !== 4) return;
  try {
    const data = await api.request(`/api/rooms/${state.code}`);
    if (await resumeExistingPlayer(state.code, data)) return;
    state.joinPreview = data;
    state.clockOffset = data.serverTime - Date.now();
    if (!isJoinFieldFocused()) render();
  } catch {
    state.joinPreview = null;
    if (!isJoinFieldFocused()) render();
  }
}

async function resumeExistingPlayer(code, preview) {
  if (!state.playerId || state.room) return false;
  const players = preview?.players || [];
  if (!players.some((player) => player.id === state.playerId)) return false;
  const data = await api.request(`/api/rooms/${code}?playerId=${encodeURIComponent(state.playerId)}`);
  state.role = "player";
  receiveRoom(data);
  history.replaceState(null, "", `/?join=${code}`);
  return true;
}

function handleAudioAndNarration(room) {
  if (!room?.game) return;
  const tutorial = room.game.tutorial;
  if (tutorial?.narrationKey && tutorial.narrationKey !== state.lastNarrationKey) {
    state.lastNarrationKey = tutorial.narrationKey;
    speak(tutorial.narrationText);
  }
  const shouldNarrateQuestion = room.phase === "cup_narrating" || room.phase === "fraud_narrating" || (room.mode === "miles" && room.phase === "miles_round");
  if (shouldNarrateQuestion && room.game.narrationKey && room.game.narrationKey !== state.lastNarrationKey) {
    const phaseWhenStarted = room.phase;
    state.lastNarrationKey = room.game.narrationKey;
    speak(room.game.narrationText, () => {
      if (state.role === "host" && (phaseWhenStarted === "cup_narrating" || phaseWhenStarted === "fraud_narrating")) {
        api.request(`/api/rooms/${room.code}/narration-done`, { method: "POST", body: {} }).then(receiveRoom).catch(() => {});
      }
    });
  }
  if (room.mode === "miles" && room.phase === "miles_round") {
    const away = room.game.isLookingAway;
    if (away && !audio.lastAway) audio.away();
    audio.lastAway = away;
  } else {
    audio.lastAway = false;
  }
}

function speak(text, done) {
  if (!("speechSynthesis" in window) || !text) {
    setTimeout(() => done?.(), 1400);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 1.05;
  utterance.volume = 1;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => /female|zira|aria|jenny|susan|english/i.test(item.name)) || voices[0];
  if (voice) utterance.voice = voice;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
  setTimeout(finish, Math.max(3500, Math.min(26000, text.length * 72)));
}

setInterval(() => {
  if (state.room) poll();
}, 450);

setInterval(() => {
  pollJoinPreview();
}, 1200);

setInterval(() => {
  if (state.room?.status === "playing") render();
}, 180);

render();
