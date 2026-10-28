/**
 * "Preferred region": categories and groups whose name marks them as
 * belonging to the viewer's region ("DE | Sport", "|DE| Filme",
 * "GERMANY HD", "Deutschland 4K", "🇩🇪 Kinder") are listed first.
 *
 * Providers tag regions in many styles, so a name is split into tokens on
 * anything that is not a letter, digit or "+", and each token is compared
 * against the region's vocabulary:
 *
 * - country codes ("DE", "GER") only match in UPPER CASE. Lower-case "de"
 *   is a common word in Spanish, French and Portuguese category names
 *   ("Películas de acción"), so it must not pull those categories up;
 * - country and language words ("GERMANY", "Deutsch") match in any case
 *   and without diacritics ("Österreich" = "OSTERREICH" = "OESTERREICH");
 * - multi-word names ("UNITED KINGDOM") match as consecutive tokens;
 * - flag emoji match the region's ISO country codes.
 */

export type PreferredRegionId =
    | ''
    | 'de'
    | 'dach'
    | 'at'
    | 'ch'
    | 'uk'
    | 'us'
    | 'fr'
    | 'it'
    | 'es'
    | 'nl'
    | 'pl'
    | 'tr';

interface CountryVocabulary {
    /** ISO 3166-1 alpha-2 code, used for the flag emoji and display name. */
    readonly iso: string;
    /** Upper-case tags providers use, matched case-sensitively. */
    readonly codes: readonly string[];
    /** Country / language words, matched case- and accent-insensitively. */
    readonly words: readonly string[];
}

const COUNTRIES: Readonly<Record<string, CountryVocabulary>> = {
    DE: {
        iso: 'DE',
        codes: ['DE', 'GER', 'DEU'],
        words: ['GERMANY', 'GERMAN', 'DEUTSCH', 'DEUTSCHE', 'DEUTSCHLAND'],
    },
    AT: {
        iso: 'AT',
        codes: ['AT', 'AUT'],
        words: ['AUSTRIA', 'OSTERREICH', 'OESTERREICH'],
    },
    CH: {
        iso: 'CH',
        codes: ['CH', 'SUI'],
        words: ['SWITZERLAND', 'SCHWEIZ', 'SWISS'],
    },
    GB: {
        iso: 'GB',
        codes: ['UK', 'GB', 'GBR'],
        words: ['BRITISH', 'ENGLAND', 'UNITED KINGDOM'],
    },
    US: {
        iso: 'US',
        codes: ['US', 'USA'],
        words: ['AMERICA', 'AMERICAN', 'UNITED STATES'],
    },
    FR: {
        iso: 'FR',
        codes: ['FR', 'FRA'],
        words: ['FRANCE', 'FRENCH', 'FRANCAIS', 'FRANCAISE'],
    },
    IT: {
        iso: 'IT',
        codes: ['IT', 'ITA'],
        words: ['ITALY', 'ITALIA', 'ITALIAN', 'ITALIANO'],
    },
    ES: {
        iso: 'ES',
        codes: ['ES', 'ESP', 'SPA'],
        words: ['SPAIN', 'ESPANA', 'SPANISH', 'ESPANOL'],
    },
    NL: {
        iso: 'NL',
        codes: ['NL', 'NLD'],
        words: ['NETHERLANDS', 'NEDERLAND', 'DUTCH', 'HOLLAND'],
    },
    PL: {
        iso: 'PL',
        codes: ['PL', 'POL'],
        words: ['POLAND', 'POLSKA', 'POLISH', 'POLSKI'],
    },
    TR: {
        iso: 'TR',
        codes: ['TR', 'TUR'],
        words: ['TURKEY', 'TURKIYE', 'TURKISH', 'TURK'],
    },
};

/** Selectable regions, in the order the settings list shows them. */
export const PREFERRED_REGION_OPTIONS: ReadonlyArray<{
    readonly value: Exclude<PreferredRegionId, ''>;
    /** ISO codes whose localized names label the option. */
    readonly countries: readonly string[];
}> = [
    { value: 'de', countries: ['DE'] },
    { value: 'dach', countries: ['DE', 'AT', 'CH'] },
    { value: 'at', countries: ['AT'] },
    { value: 'ch', countries: ['CH'] },
    { value: 'uk', countries: ['GB'] },
    { value: 'us', countries: ['US'] },
    { value: 'fr', countries: ['FR'] },
    { value: 'it', countries: ['IT'] },
    { value: 'es', countries: ['ES'] },
    { value: 'nl', countries: ['NL'] },
    { value: 'pl', countries: ['PL'] },
    { value: 'tr', countries: ['TR'] },
];

export const DEFAULT_PREFERRED_REGION: PreferredRegionId = 'de';

