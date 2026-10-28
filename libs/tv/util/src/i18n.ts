/**
 * Minimal translation layer for the TV client (no framework: the TV bundle
 * must stay small and Chromium-68 friendly). Source strings are the English
 * UI texts themselves; `t()` looks them up in the active dictionary and
 * falls back to English, so a missing entry never blanks the screen.
 * Placeholders use `{name}` and are filled from `vars`.
 */
import { DE } from './i18n-de';

export type TvLanguage = 'de' | 'en';

const DICTIONARIES: Record<TvLanguage, Readonly<Record<string, string>>> = {
    de: DE,
    en: {},
};

const STORAGE_KEY = 'meddl-tv-language';

function initialLanguage(): TvLanguage {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'de' || saved === 'en') return saved;
    } catch {
        // Storage unavailable: fall through to the default.
    }
    // meddl targets German-speaking viewers first. Outside a browser (unit
    // tests under Node) the English source strings stay as they are.
    return typeof document === 'undefined' ? 'en' : 'de';
}

let current: TvLanguage = initialLanguage();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function tvLanguage(): TvLanguage {
    return current;
}

/** BCP 47 tag for Intl date/time formatting in the active language. */
export function tvLocale(): string {
    return current === 'de' ? 'de-DE' : 'en-GB';
}

export function setTvLanguage(language: TvLanguage) {
    current = language;
    try {
        localStorage.setItem(STORAGE_KEY, language);
    } catch {
        // The choice still applies for this session.
    }
    if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export function t(
    text: string,
    vars?: Readonly<Record<string, string | number>>
): string {
    const translated = DICTIONARIES[current][text] ?? text;
    if (!vars) return translated;
    return translated.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match
    );
}

/** "1 Sender" / "5 Sender": picks the singular or plural source string. */
export function tn(
    count: number,
    singular: string,
    plural: string,
    vars?: Readonly<Record<string, string | number>>
): string {
    return t(count === 1 ? singular : plural, { count, ...vars });
}
