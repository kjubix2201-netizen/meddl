import { tvZoomFactor } from './tv-window-scale';

describe('tvZoomFactor', () => {
    it('fits the 1280 px TV layout to the window width', () => {
        expect(tvZoomFactor(1280)).toBe(1);
        expect(tvZoomFactor(1920)).toBe(1.5);
        expect(tvZoomFactor(960)).toBe(0.75);
    });

    it('stays within readable limits', () => {
        expect(tvZoomFactor(300)).toBe(0.5);
        expect(tvZoomFactor(8000)).toBe(3);
        expect(tvZoomFactor(0)).toBe(1);
    });
});
