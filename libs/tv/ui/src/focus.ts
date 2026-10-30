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
            // Otherwise the page's first control rather than the top bar.
            elements.find((e) => !!e.closest('main')) ??
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
        // OK on a list (category, sort order …) opens its choices. TVs do that
        // themselves; elsewhere (Windows app with a controller) ask for the picker.
        if ((event.key === 'Enter' || code === 13) && !isTelevision()) {
            const list = document.activeElement as HTMLSelectElement | null;
            const picker = list?.matches?.('select') ? (list as unknown as { showPicker?: () => void }).showPicker : undefined;
            if (list && typeof picker === 'function') {
                event.preventDefault();
                try {
                    picker.call(list);
                } catch {
                    /* not allowed here (e.g. without a user gesture): leave it */
                }
            }
            return;
        }
        if (!direction.startsWith('Arrow')) return;
        const from = document.activeElement as HTMLElement;
        const horizontal = /Left|Right/.test(direction);
        // Keep caret/slider movement native; vertical arrows leave single-line
        // fields. Lists (selects) never change with the arrows: OK opens them,
        // the arrows move on – on TVs and in the Windows app alike.
        if (
            // A read-only field (the TV's locked text field) is passed over.
            (from?.matches('textarea') && !(from as HTMLTextAreaElement).readOnly) ||
            (horizontal &&
                from?.matches(
                    'input:not([type="checkbox"]):not([type="radio"])'
                ) &&
                !(from as HTMLInputElement).readOnly)
        )
            return;
        event.preventDefault();
        if (event.repeat && Date.now() - lastMove < 75) return;
        // Held or pressed in quick succession: the page follows at once
        // instead of starting a new glide on every step (that stutters).
        if (event.repeat || Date.now() - lastMove < 260) markRapid();
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
        target.focus({ preventScroll: true });
        revealFocus(target);
    };
    document.addEventListener('keydown', handler);
    const keyboard = remoteKeyboard();
    // The Home bar gets a solid backing once the page is scrolled.
    const mark = () => {
        const page = document.querySelector('main');
        document.documentElement.classList.toggle('page-scrolled', !!page && page.scrollTop > 24);
    };
    const scrolled = (event: Event) => {
        if ((event.target as HTMLElement)?.tagName === 'MAIN') mark();
    };
    // A new page starts at the top without a scroll event: check after keys too.
    const afterKey = () => requestAnimationFrame(mark);
    document.addEventListener('scroll', scrolled, true);
    document.addEventListener('keyup', afterKey);
    return () => {
        document.removeEventListener('keydown', handler);
        document.removeEventListener('scroll', scrolled, true);
        document.removeEventListener('keyup', afterKey);
        keyboard();
    };
}

type TvShell = {
    isTelevision?: () => boolean;
    showKeyboard?: () => void;
    editText?: (value: string, hint: string) => void;
};

/** True in the Android TV / Fire TV app on a television. */
export function isTelevision(): boolean {
    try {
        return !!(window as unknown as { MeddlAndroid?: TvShell }).MeddlAndroid?.isTelevision?.();
    } catch {
        return false;
    }
}

const TEXT_FIELD = 'textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])';

/**
 * On a TV, moving onto a text field must not pop up the on-screen keyboard
 * (Android opens it on focus). The field stays read-only while the remote
 * passes over it; OK unlocks it and opens the keyboard.
 */
