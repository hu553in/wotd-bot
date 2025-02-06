const TelegramBot = require("node-telegram-bot-api");
const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");

// Allowed timezone offsets. We use this set to validate the timezone input.
const validTimezones = new Set([
  "-12:00",
  "-11:00",
  "-10:00",
  "-09:30",
  "-09:00",
  "-08:00",
  "-07:00",
  "-06:00",
  "-05:00",
  "-04:00",
  "-03:30",
  "-03:00",
  "-02:00",
  "-01:00",
  "+00:00",
  "+01:00",
  "+02:00",
  "+03:00",
  "+03:30",
  "+04:00",
  "+04:30",
  "+05:00",
  "+05:30",
  "+05:45",
  "+06:00",
  "+06:30",
  "+07:00",
  "+08:00",
  "+08:45",
  "+09:00",
  "+09:30",
  "+10:00",
  "+10:30",
  "+11:00",
  "+12:00",
  "+12:45",
  "+13:00",
  "+14:00",
]);

// Read the token from the environment variable.
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Error: BOT_TOKEN environment variable is not set.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Open (or create) the SQLite database.
const db = new sqlite3.Database("db.sqlite", (err) => {
  if (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  } else {
    console.log("Database connected successfully.");
  }
});

// Create necessary tables.
db.serialize(() => {
  // Chats table: stores each chat's settings.
  db.run(`CREATE TABLE IF NOT EXISTS chats (
    chat_id TEXT PRIMARY KEY,
    chat_type TEXT,
    chat_title TEXT,
    last_sent_date TEXT,
    send_time TEXT DEFAULT '09:00',
    timezone TEXT DEFAULT '+03:00'
  )`);
  // Words table: stores words per chat.
  db.run(`CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    word TEXT NOT NULL
  )`);
  // History table: tracks which word IDs have been sent already.
  db.run(`CREATE TABLE IF NOT EXISTS history (
    chat_id TEXT NOT NULL,
    word_id INTEGER NOT NULL,
    PRIMARY KEY (chat_id, word_id)
  )`);
});

// --- Promise Wrappers for SQLite ---
function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// --- Helper: Register Chat ---
// This function makes sure the chat record exists.
async function registerChat(chat) {
  const chat_id = String(chat.id);
  const chat_type = chat.type;
  // For groups, use the title if available; otherwise fall back to first name.
  const chat_title = chat.title || chat.first_name || "Чат";
  try {
    await dbRun(
      `INSERT OR IGNORE INTO chats (chat_id, chat_type, chat_title, send_time, timezone)
       VALUES (?, ?, ?, '09:00', '+03:00')`,
      [chat_id, chat_type, chat_title]
    );
  } catch (err) {
    console.error("Error registering chat:", err);
  }
}

// --- Command Handlers ---

// /start - Greet the user and register the chat.
bot.onText(/\/start/, async (msg) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  const welcomeMsg =
    `Привет! Я бот "Слово дня".\n\n` +
    `Доступные команды:\n` +
    `/add <слово> – добавить слово\n` +
    `/remove <слово> – удалить слово\n` +
    `/words – показать список слов\n` +
    `/random – получить случайное слово (оно добавится в историю)\n` +
    `/time [ЧЧ:ММ±смещение] – показать или установить время отправки\n\n` +
    `Каждый день я буду отправлять слово из вашего списка в установленное время.`;
  bot.sendMessage(chatId, welcomeMsg).catch(console.error);
});

// /add <word> – Add a word. Validation: non-empty, no excessive length.
bot.onText(/\/add\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  let word = match[1].trim();

  // Basic validations.
  if (!word) {
    bot
      .sendMessage(
        chatId,
        "Слово не может быть пустым. Используйте: /add <слово>"
      )
      .catch(console.error);
    return;
  }
  if (word.length > 30) {
    bot
      .sendMessage(chatId, "Слишком длинное слово! Максимум 30 символов.")
      .catch(console.error);
    return;
  }
  // Optional: You could restrict to letters/numbers/spaces only.
  if (!/^[\wа-яА-ЯёЁ\s-]+$/.test(word)) {
    bot
      .sendMessage(chatId, "Слово содержит недопустимые символы.")
      .catch(console.error);
    return;
  }
  try {
    // Check for duplicate.
    const exists = await dbGet(
      `SELECT word FROM words WHERE chat_id = ? AND word = ?`,
      [chatId, word]
    );
    if (exists) {
      bot
        .sendMessage(chatId, `Слово "${word}" уже есть в списке.`)
        .catch(console.error);
      return;
    }
    await dbRun(`INSERT INTO words (chat_id, word) VALUES (?, ?)`, [
      chatId,
      word,
    ]);
    bot.sendMessage(chatId, `Слово "${word}" добавлено.`).catch(console.error);
  } catch (err) {
    console.error("Error adding word:", err);
    bot
      .sendMessage(chatId, "Ошибка при добавлении слова.")
      .catch(console.error);
  }
});

