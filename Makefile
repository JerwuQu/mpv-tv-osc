tv-osc.js: tv-osc.ts
	tsc --lib es5 --outFile $@ $^

.PHONY: install clean
install: tv-osc.js
	cp tv-osc.js ~/.config/mpv/scripts/

clean:
	rm -f tv-osc.js
