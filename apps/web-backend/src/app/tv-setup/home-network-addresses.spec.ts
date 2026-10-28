import { homeNetworkAddresses } from './pairing-router';

describe('homeNetworkAddresses', () => {
    it('lists private IPv4 addresses only, home-router ranges first', () => {
        const entry = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
            ({ address, family, internal, netmask: '', mac: '', cidr: null }) as never;
        expect(
            homeNetworkAddresses({
                lo: [entry('127.0.0.1', 'IPv4', true)],
                wsl: [entry('172.17.0.1', 'IPv4')],
                vpn: [entry('10.8.0.2', 'IPv4')],
                wan: [entry('84.10.20.30', 'IPv4')],
                eth0: [entry('192.168.178.21', 'IPv4'), entry('fe80::1', 'IPv6')],
            })
        ).toEqual(['192.168.178.21', '10.8.0.2', '172.17.0.1']);
    });
});