// /remove <word> – Remove a word by an exact match.
bot.onText(/\/remove\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  let word = match[1].trim();
  if (!word) {
    bot
      .sendMessage(chatId, "Укажите слово после команды /remove.")
      .catch(console.error);
    return;
  }
  try {
    const row = await dbGet(
      `SELECT id FROM words WHERE chat_id = ? AND word = ?`,
      [chatId, word]
    );
    if (!row) {
      bot
        .sendMessage(chatId, `Слово "${word}" не найдено.`)
        .catch(console.error);
      return;
    }
    await dbRun(`DELETE FROM words WHERE id = ? AND chat_id = ?`, [
      row.id,
      chatId,
    ]);
    await dbRun(`DELETE FROM history WHERE word_id = ? AND chat_id = ?`, [
      row.id,
      chatId,
    ]);
    bot.sendMessage(chatId, `Слово "${word}" удалено.`).catch(console.error);
  } catch (err) {
    console.error("Error removing word:", err);
    bot.sendMessage(chatId, "Ошибка при удалении слова.").catch(console.error);
  }
});

// /words – List all words.
bot.onText(/\/words/, async (msg) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  try {
    const words = await dbAll(`SELECT word FROM words WHERE chat_id = ?`, [
      chatId,
    ]);
    if (!words || words.length === 0) {
      bot
        .sendMessage(
          chatId,
          "Список слов пуст. Добавьте слово командой /add <слово>."
        )
        .catch(console.error);
      return;
    }
    const wordList = words
      .map((row, index) => `${index + 1}. ${row.word}`)
      .join("\n");
    bot.sendMessage(chatId, `Ваши слова:\n${wordList}`).catch(console.error);
  } catch (err) {
    console.error("Error retrieving words:", err);
    bot
      .sendMessage(chatId, "Ошибка при получении списка слов.")
      .catch(console.error);
  }
});

// Function: Send a random word and record it in history.
// This command is idempotent: if all words have been used, history is reset.
async function sendRandomWord(chatId) {
  try {
    const words = await dbAll(`SELECT id, word FROM words WHERE chat_id = ?`, [
      chatId,
    ]);
    if (!words || words.length === 0) {
      bot
        .sendMessage(
          chatId,
          "Список слов пуст. Добавьте слово командой /add <слово>."
        )
        .catch(console.error);
      return;
    }
    // Get history for the chat.
    const historyRows = await dbAll(
      `SELECT word_id FROM history WHERE chat_id = ?`,
      [chatId]
    );
    const usedIds = historyRows ? historyRows.map((r) => r.word_id) : [];
    let available = words.filter((row) => !usedIds.includes(row.id));
    if (available.length === 0) {
      // Reset history when all words have been used.
      await dbRun(`DELETE FROM history WHERE chat_id = ?`, [chatId]);
      available = words;
    }
    const chosen = available[Math.floor(Math.random() * available.length)];
    await dbRun(
      `INSERT OR IGNORE INTO history (chat_id, word_id) VALUES (?, ?)`,
      [chatId, chosen.id]
    );
    bot
      .sendMessage(chatId, `Случайное слово: ${chosen.word}`)
      .catch(console.error);
  } catch (err) {
    console.error("Error sending random word:", err);
    bot
      .sendMessage(chatId, "Ошибка при получении случайного слова.")
      .catch(console.error);
  }
}

// /random – Get a random word and add it to history.
bot.onText(/\/random/, async (msg) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  sendRandomWord(chatId);
});

