const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const Knex = require("knex");
const knexConfig = require("./knexfile").development;
const knex = Knex(knexConfig);
const logger = require("./logger");

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
  logger.error("BOT_TOKEN environment variable is not set.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

/**
 * Run Knex migrations on startup.
 */
async function runMigrations() {
  try {
    const [batch, log] = await knex.migrate.latest();
    logger.info(`Migrations run`, { batch, migrationLog: log });
  } catch (err) {
    logger.error("Error running migrations", { error: err });
    process.exit(1);
  }
}

/**
 * Helper: Register the chat in the database.
 * Uses an "insert or ignore" strategy.
 */
async function registerChat(chat) {
  const chat_id = String(chat.id);
  const chat_type = chat.type;
  // For groups, use the title if available; otherwise fall back to first name.
  const chat_title = chat.title || chat.first_name || "Чат";
  try {
    await knex("chats")
      .insert({
        chat_id,
        chat_type,
        chat_title,
        send_time: "09:00",
        timezone: "+03:00",
      })
      .onConflict("chat_id")
      .ignore();
  } catch (err) {
    logger.error("Error registering chat", { error: err, chatId: chat_id });
  }
}

/**
 * /start - Greet the user and register the chat.
 */
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
    `/resend – повторно отправить текущее слово дня\n` +
    `/time [ЧЧ:ММ±смещение] – показать или установить время отправки\n` +
    `/days [N] – показать или установить период смены слова\n\n` +
    `Каждый день в установленное время я буду отправлять слово из вашего списка.`;
  try {
    await bot.sendMessage(chatId, welcomeMsg);
  } catch (err) {
    logger.error("Error sending welcome message", { error: err, chatId });
  }
});

/**
 * /add <word> – Add a word. Validation: non-empty, no excessive length.
 */
bot.onText(/\/add\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  let word = match[1].trim();

  // Basic validations.
  if (!word) {
    try {
      await bot.sendMessage(
        chatId,
        "Слово не может быть пустым. Используйте: /add <слово>"
      );
    } catch (err) {
      logger.error("Error sending validation message", { error: err, chatId });
    }
    return;
  }
  if (word.length > 30) {
    try {
      await bot.sendMessage(
        chatId,
        "Слишком длинное слово! Максимум 30 символов."
      );
    } catch (err) {
      logger.error("Error sending validation message", { error: err, chatId });
    }
    return;
  }
  if (!/^[\wа-яА-ЯёЁ\s-]+$/.test(word)) {
    try {
      await bot.sendMessage(chatId, "Слово содержит недопустимые символы.");
    } catch (err) {
      logger.error("Error sending validation message", { error: err, chatId });
    }
    return;
  }
  try {
    // Check for duplicate.
    const exists = await knex("words")
      .select("word")
      .where({ chat_id: chatId, word })
      .first();
    if (exists) {
      try {
        await bot.sendMessage(chatId, `Слово "${word}" уже есть в списке.`);
      } catch (err) {
        logger.error("Error sending duplicate word message", {
          error: err,
          chatId,
          word,
        });
      }
      return;
    }
    await knex("words").insert({ chat_id: chatId, word });
    try {
      await bot.sendMessage(chatId, `Слово "${word}" добавлено.`);
    } catch (err) {
      logger.error("Error sending success message", {
        error: err,
        chatId,
        word,
      });
    }
  } catch (err) {
    logger.error("Error adding word", { error: err, chatId, word });
    try {
      await bot.sendMessage(chatId, "Ошибка при добавлении слова.");
    } catch (sendErr) {
      logger.error("Error sending error message", { error: sendErr, chatId });
    }
  }
});

/**
 * /remove <word> – Remove a word by an exact match.
 */
bot.onText(/\/remove\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  let word = match[1].trim();
  if (!word) {
    try {
      await bot.sendMessage(chatId, "Укажите слово после команды /remove.");
    } catch (err) {
      logger.error("Error sending validation message", { error: err, chatId });
    }
    return;
  }
  try {
    const row = await knex("words")
      .select("id")
      .where({ chat_id: chatId, word })
      .first();
    if (!row) {
      try {
        await bot.sendMessage(chatId, `Слово "${word}" не найдено.`);
      } catch (err) {
        logger.error("Error sending not found message", {
          error: err,
          chatId,
          word,
        });
      }
      return;
    }
    await knex("words").where({ id: row.id, chat_id: chatId }).del();
    await knex("history").where({ word_id: row.id, chat_id: chatId }).del();
    try {
      await bot.sendMessage(chatId, `Слово "${word}" удалено.`);
    } catch (err) {
      logger.error("Error sending success message", {
        error: err,
        chatId,
        word,
      });
    }
  } catch (err) {
    logger.error("Error removing word", { error: err, chatId, word });
    try {
      await bot.sendMessage(chatId, "Ошибка при удалении слова.");
    } catch (sendErr) {
      logger.error("Error sending error message", { error: sendErr, chatId });
    }
  }
});

