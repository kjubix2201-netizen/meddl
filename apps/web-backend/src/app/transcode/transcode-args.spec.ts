import { parseProbe, probeArgs, PROTOCOLS, transcodeArgs } from './transcode-args';

describe('transcode arguments', () => {
    it('copies the picture and turns the first audio track into stereo AAC', () => {
        const args = transcodeArgs({ url: 'http://p.example/movie/u/p/1.mkv', start: 0 });
        const at = (flag: string) => args[args.indexOf(flag) + 1];
        expect(at('-c:v')).toBe('copy');
        expect(at('-c:a')).toBe('aac');
        expect(at('-ac')).toBe('2');
        expect(at('-f')).toBe('mp4');
        expect(at('-movflags')).toContain('frag_keyframe');
        expect(args).not.toContain('-ss');
        expect(args[args.length - 1]).toBe('pipe:1');
    });

    it('starts at the requested position and never opens local files', () => {
        const args = transcodeArgs({
            url: 'http://p.example/1.mkv',
            start: 754.25,
            userAgent: 'meddl',
        });
        expect(args[args.indexOf('-ss') + 1]).toBe('754.3');
        expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
        // Sound starts at the same keyframe as the copied picture (lip sync).
        expect(args.indexOf('-noaccurate_seek')).toBeLessThan(args.indexOf('-ss'));
        expect(args[args.indexOf('-avoid_negative_ts') + 1]).toBe('make_zero');
        expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe(PROTOCOLS);
        expect(PROTOCOLS.split(',')).not.toContain('file');
        expect(args[args.indexOf('-user_agent') + 1]).toBe('meddl');
        expect(probeArgs('http://p.example/1.mkv')).toContain('-protocol_whitelist');
    });

    it('reads duration and audio codec from ffprobe and tolerates garbage', () => {
        expect(
            parseProbe(
                JSON.stringify({
                    format: { duration: '5420.120000' },
                    streams: [
                        { codec_type: 'video', codec_name: 'h264' },
                        { codec_type: 'audio', codec_name: 'eac3' },
                    ],
                })
            )
        ).toEqual({ duration: 5420.12, audio: 'eac3' });
        expect(parseProbe('{"format":{"duration":"N/A"}}')).toEqual({});
        expect(parseProbe('not json')).toEqual({});
    });
});
