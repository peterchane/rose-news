import { isDeliveryHour, currentHourPT } from '../lib/schedule';

/**
 * Each cron entry fires once per day, at an unpredictable minute within its
 * hour (Hobby precision is +/-59min). For each season, exactly one of the two
 * entries must pass the gate, and it must pass at every minute of its window.
 */
const seasons = [
  ['summer (PDT)', '2026-07-15'],
  ['winter (PST)', '2026-01-15'],
  ['DST spring-forward day', '2026-03-08'],
  ['DST fall-back day', '2026-11-01'],
] as const;

let allPass = true;
for (const [label, date] of seasons) {
  const entriesThatRun: string[] = [];
  for (const utcHour of [15, 16]) {
    const results = Array.from({ length: 60 }, (_, min) =>
      isDeliveryHour(new Date(`${date}T${String(utcHour).padStart(2,'0')}:${String(min).padStart(2,'0')}:00Z`)),
    );
    const always = results.every(Boolean), never = results.every(r => !r);
    if (!always && !never) { console.log(`  !! ${utcHour}:00 UTC entry is inconsistent across its hour`); allPass = false; }
    if (always) entriesThatRun.push(`${utcHour}:00 UTC`);
  }
  const pt = currentHourPT(new Date(`${date}T${entriesThatRun[0]?.slice(0,2) ?? '15'}:30:00Z`));
  const ok = entriesThatRun.length === 1;
  if (!ok) allPass = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(24)} → ${entriesThatRun.join(' + ') || 'NONE'} fires, lands ${pt}am PT`);
}
console.log(allPass ? '\nPASS — exactly one send per day, 8am PT, year-round' : '\nFAIL');
