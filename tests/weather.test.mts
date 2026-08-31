import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weatherNote,
  fetchForecast,
  todaysWeatherNote,
  RAIN_CHANCE,
  RAIN_EXPECTED,
  RAIN_LIKELY,
  type Period,
} from '../lib/weather';
import { renderBrief } from '../lib/render';
import type { Cluster } from '../lib/select';
import type { Brief } from '../lib/write';

/**
 * Peter's rule: Rose hears about the weather only when it is about to CHANGE,
 * because that is what alters what she wears and what she can do. Ordinary LA
 * weather must produce silence — that is the common case, not the edge case.
 */

const day = (name: string, temperature: number, rain = 0): Period => ({
  name,
  isDaytime: true,
  temperature,
  probabilityOfPrecipitation: { value: rain },
  shortForecast: 'Sunny',
});

const night = (name: string, temperature: number, rain = 0): Period => ({
  name,
  isDaytime: false,
  temperature,
  probabilityOfPrecipitation: { value: rain },
  shortForecast: 'Clear',
});

/** A stretch of unremarkable Los Angeles days. */
const ordinary: Period[] = [
  day('This Afternoon', 86), night('Tonight', 65),
  day('Monday', 85), night('Monday Night', 64),
  day('Tuesday', 87), night('Tuesday Night', 65),
  day('Wednesday', 86), night('Wednesday Night', 64),
];

// ── Silence is the default ─────────────────────────────────────────────────

test('ordinary LA weather produces no line at all', () => {
  assert.equal(weatherNote(ordinary), null);
});

test('the real USC forecast for a steady week stays silent', () => {
  // The actual NWS response for USC on a typical late-August week: sunny,
  // mid-80s throughout. Rose should hear nothing.
  const steady: Period[] = [
    day('This Afternoon', 90), night('Tonight', 67),
    day('Monday', 86), night('Monday Night', 63, 1),
    day('Tuesday', 85, 5), night('Tuesday Night', 64, 5),
    day('Wednesday', 86, 1), night('Wednesday Night', 65),
  ];
  assert.equal(weatherNote(steady), null);
});

test('temperature is never reported, however big the swing', () => {
  // Peter's call: rain and storms only. A cool-down is not worth a line.
  assert.equal(weatherNote([day('This Afternoon', 92), day('Monday', 74)]), null, 'no cool-down line');
  assert.equal(weatherNote([day('This Afternoon', 70), day('Monday', 92)]), null, 'no warm-up line');
  assert.equal(weatherNote([day('This Afternoon', 104), day('Monday', 104)]), null, 'not even a hot day');
  assert.equal(weatherNote([day('This Afternoon', 48), day('Monday', 48)]), null, 'not even a cold one');
});

test('a trace chance of rain is not rain', () => {
  const trace = [day('This Afternoon', 84, RAIN_CHANCE - 1), day('Monday', 84, RAIN_CHANCE - 1)];
  assert.equal(weatherNote(trace), null);
});

test('rain is flagged across the WHOLE forecast, not just the next few days', () => {
  // Peter asked for a heads-up BEFORE rain arrives. The real USC forecast that
  // prompted this had its only rain six days out, past the temperature window.
  const week: Period[] = [
    day('This Afternoon', 90), night('Tonight', 67),
    day('Monday', 86), night('Monday Night', 63, 1),
    day('Tuesday', 85, 5), night('Tuesday Night', 64, 5),
    day('Wednesday', 86, 1), night('Wednesday Night', 65),
    day('Thursday', 84), night('Thursday Night', 66, 1),
    day('Friday', 85, 1), night('Friday Night', 67, 4),
    day('Saturday', 86, 4),
    { ...night('Saturday Night', 69, 15), shortForecast: 'Slight Chance Rain Showers' },
  ];
  const note = weatherNote(week)!;
  assert.match(note, /rain/i, 'six days out still earns a heads-up');
  assert.match(note, /Saturday/, `should say when: ${note}`);
});

test('how likely the rain is changes how firmly it is said', () => {
  const at = (pct: number) => weatherNote([day('This Afternoon', 80), day('Monday', 78, pct)])!;
  assert.match(at(RAIN_CHANCE), /chance of rain/i);
  assert.match(at(RAIN_EXPECTED), /expected/i);
  assert.match(at(RAIN_LIKELY), /likely/i);
});

test('an empty or malformed forecast is silent, never a crash', () => {
  assert.equal(weatherNote([]), null);
  assert.equal(weatherNote([{ ...day('Monday', 80), probabilityOfPrecipitation: undefined }]), null);
});

// ── The changes worth hearing about ────────────────────────────────────────

