import { PairingStore } from './pairing-server';

describe('PairingStore (desktop phone setup)', () => {
    it('relays an entry from the phone to the TV once', () => {
        const store = new PairingStore();
        const session = store.create({ purpose: 'source' });
        expect(store.read(session.id, session.phoneToken, false)).toMatchObject({ status: 'waiting' });
        store.submit(session.id, session.phoneToken, { type: 'xtream', name: 'A' });
        expect(store.read(session.id, session.tvToken, true)).toMatchObject({
            status: 'pending',
            source: { type: 'xtream', name: 'A' },
        });
        expect(() => store.submit(session.id, session.phoneToken, { name: 'B' })).toThrow('already been used');
        expect(store.finish(session.id, session.tvToken, 'saved')).toEqual({ status: 'saved' });
    });

    it('keeps the TV token from the phone and the phone token from the TV', () => {
        const store = new PairingStore();
        const session = store.create({});
        expect(() => store.read(session.id, session.tvToken, false)).toThrow('not valid');
        expect(() => store.read(session.id, session.phoneToken, true)).toThrow('not valid');
        expect(store.read(session.id, session.phoneToken, false)).not.toHaveProperty('source');
    });

    it('forgets sessions after five minutes', () => {
        let now = 1_000;
        const store = new PairingStore(() => now);
        const session = store.create({ purpose: 'settings', defaults: { layout: 'cinema' } });
        expect(store.read(session.id, session.phoneToken, false)).toMatchObject({ defaults: { layout: 'cinema' } });
        now += 5 * 60_000;
        expect(() => store.read(session.id, session.phoneToken, false)).toThrow('expired');
    });
});
