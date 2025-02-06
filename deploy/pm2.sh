#!/bin/bash

process="word-of-the-day-bot"

\. ~/.nvm/nvm.sh

cd /srv/$process
npm i

npm i -g pm2

if pm2 list | grep -q $process; then
    pm2 restart $process --update-env
else
    pm2 start bot.js --name $process --update-env
    pm2 startup
    pm2 save
fi

sleep 10

pm2_jlist_output=$(pm2 jlist)

apt-get -y install jq

process_status=$(
  echo "$pm2_jlist_output" \
    | jq -r --arg PROCESS "$process" '
        .[]
        | select(.name == $PROCESS)
        | .pm2_env.status
      '
)

echo "Process '$process' is in status: $process_status"

if [ "$process_status" = "online" ]; then
  echo "PM2 process '$process' is healthy."
  exit 0
else
  echo "PM2 process '$process' failed (status: $process_status)."
  exit 1
fi
