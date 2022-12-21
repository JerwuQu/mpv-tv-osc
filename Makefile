tv-osc.js: tv-osc.ts mpv-jutil/jutil.ts
	tsc --lib es5 --removeComments --strict --outFile $@ $^

.PHONY: install clean
install: tv-osc.js
	cp tv-osc.js ~/.config/mpv/scripts/

clean:
	rm -f tv-osc.js
