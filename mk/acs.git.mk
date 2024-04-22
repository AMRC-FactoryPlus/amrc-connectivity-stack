# Makefile rules for git operations

ifndef .acs.git.mk
.acs.git.mk=1

git.tag!=git describe --tags --abbrev=0 2>/dev/null
git.sha!=git rev-parse --verify HEAD

.PHONY: git.prepare git.check-committed git.pull amend

git.prepare:
	@:

ifndef git.allow_dirty
git.prepare: git.check-committed
endif

ifdef git.pull
git.prepare: git.pull
endif

git.check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

git.pull:
	git pull --ff-only

amend:
	git commit --amend -C HEAD -a

endif
