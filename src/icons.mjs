const paths = {
  settings: '<path d="m9.5 3-.6 2.1-2 .9-2-.6-2.5 4.2 1.5 1.5v2.3L2.4 15l2.5 4.2 2-.6 2 .9.6 2.1h5l.6-2.1 2-.9 2 .6 2.5-4.2-1.5-1.6v-2.3l1.5-1.5-2.5-4.2-2 .6-2-.9-.6-2.1z"/><circle cx="12" cy="12.3" r="3.1"/>',
  loading:'<path d="M20.5 12a8.5 8.5 0 1 1-8.5-8.5" stroke-width="2.6"/>',
  netease: '<path d="M13.9 4.2c-2.7-.4-4.7 1.4-4.7 3.5 0 2.3 1.9 3.8 4.8 5.6 2.5 1.6 1.1 4.6-1.8 4.6a5.4 5.4 0 0 1-5.3-5.5c0-2.9 2.3-5.6 5.6-5.6 4.2 0 7.5 3.1 7.5 7.1a8 8 0 0 1-8.1 7.8 9 9 0 0 1-8.9-8.9c0-4.7 3.6-8.7 8.6-9"/><path d="m13.6 3.8 1-2.1"/>',
  comments: '<path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-9L5 21v-3.5H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5z"/><path d="M7 9h10M7 13h7"/>',
  star:'<path d="m12 2.8 2.9 5.9 6.5 1-4.7 4.6 1.1 6.5L12 17.7l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-1z"/>',
  languages:'<path d="M2.2 4.6h13v10H8l-3.8 3v-3h-2z"/><path d="M8.6 8 6.5 12m2.1-4 2.2 4m-3.3-1.4h2.2M17 9h4.8v9h-2v2.3L16.6 18h-4v-1.2"/>',
  quiet:'<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>',
  logo: '<path d="M3 13c2.4 0 2-7 4.5-7s1.6 12 4.4 12 1.5-14 4.5-14c2.1 0 1.3 8 4.6 8" stroke-width="2.8"/>',
  discover: '<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.7"/><path d="m16 16 4.6 4.6"/>',
  heart:
    '<path d="M20.4 5.4a5.1 5.1 0 0 0-7.2 0L12 6.7l-1.2-1.3a5.1 5.1 0 0 0-7.2 7.2L12 21l8.4-8.4a5.1 5.1 0 0 0 0-7.2Z"/>',
  user: '<circle cx="12" cy="7.5" r="3.5"/><path d="M4.5 20v-2c0-3.2 3.4-5.4 7.5-5.4s7.5 2.2 7.5 5.4v2"/>',
  collection:
    '<path d="M2.7 8.5V6a1.7 1.7 0 0 1 1.7-1.7H10l2 2h7.5A1.8 1.8 0 0 1 21.3 8v1"/><rect x="2.7" y="8.8" width="18.6" height="11.2" rx="2"/><path d="M10 14.5h4"/>',
  album:
    '<circle cx="12" cy="12" r="8.7"/><circle cx="12" cy="12" r="2.4"/><path d="M6.3 11A5.7 5.7 0 0 1 11 6.3"/>',
  artist:
    '<path d="M12 16.7 7 21l-3.6-3.6 5.2-5.1"/><circle cx="14.7" cy="9.2" r="5.7"/><path d="m11 5.5 7.4 7.4"/>',
  sliders:
    '<path d="M5 3v7m0 5v6m7-18v3m0 5v10m7-18v10m0 5v3"/><rect x="2.6" y="10" width="4.8" height="4.8" rx="1.3"/><rect x="9.6" y="6" width="4.8" height="4.8" rx="1.3"/><rect x="16.6" y="13" width="4.8" height="4.8" rx="1.3"/>',
  headphones:
    '<path d="M3.5 14v-2.5a8.5 8.5 0 0 1 17 0V14"/><rect x="3" y="12" width="4.5" height="8" rx="2"/><rect x="16.5" y="12" width="4.5" height="8" rx="2"/>',
  play: '<path d="m7.5 4.5 12 7.5-12 7.5z" fill="currentColor" stroke-width="1.2"/>',
  pause: '<path d="M8 5v14m8-14v14" stroke-width="4"/>',
  prev: '<path d="M5.5 5v14m12-13.8L7.4 12l10.1 6.8z" fill="currentColor"/>',
  next: '<path d="M18.5 5v14m-12-13.8L16.6 12 6.5 18.8z" fill="currentColor"/>',
  queue: '<path d="M3 6h17M3 11h12M3 16h7m5-1.5 5 3-5 3z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  volume: '<path d="M3 9h4l5-4v14l-5-4H3zm12-1a6 6 0 0 1 0 8m2.7-10.5a9 9 0 0 1 0 13"/>',
  muted: '<path d="M3 9h4l5-4v14l-5-4H3zm13 1 5 5m0-5-5 5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  upRight: '<path d="m6.5 17.5 11-11m-10 0h10v10"/>',
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  down: '<path d="m5.5 9 6.5 6.5L18.5 9"/>',
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  bili: '<rect x="2.8" y="6.7" width="18.4" height="14.1" rx="3.5"/><path d="m7.1 2.8 3.4 3.8m6.4-3.8-3.4 3.8m-6 5.7 2-.8m5.1 0 2 .8m-6 2.9q1.4 1.5 2.9 0"/>',
  kuwo: '<path d="M5 5v14M18 4.5l-9 7.6 9 7.4" stroke-width="3.1"/><path d="m18 8 2-1.8m-1.3 9.6 2 1.6"/>',
  dots: '<g fill="currentColor" stroke="none"><circle cx="4.7" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19.3" cy="12" r="1.6"/></g>',
  history: '<path d="M3 9a9 9 0 1 1-.2 6M3 4v5h5m4.5-2v5l3 2"/>',
  library: '<path d="M3 4h4v16H3zm6 0h4v16H9zm6 1.7 3.4-.9 3.8 14.6-3.5.8z"/>',
  lyrics:
    '<rect x="2.7" y="4.5" width="18.6" height="14" rx="2.5"/><path d="M7 9h10M7 13h6m-6 5.5v2l3.5-2"/>',
  music:
    '<path d="M9 17V6l11-2v11M9 8.8l11-2"/><ellipse cx="6" cy="17.5" rx="3" ry="2.3"/><ellipse cx="17" cy="15.5" rx="3" ry="2.3"/>',
  loop: '<path d="M3.5 12V9a3 3 0 0 1 3-3H19m-3-3 3 3-3 3m4.5 3v3a3 3 0 0 1-3 3H5m3 3-3-3 3-3"/>',
  expand: '<path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wave: '<path d="M3 10v4m4-8v12m5-15v18m5-14v10m4-7v4"/>',
};

export function icon(name, size = 20) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}
