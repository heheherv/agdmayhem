const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 3030);
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 4 * 60 * 60 * 1000);
const PLAYER_STALE_MS = Number(process.env.PLAYER_STALE_MS || 30 * 1000);

const rooms = new Map();

const MODES = {
  cup: {
    id: "cup",
    title: "Code & Render Cup",
    min: 4,
    max: 8,
  },
  fraud: {
    id: "fraud",
    title: "De-Bugged: Find the Fraud",
    min: 6,
    max: 8,
  },
  miles: {
    id: "miles",
    title: "Miles Apart: The AI Detector",
    min: 4,
    max: 8,
  },
};

const TUTORIALS = {
  cup: {
    title: "Code & Render Cup Tutorial",
    bullets: [
      "The topic wheel shows Java, Maya 3D, Game Studies, Communication, and C++.",
      "The wheel picks a topic, then the next 3 questions come from that topic.",
      "Listen to the question and choices, then answer within 10 seconds.",
      "Correct answers earn 1 point. The fastest correct player can earn a perk.",
      "Perks can add points, protect scores, reroll the topic, erase a choice, delay an opponent, and more.",
      "After the final question, the highest score wins the cup.",
    ],
  },
  fraud: {
    title: "De-Bugged Tutorial",
    bullets: [
      "Most players are Innocent Students. One or two players are secretly The Fraud.",
      "Students get normal questions. The Fraud sees a glitched version and must blend in.",
      "During the answer timer, The Fraud can silently sabotage an innocent student's answer.",
      "After 3 questions, the class sees the scores, then everyone votes for the player they suspect.",
      "Vote out The Fraud and the class wins. If The Fraud survives all rounds, The Fraud wins.",
    ],
  },
  miles: {
    title: "Miles Apart Tutorial",
    bullets: [
      "Maam Miles is watching the class. Only answer while she looks away.",
      "Each question lasts 10 seconds. She looks away 2 to 3 times for short windows.",
      "If you answer while she is facing front, you are out.",
      "If you do not answer in time, you are also out.",
      "Out players can return by answering the next 2 questions correctly while she looks away.",
      "The last student standing wins.",
    ],
  },
};

const TOPICS = [
  { id: "java", name: "Java", file: "TOPIC_JAVA.txt" },
  { id: "maya", name: "Maya 3D", file: "TOPIC_MAYA3D.txt" },
  { id: "studies", name: "Game Studies", file: "TOPIC_GAMESTUDIES.txt" },
  { id: "comm", name: "Communication", file: "TOPIC_COMMUNICATION.txt" },
  { id: "cpp", name: "C++", file: "TOPIC_C++.txt" },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const questionBank = loadQuestionBank();

function loadQuestionBank() {
  const topics = {};
  for (const topic of TOPICS) {
    topics[topic.id] = {
      ...topic,
      questions: parseQuestionFile(path.join(DATA_DIR, topic.file), topic.name),
    };
  }
  return {
    topics,
    debugged: parseQuestionFile(path.join(DATA_DIR, "DEBUGGED.txt"), "De-Bugged"),
    miles: parseQuestionFile(path.join(DATA_DIR, "MILESAPART.txt"), "Miles Apart"),
  };
}

function parseQuestionFile(filePath, topicName) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/\r/g, "");
  const blocks = raw
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^choices:?$/i.test(line));

      const correctLine = lines.find((line) => /^correct answer\s*:/i.test(line));
      const correctRaw = correctLine
        ? correctLine.replace(/^correct answer\s*:\s*/i, "").trim()
        : "";

      const choiceLines = lines.filter((line) => /^[A-D]\)\s*/i.test(line));
      const questionLine = lines.find((line) => !/^[A-D]\)\s*/i.test(line) && !/^correct answer/i.test(line));
      const question = cleanQuestion(questionLine || `Question ${index + 1}`);

      const choices = choiceLines.map((line) => ({
        label: line.slice(0, 1).toUpperCase(),
        text: line.replace(/^[A-D]\)\s*/i, "").trim(),
        full: line,
      }));

      const answerLetter = (correctRaw.match(/^([A-D])\)/i) || [])[1];
      let correctIndex = answerLetter ? answerLetter.toUpperCase().charCodeAt(0) - 65 : -1;
      if (correctIndex < 0 || correctIndex >= choices.length) {
        correctIndex = choices.findIndex((choice) => normalize(choice.full) === normalize(correctRaw));
      }
      if (correctIndex < 0) {
        correctIndex = choices.findIndex((choice) => normalize(choice.text) === normalize(correctRaw.replace(/^[A-D]\)\s*/i, "")));
      }
      if (correctIndex < 0) correctIndex = 0;

      return {
        id: `${slug(topicName)}-${index + 1}`,
        topic: topicName,
        question,
        choices: choices.length ? choices : fallbackChoices(),
        correctIndex,
      };
    })
    .filter((question) => question.choices.length >= 2);
}