// /time – Show or update the sending time.
// Without parameter, it shows current settings.
// With parameter, it expects the format: HH:MM±offset (e.g. /time 21:00+3 or /time 08:30-5).
bot.onText(/\/time(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  const param = match[1];
  if (!param) {
    try {
      const record = await dbGet(
        `SELECT send_time, timezone FROM chats WHERE chat_id = ?`,
        [chatId]
      );
      bot
        .sendMessage(
          chatId,
          `Время отправки: ${record.send_time} (UTC${record.timezone})`
        )
        .catch(console.error);
    } catch (err) {
      console.error("Error retrieving time settings:", err);
      bot
        .sendMessage(chatId, "Ошибка при получении настроек времени.")
        .catch(console.error);
    }
    return;
  }
  // Validate input using a regular expression.
  // Expected: HH:MM±offset, where offset can be an integer (optionally with :MM).
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)([+-]\d{1,2}(?::\d{2})?)$/;
  const parts = param.trim().match(timeRegex);
  if (!parts) {
    bot
      .sendMessage(
        chatId,
        "Неверный формат. Пример: /time 21:00+3 или /time 08:30-5"
      )
      .catch(console.error);
    return;
  }
  const hh = parts[1];
  const mm = parts[2];
  let tz = parts[3];
  // Normalize timezone: if offset is like "+3", convert to "+03:00".
  if (!tz.includes(":")) {
    const sign = tz.startsWith("-") ? "-" : "+";
    let hour = tz.slice(1);
    hour = hour.padStart(2, "0");
    tz = `${sign}${hour}:00`;
  }
  if (!validTimezones.has(tz)) {
    bot
      .sendMessage(
        chatId,
        "Неверное значение часового пояса. Допустимые значения: от -12:00 до +14:00."
      )
      .catch(console.error);
    return;
  }
  const newTime = `${hh}:${mm}`;
  try {
    await dbRun(
      `UPDATE chats SET send_time = ?, timezone = ? WHERE chat_id = ?`,
      [newTime, tz, chatId]
    );
    bot
      .sendMessage(
        chatId,
        `Время отправки установлено на ${newTime} (UTC${tz})`
      )
      .catch(console.error);
  } catch (err) {
    console.error("Error updating time settings:", err);
    bot
      .sendMessage(chatId, "Ошибка при обновлении настроек времени.")
      .catch(console.error);
  }
});

// --- Daily Scheduler ---
// This cron job checks every minute if it is time to send the word of the day.
async function sendDailyWordForChat(chat) {
  const chatId = chat.chat_id;
  try {
    const words = await dbAll(`SELECT id, word FROM words WHERE chat_id = ?`, [
      chatId,
    ]);
    if (!words || words.length === 0) {
      console.log(`Список слов пуст для чата ${chatId}`);
      return;
    }
    const historyRows = await dbAll(
      `SELECT word_id FROM history WHERE chat_id = ?`,
      [chatId]
    );
    const usedIds = historyRows ? historyRows.map((r) => r.word_id) : [];
    let available = words.filter((row) => !usedIds.includes(row.id));
    if (available.length === 0) {
      await dbRun(`DELETE FROM history WHERE chat_id = ?`, [chatId]);
      available = words;
    }
    const chosen = available[Math.floor(Math.random() * available.length)];
    await dbRun(
      `INSERT OR IGNORE INTO history (chat_id, word_id) VALUES (?, ?)`,
      [chatId, chosen.id]
    );
    await bot
      .sendMessage(chatId, `Слово дня: ${chosen.word}`)
      .catch(console.error);
    const today = new Date().toISOString().split("T")[0];
    await dbRun(`UPDATE chats SET last_sent_date = ? WHERE chat_id = ?`, [
      today,
      chatId,
    ]);
  } catch (err) {
    console.error(`Ошибка при отправке слова дня в чат ${chatId}:`, err);
  }
}

cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const chats = await dbAll(`SELECT * FROM chats`);
    for (const chat of chats) {
      // Calculate the chat's local time.
      // Parse the timezone (format ±HH:MM).
      const tz = chat.timezone || "+00:00";
      const tzMatch = tz.match(/([+-])(\d{2}):(\d{2})/);
      if (!tzMatch) {
        console.error(
          `Неверный формат часового пояса для чата ${chat.chat_id}: ${tz}`
        );
        continue;
      }
      const sign = tzMatch[1] === "-" ? -1 : 1;
      const tzHours = Number(tzMatch[2]);
      const tzMinutes = Number(tzMatch[3]);
      const tzOffsetMinutes = sign * (tzHours * 60 + tzMinutes);
      // Create a Date adjusted by the timezone offset.
      const chatTime = new Date(now.getTime() + tzOffsetMinutes * 60000);
      const currentHH = chatTime.getUTCHours().toString().padStart(2, "0");
      const currentMM = chatTime.getUTCMinutes().toString().padStart(2, "0");
      if (chat.send_time === `${currentHH}:${currentMM}`) {
        sendDailyWordForChat(chat);
      }
    }
  } catch (err) {
    console.error("Ошибка при проверке расписания:", err);
  }
});
