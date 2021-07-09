declare const mp: any;

// TODO:
// - Back handler: On menu: close menu, otherwise: close mpv
// - Show progress on pause: mp.observe_property('pause', 'bool', ...);
// - Audio normalization
// - Anime4K shader selection
// - Mono sound
// - Saveable and loadable audio/sub id, audio/sub delay, and shader selection, with option to autoload

// ASS specs: http://www.tcax.org/docs/ass-specs.htm

interface OsdOverlay {
	data: string
	update(): void
	remove(): void
}

interface Track {
	// NOTE: incomplete
	id: string
	type: string
}

interface Chapter {
	title: string
	time: number
}

const clamp = (n: number, min: number, max: number) => n < min ? min : (n > max ? max : n);
const padTwoZero = (s: string) => s.length === 1 ? ('0' + s) : s;
const hexify = (n: number) => padTwoZero((n).toString(16));
const hhmmss = (s: number, forceH?: boolean) => {
	const h = Math.floor(s / 3600);
	s %= 3600;
	const m = Math.floor(s / 60);
	s = Math.floor(s % 60);
	return (h > 0 || forceH ? padTwoZero(h + '') + ':' : '') + padTwoZero(m + '') + ':' + padTwoZero(s + '');
};

const ass = {
	create: (str?: string | null): OsdOverlay => {
		const item = mp.create_osd_overlay('ass-events');
		if (str) {
			item.data = str;
			item.update();
		}
		return item;
	},
	rgbColor: (r: number, g: number, b: number) =>
		`{\\c&H${hexify(b) + hexify(g) + hexify(r)}&}`,
	bgrHexColor: (c: string) => `{\\c&H${c}&}`,
	rect: (x: number, y: number, w: number, h: number) =>
		`{\\p1}m ${x} ${y} l ${x + w} ${y} ${x + w} ${y + h} ${x} ${y + h}\\p0}`,
};

enum Keys { Up, Down, Left, Right, Enter }

interface MenuItem {
	title: string
	value?: string | number | ((it: MenuItem) => string | number)
	pressHandler?(it: MenuItem): void
	lrHandler?(dir: -1 | 1, it: MenuItem): void
}

class SimpleAssMenu {
	items: MenuItem[]
	osd: OsdOverlay
	selectedI: number = 0

	constructor(items: MenuItem[]) {
		this.items = items;
		this.osd = ass.create(this.getStr());
	}
	destroy() {
		this.osd.remove();
	}
	update() {
		this.osd.data = this.getStr();
		this.osd.update();
	}
	getStr() {
		return this.items.map((it, i) => {
			let str = it.title;
			if (it.value !== undefined) {
				if (typeof it.value === 'function') {
					str += ' (' + it.value(it) + ')';
				} else {
					str += ' (' + it.value + ')';
				}
			}
			if (it.pressHandler) {
				str = '[ ' + str + ' ]';
			}
			if (it.lrHandler) {
				str = '[<] ' + str + ' [>]';
			}
			return '{\\an4}{\\fs26}{\\bord1}' + (this.selectedI === i ? '{\\b1}' : '') + str;
		}).join('\n');
	}
	key(key: Keys) {
		if (this.items.length > 0) {
			const it = this.items[this.selectedI];
			switch (key) {
			case Keys.Up:
				this.selectedI = (this.selectedI + this.items.length - 1) % this.items.length;
				break;
			case Keys.Down:
				this.selectedI = (this.selectedI + this.items.length + 1) % this.items.length;
				break;
			case Keys.Left:
				if (it.lrHandler) {
					it.lrHandler(-1, it);
				}
				break;
			case Keys.Right:
				if (it.lrHandler) {
					it.lrHandler(1, it);
				}
				break;
			case Keys.Enter:
				if (it.pressHandler) {
					it.pressHandler(it);
				}
				break;
			}
		}
		this.update();
	}
}

class TitleProgress {
	osd = ass.create(null)

	constructor() {
		this.update();
	}
	update() {
		const title = mp.get_property('media-title');
		const pos = mp.get_property_number('time-pos');
		const duration = mp.get_property_number('duration');
		const posStr = hhmmss(pos, duration >= 3600);
		const durationStr = hhmmss(duration);
		const posPercent = Math.round(mp.get_property_number('percent-pos') * 100) / 100;
		this.osd.data = `{\\an8}{\\fs32}${title}\n{\\an8}{\\fs24}${posStr}/${durationStr} - ${posPercent}%`;
		this.osd.update();
	}
	destroy() {
		this.osd.remove();
	}
}

const trackStr = (type: string) => {
	const tracks: Track[] = JSON.parse(mp.get_property('track-list'));
	const title = mp.get_property(`current-tracks/${type}/title`);
	const lang = mp.get_property(`current-tracks/${type}/lang`);
	const id = mp.get_property(type);
	const count = tracks.filter(t => t.type === type).length;
	if (count) {
		return `${title ? title + ' ' : ''}${lang ? lang + ' ' : ''}${id}/${count}`;
	} else {
		return 'N/A';
	}
};
const cycleTrack = (type: string, dir: number) => {
	const tracks: Track[] = JSON.parse(mp.get_property('track-list'));
	const count = tracks.filter(t => t.type === type).length;
	const currentStr = mp.get_property(type);
	const current = currentStr === 'no' ? 0 : parseInt(currentStr);
	const next = (current + count + 1 + dir) % (count + 1);
	mp.set_property(type, next === 0 ? 'no' : next);
};

