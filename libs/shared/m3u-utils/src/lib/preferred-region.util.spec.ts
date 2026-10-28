import {
    matchesPreferredRegion,
    normalizePreferredRegion,
    orderPreferredRegionFirst,
} from './preferred-region.util';

describe('matchesPreferredRegion', () => {
    it.each([
        'DE | Sport',
        'DE: Filme',
        '|DE| Kinder',
        'DE-HD',
        '4K-DE',
        '[DE] Dokus',
        '(GER) Movies',
        'GERMANY HD',
        'Germany ▶ News',
        'Deutsch Serien',
        'DEUTSCHLAND 4K',
        '🇩🇪 Bundesliga',
        'VOD DE',
    ])('treats %p as German', (name) => {
        expect(matchesPreferredRegion(name, 'de')).toBe(true);
    });

    it.each([
        'Películas de acción',
        'Films de guerre',
        'UK | Sport',
        'DEUTSCHLANDSPIEGEL',
        'Dennis',
        'DELUXE',
        'NEW RELEASES',
        '',
    ])('does not treat %p as German', (name) => {
        expect(matchesPreferredRegion(name, 'de')).toBe(false);
    });

    it('matches Austria and Switzerland only for the DACH region', () => {
        expect(matchesPreferredRegion('AT | ORF', 'de')).toBe(false);
        expect(matchesPreferredRegion('AT | ORF', 'dach')).toBe(true);
        expect(matchesPreferredRegion('Österreich', 'dach')).toBe(true);
        expect(matchesPreferredRegion('SCHWEIZ', 'dach')).toBe(true);
        expect(matchesPreferredRegion('DE | ARD', 'dach')).toBe(true);
    });

    it('matches multi-word country names', () => {
        expect(matchesPreferredRegion('United Kingdom News', 'uk')).toBe(true);
        expect(matchesPreferredRegion('United News', 'uk')).toBe(false);
    });

    it('is off without a region', () => {
        expect(matchesPreferredRegion('DE | Sport', '')).toBe(false);
        expect(matchesPreferredRegion('DE | Sport', null)).toBe(false);
    });
});

describe('orderPreferredRegionFirst', () => {
    const name = (value: string) => value;

    it('moves preferred items to the front and keeps both orders stable', () => {
        expect(
            orderPreferredRegionFirst(
                ['UK | News', 'DE | Sport', 'FR | Films', 'DE | Kinder'],
                'de',
                name
            )
        ).toEqual(['DE | Sport', 'DE | Kinder', 'UK | News', 'FR | Films']);
    });

    it('returns the same array when nothing changes', () => {
        const items = ['UK | News', 'FR | Films'];
        expect(orderPreferredRegionFirst(items, 'de', name)).toBe(items);
        expect(orderPreferredRegionFirst(items, '', name)).toBe(items);
    });
});

describe('normalizePreferredRegion', () => {
    it('keeps known regions and the explicit off value', () => {
        expect(normalizePreferredRegion('dach')).toBe('dach');
        expect(normalizePreferredRegion('')).toBe('');
    });

    it('falls back to Germany for unknown or missing values', () => {
        expect(normalizePreferredRegion(undefined)).toBe('de');
        expect(normalizePreferredRegion('xx')).toBe('de');
    });
});
