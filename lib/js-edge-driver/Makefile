sinclude config.mk

check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

lint:
	npx eslint lib

publish: check-committed lint
	npm version prerelease
	npm publish

amend:
	git commit -C HEAD -a --amend

pubdev: check-committed lint
	sh ./tools/pub-dev.sh "${js.dev_tag}"
