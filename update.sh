#!/bin/sh
set -e
releases=$(curl -sL 'https://api.github.com/repos/JerwuQu/mpv-tv-osc/releases/latest')
js_url=$(echo "$releases" | jq -r '.assets[0].browser_download_url')
curl -sLo ~/.config/mpv/scripts/tv-osc.js "$js_url"