/**
 * /words – List all words.
 */
bot.onText(/\/words/, async (msg) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  try {
    const words = await knex("words").select("word").where({ chat_id: chatId });
    if (!words || words.length === 0) {
      try {
        await bot.sendMessage(
          chatId,
          "Список слов пуст. Добавьте слово командой /add <слово>."
        );
      } catch (err) {
        logger.error("Error sending empty list message", {
          error: err,
          chatId,
        });
      }
      return;
    }
    const wordList = words
      .map((row, index) => `${index + 1}. ${row.word}`)
      .join("\n");
    try {
      await bot.sendMessage(chatId, `Ваши слова:\n${wordList}`);
    } catch (err) {
      logger.error("Error sending word list", { error: err, chatId });
    }
  } catch (err) {
    logger.error("Error retrieving words", { error: err, chatId });
    try {
      await bot.sendMessage(chatId, "Ошибка при получении списка слов.");
    } catch (sendErr) {
      logger.error("Error sending error message", { error: sendErr, chatId });
    }
  }
});

/**
 * Function: Send a random word and record it in history.
 * This command is idempotent: if all words have been used, the history is reset.
 */
async function sendRandomWord(chatId) {
  try {
    const words = await knex("words")
      .select("id", "word")
      .where({ chat_id: chatId });
    if (!words || words.length === 0) {
      try {
        await bot.sendMessage(
          chatId,
          "Список слов пуст. Добавьте слово командой /add <слово>."
        );
      } catch (err) {
        logger.error("Error sending empty list message", {
          error: err,
          chatId,
        });
      }
      return;
    }
    // Get history for the chat.
    const historyRows = await knex("history")
      .select("word_id")
      .where({ chat_id: chatId });
    const usedIds = historyRows.map((r) => r.word_id);
    let available = words.filter((row) => !usedIds.includes(row.id));
    if (available.length === 0) {
      // Reset history when all words have been used.
      await knex("history").where({ chat_id: chatId }).del();
      available = words;
    }
    const chosen = available[Math.floor(Math.random() * available.length)];
    await knex("history")
      .insert({ chat_id: chatId, word_id: chosen.id })
      .onConflict(["chat_id", "word_id"])
      .ignore();
    try {
      await bot.sendMessage(chatId, `Случайное слово: ${chosen.word}`);
    } catch (err) {
      logger.error("Error sending random word", {
        error: err,
        chatId,
        word: chosen.word,
      });
    }
  } catch (err) {
    logger.error("Error processing random word", { error: err, chatId });
    try {
      await bot.sendMessage(chatId, "Ошибка при получении случайного слова.");
    } catch (sendErr) {
      logger.error("Error sending error message", { error: sendErr, chatId });
    }
  }
}

/**
 * /random – Get a random word and add it to history.
 */
bot.onText(/\/random/, async (msg) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  sendRandomWord(chatId);
});

/**
 * /time – Show or update the sending time.
 * Format: HH:MM±offset (e.g., /time 21:00+3 or /time 08:30-5)
 */
