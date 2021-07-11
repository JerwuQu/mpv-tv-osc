declare const mp: any;

// TODO:
// - Prettier menu
// - Audio normalization
// - Settings autoload
// - More flexible settings save/load menu
// - Anime4K shader selection
// - Show progress on pause: mp.observe_property('pause', 'bool', ...);

interface MpvOsdOverlay {
	data: string
	update(): void
	remove(): void
}

interface MpvTrack {
	// NOTE: incomplete
	id: string
	type: string
}

interface MpvChapter {
	title: string
	time: number
}

const clamp = (n: number, min: number, max: number) => n < min ? min : (n > max ? max : n);
const padTwoZero = (s: string) => s.length === 1 ? ('0' + s) : s;
const hhmmss = (s: number, forceH?: boolean) => {
	const h = Math.floor(s / 3600);
	s %= 3600;
	const m = Math.floor(s / 60);
	s = Math.floor(s % 60);
	return (h > 0 || forceH ? padTwoZero(h + '') + ':' : '') + padTwoZero(m + '') + ':' + padTwoZero(s + '');
};

const createASS = (str?: string | null): MpvOsdOverlay => {
	const item = mp.create_osd_overlay('ass-events');
	if (str) {
		item.data = str;
		item.update();
	}
	return item;
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
	osd: MpvOsdOverlay
	selectedI: number = 0

	constructor(items: MenuItem[]) {
		this.items = items;
		this.osd = createASS(this.getStr());
	}
	destroy() {
		this.osd.remove();
	}
	update() {
		this.osd.data = this.getStr();
		this.osd.update();
	}
	getStr() {
		return '\\N\\N\\N' + this.items.map((it, i) => {
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
			return '{\\an7}{\\fs22}{\\bord1}' + (this.selectedI === i ? '{\\b1}' : '') + str;
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
	osd = createASS(null)

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

const PROPS_FILE = '~~/tv-osc.settings.json';
const SAVED_PROPS = [
	'fullscreen', 'af',
	'audio', 'sub',
	'audio-delay', 'sub-delay',
	'sub-scale', 'sub-pos',
];

const saveProps = () => {
	const props = SAVED_PROPS.reduce((acc, prop) => {
		acc[prop] = mp.get_property(prop);
		return acc;
	}, {});
	mp.utils.write_file('file://' + PROPS_FILE, JSON.stringify(props));
	mp.osd_message('Saved');
};

const loadProps = () => {
	try {
		const props = JSON.parse(mp.utils.read_file(PROPS_FILE));
		for (let prop in props) {
			mp.set_property(prop, props[prop]);
		}
		mp.osd_message('Loaded');
	} catch {
		mp.osd_message('File load failed');
	}
};

const trackStr = (type: string) => {
	const tracks: MpvTrack[] = JSON.parse(mp.get_property('track-list'));
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
	const tracks: MpvTrack[] = JSON.parse(mp.get_property('track-list'));
	const count = tracks.filter(t => t.type === type).length;
	const currentStr = mp.get_property(type);
	const current = currentStr === 'no' ? 0 : parseInt(currentStr);
	const next = (current + count + 1 + dir) % (count + 1);
	mp.set_property(type, next === 0 ? 'no' : next);
};

const AUDIO_FILTERS = {
	'': 'None',
	'lavfi=graph=%19%pan=1c|c0=1*c0+1*c1': 'Mono',
};

const MAIN_MENU: MenuItem[] = [
	{
		title: 'Chapter',
		value: () => {
			const chapters: MpvChapter[] = JSON.parse(mp.get_property('chapter-list'));
			if (chapters.length > 0) {
				const chapterI = mp.get_property_number('chapter');
				return `${chapterI + 1}/${chapters.length}`;
			} else {
				return 'N/A';
			}
		},
		lrHandler: dir => {
			const chapters: MpvChapter[] = JSON.parse(mp.get_property('chapter-list'));
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
		title: 'Audio Filter',
		value: () => AUDIO_FILTERS[mp.get_property('af')] || '?',
		pressHandler: () => mp.set_property('af', ''),
		lrHandler: dir => {
			const af = mp.get_property('af');
			const afKeys = Object.keys(AUDIO_FILTERS);
			const afIdx = afKeys.indexOf(af);
			mp.set_property('af', afIdx === -1 ? ''
					: afKeys[(afIdx + dir + afKeys.length) % afKeys.length]);
		},
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
		title: 'Save Settings',
		pressHandler: saveProps,
	},
	{
		title: 'Load Settings',
		pressHandler: loadProps,
	},
	{
		title: 'Save Position & Quit',
		pressHandler: () => mp.command('quit-watch-later'),
	},
	{
		title: 'Quit',
		pressHandler: () => mp.command('quit'),
	},
];

class Overlay {
	titleProgress = new TitleProgress()
	menu = new SimpleAssMenu(MAIN_MENU)

	destroy() {
		this.titleProgress.destroy();
		this.menu.destroy();
	}
	key(key: Keys) {
		this.menu.key(key);
	}
}

let overlay: Overlay = null;

const openOverlay = () => {
	overlay = new Overlay();
	mp.add_forced_key_binding('enter', 'tv-osc-enter', () => overlay.key(Keys.Enter));
	const flags = {repeatable: true};
	mp.add_forced_key_binding('up', 'tv-osc-up', () => overlay.key(Keys.Up), flags);
	mp.add_forced_key_binding('down', 'tv-osc-down', () => overlay.key(Keys.Down), flags);
	mp.add_forced_key_binding('left', 'tv-osc-left', () => overlay.key(Keys.Left), flags);
	mp.add_forced_key_binding('right', 'tv-osc-right', () => overlay.key(Keys.Right), flags);
};

const closeOverlay = () => {
	mp.remove_key_binding('tv-osc-enter');
	mp.remove_key_binding('tv-osc-up');
	mp.remove_key_binding('tv-osc-down');
	mp.remove_key_binding('tv-osc-left');
	mp.remove_key_binding('tv-osc-right');
	overlay.destroy();
	overlay = null;
};

mp.add_key_binding('alt+u', 'tv-osc-toggle', () => {
	if (overlay) {
		closeOverlay();
	} else {
		openOverlay();
	}
});

mp.add_key_binding('q', 'tv-osc-back', () => {
	if (overlay) {
		closeOverlay();
	} else {
		mp.command('quit');
	}
});

mp.observe_property('media-title', 'string', () => overlay?.titleProgress.update());
mp.observe_property('time-pos', 'number', () => overlay?.titleProgress.update());
mp.observe_property('chapter', 'number', () => overlay?.menu.update());
