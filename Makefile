.PHONY: map health

map:
	node scripts/code-index.mjs

health:
	npm run lint
	npm run typecheck
