# Word of the day (WOTD) bot

[![CI](https://github.com/hu553in/wotd-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/hu553in/wotd-bot/actions/workflows/ci.yml)

A lightweight Telegram bot that sends a daily word from your custom list at a scheduled time.

The bot works in both private and group chats, uses a command-only interface, and is designed to be predictable,
reliable, and easy to operate. All state is stored locally in an SQLite database.

## Features

- Add a word to your list with `/add <word>`.
- Remove a word by exact match using `/remove <word>`.
- View the full word list with `/words`.
- Get a random word (and record it in history) using `/random`.
  - Once all words have been used, the history resets automatically.
- Resend today’s word without changing state using `/resend`.
- View or update the daily send time with `/time [HH:MM±offset]`.
  - `/time` shows the current schedule.
  - `/time 21:00+3` sets the time to 21:00 with timezone UTC+03:00.
  - Default schedule is 09:00, UTC+03:00.
- View or change how many days a word stays active using `/days [N]`.
  - `/days` shows the current value.
  - `/days 5` sets the period to 5 days.
- A cron job runs every minute and delivers the “Word of the day”
  at the configured time for each chat, adjusted to its timezone.
- Pause and resume daily delivery with `/pause` and `/resume`.
  - While paused, the bot remembers the current word and its remaining period.
  - On resume, if the period hasn’t expired, the bot shows the current word
    and how many days remain until the next change.

## Notes

- Each chat has its own isolated word list, schedule, and history.
- Input is fully validated to prevent invalid states.
- Designed for consistency and long-term unattended operation.
