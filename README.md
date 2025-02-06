# Word of the day (wotd) bot

Node.js Telegram Word of the day bot.

## Features

* Automatically registers a chat (1-on-1 or group) when accessed.
* Allows adding a word with the command `/add <слово>` or via the "Добавить
  слово" button.
* Displays the list of words with inline delete buttons via `/list` or the
  "Список слов" button.
* Sends a random word from the list every day without repeating words until
  all have been used (history resets).
* Allows changing the scheduled sending time (default is 09:00) and timezone
  (default is UTC+3) via `/time` or the "Время" button.
* There is `/extra` command or "Другое слово" button that returns a random word
  from the full list without recording it in history.
* A main menu with inline buttons is provided for easy access to all commands.

Data (chats, words, history, scheduled time) is stored in an SQLite database,
with data isolated by `chat_id`.

Note: All time values are in 24‑hour format.