export function normalizePreferredRegion(value: unknown): PreferredRegionId {
    if (value === '') return '';
    return PREFERRED_REGION_OPTIONS.some((option) => option.value === value)
        ? (value as PreferredRegionId)
        : DEFAULT_PREFERRED_REGION;
}

interface CompiledRegion {
    readonly codes: ReadonlySet<string>;
    readonly words: ReadonlySet<string>;
    readonly phrases: readonly (readonly string[])[];
    readonly flags: readonly string[];
}

const compiledRegions = new Map<PreferredRegionId, CompiledRegion | null>();

function toFlag(iso: string): string {
    return String.fromCodePoint(
        ...[...iso].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65)
    );
}

function compileRegion(region: PreferredRegionId): CompiledRegion | null {
    const option = PREFERRED_REGION_OPTIONS.find(
        (candidate) => candidate.value === region
    );
    if (!option) return null;

    const codes = new Set<string>();
    const words = new Set<string>();
    const phrases: string[][] = [];
    const flags: string[] = [];
    for (const iso of option.countries) {
        const country = COUNTRIES[iso];
        country.codes.forEach((code) => codes.add(code));
        for (const word of country.words) {
            const parts = word.split(' ');
            if (parts.length > 1) phrases.push(parts);
            else words.add(word);
        }
        flags.push(toFlag(country.iso));
    }
    return { codes, words, phrases, flags };
}

function getCompiledRegion(region: PreferredRegionId): CompiledRegion | null {
    if (!compiledRegions.has(region)) {
        compiledRegions.set(region, compileRegion(region));
    }
    return compiledRegions.get(region) ?? null;
}

// Built with `new RegExp` like the VOD detection util: the workspace
// compiles to es2015, where regex literals with \p{...} are rejected.
const COMBINING_MARKS = new RegExp('\\p{M}+', 'gu');
const TOKEN_SEPARATORS = new RegExp('[^\\p{L}\\p{N}+]+', 'u');

function stripDiacritics(value: string): string {
    return value.normalize('NFD').replace(COMBINING_MARKS, '');
}

function tokenize(value: string): string[] {
    return stripDiacritics(value).split(TOKEN_SEPARATORS).filter(Boolean);
}

/** Whether a category / group name belongs to the preferred region. */
export function matchesPreferredRegion(
    name: string | null | undefined,
    region: PreferredRegionId | null | undefined
): boolean {
    if (!name || !region) return false;
    const compiled = getCompiledRegion(region);
    if (!compiled) return false;

    if (compiled.flags.some((flag) => name.includes(flag))) return true;

    const tokens = tokenize(name);
    const upper = tokens.map((token) => token.toUpperCase());
    for (let index = 0; index < tokens.length; index++) {
        if (compiled.codes.has(tokens[index])) return true;
        if (compiled.words.has(upper[index])) return true;
        for (const phrase of compiled.phrases) {
            if (phrase.every((part, offset) => upper[index + offset] === part)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Stable partition: preferred items first, every group keeps its order.
 * Returns the input array unchanged when nothing (or everything) matches.
 */
export function orderPreferredRegionFirst<T>(
    items: readonly T[],
    region: PreferredRegionId | null | undefined,
    getName: (item: T) => string | null | undefined
): readonly T[] {
    if (!region || items.length < 2) return items;
    const preferred: T[] = [];
    const rest: T[] = [];
    for (const item of items) {
        (matchesPreferredRegion(getName(item), region) ? preferred : rest).push(
            item
        );
    }
    return preferred.length === 0 || rest.length === 0
        ? items
        : preferred.concat(rest);
}

/**
 * `Intl.DisplayNames` is ES2021; the workspace compiles against es2018, so
 * it is reached through a narrow shim (same pattern as the VOD language
 * util). Without it, labels fall back to the ISO codes.
 */
const RegionNames = (
    Intl as unknown as {
        DisplayNames?: new (
            locales: string[],
            options: { type: string }
        ) => { of(code: string): string | undefined };
    }
).DisplayNames;

/** App language codes that are not valid BCP 47 tags as-is. */
const LOCALE_ALIASES: Readonly<Record<string, string>> = {
    by: 'be',
    zhtw: 'zh-TW',
    ary: 'ar-MA',
};

/** Localized label for a region option, e.g. "Deutschland + Österreich + Schweiz". */
export function preferredRegionLabel(
    countries: readonly string[],
    appLanguage: string | null | undefined
): string {
    const locale = LOCALE_ALIASES[appLanguage ?? ''] ?? appLanguage ?? 'en';
    let names: { of(code: string): string | undefined } | null = null;
    try {
        names = RegionNames ? new RegionNames([locale, 'en'], { type: 'region' }) : null;
    } catch {
        names = null;
    }
    return countries.map((iso) => names?.of(iso) ?? iso).join(' + ');
}