bot.onText(/\/time(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  const param = match[1];
  if (!param) {
    try {
      const record = await knex("chats")
        .select("send_time", "timezone")
        .where({ chat_id: chatId })
        .first();
      try {
        await bot.sendMessage(
          chatId,
          `Время отправки: ${record.send_time} (UTC${record.timezone})`
        );
      } catch (err) {
        logger.error("Error sending time settings", { error: err, chatId });
      }
    } catch (err) {
      logger.error("Error retrieving time settings", { error: err, chatId });
      try {
        await bot.sendMessage(chatId, "Ошибка при получении настроек времени.");
      } catch (sendErr) {
        logger.error("Error sending error message", {
          error: sendErr,
          chatId,
        });
      }
    }
    return;
  }
  // Validate input using a regular expression.
  // Expected: HH:MM±offset, where offset can be an integer (optionally with :MM).
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)([+-]\d{1,2}(?::\d{2})?)$/;
  const parts = param.trim().match(timeRegex);
  if (!parts) {
    try {
      await bot.sendMessage(
        chatId,
        "Неверный формат. Пример: /time 21:00+3 или /time 08:30-5"
      );
    } catch (err) {
      logger.error("Error sending validation message", { error: err, chatId });
    }
    return;
  }
  const hh = parts[1];
  const mm = parts[2];
  let tz = parts[3];
  // Normalize timezone: always ensure format is ±HH:MM
  if (tz.includes(":")) {
    const [signAndHour, minute] = tz.split(":");
    const sign = signAndHour.charAt(0);
    let hour = signAndHour.slice(1).padStart(2, "0");
    tz = `${sign}${hour}:${minute}`;
  } else {
    const sign = tz.startsWith("-") ? "-" : "+";
    let hour = tz.slice(1).padStart(2, "0");
    tz = `${sign}${hour}:00`;
  }
  if (!validTimezones.has(tz)) {
    try {
      await bot.sendMessage(
        chatId,
        "Неверное значение часового пояса. Допустимые значения: от -12:00 до +14:00."
      );
    } catch (err) {
      logger.error("Error sending validation message", { error: err, chatId });
    }
    return;
  }
  const newTime = `${hh}:${mm}`;
  try {
    await knex("chats")
      .where({ chat_id: chatId })
      .update({ send_time: newTime, timezone: tz });
    try {
      await bot.sendMessage(
        chatId,
        `Время отправки установлено на ${newTime} (UTC${tz})`
      );
    } catch (err) {
      logger.error("Error sending success message", {
        error: err,
        chatId,
        newTime,
        timezone: tz,
      });
    }
  } catch (err) {
    logger.error("Error updating time settings", {
      error: err,
      chatId,
      newTime,
      timezone: tz,
    });
    try {
      await bot.sendMessage(chatId, "Ошибка при обновлении настроек времени.");
    } catch (sendErr) {
      logger.error("Error sending error message", { error: sendErr, chatId });
    }
  }
});

/**
 * /days – Show or update the number of days between a word change.
 * Format: /days [N]
 */
bot.onText(/\/days(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  const param = match[1];
  if (!param) {
    try {
      const record = await knex("chats")
        .select("days")
        .where({ chat_id: chatId })
        .first();
      try {
        await bot.sendMessage(
          chatId,
          `Период смены слова: ${record.days} дней`
        );
      } catch (err) {
        logger.error("Error sending days setting", { error: err, chatId });
      }
    } catch (err) {
      logger.error("Error retrieving days setting", { error: err, chatId });
      try {
        await bot.sendMessage(chatId, "Ошибка при получении настроек периода.");
      } catch (sendErr) {
        logger.error("Error sending error message", {
          error: sendErr,
          chatId,
        });
      }
    }
    return;
  }
  const days = parseInt(param, 10);
  if (isNaN(days) || days < 1) {
    try {
      await bot.sendMessage(
        chatId,
        "Неверное значение. Период должен быть целым числом, большим или равным 1."
      );
    } catch (err) {
      logger.error("Error sending validation message", { error: err, chatId });
    }
    return;
  }
  try {
    await knex("chats").where({ chat_id: chatId }).update({ days });
    try {
      await bot.sendMessage(
        chatId,
        `Период смены слова установлен на ${days} дней.`
      );
    } catch (err) {
      logger.error("Error sending success message", {
        error: err,
        chatId,
        days,
      });
    }
  } catch (err) {
    logger.error("Error updating days setting", { error: err, chatId, days });
    try {
      await bot.sendMessage(chatId, "Ошибка при обновлении настроек периода.");
    } catch (sendErr) {
      logger.error("Error sending error message", { error: sendErr, chatId });
    }
  }
});

/**
 * /resend - Resend today's word without changing any state.
 */
bot.onText(/\/resend/, async (msg) => {
  const chatId = String(msg.chat.id);
  await registerChat(msg.chat);
  try {
    const chat = await knex("chats")
      .select("current_word_id")
      .where({ chat_id: chatId })
      .first();
    if (!chat?.current_word_id) {
      try {
        await bot.sendMessage(chatId, "Нет текущего слова дня.");
      } catch (err) {
        logger.error("Error sending no word message", { error: err, chatId });
      }
      return;
    }
    const wordRecord = await knex("words")
      .select("word")
      .where({ id: chat.current_word_id, chat_id: chatId })
      .first();
    if (!wordRecord) {
      try {
        await bot.sendMessage(
          chatId,
          "Текущее слово не найдено в базе данных."
        );
      } catch (err) {
        logger.error("Error sending word not found message", {
          error: err,
          chatId,
        });
      }
      return;
    }
    try {
      await bot.sendMessage(chatId, `Слово дня: ${wordRecord.word}`);
    } catch (err) {
      logger.error("Error sending word", {
        error: err,
        chatId,
        word: wordRecord.word,
      });
    }
  } catch (err) {
    logger.error("Error resending word", { error: err, chatId });
    try {
      await bot.sendMessage(chatId, "Ошибка при повторной отправке слова.");
    } catch (sendErr) {
      logger.error("Error sending error message", { error: sendErr, chatId });
    }
  }
});

