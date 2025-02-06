const TelegramBot = require("node-telegram-bot-api");
const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");

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

// Read the token from the environment variable. Exit if not set.
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Error: BOT_TOKEN environment variable is not set.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Connect to the SQLite database
const db = new sqlite3.Database("db.sqlite", (err) => {
  if (err) {
    console.error("Database connection error:", err);
  } else {
    console.log("Database connected successfully.");
  }
});

// Promise wrappers for SQLite operations
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

// Create necessary tables if they do not exist.
// The 'chats' table includes 'send_time' (default "09:00")
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS chats (
    chat_id TEXT PRIMARY KEY,
    chat_type TEXT,
    chat_title TEXT,
    last_sent_date TEXT,
    send_time TEXT DEFAULT '09:00',
    timezone TEXT DEFAULT '+03:00'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    word TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS history (
    chat_id TEXT NOT NULL,
    word_id INTEGER NOT NULL,
    PRIMARY KEY (chat_id, word_id)
  )`);
});

// Function to register a chat: creates a record if it doesn't exist.
async function registerChat(chat) {
  const chat_id = String(chat.id);
  const chat_type = chat.type;
  const chat_title = chat.title || chat.first_name || "Чат";
  try {
    await dbRun(
      `INSERT OR IGNORE INTO chats (chat_id, chat_type, chat_title, send_time, timezone) ` +
        `VALUES (?, ?, ?, '09:00', '+03:00')`,
      [chat_id, chat_type, chat_title]
    );
    // If the record already exists, ensure send_time and timezone are set (if missing)
    await dbRun(
      `UPDATE chats SET
       send_time = COALESCE(NULLIF(send_time, ''), '09:00'),
       timezone = COALESCE(NULLIF(timezone, ''), '+03:00')
       WHERE chat_id = ?`,
      [chat_id]
    );
  } catch (err) {
    console.error("Error registering chat:", err);
  }
}

// Global storage for pending new time requests (keyed by chat_id)
const pendingTimeRequests = {};

// Global storage for pending add word requests (keyed by chat_id)
const pendingAddRequests = {};

// Function to build the main menu inline keyboard
function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Добавить слово", callback_data: "menu_add" },
        { text: "Список слов", callback_data: "menu_list" },
      ],
      [
        { text: "Другое слово", callback_data: "extra" },
        { text: "Время", callback_data: "menu_time" },
      ],
      [{ text: "Помощь", callback_data: "menu_help" }],
    ],
  };
}

// /start command - greeting and instructions with main menu
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await registerChat(msg.chat);
  const welcomeMsg =
    `Привет! Я бот "Слово дня".\n\n` +
    `• Добавьте слово командой: /add <слово>\n` +
    `• Посмотреть список слов: /list\n` +
    `• Получить дополнительное слово: нажмите кнопку "Другое слово" или используйте /extra\n` +
    `• Задать время и часовой пояс отправки: /time\n\n` +
    `Каждый день я буду отправлять случайное слово из вашего списка, ` +
    `не повторяя их, пока не будут исчерпаны все варианты.\n` +
    `Если все слова использованы, история сбрасывается.\n\n` +
    `Время работает в 24-часовом формате.`;
  bot.sendMessage(chatId, welcomeMsg, {
    reply_markup: getMainMenuKeyboard(),
  });
});

// /add command - adding a word (manual text command)
bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  await registerChat(msg.chat);
  const word = match[1].trim();
  if (!word) {
    bot.sendMessage(chatId, "Пожалуйста, укажите слово после команды /add.");
    return;
  }
  try {
    await dbRun(`INSERT INTO words (chat_id, word) VALUES (?, ?)`, [
      String(chatId),
      word,
    ]);
    bot.sendMessage(chatId, `Слово "${word}" добавлено в список.`, {
      reply_markup: getMainMenuKeyboard(),
    });
  } catch (err) {
    console.error("Error adding word:", err);
    bot.sendMessage(chatId, "Ошибка при добавлении слова.");
  }
});

// /list command - displaying the list of words with delete buttons
bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  await registerChat(msg.chat);
  try {
    const words = await dbAll(`SELECT id, word FROM words WHERE chat_id = ?`, [
      String(chatId),
    ]);
    if (!words || words.length === 0) {
      bot.sendMessage(
        chatId,
        "Список слов пуст. Добавьте новое слово командой /add <слово>.",
        { reply_markup: getMainMenuKeyboard() }
      );
      return;
    }
    let message = "Ваш список слов:\n";
    const inline_keyboard = [];
    words.forEach((row, index) => {
      message += `${index + 1}. ${row.word}\n`;
      inline_keyboard.push([
        { text: `Удалить "${row.word}"`, callback_data: `delete:${row.id}` },
      ]);
    });
    bot.sendMessage(chatId, message, { reply_markup: { inline_keyboard } });
  } catch (err) {
    console.error("Error fetching word list:", err);
    bot.sendMessage(msg.chat.id, "Ошибка при получении списка слов.");
  }
});

// /extra command - get an extra word (not recorded in history)
bot.onText(/\/extra/, async (msg) => {
  const chatId = msg.chat.id;
  await registerChat(msg.chat);
  try {
    const words = await dbAll(`SELECT word FROM words WHERE chat_id = ?`, [
      String(chatId),
    ]);
    if (!words || words.length === 0) {
      bot.sendMessage(
        chatId,
        "Список слов пуст. Добавьте новое слово командой /add <слово>.",
        { reply_markup: getMainMenuKeyboard() }
      );
      return;
    }
    const randomWord = words[Math.floor(Math.random() * words.length)].word;
    bot.sendMessage(chatId, `Случайное слово: ${randomWord}`, {
      reply_markup: getMainMenuKeyboard(),
    });
  } catch (err) {
    console.error("Error fetching extra word via /extra:", err);
    bot.sendMessage(chatId, "Ошибка при получении дополнительного слова.");
  }
});

// /time command - show current sending time and timezone options
bot.onText(/\/time/, async (msg) => {
  const chatId = msg.chat.id;
  await registerChat(msg.chat);
  try {
    const chatRecord = await dbGet(
      `SELECT send_time, timezone FROM chats WHERE chat_id = ?`,
      [String(chatId)]
    );
    const currentTime = chatRecord ? chatRecord.send_time : "09:00";
    const timezone = chatRecord ? chatRecord.timezone : "+03:00";
    const message =
      `Текущее время отправки слова дня: ${currentTime} (UTC${timezone})\n` +
      `По умолчанию используется часовой пояс Москвы (UTC+03:00)\n` +
      `Время работает в 24-часовом формате.`;
    bot.sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Изменить время", callback_data: "set_time" },
            { text: "Изменить часовой пояс", callback_data: "set_timezone" },
          ],
        ],
      },
    });
  } catch (err) {
    console.error("Error retrieving sending time:", err);
    bot.sendMessage(chatId, "Ошибка при получении времени отправки.");
  }
});

// /help command - help message
bot.onText(/\/help/, async (msg) => {
  const helpMsg =
    `Доступные команды:\n` +
    `/start – Запуск бота и вывод инструкции\n` +
    `/add <слово> – Добавить слово в список\n` +
    `/list – Показать список слов (с кнопками для удаления)\n` +
    `/extra – Получить дополнительное случайное слово\n` +
    `/time – Показать/изменить время и часовой пояс отправки слова дня\n` +
    `(Время работает в 24-часовом формате.)`;
  bot.sendMessage(msg.chat.id, helpMsg, {
    reply_markup: getMainMenuKeyboard(),
  });
});

// Handling callback queries for inline buttons
bot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  // Delete word button handling
  if (data.startsWith("delete:")) {
    const wordId = data.split(":")[1];
    try {
      const wordRow = await dbGet(
        `SELECT word FROM words WHERE id = ? AND chat_id = ?`,
        [wordId, String(chatId)]
      );
      if (!wordRow) {
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "Слово не найдено или уже удалено.",
        });
        return;
      }
      await dbRun(`DELETE FROM words WHERE id = ? AND chat_id = ?`, [
        wordId,
        String(chatId),
      ]);
      await dbRun(`DELETE FROM history WHERE word_id = ? AND chat_id = ?`, [
        wordId,
        String(chatId),
      ]);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: `Слово "${wordRow.word}" удалено.`,
      });
      // Update the word list message
      const words = await dbAll(
        `SELECT id, word FROM words WHERE chat_id = ?`,
        [String(chatId)]
      );
      if (!words || words.length === 0) {
        bot.editMessageText(
          "Список слов пуст. Добавьте новое слово командой /add <слово>.",
          {
            chat_id: chatId,
            message_id: msg.message_id,
          }
        );
      } else {
        let message = "Ваш список слов:\n";
        const inline_keyboard = [];
        words.forEach((row, index) => {
          message += `${index + 1}. ${row.word}\n`;
          inline_keyboard.push([
            {
              text: `Удалить "${row.word}"`,
              callback_data: `delete:${row.id}`,
            },
          ]);
        });
        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: msg.message_id,
          reply_markup: { inline_keyboard: inline_keyboard },
        });
      }
    } catch (err) {
      console.error("Error deleting word:", err);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Ошибка при удалении слова.",
      });
    }
  }
  // "Другое слово" button handling
  else if (data === "extra") {
    try {
      const words = await dbAll(`SELECT word FROM words WHERE chat_id = ?`, [
        String(chatId),
      ]);
      if (!words || words.length === 0) {
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "Список слов пуст. Добавьте новое слово командой /add <слово>.",
        });
        return;
      }
      const randomWord = words[Math.floor(Math.random() * words.length)].word;
      bot.sendMessage(chatId, `Случайное слово: ${randomWord}`, {
        reply_markup: getMainMenuKeyboard(),
      });
      bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
      console.error("Error fetching extra word:", err);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Ошибка при получении дополнительного слова.",
      });
    }
  }
  // "Изменить время" or "Изменить часовой пояс" button handling
  else if (data === "set_time" || data === "set_timezone") {
    // Mark that we are waiting for a new input from this chat
    pendingTimeRequests[String(chatId)] = {
      userId: callbackQuery.from.id,
      type: data === "set_time" ? "time" : "timezone",
    };
    const message =
      data === "set_time"
        ? "Пожалуйста, введите новое время в формате ЧЧ:ММ (например, 21:30)."
        : "Пожалуйста, введите смещение часового пояса в формате " +
          "±ЧЧ:ММ (например, +05:00 или -08:00)";
    bot.sendMessage(chatId, message);
    bot.answerCallbackQuery(callbackQuery.id);
  }
  // Main menu: "Добавить слово"
  else if (data === "menu_add") {
    pendingAddRequests[String(chatId)] = { userId: callbackQuery.from.id };
    bot.sendMessage(
      chatId,
      "Пожалуйста, введите слово, которое хотите добавить."
    );
    bot.answerCallbackQuery(callbackQuery.id);
  }
  // Main menu: "Список слов"
  else if (data === "menu_list") {
    // Reuse the /list command functionality
    try {
      const words = await dbAll(
        `SELECT id, word FROM words WHERE chat_id = ?`,
        [String(chatId)]
      );
      if (!words || words.length === 0) {
        bot.sendMessage(
          chatId,
          "Список слов пуст. Добавьте новое слово командой /add <слово>.",
          { reply_markup: getMainMenuKeyboard() }
        );
        bot.answerCallbackQuery(callbackQuery.id);
        return;
      }
      let message = "Ваш список слов:\n";
      const inline_keyboard = [];
      words.forEach((row, index) => {
        message += `${index + 1}. ${row.word}\n`;
        inline_keyboard.push([
          { text: `Удалить "${row.word}"`, callback_data: `delete:${row.id}` },
        ]);
      });
      bot.sendMessage(chatId, message, { reply_markup: { inline_keyboard } });
      bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
      console.error("Error fetching word list (menu_list):", err);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Ошибка при получении списка слов.",
      });
    }
  }
  // Main menu: "Время"
  else if (data === "menu_time") {
    try {
      const chatRecord = await dbGet(
        `SELECT send_time, timezone FROM chats WHERE chat_id = ?`,
        [String(chatId)]
      );
      const currentTime = chatRecord ? chatRecord.send_time : "09:00";
      const timezone = chatRecord ? chatRecord.timezone : "+03:00";
      const message =
        `Текущее время отправки слова дня: ${currentTime} (UTC${timezone})\n` +
        `По умолчанию используется часовой пояс Москвы (UTC+03:00)\n` +
        `Время работает в 24-часовом формате.`;
      bot.sendMessage(chatId, message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Изменить время", callback_data: "set_time" },
              { text: "Изменить часовой пояс", callback_data: "set_timezone" },
            ],
          ],
        },
      });
      bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
      console.error("Error retrieving time (menu_time):", err);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Ошибка при получении времени отправки.",
      });
    }
  }
  // Main menu: "Помощь" or unknown callback
  else if (data === "menu_help") {
    const helpMsg =
      `Доступные команды:\n` +
      `/start – Запуск бота и вывод инструкции\n` +
      `/add <слово> – Добавить слово в список\n` +
      `/list – Показать список слов (с кнопками для удаления)\n` +
      `/extra – Получить дополнительное случайное слово\n` +
      `/time – Показать/изменить время отправки слова дня\n` +
      `(Время работает в 24-часовом формате.)`;
    bot.sendMessage(chatId, helpMsg, {
      reply_markup: getMainMenuKeyboard(),
    });
    bot.answerCallbackQuery(callbackQuery.id);
  }
});

// Handle messages for new time or timezone input if pending
bot.on("message", async (msg) => {
  const chatId = String(msg.chat.id);
  // If waiting for new input and the message is not a command
  if (pendingTimeRequests[chatId] && msg.text && !msg.text.startsWith("/")) {
    // In group chats, ensure the same user who initiated the request is responding
    if (
      pendingTimeRequests[chatId].userId &&
      pendingTimeRequests[chatId].userId !== msg.from.id
    ) {
      return; // Ignore input from other users.
    }
    const inputType = pendingTimeRequests[chatId].type;
    const input = msg.text.trim();
    if (inputType === "time") {
      // Validate time format HH:MM (24-hour format)
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(input)) {
        bot.sendMessage(
          chatId,
          "Неверный формат. Введите время в формате ЧЧ:ММ (например, 21:30)."
        );
        return;
      }
      try {
        await dbRun(`UPDATE chats SET send_time = ? WHERE chat_id = ?`, [
          input,
          chatId,
        ]);
        const chatRecord = await dbGet(
          `SELECT timezone FROM chats WHERE chat_id = ?`,
          [chatId]
        );
        bot.sendMessage(
          chatId,
          `Время отправки слова дня изменено на: ${input} (UTC${chatRecord.timezone})`,
          { reply_markup: getMainMenuKeyboard() }
        );
      } catch (err) {
        console.error("Error updating sending time:", err);
        bot.sendMessage(chatId, "Ошибка при обновлении времени отправки.");
      }
    } else if (inputType === "timezone") {
      if (!validTimezones.has(input)) {
        bot.sendMessage(
          chatId,
          "Неверный формат. Введите смещение в формате ±ЧЧ:ММ (например, +05:00 или -08:00)."
        );
        return;
      }
      try {
        await dbRun(`UPDATE chats SET timezone = ? WHERE chat_id = ?`, [
          input,
          chatId,
        ]);
        const chatRecord = await dbGet(
          `SELECT send_time FROM chats WHERE chat_id = ?`,
          [chatId]
        );
        bot.sendMessage(
          chatId,
          `Часовой пояс изменен на: UTC${input}\nВремя отправки: ${chatRecord.send_time} (UTC${input})`,
          { reply_markup: getMainMenuKeyboard() }
        );
      } catch (err) {
        console.error("Error updating timezone:", err);
        bot.sendMessage(chatId, "Ошибка при обновлении часового пояса.");
      }
    }
    // Clear the pending request
    delete pendingTimeRequests[chatId];
  }
  // Handle pending add word requests
  else if (
    pendingAddRequests[chatId] &&
    msg.text &&
    !msg.text.startsWith("/")
  ) {
    if (
      pendingAddRequests[chatId].userId &&
      pendingAddRequests[chatId].userId !== msg.from.id
    ) {
      return; // Ignore input from other users.
    }
    const word = msg.text.trim();
    if (!word) {
      bot.sendMessage(chatId, "Слово не может быть пустым.");
      return;
    }
    if (word.length > 30) {
      bot.sendMessage(chatId, "Слишком длинное слово! Максимум 30 символов.");
      return;
    }
    const existingWord = await dbGet(
      `SELECT word FROM words WHERE chat_id = ? AND word = ?`,
      [chatId, word]
    );
    if (existingWord) {
      bot.sendMessage(chatId, `Слово "${word}" уже есть в вашем списке.`);
      return;
    }
    try {
      await dbRun(`INSERT INTO words (chat_id, word) VALUES (?, ?)`, [
        chatId,
        word,
      ]);
      bot.sendMessage(chatId, `Слово "${word}" добавлено в список.`, {
        reply_markup: getMainMenuKeyboard(),
      });
    } catch (err) {
      console.error("Error adding word (menu):", err);
      bot.sendMessage(chatId, "Ошибка при добавлении слова.");
    }
    delete pendingAddRequests[chatId];
  }
});

// Function to send the "Word of the Day" for a specific chat
async function sendDailyWordForChat(chat) {
  const chatId = chat.chat_id;
  try {
    const words = await dbAll(`SELECT id, word FROM words WHERE chat_id = ?`, [
      chatId,
    ]);
    if (!words || words.length === 0) {
      console.log(`Word list is empty for chat ${chatId}.`);
      return;
    }
    const historyRows = await dbAll(
      `SELECT word_id FROM history WHERE chat_id = ?`,
      [chatId]
    );
    const usedIds = historyRows ? historyRows.map((row) => row.word_id) : [];
    let availableWords = words.filter((row) => !usedIds.includes(row.id));
    if (availableWords.length === 0) {
      await dbRun(`DELETE FROM history WHERE chat_id = ?`, [chatId]);
      availableWords = words;
    }
    const chosen =
      availableWords[Math.floor(Math.random() * availableWords.length)];
    await dbRun(
      `INSERT OR IGNORE INTO history (chat_id, word_id) VALUES (?, ?)`,
      [chatId, chosen.id]
    );
    const message = `Слово дня: ${chosen.word}`;
    await bot.sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [[{ text: "Другое слово", callback_data: "extra" }]],
      },
    });
    // Update the last sent date for this chat
    const today = new Date().toISOString().split("T")[0];
    await dbRun(`UPDATE chats SET last_sent_date = ? WHERE chat_id = ?`, [
      today,
      chatId,
    ]);
  } catch (err) {
    console.error(`Error sending word of the day to chat ${chatId}:`, err);
  }
}

// Global scheduler: check every minute if it's time to send the word of the day for any chat.
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const chats = await dbAll(`SELECT * FROM chats`);
    for (const chat of chats) {
      // Get chat's timezone offset in minutes
      const timezone = chat.timezone || "+00:00";
      const match = timezone.match(/([+-]\d{2}):(\d{2})/);
      const [tzHours, tzMinutes] = (match ? match.slice(1) : ["00", "00"]).map(
        Number
      );
      const tzOffsetMinutes =
        (tzHours * 60 + tzMinutes) * (timezone.startsWith("-") ? -1 : 1);
      // Create a date object in the chat's timezone
      const chatTime = new Date(now.getTime() + tzOffsetMinutes * 60000);
      const chatHH = chatTime.getUTCHours().toString().padStart(2, "0");
      const chatMM = chatTime.getUTCMinutes().toString().padStart(2, "0");
      if (chat.send_time === `${chatHH}:${chatMM}`) {
        sendDailyWordForChat(chat);
      }
    }
  } catch (err) {
    console.error("Error checking schedule for word of the day:", err);
  }
});
