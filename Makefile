.PHONY: pm2
pm2:
	ssh \
		${REMOTE_SSH_USER}@${REMOTE_SSH_IP} \
		-p ${REMOTE_SSH_PORT} \
		"BOT_TOKEN='${BOT_TOKEN}' bash -s" < ./deploy/pm2.sh

.PHONY: deploy
deploy:
	ssh \
		${REMOTE_SSH_USER}@${REMOTE_SSH_IP} \
		-p ${REMOTE_SSH_PORT} \
		'mkdir -p /srv/word-of-the-day-bot'
	rsync \
		-avzr \
		--exclude-from=./.rsyncignore \
		-e "ssh -p ${REMOTE_SSH_PORT}" \
		./ \
		${REMOTE_SSH_USER}@${REMOTE_SSH_IP}:/srv/word-of-the-day-bot \
		--progress
