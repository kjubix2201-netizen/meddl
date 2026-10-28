const paths: Record<string, string> = {
    home: 'M3 11 12 3 21 11 M5 10v11h5v-7h4v7h5V10',
    live: 'M3 5h18v14H3z M8 22h8 M8 2l4 3 4-3',
    movies: 'M3 4h18v17H3z M3 9h18 M7 4l3 5 M14 4l3 5',
    series: 'M3 3h8v8H3z M14 3h7v8h-7z M3 14h8v7H3z M14 14h7v7h-7z',
    favorites: 'M12 21S2 15 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 7-10 13-10 13z',
    search: 'M16 16l6 6 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    sources: 'M3 3h18v18H3z M12 7v10 M7 12h10',
    settings: 'M4 5h16 M4 12h16 M4 19h16 M8 2v6 M16 9v6 M9 16v6',
    check: 'M4 12l5 5L20 6',
    volume: 'M4 9h4l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a7.5 7.5 0 0 1 0 11',
    muted: 'M4 9h4l5-4v14l-5-4H4z M16 9l5 6 M21 9l-5 6',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    play: 'M8 5v14l11-7z',
    pause: 'M8 5v14 M16 5v14',
    previous: 'M6 5v14 M19 5L9 12l10 7z',
    next: 'M18 5v14 M5 5l10 7-10 7z',
    back: 'M15 5l-7 7 7 7',
    rewind: 'M11 6l-7 6 7 6z M20 6l-7 6 7 6z',
    forward: 'M13 6l7 6-7 6z M4 6l7 6-7 6z',
    guide: 'M3 4h18v16H3z M3 9h18 M9 9v11',
    list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
};
export function TvIcon({ name }: { name: string }) {
    return (
        <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d={paths[name] ?? paths.sources} />
        </svg>
    );
}
