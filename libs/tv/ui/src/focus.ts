const selectors =
    'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[data-tv-scroll]';
export function focusKey() {
    return (document.activeElement as HTMLElement)?.dataset.focus ?? '';
}
export function restoreFocus(
    key: string,
    fallback = '',
    scroll?: number,
    owns: () => boolean = () => true
) {
    requestAnimationFrame(() => {
        if (!owns()) return;
        const elements = Array.from(
            (
                document.querySelector('[data-tv-modal]') ?? document
            ).querySelectorAll<HTMLElement>(selectors)
        ).filter((e) => !!e.offsetWidth && !e.closest('[hidden]'));
        const target =
            elements.find((e) => e.dataset.focus === key) ??
            elements.find((e) => e.dataset.focus === fallback) ??
            elements[0];
        target?.focus();
        if (scroll !== undefined) {
            const main = document.querySelector('main');
            if (main) main.scrollTop = scroll;
        }
    });
}
export function installRemote(
    back: () => void,
    fullscreen: () => boolean,
    playerKey: (key: number) => void
) {
    let lastMove = 0;
    // The last move, so the opposite arrow returns to where it came from.
    let memory: { from: HTMLElement; to: HTMLElement; direction: string } | null = null;
    const opposite: Record<string, string> = {
        ArrowLeft: 'ArrowRight',
        ArrowRight: 'ArrowLeft',
        ArrowUp: 'ArrowDown',
        ArrowDown: 'ArrowUp',
    };
    const nextFocus = (from: HTMLElement, direction: string, candidates: HTMLElement[]) => {
        if (
            memory &&
            memory.to === from &&
            opposite[memory.direction] === direction &&
            candidates.includes(memory.from) &&
            memory.from.isConnected
        )
            return memory.from;
        return spatialTarget(from, direction, candidates);
    };
    const handler = (event: KeyboardEvent) => {
        const code = event.keyCode;
        const direction =
            (
                {
                    37: 'ArrowLeft',
                    38: 'ArrowUp',
                    39: 'ArrowRight',
                    40: 'ArrowDown',
                } as Record<number, string>
            )[code] ?? event.key;
        if (
            code === 461 ||
            event.key === 'Escape' ||
            event.key === 'BrowserBack' ||
            (event.key === 'Backspace' &&
                !(event.target instanceof HTMLInputElement))
        ) {
            event.preventDefault();
            back();
            return;
        }
        if ([415, 19, 413, 412, 417].includes(code)) {
            event.preventDefault();
            playerKey(code);
            return;
        }
        if (!direction.startsWith('Arrow')) return;
        const from = document.activeElement as HTMLElement;
        const horizontal = /Left|Right/.test(direction);
        // Keep caret/slider movement native; vertical arrows leave single-line
        // fields. Selects own vertical choice changes and leave horizontally.
        if (
            from?.matches('textarea') ||
            (horizontal &&
                from?.matches(
                    'input:not([type="checkbox"]):not([type="radio"])'
                )) ||
            (!horizontal && from?.matches('select'))
        )
            return;
        event.preventDefault();
        if (event.repeat && Date.now() - lastMove < 75) return;
        lastMove = Date.now();
        const root =
            document.querySelector('[data-tv-modal]') ??
            (fullscreen()
                ? document.querySelector('.player-controls')
                : document);
        const candidates = Array.from(
            root?.querySelectorAll<HTMLElement>(selectors) ?? []
        ).filter(
            (e) =>
                e !== from &&
                !!e.offsetWidth &&
                !!e.offsetHeight &&
                !e.closest('[hidden]') &&
                getComputedStyle(e).visibility !== 'hidden'
        );
        if (!from || from === document.body || !from.offsetWidth) {
            candidates[0]?.focus();
            return;
        }
        const target = nextFocus(from, direction, candidates);
        if (!target) return;
        memory = { from, to: target, direction };
        target.focus();
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        clearOfTopBar(target);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
/**
 * The element the arrow moves to. Elements lined up with the focused one
 * come first (sharing some height for Left/Right, some width for Up/Down),
 * so the end of a row stops instead of jumping into another one. Inside the
 * scrolling page (main) the page is searched first, so Up reaches the row
 * above before the fixed top bar. Distances run edge to edge.
 */
export function spatialTarget(
    from: HTMLElement,
    direction: string,
    candidates: HTMLElement[]
): HTMLElement | undefined {
    const rect = from.getBoundingClientRect();
    const horizontal = /Left|Right/.test(direction);
    const sign = /Left|Up/.test(direction) ? -1 : 1;
    const page = from.closest('main');
    // loose: also elements that do not line up with the focused one.
    const pick = (pool: HTMLElement[], loose = false) => {
        let score = Infinity;
        let best: HTMLElement | undefined;
        for (const element of pool) {
            const r = element.getBoundingClientRect();
            const [fromStart, fromEnd, start, end] = horizontal
                ? [rect.left, rect.right, r.left, r.right]
                : [rect.top, rect.bottom, r.top, r.bottom];
            const [crossFromStart, crossFromEnd, crossStart, crossEnd] = horizontal
                ? [rect.top, rect.bottom, r.top, r.bottom]
                : [rect.left, rect.right, r.left, r.right];
            const centre = (start + end) / 2 - (fromStart + fromEnd) / 2;
            if (centre * sign <= 3) continue;
            // Edge gap in the arrow's direction; overlapping elements may
            // reach back by half the smaller size at most.
            const gap = sign > 0 ? start - fromEnd : fromStart - end;
            const slack = Math.min(end - start, fromEnd - fromStart) / 2;
            if (gap < -slack) continue;
            const overlap = Math.min(crossEnd, crossFromEnd) - Math.max(crossStart, crossFromStart);
            if (overlap <= 0 && !loose) continue;
            const crossGap = Math.max(0, -overlap);
            const crossCentre = Math.abs(
                (crossStart + crossEnd) / 2 - (crossFromStart + crossFromEnd) / 2
            );
            const distance = Math.max(0, gap) + crossGap * 4 + crossCentre * 0.3;
            if (distance < score) {
                score = distance;
                best = element;
            }
        }
        return best;
    };
    const inPage = page ? candidates.filter((e) => page.contains(e)) : [];
    const row = inHorizontalRow(from);
    let found = (page && pick(inPage)) || undefined;
    // Up and Down from a row reach the row above or below, wherever its items are.
    if (!found && !horizontal && row && page) found = pick(inPage, true);
    found ??= pick(candidates);
    // Columns side by side (channel list and preview, settings menu and
    // form): the next column may start lower than the focused element.
    // Left and Right never leave a row or the top bar that way.
    if (!found && !(horizontal && (row || !page))) found = (page && pick(inPage, true)) || pick(candidates, true);
    // Sideways into a list, or up from the page into the top bar: land on
    // the chosen entry there (the category shown, the current page).
    if (found && (horizontal || (page && !page.contains(found))))
        return chosenInLine(found, candidates, horizontal, rect) ?? found;
    return found;
}

function chosenInLine(
    found: HTMLElement,
    candidates: HTMLElement[],
    column: boolean,
    from: DOMRect
): HTMLElement | undefined {
    const line = found.getBoundingClientRect();
    return candidates.find((e) => {
        if (e === found || !e.matches('[aria-pressed="true"],[aria-current]:not([aria-current="false"]),[aria-selected="true"]'))
            return false;
        const r = e.getBoundingClientRect();
        const lined = column
            ? Math.abs(r.left - line.left) < 2 && Math.abs(r.width - line.width) < 2
            : r.bottom > line.top && r.top < line.bottom && r.right > from.left - 40 && r.left < from.right + 40;
        return lined && r.bottom > 0 && r.top < innerHeight;
    });
}

/** True inside a sideways scrolling row (Home and catalog rows). */
function inHorizontalRow(element: HTMLElement): boolean {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        // A row scrolls sideways and is wider than tall (not a column list).
        if ((overflow === 'auto' || overflow === 'scroll') && node.clientWidth > node.clientHeight * 1.5) return true;
        if (node.tagName === 'MAIN') return false;
    }
    return false;
}

/**
 * The top bar floats over the page: a focused element scrolled up under it
 * moves down until it is fully visible again.
 */
export function clearOfTopBar(element: HTMLElement) {
    const page = element.closest('main');
    const bar = document.querySelector<HTMLElement>('.top-bar');
    if (!page || !bar || page.contains(bar)) return;
    const covered = bar.getBoundingClientRect().bottom + 12 - element.getBoundingClientRect().top;
    if (covered > 0 && page.scrollTop > 0) page.scrollTop = Math.max(0, page.scrollTop - covered);
}

export function platformBack() {
    const platform = window as unknown as {
        webOS?: { platformBack?: () => void };
        PalmSystem?: { platformBack?: () => void };
        /** Android TV / Fire TV shell (apps/android-tv). */
        MeddlAndroid?: { exitApp?: () => void };
    };
    if (platform.webOS?.platformBack) platform.webOS.platformBack();
    else if (platform.MeddlAndroid?.exitApp) platform.MeddlAndroid.exitApp();
    else platform.PalmSystem?.platformBack?.();
}
