import { t, type Media, type UserData } from '@meddl/tv/util';

/** Toggles a favorite and reports a failed save with a retry. */
export function favoriteToggle(
    update: (change: (data: UserData) => UserData) => Promise<unknown>,
    setError: (message: string, retry?: () => void, label?: string) => void,
    clearError: (label: string) => void
) {
    async function favorite(item: Media) {
        try {
            await update((d) => ({
                ...d,
                favorites: d.favorites.some((m) => m.id === item.id)
                    ? d.favorites.filter((m) => m.id !== item.id)
                    : [...d.favorites, item],
            }));
            clearError(t('Retry saving favorite'));
        } catch {
            setError(
                t('Favorite was not saved. Free TV storage and retry.'),
                () => void favorite(item),
                t('Retry saving favorite')
            );
        }
    }
    return favorite;
}
