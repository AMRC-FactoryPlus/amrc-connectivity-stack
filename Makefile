check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

lint:
	npx eslint lib

publish: check-committed lint
	npm version prerelease
	npm publish

amend:
	git commit -C HEAD -a --amend