class Overlay {
	titleProgress = new TitleProgress()
	menu = new SimpleAssMenu([
		{
			title: 'Chapter',
			value: () => {
				const chapters: Chapter[] = JSON.parse(mp.get_property('chapter-list'));
				if (chapters.length > 0) {
					const chapterI = mp.get_property_number('chapter');
					return `${chapterI + 1}/${chapters.length}`;
				} else {
					return 'N/A';
				}
			},
			lrHandler: dir => {
				const chapters: Chapter[] = JSON.parse(mp.get_property('chapter-list'));
				if (chapters.length > 0) {
					const chapterI = mp.get_property_number('chapter');
					const newChapter = clamp(chapterI + dir, 0, chapters.length - 1);
					mp.set_property('chapter', newChapter);
				}
			},
		},
		{
			title: 'Audio Track',
			value: () => trackStr('audio'),
			// pressHandler: () => {}, // TODO: show selection menu
			lrHandler: dir => cycleTrack('audio', dir),
		},
		{
			title: 'Subtitle Track',
			value: () => trackStr('sub'),
			// pressHandler: () => {}, // TODO: show selection menu
			lrHandler: dir => cycleTrack('sub', dir),
		},
		{
			title: 'Fullscreen',
			value: () => mp.get_property('fullscreen'),
			pressHandler: () => mp.set_property('fullscreen',
					mp.get_property('fullscreen') === 'yes' ? 'no' : 'yes'),
			lrHandler: (_dir, it) => {
				it.pressHandler(it);
			},
		},
		{
			title: 'Audio Delay',
			value: () => Math.round(mp.get_property('audio-delay') * 1000) + 'ms',
			pressHandler: () => mp.set_property('audio-delay', 0),
			lrHandler: dir => mp.set_property('audio-delay',
					mp.get_property_number('audio-delay') + dir * 0.025),
		},
		{
			title: 'Subtitle Delay',
			value: () => Math.round(mp.get_property('sub-delay') * 1000) + 'ms',
			pressHandler: () => mp.set_property('sub-delay', 0),
			lrHandler: dir => mp.set_property('sub-delay',
					mp.get_property_number('sub-delay') + dir * 0.025),
		},
		{
			title: 'Subtitle Scale',
			value: () => Math.round(mp.get_property('sub-scale') * 100) / 100,
			pressHandler: () => mp.set_property('sub-scale', 1),
			lrHandler: dir => {
				const newVal = mp.get_property_number('sub-scale') + dir * 0.05;
				mp.set_property('sub-scale', clamp(newVal, 0.05, 5));
			},
		},
		{
			title: 'Subtitle Position',
			value: () => mp.get_property('sub-pos'),
			pressHandler: () => mp.set_property('sub-pos', 100),
			lrHandler: dir => {
				const newVal = mp.get_property_number('sub-pos') + dir * 5;
				mp.set_property('sub-pos', clamp(newVal, 0, 150));
			},
		},
		{
			title: 'Save Position & Quit',
			pressHandler: () => mp.command('quit-watch-later'),
		},
		{
			title: 'Quit',
			pressHandler: () => mp.command('quit'),
		},
	]);

	destroy() {
		this.menu.destroy();
		this.titleProgress.destroy();
	}
	key(key: Keys) {
		this.menu.key(key);
	}
	updateChapter() {
		this.menu.update();
	}
}

let overlay: Overlay = null;
mp.add_key_binding('alt+u', 'toggle-tv-osc', () => {
	if (overlay) {
		mp.remove_key_binding('tv-osc-enter');
		mp.remove_key_binding('tv-osc-up');
		mp.remove_key_binding('tv-osc-down');
		mp.remove_key_binding('tv-osc-left');
		mp.remove_key_binding('tv-osc-right');
		overlay.destroy();
		overlay = null;
	} else {
		overlay = new Overlay();
		mp.add_forced_key_binding('enter', 'tv-osc-enter', () => overlay.key(Keys.Enter));
		const flags = {repeatable: true};
		mp.add_forced_key_binding('up', 'tv-osc-up', () => overlay.key(Keys.Up), flags);
		mp.add_forced_key_binding('down', 'tv-osc-down', () => overlay.key(Keys.Down), flags);
		mp.add_forced_key_binding('left', 'tv-osc-left', () => overlay.key(Keys.Left), flags);
		mp.add_forced_key_binding('right', 'tv-osc-right', () => overlay.key(Keys.Right), flags);
	}
});

mp.observe_property('media-title', 'string', () => overlay?.titleProgress.update());
mp.observe_property('time-pos', 'number', () => overlay?.titleProgress.update());
mp.observe_property('chapter', 'number', () => overlay?.menu.update());
