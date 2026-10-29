import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayCategoryName, displayChannelName } from '@meddl/tv/util';

test('categories lose the repeated country prefix and shouting capitals', () => {
    assert.equal(displayCategoryName('|DE| ✪ SKY CINEMA'), 'Sky Cinema');
    assert.equal(displayCategoryName('|DE| ✪ NEWS| DOKU'), 'News · Doku');
    assert.equal(displayCategoryName('DE: Kinder'), 'Kinder');
    assert.equal(displayCategoryName('[DE] UFC PPV'), 'UFC PPV');
    assert.equal(displayCategoryName('Alle Sender'), 'Alle Sender');
});

test('channels lose prefix and quality suffix, brands stay', () => {
    assert.equal(displayChannelName('DE - PROMI BIG BROTHER HD'), 'Promi Big Brother');
    assert.equal(displayChannelName('|DE| ZDF UHD'), 'ZDF');
    assert.equal(displayChannelName('[DE] RTL ZWEI HD'), 'RTL Zwei');
    assert.equal(displayChannelName('RTL ZWEI'), 'RTL Zwei');
    assert.equal(displayChannelName('Kanal 1 HD'), 'Kanal 1');
    assert.equal(displayChannelName('HD'), 'HD');
});
