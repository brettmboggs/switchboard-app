// The System monitor: reading what each OS says (text copied in the shape the
// OS prints, with made-up numbers), grouping apps, and the plain-words verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMeminfo, parseProcStat, groupProcs, parseNvidia, parseVmStat, parseNetDev, parseMacNetstat, readHwmon, parseWindows, sensorName, _parse } from '../lib/sysprobe.js';
import { bottleneck, corePercents, systemSnapshot, diskName } from '../lib/sysmon.js';

const GB = 1073741824;

test('meminfo: total, available, cached and swap in bytes', () => {
  const m = parseMeminfo('MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    9000000 kB\nCached:          4000000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\n');
  assert.equal(m.total, 16000000 * 1024); assert.equal(m.avail, 9000000 * 1024); assert.equal(m.cached, 4000000 * 1024);
  assert.equal(m.swapTotal - m.swapFree, 500000 * 1024);
  assert.equal(parseMeminfo('').total, null);
});

test('a /proc stat line: name with spaces and brackets, ticks, resident pages', () => {
  const rest = '0 1 1 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 1 0 5000 12345678 321 18446744073709551615';
  const p = parseProcStat(`4242 (my (odd) app) S ${rest}`);
  assert.equal(p.name, 'my (odd) app'); assert.equal(p.ticks, 300); assert.equal(p.rssPages, 321);
  assert.equal(parseProcStat('garbage'), null);
});

test('apps with one name count as one, and add up', () => {
  const g = groupProcs([{ name: 'browser', cpu: 2, mem: 100 }, { name: 'browser', cpu: 3, mem: 50 }, { name: 'editor', cpu: 1, mem: 10 }]);
  const b = g.find((x) => x.name === 'browser');
  assert.deepEqual([g.length, b.count, b.cpu, b.mem], [2, 2, 5, 150]);
});

test('nvidia-smi rows: use, video memory in bytes, temperature, fan, power', () => {
  const [g] = parseNvidia('Example GPU 9000, 36, 562, 12280, 49, 0, 27.24\n');
  assert.equal(g.name, 'Example GPU 9000'); assert.equal(g.pct, 36); assert.equal(g.memUsed, 562 * 1048576); assert.equal(g.temp, 49); assert.equal(g.watts, 27.24);
  assert.deepEqual(parseNvidia(''), []); assert.deepEqual(parseNvidia('[N/A], [N/A]\n'), []);
});

test('Mac memory from vm_stat: free, inactive, speculative and purgeable are available', () => {
  const v = parseVmStat('Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                               1000.\nPages inactive:                           2000.\nPages speculative:                         500.\nPages purgeable:                           500.\n');
  assert.equal(v.avail, 4000 * 16384); assert.equal(v.cached, 2000 * 16384);
});

test('network counters add up real interfaces, not loopback or containers', () => {
  const dev = 'Inter-|   Receive\n face |bytes packets\n    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eth0: 1000 5 0 0 0 0 0 0 2000 6 0 0 0 0 0 0\ndocker0: 50 1 0 0 0 0 0 0 60 1 0 0 0 0 0 0\n';
  assert.deepEqual(parseNetDev(dev), { rx: 1000, tx: 2000 });
  const mac = 'Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll\nlo0   16384 <Link#1>                           10     0       5000       10     0       5000     0\nen0   1500  <Link#4>    aa:bb:cc:dd:ee:ff   100     0       7000      200     0       9000     0\nutun3 1380  <Link#9>                            1     0        100        2     0        200     0\n';
  assert.deepEqual(parseMacNetstat(mac), { rx: 7100, tx: 9200 });
});