test('rain on the way is announced with when it arrives', () => {
  const rain = [
    day('This Afternoon', 84), night('Tonight', 63),
    day('Monday', 82), night('Monday Night', 60),
    day('Tuesday', 78, 70),
  ];
  const note = weatherNote(rain)!;
  assert.match(note, /rain/i);
  assert.match(note, /Tuesday/, `should say when: ${note}`);
});

test('rain still speaks when a temperature swing comes with it', () => {
  const both = [day('This Afternoon', 88), day('Monday', 70, 80)];
  const note = weatherNote(both)!;
  assert.match(note, /rain/i);
  assert.doesNotMatch(note, /cool|degrees/i, 'and says nothing about the temperature');
});

// ── It must never be able to break the email ───────────────────────────────

test('a failing weather service yields no line rather than an error', async () => {
  const dead = (async () => {
    throw new Error('ENOTFOUND api.weather.gov');
  }) as unknown as typeof fetch;
  assert.equal(await fetchForecast(dead), null);
  assert.equal(await todaysWeatherNote(dead), null);
});

test('an error status or junk body yields no line', async () => {
  const notOk = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
  assert.equal(await fetchForecast(notOk), null);

  const junk = (async () => ({ ok: true, json: async () => ({ nope: true }) })) as unknown as typeof fetch;
  assert.equal(await fetchForecast(junk), null);
});

// ── Placement in the email ─────────────────────────────────────────────────

const clusters: Cluster[] = [1, 2].map((i) => ({
  id: i, title: `Story ${i}`, section: 'us', blurb: '',
  link: `https://e.com/${i}`, source: 'NPR', coverage: [], publishedAt: new Date(), score: 1,
}));
const brief: Brief = {
  subject: 'A subject',
  paragraphs: ['The Senate [voted on Tuesday](#1).', 'Officials [responded](#2).'],
};

test('the weather line leads the email when there is one', () => {
  const r = renderBrief(brief, clusters, 'Rain is expected Tuesday.');
  assert.match(r.text, /^Rain is expected Tuesday/, 'plaintext leads with it');
  assert.ok(r.html.includes('Rain is expected Tuesday'), 'and it is in the HTML');
  assert.ok(
    r.html.indexOf('Rain is expected') < r.html.indexOf('The Senate'),
    'above the news, since it decides what she wears',
  );
});

test('no weather line leaves the email exactly as it was', () => {
  const withNone = renderBrief(brief, clusters, null);
  assert.match(withNone.text, /^The Senate/, 'no stray blank space');
  assert.ok(!withNone.html.includes('background-color:#f0f4f8'), 'no empty box');
  // The default must match the old two-argument behaviour.
  assert.deepEqual(renderBrief(brief, clusters), withNone);
});

test('the weather line is escaped like everything else', () => {
  const r = renderBrief(brief, clusters, 'Cooler & wetter <b>soon</b>');
  assert.ok(!r.html.includes('<b>soon</b>'), 'no raw markup reaches the email');
  assert.ok(r.html.includes('&amp;'));
});

test("tomorrow's rain is what gets reported, ahead of anything later", () => {
  // The nearest rain is the one that changes what she does tomorrow.
  const week = [
    day('This Afternoon', 88), night('Tonight', 65),
    day('Monday', 80, 60), night('Monday Night', 62, 60),
    day('Saturday', 78, 90),
  ];
  const note = weatherNote(week)!;
  assert.match(note, /Monday/, `should lead with tomorrow, not Saturday: ${note}`);
});

test('thunderstorms are called storms, not rain', () => {
  const stormy = [
    day('This Afternoon', 88),
    { ...day('Monday', 80, 60), shortForecast: 'Chance Showers And Thunderstorms' },
  ];
  const note = weatherNote(stormy)!;
  assert.match(note, /storms/i, `should name storms: ${note}`);
  assert.doesNotMatch(note, /\bRain is\b/, 'and not undersell them as rain');
});

test('the line states the weather and stops, with no advice attached', () => {
  // Peter: "not worth keeping in mind. just There's a chance of rain Saturday
  // night." She can decide what to do about rain on her own.
  const lines = [
    weatherNote([day('This Afternoon', 80), day('Monday', 78, RAIN_CHANCE)])!,
    weatherNote([day('This Afternoon', 80), day('Monday', 78, RAIN_EXPECTED)])!,
    weatherNote([day('This Afternoon', 80), day('Monday', 78, RAIN_LIKELY)])!,
    weatherNote([day('This Afternoon', 78, RAIN_LIKELY)])!,
  ];
  for (const line of lines) {
    assert.doesNotMatch(line, /jacket|keep in mind|keeping in mind|worth|plan on/i, `advice leaked: ${line}`);
    assert.doesNotMatch(line, /—/, `no trailing clause: ${line}`);
    assert.match(line, /\.$/, `one clean sentence: ${line}`);
  }
});