function cleanQuestion(line) {
  return String(line || "")
    .replace(/^Question\s*\d+\s*:\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function fallbackChoices() {
  return ["A", "B", "C", "D"].map((label) => ({ label, text: "Missing choice", full: `${label}) Missing choice` }));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function randomId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function roomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickUnused(pool, usedSet) {
  const available = pool.filter((question) => !usedSet.has(question.id));
  const chosen = pick(available.length ? available : pool);
  usedSet.add(chosen.id);
  if (usedSet.size >= pool.length) usedSet.clear();
  return chosen;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRoom(modeId, hostOrigin) {
  const mode = MODES[modeId] || MODES.cup;
  const code = roomCode();
  const now = Date.now();
  const room = {
    code,
    mode: mode.id,
    modeTitle: mode.title,
    createdAt: now,
    updatedAt: now,
    status: "lobby",
    phase: "lobby",
    players: [],
    game: null,
    events: [],
    hostOrigin,
  };
  rooms.set(code, room);
  addEvent(room, `${mode.title} room created.`, "system");
  return room;
}

function addEvent(room, text, type = "info", targetId = null) {
  markRoomActivity(room);
  room.events.push({
    id: randomId("event"),
    at: Date.now(),
    text,
    type,
    targetId,
  });
  room.events = room.events.slice(-80);
}

function markRoomActivity(room) {
  if (room) room.updatedAt = Date.now();
}

function markPlayerSeen(room, playerId) {
  if (!playerId) return null;
  const player = getSelf(room, playerId);
  if (!player) return null;
  const now = Date.now();
  player.lastSeenAt = now;
  player.connected = true;
  markRoomActivity(room);
  return player;
}

function publicPlayers(room, viewerId = null, isHost = false) {
  const now = Date.now();
  const viewer = room.players.find((player) => player.id === viewerId) || null;
  return room.players.map((player) => {
    const base = {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      score: player.score || 0,
      joinedAt: player.joinedAt,
      connected: now - (player.lastSeenAt || player.joinedAt || 0) <= PLAYER_STALE_MS,
      answered: Boolean(player.answered),
      choiceIndex: isHost || room.phase.includes("reveal") || room.status === "ended" ? player.choiceIndex : null,
      isOut: Boolean(player.isOut),
      votedOut: Boolean(player.votedOut),
      alive: player.alive !== false,
      comeback: player.comeback || 0,
      seenAttempts: player.seenAttempts || 0,
      tutorialSkipped: Boolean(player.tutorialSkipped),
      playAgain: Boolean(player.playAgain),
      canSabotageTarget: Boolean(viewer && viewer.role === "fraud" && player.role === "student" && !player.votedOut && player.id !== viewer.id),
      perks: viewerId === player.id || isHost ? player.perks || [] : [],
      safetyRemaining: viewerId === player.id || isHost ? player.safetyRemaining || 0 : 0,
      nextBonus: viewerId === player.id || isHost ? player.nextBonus || 0 : 0,
    };
    if (viewerId === player.id) base.role = player.role || null;
    if (isHost && room.status === "ended") base.role = player.role || null;
    return base;
  });
}

function getSelf(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function sanitizeQuestion(question, redact = false) {
  if (!question) return null;
  if (redact) {
    return {
      id: question.id,
      topic: question.topic,
      question: "GLITCHED CLASS FILE - answer by instinct.",
      choices: question.choices.map((choice) => ({
        label: choice.label,
        text: "[redacted]",
        full: `${choice.label}) [redacted]`,
      })),
      correctIndex: null,
    };
  }
  return {
    id: question.id,
    topic: question.topic,
    question: question.question,
    choices: question.choices,
    correctIndex: roomAllowsCorrectIndex(question) ? question.correctIndex : null,
  };
}

function roomAllowsCorrectIndex(question) {
  return Boolean(question && question.showCorrect);
}

function publicAnswerMap(answers = {}) {
  return Object.fromEntries(Object.entries(answers).map(([playerId, answer]) => [
    playerId,
    {
      playerId: answer.playerId || playerId,
      choiceIndex: answer.choiceIndex,
      at: answer.at || 0,
    },
  ]));
}

function sanitizeRoom(room, options = {}) {
  tickRoom(room);
  const isHost = Boolean(options.host);
  if (options.playerId) markPlayerSeen(room, options.playerId);
  const self = getSelf(room, options.playerId);
  const game = sanitizeGame(room, self, isHost);
  const baseUrl = options.origin || room.hostOrigin || "";
  return {
    code: room.code,
    mode: room.mode,
    modeTitle: room.modeTitle,
    status: room.status,
    phase: room.phase,
    serverTime: Date.now(),
    createdAt: room.createdAt,
    players: publicPlayers(room, options.playerId, isHost),
    selfId: options.playerId || null,
    self: self ? publicPlayers({ players: [self], phase: room.phase, status: room.status }, options.playerId, isHost)[0] : null,
    game,
    events: room.events.filter((event) => isHost || !event.targetId || event.targetId === options.playerId).slice(-40),
    links: {
      local: `${baseUrl}/?join=${room.code}`,
      lan: lanUrls(`/?join=${room.code}`),
    },
  };
}

function sanitizeGame(room, self, isHost) {
  if (room.phase === "tutorial") {
    const tutorial = room.tutorial || {};
    return {
      type: room.mode,
      phase: "tutorial",
      tutorial: {
        title: tutorial.title || "Tutorial",
        bullets: tutorial.bullets || [],
        narrationKey: tutorial.narrationKey || "",
        narrationText: tutorial.narrationText || "",
        hostSkipped: Boolean(tutorial.hostSkipped),
        selfSkipped: isHost ? Boolean(tutorial.hostSkipped) : Boolean(self && self.tutorialSkipped),
        skippedCount: room.players.filter((player) => player.tutorialSkipped).length + (tutorial.hostSkipped ? 1 : 0),
        totalSkips: room.players.length + 1,
      },
    };
  }

  const game = room.game;
  if (!game) return null;
  if (room.mode === "cup") {
    const question = game.question
      ? {
          id: game.question.id,
          topic: game.question.topic,
          question: game.question.question,
          choices: getCupChoicesForPlayer(game, self),
          correctIndex: room.phase === "cup_reveal" || room.status === "ended" ? game.question.correctIndex : null,
        }
      : null;
    return {
      type: "cup",
      phase: room.phase,
      topic: game.topic,
      pendingTopic: game.pendingTopic,
      topics: TOPICS.map(({ id, name }) => ({ id, name })),
      topicSpinStart: game.topicSpinStart,
      topicSpinEnd: game.topicSpinEnd,
      topicsCompleted: game.topicsCompleted,
      targetQuestions: game.targetQuestions,
      completed: game.completed,
      question,
      answerStart: game.answerStart,
      answerEnd: game.answerEnd,
      revealEnd: game.revealEnd,
      perkEnd: game.perkEnd,
      currentIgnored: game.currentIgnored,
      narrationKey: game.narrationKey,
      narrationText: game.narrationText,
      selfAnswer: self ? game.answers[self.id] || null : null,
      answers: room.phase === "cup_reveal" || isHost ? game.answers : {},
      answerOrder: room.phase === "cup_reveal" || isHost ? game.answerOrder : [],
      reveal: game.reveal || null,
      snoozedUntil: self && game.snoozedPlayers[self.id] ? game.answerStart + 4000 : 0,
    };
  }

  if (room.mode === "fraud") {
    const redact = Boolean(self && self.role === "fraud" && room.phase === "fraud_answer");
    return {
      type: "fraud",
      phase: room.phase,
      round: game.round,
      maxRounds: game.maxRounds,
      questionInCycle: game.questionInCycle || 0,
      questionsPerVote: game.questionsPerVote || 3,
      impostorCount: game.impostorCount,
      question: game.question
        ? {
            id: game.question.id,
            topic: game.question.topic,
            question: redact ? "GLITCHED CLASS FILE - prove you belong." : game.question.question,
            choices: redact
              ? game.question.choices.map((choice) => ({ label: choice.label, text: "[redacted]", full: `${choice.label}) [redacted]` }))
              : game.question.choices,
            correctIndex: room.phase === "fraud_reveal" || room.status === "ended" ? game.question.correctIndex : null,
          }
        : null,
      answerEnd: game.answerEnd,
      answerStart: game.answerStart,
      voteEnd: game.voteEnd,
      revealEnd: game.revealEnd,
      scoreboardEnd: game.scoreboardEnd,
      narrationKey: game.narrationKey,
      narrationText: game.narrationText,
      selfAnswer: self && game.answers[self.id] ? publicAnswerMap({ [self.id]: game.answers[self.id] })[self.id] : null,
      answers: room.phase === "fraud_reveal" || room.phase === "fraud_scoreboard" || isHost || room.status === "ended" ? publicAnswerMap(game.answers) : {},
      votes: room.phase === "fraud_vote" || isHost || room.status === "ended" ? game.votes : {},
      reveal: game.reveal || null,
      result: game.result || null,
    };
  }

  if (room.mode === "miles") {
    return {
      type: "miles",
      phase: room.phase,
      round: game.round,
      question: game.question
        ? {
            id: game.question.id,
            topic: game.question.topic,
            question: game.question.question,
            choices: game.question.choices,
            correctIndex: room.phase === "miles_reveal" || room.status === "ended" ? game.question.correctIndex : null,
          }
        : null,
      roundStart: game.roundStart,
      roundEnd: game.roundEnd,
      revealEnd: game.revealEnd,
      lookAwayWindows: game.lookAwayWindows,
      answers: game.answers,
      selfAnswer: self ? game.answers[self.id] || null : null,
      isLookingAway: room.phase === "miles_round" ? isMilesLookingAway(game, Date.now()) : false,
      announcement: game.announcement || "",
      winnerId: game.winnerId || null,
      result: game.result || null,
      narrationKey: game.narrationKey,
      narrationText: game.narrationText,
    };
  }

  return null;
}

function getCupChoicesForPlayer(game, self) {
  if (!game.question) return [];
  const choices = game.question.choices.map((choice, index) => ({ ...choice, hidden: false, index }));
  if (self && game.eraserPlayers[self.id] && game.phaseAllowsEraser) {
    const wrongChoices = choices.filter((choice, index) => index !== game.question.correctIndex);
    const hidden = wrongChoices[0];
    if (hidden) hidden.hidden = true;
  }
  return choices;
}

function tickRoom(room) {
  markRoomActivity(room);
  if (room.phase === "tutorial") return;
  if (!room.game || room.status !== "playing") return;
  if (room.mode === "cup") tickCup(room);
  if (room.mode === "fraud") tickFraud(room);
  if (room.mode === "miles") tickMiles(room);
}

function startRoom(room) {
  if (room.status !== "lobby") throw new Error("This room already started.");
  const mode = MODES[room.mode];
  if (room.players.length < mode.min) throw new Error(`${mode.title} needs at least ${mode.min} players.`);
  if (room.players.length > mode.max) throw new Error(`${mode.title} allows up to ${mode.max} players.`);
  room.status = "playing";
  beginTutorial(room);
}

function beginTutorial(room) {
  const tutorial = TUTORIALS[room.mode];
  room.phase = "tutorial";
  room.game = null;
  room.tutorial = {
    ...tutorial,
    hostSkipped: false,
    narrationKey: `${room.mode}-tutorial-${Date.now()}`,
    narrationText: `${tutorial.title}. ${tutorial.bullets.join(" ")}`,
  };
  room.players.forEach((player) => {
    player.tutorialSkipped = false;
  });
  addEvent(room, `${tutorial.title} started.`, "system");
}

function skipTutorial(room, options = {}) {
  if (room.status !== "playing" || room.phase !== "tutorial") throw new Error("Tutorial is not open.");
  let skippedName = "Host";
  if (options.host) {
    room.tutorial.hostSkipped = true;
    room.players.forEach((player) => {
      player.tutorialSkipped = true;
    });
  } else {
    const player = getSelf(room, options.playerId);
    if (!player) throw new Error("Player not found.");
    player.tutorialSkipped = true;
    skippedName = player.name;
  }
  addEvent(room, `${skippedName} is ready.`, "system");
  if (room.tutorial.hostSkipped && room.players.every((player) => player.tutorialSkipped)) {
    beginGameProper(room);
  }
}

function beginGameProper(room) {
  if (room.mode === "cup") initCup(room);
  if (room.mode === "fraud") initFraud(room);
  if (room.mode === "miles") initMiles(room);
}

function replayRoom(room) {
  if (room.status !== "ended") throw new Error("Replay is only available after the game ends.");
  room.status = "playing";
  room.phase = "tutorial";
  room.game = null;
  room.events = [];
  room.players.forEach((player) => {
    resetPlayerGameState(player);
    player.tutorialSkipped = false;
    player.playAgain = false;
  });
  beginTutorial(room);
}

function requestPlayAgain(room, player) {
  if (room.status !== "ended") throw new Error("Play again is only available after the game ends.");
  player.playAgain = true;
  addEvent(room, `${player.name} wants to play again.`, "system");
}

function resetPlayerGameState(player) {
  player.score = 0;
  player.perks = [];
  player.choiceIndex = null;
  player.answered = false;
  player.answerAt = 0;
  player.nextBonus = 0;
  player.safetyRemaining = 0;
  player.role = null;
  player.votedOut = false;
  player.isOut = false;
  player.alive = true;
  player.comeback = 0;
  player.seenAttempts = 0;
  player.playAgain = false;
}

function initCup(room) {
  room.players.forEach(resetPlayerGameState);
  const targetQuestions = clamp(12 + Math.max(0, room.players.length - 4) * 2, 12, 20);
  room.game = {
    targetQuestions,
    completed: 0,
    topic: null,
    pendingTopic: null,
    topicsCompleted: 0,
    topicQuestionsRemaining: 0,
    topicSpinStart: 0,
    topicSpinEnd: 0,
    usedByTopic: Object.fromEntries(TOPICS.map((topic) => [topic.id, new Set()])),
    question: null,
    answers: {},
    answerOrder: [],
    answerStart: 0,
    answerEnd: 0,
    revealEnd: 0,
    perkEnd: 0,
    reveal: null,
    currentIgnored: false,
    nextNullPointer: false,
    nextPostCredits: 0,
    forceTopicSpin: false,
    eraserPlayers: {},
    snoozedPlayers: {},
    narrationKey: "",
    narrationText: "",
  };
  addEvent(room, `Code & Render Cup starts at ${targetQuestions} questions.`, "system");
  beginCupTopicSpin(room);
}

function beginCupTopicSpin(room) {
  const game = room.game;
  room.phase = "cup_topic";
  game.pendingTopic = pick(TOPICS);
  game.topicSpinStart = Date.now();
  game.topicSpinEnd = game.topicSpinStart + 3400;
  game.reveal = null;
  addEvent(room, "The topic wheel is spinning.", "system");
}

function beginCupQuestion(room) {
  const game = room.game;
  if (game.completed >= game.targetQuestions) {
    endCup(room);
    return;
  }
  if (!game.topic || game.topicQuestionsRemaining <= 0 || game.forceTopicSpin) {
    game.forceTopicSpin = false;
    beginCupTopicSpin(room);
    return;
  }

  const bank = questionBank.topics[game.topic.id];
  const question = pickUnused(bank.questions, game.usedByTopic[game.topic.id]);
  game.question = { ...question };
  game.answers = {};
  game.answerOrder = [];
  game.reveal = null;
  game.currentIgnored = Boolean(game.nextNullPointer);
  game.nextNullPointer = false;
  game.phaseAllowsEraser = true;
  room.players.forEach((player) => {
    player.choiceIndex = null;
    player.answered = false;
    player.answerAt = 0;
  });

  room.phase = "cup_narrating";
  game.narrationKey = `${question.id}-${Date.now()}`;
  game.narrationText = narrateQuestion(question);
  game.narrationTimeout = Date.now() + 26000;
  addEvent(room, `Topic locked: ${game.topic.name}.`, "system");
}

function startCupAnswer(room) {
  const game = room.game;
  if (room.phase !== "cup_narrating") return;
  room.phase = "cup_answer";
  game.answerStart = Date.now();
  game.answerEnd = game.answerStart + 10000;
  game.phaseAllowsEraser = true;
  addEvent(room, "Answer timer started.", "timer");
}

function finishCupAnswer(room) {
  const game = room.game;
  if (room.phase !== "cup_answer") return;
  const question = game.question;
  const correctIndex = question.correctIndex;
  const resultByPlayer = {};
  let firstCorrect = null;

  for (const player of room.players) {
    const answer = game.answers[player.id];
    const correct = Boolean(answer && answer.choiceIndex === correctIndex);
    let delta = 0;
    if (correct) {
      delta = 1 + (player.nextBonus || 0);
      player.score += delta;
      player.nextBonus = 0;
      if (!firstCorrect || answer.at < firstCorrect.at) {
        firstCorrect = { player, at: answer.at };
      }
    }
    resultByPlayer[player.id] = {
      choiceIndex: answer ? answer.choiceIndex : null,
      correct,
      delta,
      answerAt: answer ? answer.at : 0,
    };
  }

  let earned = null;
  if (firstCorrect && Math.random() < 0.9) {
    earned = awardCupPerk(room, firstCorrect.player);
  }

  if (!game.currentIgnored) {
    game.completed += 1;
    game.topicQuestionsRemaining -= 1;
  } else {
    addEvent(room, "Null Pointer activated: this question did not count.", "perk");
  }

  for (const player of room.players) {
    if (player.safetyRemaining > 0) player.safetyRemaining -= 1;
  }

  game.eraserPlayers = {};
  game.snoozedPlayers = {};
  game.reveal = {
    correctIndex,
    results: resultByPlayer,
    earned,
    ignored: game.currentIgnored,
  };
  room.phase = "cup_reveal";
  game.revealEnd = Date.now() + 6500;
}

function afterCupReveal(room) {
  const game = room.game;
  if (room.phase !== "cup_reveal") return;
  if (game.completed >= game.targetQuestions) {
    endCup(room);
    return;
  }
  if (room.players.some((player) => (player.perks || []).length > 0)) {
    room.phase = "cup_perk";
    game.perkEnd = Date.now() + 5000;
    addEvent(room, "Perk window open.", "perk");
    return;
  }
  beginCupQuestion(room);
}

function endCup(room) {
  room.status = "ended";
  room.phase = "ended";
  const highScore = Math.max(...room.players.map((player) => player.score));
  const winners = room.players.filter((player) => player.score === highScore);
  room.game.result = {
    winnerIds: winners.map((player) => player.id),
    title: winners.length === 1 ? `${winners[0].name} wins the Code & Render Cup!` : "It is a Code & Render tie!",
  };
  addEvent(room, room.game.result.title, "winner");
}

function tickCup(room) {
  const game = room.game;
  const now = Date.now();
  if (room.phase === "cup_topic" && now >= game.topicSpinEnd) {
    game.topic = game.pendingTopic;
    game.pendingTopic = null;
    game.topicQuestionsRemaining = 3;
    game.topicsCompleted += 1;
    beginCupQuestion(room);
    return;
  }
  if (room.phase === "cup_narrating" && now >= game.narrationTimeout) {
    startCupAnswer(room);
    return;
  }
  if (room.phase === "cup_answer") {
    const allAnswered = room.players.every((player) => game.answers[player.id]);
    if (allAnswered || now >= game.answerEnd) finishCupAnswer(room);
    return;
  }
  if (room.phase === "cup_reveal" && now >= game.revealEnd) {
    afterCupReveal(room);
    return;
  }
  if (room.phase === "cup_perk" && now >= game.perkEnd) {
    beginCupQuestion(room);
  }
}

function awardCupPerk(room, player) {
  const perk = chooseCupPerk(room, player);
  player.perks = player.perks || [];
  if (player.perks.length >= 3) player.perks.shift();
  const earned = { ...perk, instanceId: randomId("perk") };
  player.perks.push(earned);
  addEvent(room, `${player.name} earned ${perk.name}!`, "perk");
  return { playerId: player.id, perk: earned };
}

function chooseCupPerk(room, player) {
  const lowestScore = Math.min(...room.players.map((item) => item.score || 0));
  if (room.game.topicsCompleted >= 2 && (player.score || 0) === lowestScore && Math.random() < 0.4) {
    return PERKS.find((perk) => perk.id === "clutch");
  }
  const available = PERKS.filter((perk) => perk.id !== "clutch" || room.game.topicsCompleted >= 2);
  const total = available.reduce((sum, perk) => sum + perk.weight, 0);
  let roll = Math.random() * total;
  for (const perk of available) {
    roll -= perk.weight;
    if (roll <= 0) return perk;
  }
  return available[0];
}

const PERKS = [
  { id: "bonus", name: "Additional Point", weight: 14, description: "+1 point to your next correct answer." },
  { id: "oneforall", name: "One for All", weight: 14, description: "+1 point to all players." },
  { id: "glitch", name: "Random Glitch", weight: 14, description: "-1 point to a random opponent." },
  { id: "spin", name: "Spin the Wheel", weight: 11, description: "Reroll the topic before the next question." },
  { id: "snooze", name: "Snooze Button", weight: 11, description: "A random opponent waits 4 seconds." },
  { id: "null", name: "Null Pointer", weight: 11, description: "The next question will not count." },
  { id: "safety", name: "Safety Net", weight: 7.3, description: "No point deductions for 2 questions." },
  { id: "eraser", name: "The Eraser", weight: 7.3, description: "Hide one wrong option next question." },
  { id: "credits", name: "Post-Credits Scene", weight: 7.3, description: "Add 2 questions, up to 40 total." },
  { id: "clutch", name: "Clutch Saboteur", weight: 3, description: "Swap score with the highest scorer." },
];

function useCupPerk(room, player, instanceId) {
  tickRoom(room);
  if (room.phase !== "cup_perk") throw new Error("Perks can only be used during the perk window.");
  const index = (player.perks || []).findIndex((perk) => perk.instanceId === instanceId);
  if (index < 0) throw new Error("That perk is not available.");
  const [perk] = player.perks.splice(index, 1);
  const others = room.players.filter((item) => item.id !== player.id);

  if (perk.id === "bonus") {
    player.nextBonus = (player.nextBonus || 0) + 1;
    addEvent(room, `${player.name} armed Additional Point.`, "perk");
  }
  if (perk.id === "oneforall") {
    room.players.forEach((item) => {
      item.score += 1;
    });
    addEvent(room, `${player.name} gave everyone +1 point.`, "perk");
  }
  if (perk.id === "glitch") {
    const target = pick(others);
    if (target) {
      if (target.safetyRemaining > 0) {
        addEvent(room, `${target.name}'s Safety Net blocked Random Glitch.`, "perk", target.id);
      } else {
        target.score = Math.max(0, (target.score || 0) - 1);
        addEvent(room, `${player.name}'s Random Glitch hit ${target.name}.`, "perk", target.id);
      }
    }
  }
  if (perk.id === "spin") {
    room.game.forceTopicSpin = true;
    addEvent(room, `${player.name} queued a topic reroll.`, "perk");
  }
  if (perk.id === "snooze") {
    const target = pick(others);
    if (target) {
      room.game.snoozedPlayers[target.id] = true;
      addEvent(room, `${player.name} snoozed ${target.name} for the next question.`, "perk", target.id);
    }
  }
  if (perk.id === "null") {
    room.game.nextNullPointer = true;
    addEvent(room, `${player.name} activated Null Pointer for the next question.`, "perk");
  }
  if (perk.id === "safety") {
    player.safetyRemaining = Math.max(player.safetyRemaining || 0, 2);
    addEvent(room, `${player.name} is protected by Safety Net.`, "perk", player.id);
  }
  if (perk.id === "eraser") {
    room.game.eraserPlayers[player.id] = true;
    addEvent(room, `${player.name} will erase one wrong choice next question.`, "perk", player.id);
  }
  if (perk.id === "credits") {
    room.game.targetQuestions = clamp(room.game.targetQuestions + 2, 0, 40);
    addEvent(room, `${player.name} added a Post-Credits Scene.`, "perk");
  }
  if (perk.id === "clutch") {
    const highest = [...others].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (highest && (highest.score || 0) > (player.score || 0)) {
      const old = player.score || 0;
      player.score = highest.score || 0;
      highest.score = old;
      addEvent(room, `${player.name} swapped scores with ${highest.name}.`, "perk");
    } else {
      addEvent(room, `${player.name} tried Clutch Saboteur, but nobody was ahead.`, "perk");
    }
  }
}

function initFraud(room) {
  room.players.forEach(resetPlayerGameState);
  const shuffled = shuffle(room.players);
  const impostorCount = room.players.length === 8 ? 2 : 1;
  shuffled.forEach((player, index) => {
    player.role = index < impostorCount ? "fraud" : "student";
    player.votedOut = false;
    player.score = player.role === "fraud" ? 1 : 0;
  });
  room.game = {
    round: 1,
    maxRounds: room.players.length === 8 ? 4 : 3,
    questionInCycle: 0,
    questionsPerVote: 3,
    impostorCount,
    used: new Set(),
    question: null,
    answers: {},
    sabotages: {},
    votes: {},
    reveal: null,
    result: null,
    answerStart: 0,
    answerEnd: 0,
    revealEnd: 0,
    scoreboardEnd: 0,
    voteEnd: 0,
    narrationKey: "",
    narrationText: "",
  };
  addEvent(room, `${impostorCount} Fraud role${impostorCount > 1 ? "s" : ""} assigned secretly.`, "system");
  beginFraudQuestion(room);
}

function beginFraudQuestion(room) {
  const game = room.game;
  const question = pickUnused(questionBank.debugged, game.used);
  game.questionInCycle = (game.questionInCycle || 0) + 1;
  game.question = { ...question };
  game.answers = {};
  game.sabotages = {};
  game.votes = {};
  game.reveal = null;
  room.players.forEach((player) => {
    player.choiceIndex = null;
    player.answered = false;
    player.answerAt = 0;
  });
  room.phase = "fraud_narrating";
  game.narrationKey = `${question.id}-${Date.now()}`;
  game.narrationText = narrateQuestion(question);
  game.narrationTimeout = Date.now() + 26000;
  addEvent(room, `Round ${game.round} begins.`, "system");
}

function startFraudAnswer(room) {
  const game = room.game;
  if (room.phase !== "fraud_narrating") return;
  room.phase = "fraud_answer";
  game.answerStart = Date.now();
  game.answerEnd = game.answerStart + 15000;
  addEvent(room, "Answer and sabotage timer started.", "timer");
}

function finishFraudAnswer(room) {
  const game = room.game;
  if (room.phase !== "fraud_answer") return;
  const correctIndex = game.question.correctIndex;
  const active = room.players.filter((player) => !player.votedOut);

  for (const [fraudId, targetId] of Object.entries(game.sabotages)) {
    const target = room.players.find((player) => player.id === targetId && player.role === "student" && !player.votedOut);
    if (!target) continue;
    const wrongChoices = game.question.choices.map((_, index) => index).filter((index) => index !== correctIndex);
    const forcedChoice = pick(wrongChoices);
    game.answers[target.id] = {
      playerId: target.id,
      choiceIndex: forcedChoice,
      at: Date.now(),
      sabotaged: true,
    };
  }

  const results = {};
  for (const player of active) {
    const answer = game.answers[player.id];
    const correct = Boolean(answer && answer.choiceIndex === correctIndex);
    if (player.role === "fraud") {
      player.score = 1;
    } else if (correct) {
      player.score = (player.score || 0) + 1;
    }
    player.choiceIndex = answer ? answer.choiceIndex : null;
    player.answered = Boolean(answer);
    results[player.id] = {
      choiceIndex: answer ? answer.choiceIndex : null,
      correct,
      role: player.role,
    };
  }

  game.reveal = { correctIndex, results };
  room.phase = "fraud_reveal";
  game.revealEnd = Date.now() + 8000;
}

function beginFraudScoreboard(room) {
  const game = room.game;
  if (room.phase !== "fraud_reveal") return;
  room.phase = "fraud_scoreboard";
  game.scoreboardEnd = Date.now() + 8000;
}

function beginFraudVote(room) {
  const game = room.game;
  if (room.phase !== "fraud_scoreboard") return;
  room.phase = "fraud_vote";
  game.votes = {};
  game.voteEnd = Date.now() + 30000;
}

function finishFraudVote(room) {
  const game = room.game;
  if (room.phase !== "fraud_vote") return;
  const active = room.players.filter((player) => !player.votedOut);
  const tally = {};
  for (const targetId of Object.values(game.votes)) {
    if (active.some((player) => player.id === targetId)) {
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const ejected = top ? room.players.find((player) => player.id === top[0]) : null;

  if (ejected) {
    ejected.votedOut = true;
    addEvent(room, `${ejected.name} was voted out.`, "vote");
    if (ejected.role === "fraud") {
      endFraud(room, "students", `${ejected.name} was the Fraud. The class wins!`);
      return;
    }
  } else {
    addEvent(room, "No one was voted out.", "vote");
  }

  if (game.round >= game.maxRounds) {
    endFraud(room, "fraud", "The Fraud survived the school day!");
    return;
  }

  game.round += 1;
  game.questionInCycle = 0;
  beginFraudQuestion(room);
}

function endFraud(room, winner, title) {
  room.status = "ended";
  room.phase = "ended";
  room.game.result = {
    winner,
    title,
    fraudIds: room.players.filter((player) => player.role === "fraud").map((player) => player.id),
  };
  addEvent(room, title, "winner");
}

function tickFraud(room) {
  const game = room.game;
  const now = Date.now();
  if (room.phase === "fraud_narrating" && now >= game.narrationTimeout) {
    startFraudAnswer(room);
    return;
  }
  if (room.phase === "fraud_answer") {
    const active = room.players.filter((player) => !player.votedOut);
    const allAnswered = active.every((player) => game.answers[player.id]);
    if (allAnswered || now >= game.answerEnd) finishFraudAnswer(room);
    return;
  }
  if (room.phase === "fraud_reveal" && now >= game.revealEnd) {
    if ((game.questionInCycle || 0) >= (game.questionsPerVote || 3)) {
      beginFraudScoreboard(room);
    } else {
      beginFraudQuestion(room);
    }
    return;
  }
  if (room.phase === "fraud_scoreboard" && now >= game.scoreboardEnd) {
    beginFraudVote(room);
    return;
  }
  if (room.phase === "fraud_vote") {
    const active = room.players.filter((player) => !player.votedOut);
    const allVoted = active.every((player) => game.votes[player.id]);
    if (allVoted || now >= game.voteEnd) finishFraudVote(room);
  }
}

function initMiles(room) {
  room.players.forEach(resetPlayerGameState);
  room.players.forEach((player) => {
    player.alive = true;
    player.isOut = false;
    player.comeback = 0;
    player.seenAttempts = 0;
  });
  room.game = {
    round: 0,
    used: new Set(),
    question: null,
    answers: {},
    lookAwayWindows: [],
    roundStart: 0,
    roundEnd: 0,
    revealEnd: 0,
    announcement: "",
    result: null,
    winnerId: null,
    narrationKey: "",
    narrationText: "",
  };
  addEvent(room, "Maam Miles entered the classroom.", "system");
  beginMilesRound(room);
}

function beginMilesRound(room) {
  const alive = room.players.filter((player) => player.alive);
  if (alive.length <= 1) {
    endMiles(room, alive[0] || null);
    return;
  }
  const game = room.game;
  game.round += 1;
  game.question = { ...pickUnused(questionBank.miles, game.used) };
  game.answers = {};
  game.announcement = "";
  const now = Date.now();
  game.roundStart = now + 800;
  game.roundEnd = game.roundStart + 10000;
  game.lookAwayWindows = createLookAwayWindows(game.roundStart, game.roundEnd);
  game.revealEnd = 0;
  room.phase = "miles_round";
  game.narrationKey = `${game.question.id}-${Date.now()}`;
  game.narrationText = narrateQuestion(game.question);
  room.players.forEach((player) => {
    player.choiceIndex = null;
    player.answered = false;
  });
  addEvent(room, `Miles Apart round ${game.round} started.`, "system");
}

function createLookAwayWindows(start, end) {
  const count = Math.random() < 0.5 ? 2 : 3;
  const windows = [];
  let attempts = 0;
  while (windows.length < count && attempts < 80) {
    attempts += 1;
    const duration = Math.random() < 0.55 ? 1500 : 2000;
    const earliest = start + 1300;
    const latest = end - duration - 700;
    const from = Math.floor(earliest + Math.random() * Math.max(1, latest - earliest));
    const to = from + duration;
    const overlaps = windows.some((window) => from < window.to + 450 && to > window.from - 450);
    if (!overlaps) windows.push({ from, to });
  }
  return windows.sort((a, b) => a.from - b.from);
}

function isMilesLookingAway(game, at) {
  return game.lookAwayWindows.some((window) => at >= window.from && at <= window.to);
}

function submitMilesAnswer(room, player, choiceIndex) {
  tickRoom(room);
  if (room.phase !== "miles_round") throw new Error("Wait for the next Miles question.");
  const game = room.game;
  if (game.answers[player.id]) throw new Error("You already answered this round.");

  const now = Date.now();
  const safe = isMilesLookingAway(game, now);
  const correct = choiceIndex === game.question.correctIndex;
  player.choiceIndex = choiceIndex;
  player.answered = true;

  if (!safe) {
    game.answers[player.id] = { choiceIndex, correct: false, safe: false, caught: true, at: now };
    if (player.alive) {
      player.seenAttempts = (player.seenAttempts || 0) + 1;
      if (player.seenAttempts >= 3) {
        markMilesOut(room, player, "caught");
        addEvent(room, `${player.name} was seen 3 times by Maam Miles.`, "wrong", player.id);
        finishMilesRound(room, `${player.name} is now out.`, false);
      } else {
        addEvent(room, `${player.name} was seen by Maam Miles (${player.seenAttempts}/3).`, "wrong", player.id);
        checkMilesRoundProgress(room);
      }
    } else {
      player.comeback = 0;
    }
    return;
  }

  if (!correct) {
    game.answers[player.id] = { choiceIndex, correct: false, safe: true, caught: false, at: now };
    const wasAlive = player.alive;
    markMilesOut(room, player, "wrong");
    addEvent(room, `${player.name} answered during the window, but it was wrong.`, "wrong", player.id);
    if (wasAlive) finishMilesRound(room, `${player.name} is now out.`, false);
    return;
  }

  game.answers[player.id] = { choiceIndex, correct: true, safe: true, caught: false, at: now };
  if (!player.alive) {
    player.comeback = (player.comeback || 0) + 1;
    if (player.comeback >= 2) {
      player.alive = true;
      player.isOut = false;
      player.comeback = 0;
      player.seenAttempts = 0;
      addEvent(room, `${player.name} returned from detention.`, "correct", player.id);
    } else {
      addEvent(room, `${player.name} needs one more clean answer to return.`, "correct", player.id);
    }
  } else {
    addEvent(room, `${player.name} answered safely.`, "correct", player.id);
  }

  checkMilesRoundProgress(room);
}

function markMilesOut(room, player) {
  player.alive = false;
  player.isOut = true;
  player.comeback = 0;
}

function checkMilesRoundProgress(room) {
  const game = room.game;
  if (room.phase !== "miles_round") return;
  const alivePlayers = room.players.filter((item) => item.alive);
  const allAliveAnswered = alivePlayers.every((item) => game.answers[item.id]);
  if (!allAliveAnswered) return;
  const seenPlayers = alivePlayers.filter((item) => game.answers[item.id]?.caught);
  if (seenPlayers.length) {
    const names = seenPlayers.map((item) => `${item.name} (${item.seenAttempts || 0}/3)`);
    finishMilesRound(room, `${formatNames(names)} ${seenPlayers.length === 1 ? "was" : "were"} seen by Maam Miles.`, false);
    return;
  }
  finishMilesRound(room, "Everyone survived.", false);
}

function finishMilesRound(room, announcement, markMissing) {
  const game = room.game;
  if (room.phase !== "miles_round") return;
  const outNames = [];
  if (markMissing) {
    for (const player of room.players) {
      if (game.answers[player.id]) continue;
      if (player.alive) {
        markMilesOut(room, player, "timeout");
        outNames.push(player.name);
        addEvent(room, `${player.name} did not answer in time.`, "wrong", player.id);
      } else {
        player.comeback = 0;
      }
    }
  }
  if (outNames.length) {
    announcement = `${formatNames(outNames)} ${outNames.length === 1 ? "is" : "are"} now out.`;
  }
  const alive = room.players.filter((player) => player.alive);
  if (alive.length <= 1) {
    endMiles(room, alive[0] || null);
    return;
  }
  room.phase = "miles_reveal";
  game.announcement = announcement || "Next question incoming.";
  game.revealEnd = Date.now() + 5000;
  addEvent(room, game.announcement, "system");
}

function formatNames(names) {
  if (names.length <= 1) return names[0] || "Nobody";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function endMiles(room, winner) {
  room.status = "ended";
  room.phase = "ended";
  room.game.winnerId = winner ? winner.id : null;
  room.game.result = {
    title: winner ? `${winner.name} is the last student standing!` : "No student survived Maam Miles.",
  };
  addEvent(room, room.game.result.title, "winner");
}

function tickMiles(room) {
  const game = room.game;
  const now = Date.now();
  if (room.phase === "miles_round" && now >= game.roundEnd) {
    finishMilesRound(room, "Time is up.", true);
    return;
  }
  if (room.phase === "miles_reveal" && now >= game.revealEnd) {
    beginMilesRound(room);
  }
}

function narrateQuestion(question) {
  if (!question) return "";
  const choices = question.choices.map((choice) => `${choice.label}. ${choice.text}`).join(". ");
  return `${question.topic}. ${question.question}. ${choices}.`;
}

function submitAnswer(room, player, choiceIndex) {
  tickRoom(room);
  if (room.mode === "cup") {
    if (room.phase !== "cup_answer") throw new Error("The answer timer is not open.");
    const game = room.game;
    if (game.answers[player.id]) throw new Error("You already answered.");
    if (game.snoozedPlayers[player.id] && Date.now() < game.answerStart + 4000) {
      throw new Error("Snooze Button is holding you for 4 seconds.");
    }
    game.answers[player.id] = { playerId: player.id, choiceIndex, at: Date.now() };
    game.answerOrder.push(player.id);
    player.choiceIndex = choiceIndex;
    player.answered = true;
    tickCup(room);
    return;
  }

  if (room.mode === "fraud") {
    if (room.phase !== "fraud_answer") throw new Error("The answer timer is not open.");
    if (player.votedOut) throw new Error("You were voted out.");
    if (room.game.answers[player.id]) throw new Error("You already answered.");
    room.game.answers[player.id] = { playerId: player.id, choiceIndex, at: Date.now() };
    player.choiceIndex = choiceIndex;
    player.answered = true;
    tickFraud(room);
    return;
  }

  if (room.mode === "miles") {
    submitMilesAnswer(room, player, choiceIndex);
  }
}

function submitSabotage(room, player, targetId) {
  tickRoom(room);
  if (room.mode !== "fraud" || room.phase !== "fraud_answer") throw new Error("Sabotage is not open.");
  if (player.role !== "fraud") throw new Error("Only the Fraud can sabotage.");
  const target = room.players.find((item) => item.id === targetId && item.role === "student" && !item.votedOut && item.id !== player.id);
  if (!target) throw new Error("Choose an active innocent student.");
  room.game.sabotages[player.id] = target.id;
}

function submitVote(room, player, targetId) {
  tickRoom(room);
  if (room.mode !== "fraud" || room.phase !== "fraud_vote") throw new Error("Voting is not open.");
  if (player.votedOut) throw new Error("You were voted out.");
  const target = room.players.find((item) => item.id === targetId && !item.votedOut && item.id !== player.id);
  if (!target) throw new Error("Vote for another active player.");
  room.game.votes[player.id] = target.id;
  addEvent(room, `${player.name} voted.`, "vote", player.id);
  tickFraud(room);
}

function handleJoin(room, body) {
  if (room.status !== "lobby") throw new Error("This room already started.");
  const mode = MODES[room.mode];
  if (room.players.length >= mode.max) throw new Error("This room is full.");
  const name = String(body.name || "").trim().slice(0, 18);
  const avatar = String(body.avatar || "").trim();
  if (!name) throw new Error("Enter a name.");
  if (!/^Avatar[1-8]\.png$/.test(avatar)) throw new Error("Choose an avatar.");
  if (room.players.some((player) => player.avatar === avatar)) throw new Error("That avatar is already taken.");
  const player = {
    id: randomId("player"),
    name,
    avatar,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    connected: true,
    score: 0,
    perks: [],
    choiceIndex: null,
    answered: false,
    alive: true,
    seenAttempts: 0,
    playAgain: false,
  };
  room.players.push(player);
  addEvent(room, `${name} joined the room.`, "join");
  return player;
}

function lanUrls(pathSuffix = "/") {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${PORT}${pathSuffix}`);
      }
    }
  }
  return urls;
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || (req.socket.encrypted ? "https" : "http");
  const host = forwardedHost || req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

function sendJson(res, statusCode, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function routeApi(req, res, parsedUrl) {
  const parts = parsedUrl.pathname.split("/").filter(Boolean);
  const origin = requestOrigin(req);

  if (req.method === "POST" && parsedUrl.pathname === "/api/rooms") {
    return readBody(req)
      .then((body) => {
        const room = createRoom(body.mode, origin);
        sendJson(res, 200, sanitizeRoom(room, { host: true, origin }));
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
  }

  if (parts[0] !== "api" || parts[1] !== "rooms" || !parts[2]) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const code = String(parts[2] || "").toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    sendJson(res, 404, { error: "Room not found." });
    return;
  }

  const action = parts[3] || "";
  const isHost = parsedUrl.searchParams.get("host") === "1";
  const playerId = parsedUrl.searchParams.get("playerId") || "";

  if (req.method === "GET" && !action) {
    sendJson(res, 200, sanitizeRoom(room, { host: isHost, playerId, origin }));
    return;
  }

  readBody(req)
    .then((body) => {
      tickRoom(room);
      if (req.method === "POST" && action === "join") {
        const player = handleJoin(room, body);
        sendJson(res, 200, { playerId: player.id, room: sanitizeRoom(room, { playerId: player.id, origin }) });
        return;
      }
      if (req.method === "POST" && action === "start") {
        startRoom(room);
        sendJson(res, 200, sanitizeRoom(room, { host: true, origin }));
        return;
      }
      if (req.method === "POST" && action === "replay") {
        replayRoom(room);
        sendJson(res, 200, sanitizeRoom(room, { host: true, origin }));
        return;
      }
      if (req.method === "POST" && action === "play-again") {
        const player = getSelf(room, body.playerId);
        if (!player) throw new Error("Player not found.");
        requestPlayAgain(room, player);
        sendJson(res, 200, sanitizeRoom(room, { playerId: player.id, origin }));
        return;
      }
      if (req.method === "POST" && action === "skip-tutorial") {
        skipTutorial(room, { host: Boolean(body.host), playerId: body.playerId });
        sendJson(res, 200, sanitizeRoom(room, { host: Boolean(body.host), playerId: body.playerId, origin }));
        return;
      }
      if (req.method === "POST" && action === "narration-done") {
        if (room.mode === "cup") startCupAnswer(room);
        if (room.mode === "fraud") startFraudAnswer(room);
        sendJson(res, 200, sanitizeRoom(room, { host: true, origin }));
        return;
      }
      if (req.method === "POST" && action === "answer") {
        const player = getSelf(room, body.playerId);
        if (!player) throw new Error("Player not found.");
        submitAnswer(room, player, Number(body.choiceIndex));
        sendJson(res, 200, sanitizeRoom(room, { playerId: player.id, origin }));
        return;
      }
      if (req.method === "POST" && action === "perk") {
        const player = getSelf(room, body.playerId);
        if (!player) throw new Error("Player not found.");
        useCupPerk(room, player, String(body.instanceId || ""));
        sendJson(res, 200, sanitizeRoom(room, { playerId: player.id, origin }));
        return;
      }
      if (req.method === "POST" && action === "sabotage") {
        const player = getSelf(room, body.playerId);
        if (!player) throw new Error("Player not found.");
        submitSabotage(room, player, String(body.targetId || ""));
        sendJson(res, 200, sanitizeRoom(room, { playerId: player.id, origin }));
        return;
      }
      if (req.method === "POST" && action === "vote") {
        const player = getSelf(room, body.playerId);
        if (!player) throw new Error("Player not found.");
        submitVote(room, player, String(body.targetId || ""));
        sendJson(res, 200, sanitizeRoom(room, { playerId: player.id, origin }));
        return;
      }
      if (req.method === "POST" && action === "reset") {
        rooms.delete(room.code);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 404, { error: "Unknown action." });
    })
    .catch((error) => sendJson(res, 400, { error: error.message }));
}

function staticCacheControl(ext) {
  if (ext === ".html") return "no-store";
  if ([".png", ".webp", ".ico"].includes(ext)) return "public, max-age=86400";
  return "no-cache";
}

function serveStatic(req, res, parsedUrl) {
  let pathname = decodeURIComponent(parsedUrl.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackContent) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": staticCacheControl(".html") });
        res.end(fallbackContent);
      });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": staticCacheControl(ext),
    });
    res.end(content);
  });
}

function cleanupRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  if (parsedUrl.pathname === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      uptimeSeconds: Math.round(process.uptime()),
    });
    return;
  }
  if (parsedUrl.pathname.startsWith("/api/")) {
    routeApi(req, res, parsedUrl);
    return;
  }
  serveStatic(req, res, parsedUrl);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

const cleanupTimer = setInterval(cleanupRooms, 60_000);
if (cleanupTimer.unref) cleanupTimer.unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AGD Mayhem is running.`);
  console.log(`Host screen: http://localhost:${PORT}`);
  for (const url of lanUrls("/")) {
    console.log(`Player link: ${url}`);
  }
});

function shutdown(signal) {
  console.log(`${signal} received. Closing AGD Mayhem server.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