/**
 * Daily Scheduler: Send the daily word (or repeat the current one if within its period).
 */
async function sendDailyWordForChat(chat) {
  const chatId = chat.chat_id;
  const today = new Date().toISOString().split("T")[0];

  // If a current word exists and its word change period hasn't expired, re-send it.
  if (chat.current_word_id && chat.word_start_date) {
    const startDate = new Date(chat.word_start_date);
    const currentDate = new Date(today);
    const diffDays = Math.floor(
      (currentDate - startDate) / (1000 * 60 * 60 * 24)
    );
    if (diffDays < chat.days) {
      const wordRecord = await knex("words")
        .select("word")
        .where({ id: chat.current_word_id, chat_id: chatId })
        .first();
      if (wordRecord) {
        try {
          await bot.sendMessage(chatId, `Слово дня: ${wordRecord.word}`);
          await knex("chats")
            .where({ chat_id: chatId })
            .update({ last_sent_date: today });
        } catch (err) {
          logger.error("Error sending daily word", {
            error: err,
            chatId,
            word: wordRecord.word,
          });
        }
        return;
      }
      // If the stored word no longer exists, fall through and choose a new word.
    }
  }

  try {
    const words = await knex("words")
      .select("id", "word")
      .where({ chat_id: chatId });
    if (!words || words.length === 0) {
      logger.info("Empty word list", { chatId });
      return;
    }
    const historyRows = await knex("history")
      .select("word_id")
      .where({ chat_id: chatId });
    const usedIds = historyRows.map((r) => r.word_id);
    let available = words.filter((row) => !usedIds.includes(row.id));
    if (available.length === 0) {
      await knex("history").where({ chat_id: chatId }).del();
      available = words;
    }
    const chosen = available[Math.floor(Math.random() * available.length)];
    await knex("history")
      .insert({ chat_id: chatId, word_id: chosen.id })
      .onConflict(["chat_id", "word_id"])
      .ignore();
    await knex("chats").where({ chat_id: chatId }).update({
      current_word_id: chosen.id,
      word_start_date: today,
      last_sent_date: today,
    });
    try {
      await bot.sendMessage(chatId, `Слово дня: ${chosen.word}`);
    } catch (err) {
      logger.error("Error sending daily word", {
        error: err,
        chatId,
        word: chosen.word,
      });
    }
  } catch (err) {
    logger.error("Error processing daily word", { error: err, chatId });
  }
}

// Cron job: every minute check if it is time to send the daily word.
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const chats = await knex("chats").select("*");
    const tasks = chats.map(async (chat) => {
      const tz = chat.timezone || "+00:00";
      const tzMatch = tz.match(/([+-])(\d{2}):(\d{2})/);
      if (!tzMatch) {
        logger.error("Invalid timezone format", {
          chatId: chat.chat_id,
          timezone: tz,
        });
        return;
      }
      const sign = tzMatch[1] === "-" ? -1 : 1;
      const tzHours = Number(tzMatch[2]);
      const tzMinutes = Number(tzMatch[3]);
      const tzOffsetMinutes = sign * (tzHours * 60 + tzMinutes);
      const chatTime = new Date(now.getTime() + tzOffsetMinutes * 60000);
      const currentHH = chatTime.getUTCHours().toString().padStart(2, "0");
      const currentMM = chatTime.getUTCMinutes().toString().padStart(2, "0");
      if (chat.send_time === `${currentHH}:${currentMM}`) {
        await sendDailyWordForChat(chat);
      }
    });
    await Promise.all(tasks);
  } catch (err) {
    logger.error("Error in scheduler", { error: err });
  }
});

/**
 * Start-up: Run migrations and then initialize the bot.
 */
(async function startBot() {
  await runMigrations();
  logger.info("Migrations complete, bot is running...");
  // All command handlers and cron jobs have already been registered.
})();
