import { tvLanguage } from './i18n';

/** Country names for the picker, in German and English (Intl.DisplayNames
 * is missing on the Chromium 68 TV engines). */
const NAMES: Readonly<Record<string, [string, string]>> = {
    DE: ['Deutschland', 'Germany'],
    AT: ['Österreich', 'Austria'],
    CH: ['Schweiz', 'Switzerland'],
    GB: ['Vereinigtes Königreich', 'United Kingdom'],
    US: ['USA', 'United States'],
    FR: ['Frankreich', 'France'],
    IT: ['Italien', 'Italy'],
    ES: ['Spanien', 'Spain'],
    NL: ['Niederlande', 'Netherlands'],
    BE: ['Belgien', 'Belgium'],
    PL: ['Polen', 'Poland'],
    TR: ['Türkei', 'Turkey'],
    PT: ['Portugal', 'Portugal'],
    GR: ['Griechenland', 'Greece'],
    RO: ['Rumänien', 'Romania'],
    AL: ['Albanien', 'Albania'],
    HR: ['Kroatien', 'Croatia'],
    RS: ['Serbien', 'Serbia'],
    BA: ['Bosnien', 'Bosnia'],
    BG: ['Bulgarien', 'Bulgaria'],
    HU: ['Ungarn', 'Hungary'],
    CZ: ['Tschechien', 'Czechia'],
    SK: ['Slowakei', 'Slovakia'],
    SE: ['Schweden', 'Sweden'],
    NO: ['Norwegen', 'Norway'],
    DK: ['Dänemark', 'Denmark'],
    FI: ['Finnland', 'Finland'],
    IE: ['Irland', 'Ireland'],
    RU: ['Russland', 'Russia'],
    UA: ['Ukraine', 'Ukraine'],
    IN: ['Indien', 'India'],
    PK: ['Pakistan', 'Pakistan'],
    BR: ['Brasilien', 'Brazil'],
    MX: ['Mexiko', 'Mexico'],
    CA: ['Kanada', 'Canada'],
    AU: ['Australien', 'Australia'],
};

export function countryName(code: string): string {
    const names = NAMES[code.toUpperCase()];
    if (!names) return code.toUpperCase();
    return tvLanguage() === 'de' ? names[0] : names[1];
}