test('Linux sensors: temperatures with their labels and fans, read from a folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'sb-hwmon-'));
  try {
    const chip = join(root, 'hwmon0'); mkdirSync(chip);
    writeFileSync(join(chip, 'name'), 'examplechip\n'); writeFileSync(join(chip, 'temp1_input'), '45500\n'); writeFileSync(join(chip, 'temp1_label'), 'Package\n');
    writeFileSync(join(chip, 'temp2_input'), '0\n'); writeFileSync(join(chip, 'fan1_input'), '1200\n');
    const { temps, fans } = readHwmon(root);
    assert.deepEqual(temps.map((t) => [t.label, t.raw, t.c]), [['Processor', 'examplechip Package', 45.5]]);   // a zero reading is no reading
    assert.deepEqual(fans.map((f) => [f.label, f.rpm]), [['examplechip fan 1', 1200]]);
    assert.deepEqual(readHwmon(join(root, 'missing')), { temps: [], fans: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Mac graphics use and battery temperature', () => {
  assert.equal(_parse.macGpu('"PerformanceStatistics" = {"Device Utilization %"=23,"Renderer Utilization %"=10}'), 23);
  assert.equal(_parse.macBatteryTemp('"Temperature" = 3050'), 30.5);
  assert.equal(_parse.macGpu(''), null);
});

test('Windows answer: process change over time, network, sensors from a monitoring tool', () => {
  const json = (cpu) => JSON.stringify({ procs: [{ n: 'editor', c: cpu, m: 1000, i: 7 }], net: [{ r: 10, s: 20 }, { r: 5, s: 5 }], sensors: [{ t: 'Temperature', n: 'CPU Package', v: 61 }, { t: 'Fan', n: 'Fan #1', v: 900 }], zones: [{ l: 'x', c: 30 }] });
  const first = parseWindows(json(10), null, 1000);
  assert.equal(first.procs[0].cpu, 0);    // one point is no change yet
  const second = parseWindows(json(12), { at: 1000, ticks: first.ticks }, 6000);   // 2 s of processor time in 5 s, whatever the core count
  assert.ok(second.procs[0].cpu > 0);
  assert.deepEqual(second.net, { rx: 15, tx: 25 });
  assert.deepEqual(second.temps.map((t) => [t.label, t.raw]), [['Processor', 'CPU Package']]); assert.equal(second.fans[0].rpm, 900);
  assert.equal(parseWindows('not json', null, 1), null);
});

test('processor percent per core from two readings', () => {
  const a = [{ user: 100, nice: 0, sys: 100, idle: 800, irq: 0 }], b = [{ user: 150, nice: 0, sys: 150, idle: 900, irq: 0 }];
  assert.equal(Math.round(corePercents(a, b)[0]), 50);
  assert.equal(corePercents(a, a)[0], 0);
});

test('the verdict says what is straining, in words, and says nothing when calm', () => {
  const calm = { cpu: { pct: 20 }, mem: { pct: 40, swapUsed: 0 }, gpus: [], temps: [{ label: 'CPU', c: 50 }], disks: [{ mount: '/', total: 100 * GB, free: 50 * GB }], apps: [{ name: 'editor', cpu: 5, mem: GB }] };
  assert.deepEqual(bottleneck(calm), []);
  const busy = { ...calm, cpu: { pct: 97 }, mem: { pct: 93, swapUsed: 0 }, temps: [{ label: 'CPU', c: 95 }], gpus: [{ pct: 99 }], disks: [{ mount: 'C:\\', total: 100 * GB, free: 4 * GB }], apps: [{ name: 'renderer', cpu: 80, mem: 6 * GB }] };
  const say = bottleneck(busy).map((x) => x.text).join(' | ');
  assert.match(say, /processor is flat out \(97%\), mostly renderer/); assert.match(say, /Memory is 93% full; renderer holds 6\.0 GB/);
  assert.match(say, /graphics card is flat out/); assert.match(say, /CPU is running hot \(95°C\)/); assert.match(say, /Drive C: has only 4 GB left/);
});

test('a snapshot on this computer has the whole shape the page draws', async () => {
  const s = await systemSnapshot();
  assert.ok(s.cpu.count > 0 && s.cpu.cores.length === s.cpu.count);
  assert.ok(s.mem.total > 0 && s.mem.pct >= 0 && s.mem.pct <= 100);
  for (const k of ['disks', 'gpus', 'temps', 'fans', 'apps', 'notes', 'say']) assert.ok(Array.isArray(s[k]), k);
  assert.ok(s.apps.length > 0);
});

test('sensors and disks are named for the part of the computer, not the chip or the path', () => {
  const names = [['Tctl', 'k10temp'], ['Tccd1', 'k10temp'], ['Package id 0', 'coretemp'], ['Core 0', 'coretemp'], ['Composite', 'nvme'], ['edge', 'amdgpu'], ['junction', 'amdgpu'], ['', 'acpitz'], ['CPU Core #2', 'sensor'], ['GPU Core', 'sensor'], ['Water', 'nct6798']].map(([l, c]) => sensorName(l, c));
  assert.deepEqual(names, ['Processor', 'Processor chiplet 1', 'Processor', 'Processor core 1', 'SSD', 'Graphics', 'Graphics (hottest spot)', 'Motherboard', 'Processor core 2', 'Graphics', 'Water']);
  assert.deepEqual(['/', '/boot/efi', 'C:\\', 'd:', '/media/sam/photos'].map((m) => diskName(m, 'linux')), ['The main disk', 'The startup disk', 'Drive C:', 'Drive D:', 'Photos']);
  const GB = 1073741824;
  const say = bottleneck({ cpu: { pct: 1 }, mem: { pct: 1 }, gpus: [], temps: [], apps: [], disks: [{ mount: '/', total: 100 * GB, free: 5 * GB }] });
  assert.equal(say[0].text, 'The main disk has only 5 GB left.');
});