function remoteKeyboard(): () => void {
    const shell = (window as unknown as { MeddlAndroid?: TvShell }).MeddlAndroid;
    let television = false;
    try {
        television = !!shell?.isTelevision?.();
    } catch {
        television = false;
    }
    if (!television) return () => undefined;
    const locked = new WeakSet<HTMLElement>();
    const focusIn = (event: FocusEvent) => {
        const field = event.target as HTMLInputElement;
        if (!field?.matches?.(TEXT_FIELD) || field.readOnly) return;
        field.readOnly = true;
        locked.add(field);
    };
    const focusOut = (event: FocusEvent) => {
        const field = event.target as HTMLInputElement;
        if (!locked.has(field)) return;
        locked.delete(field);
        field.readOnly = false;
    };
    const unlock = (event: KeyboardEvent) => {
        const field = event.target as HTMLInputElement;
        if (!locked.has(field) || (event.key !== 'Enter' && event.keyCode !== 13)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (shell?.editText) {
            // The app's own text field (MainActivity): the WebView's field
            // loses the keyboard on many TVs. Text comes back as typed.
            editing = field;
            shell.editText(field.value, field.getAttribute('aria-label') || field.placeholder || '');
            return;
        }
        locked.delete(field);
        field.readOnly = false;
        shell?.showKeyboard?.();
    };
    let editing: HTMLInputElement | undefined;
    // While typing, the results follow after a short pause: searching tens
    // of thousands of titles on every letter made the TV keyboard lag.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const entered = (text: string, done: boolean) => {
        clearTimeout(pending);
        if (!done) {
            pending = setTimeout(() => apply(text, false), 350);
            return;
        }
        apply(text, true);
    };
    const apply = (text: string, done: boolean) => {
        let field = editing;
        if (field && !field.isConnected) {
            // Re-rendered meanwhile: the same field by its label.
            const label = field.getAttribute('aria-label');
            const selector = `input[aria-label="${(label ?? '').replace(/"/g, '\\"')}"]`;
            field = (label && document.querySelector<HTMLInputElement>(selector)) || undefined;
            editing = field;
        }
        if (!field) return;
        if (field.value !== text) {
            field.value = text;
            field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (done) {
            editing = undefined;
            field.focus({ preventScroll: true });
        }
    };
    (window as unknown as { meddlTextEntered?: typeof entered }).meddlTextEntered = entered;
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('keydown', unlock, true);
    return () => {
        document.removeEventListener('focusin', focusIn);
        document.removeEventListener('focusout', focusOut);
        document.removeEventListener('keydown', unlock, true);
        delete (window as unknown as { meddlTextEntered?: typeof entered }).meddlTextEntered;
    };
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

/** The nearest ancestor that scrolls along this axis. */
function scroller(element: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        const overflow = axis === 'y' ? style.overflowY : style.overflowX;
        const room = axis === 'y' ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
        if ((overflow === 'auto' || overflow === 'scroll') && room > 1) return node;
    }
    return null;
}

/**
 * Brings the focused element into view the TV way: the focused element sits
 * in the middle of the free area below the top bar, which keeps every step
 * the same size instead of jumping at the edges; the page glides there.
 * Rows scroll sideways only as far as needed.
 */
/** Until then focus moves come fast (held key): scroll without gliding. */
let rapidUntil = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
function markRapid() {
    rapidUntil = Date.now() + 260;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => window.dispatchEvent(new Event('meddl:settled')), 300);
}
/** True while the viewer holds an arrow (or presses it in quick succession). */
export function movingFast(): boolean {
    return Date.now() < rapidUntil;
}
/** Calls back once the fast movement is over (at once if there is none). */
export function whenSettled(callback: () => void): () => void {
    if (!movingFast()) {
        callback();
        return () => undefined;
    }
    const done = () => {
        window.removeEventListener('meddl:settled', done);
        callback();
    };
    window.addEventListener('meddl:settled', done);
    return () => window.removeEventListener('meddl:settled', done);
}

export function revealFocus(element: HTMLElement) {
    const vertical = scroller(element, 'y');
    const horizontal = scroller(element, 'x');
    if (!vertical && !horizontal) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
    }
    const box = element.getBoundingClientRect();
    if (vertical) {
        const view = vertical.getBoundingClientRect();
        const bar = document.querySelector<HTMLElement>('.top-bar');
        const top = bar && !vertical.contains(bar) ? Math.max(view.top, bar.getBoundingClientRect().bottom) : view.top;
        const free = view.bottom - top;
        const offset = box.height >= free ? box.top - top - 12 : box.top + box.height / 2 - (top + free / 2);
        const goal = Math.max(0, Math.min(vertical.scrollHeight - vertical.clientHeight, vertical.scrollTop + offset));
        // Only the page glides. Lists inside it (channels, categories) jump
        // straight to the spot: a gliding list that re-renders its window
        // while moving wobbles up and down.
        const glide = vertical.tagName === 'MAIN' && Date.now() > rapidUntil;
        if (Math.abs(goal - vertical.scrollTop) > 1) vertical.scrollTo({ top: goal, behavior: glide ? 'smooth' : 'auto' });
    }
    if (horizontal) {
        const view = horizontal.getBoundingClientRect();
        const margin = 24;
        const shift =
            box.left < view.left + margin
                ? box.left - view.left - margin
                : box.right > view.right - margin
                  ? box.right - view.right + margin
                  : 0;
        if (shift)
            horizontal.scrollTo({
                left: horizontal.scrollLeft + shift,
                behavior: Date.now() > rapidUntil ? 'smooth' : 'auto',
            });
    }
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
