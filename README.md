# Word of the day (wotd) bot

A simple Telegram bot that sends a daily word from your list at a scheduled time.
The bot supports group and solo chats using only commands.
It stores each chat’s word list, daily-send settings, and history in an SQLite database.
The bot also validates all input to ensure reliability.

## Features

* Add words to your personal list with `/add <word>`.
* Remove a word by exact match with `/remove <word>`.
* View your complete word list using `/words`.
* Retrieve a random word (and add it to history) using `/random`.
  Once all words have been used, the history resets automatically.
* View or update the scheduled daily-send time with `/time [HH:MM±offset]`.
  For example, `/time` shows the current settings, while `/time 21:00+3`
  sets the send time to 21:00 with timezone UTC+03:00.
  Default time is 09:00 with timezone UTC+03:00.
* View or change the number of days between a word change (default is 1)
  with `/days [N]`. For example, `/days` shows the current settings,
  while `/days 5` sets the number of days to 5.
* A cron job checks every minute and sends the "Word of the Day"
  at the scheduled time (adjusted to each chat’s timezone).
