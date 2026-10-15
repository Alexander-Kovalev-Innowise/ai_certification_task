// Joins every recorded test video (apps/e2e/videos/**.webm) into one MP4 with a small caption in the
// top-left corner naming the spec and the test being shown, plus a chapter per clip.
//
//   node scripts/build-showreel.mjs [--out=videos/_showreel] [--jobs=4] [--crf=28] [--only=<regex on spec folder>]
//
// Needs a full ffmpeg (drawtext + concat): put one in apps/e2e/.tools/ (any ffmpeg-*/bin/ffmpeg.exe) or on PATH.
// Playwright's bundled ffmpeg is a stripped build and cannot do this.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEOS = path.join(ROOT, 'videos');
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const OUT_DIR = path.resolve(ROOT, arg('out', 'videos/_showreel'));
const JOBS = Number(arg('jobs', Math.min(4, os.cpus().length)));
const CRF = arg('crf', '28');
const ONLY = arg('only', '') ? new RegExp(arg('only', '')) : null;
const W = 1280;
const H = 720;
const BAR = 24; // caption strip above the recording, so the caption never covers the app
const FONT = process.platform === 'win32' ? 'C\\:/Windows/Fonts/arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function findFfmpeg() {
  const tools = path.join(ROOT, '.tools');
  if (fs.existsSync(tools)) {
    for (const dir of fs.readdirSync(tools)) {
      const exe = path.join(tools, dir, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return 'ffmpeg';
}
const FFMPEG = findFfmpeg();

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'test';

// Real test titles (and their order) come from Playwright's own listing; the video file name is a slug of them.
function loadTitles() {
  const res = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const map = new Map();
  let order = 0;
  const walk = (suite, titles, file) => {
    for (const child of suite.suites ?? []) walk(child, child.title === path.basename(child.file ?? '') ? titles : [...titles, child.title], child.file ?? file);
    for (const spec of suite.specs ?? []) {
      const full = [...titles, spec.title].join(' - ');
      for (const t of spec.tests ?? []) {
        const suffix = t.projectName === 'chromium' ? '' : `-${t.projectName}`;
        const specName = path.basename(spec.file ?? file).replace(/\.spec\.[jt]sx?$/, '');
        map.set(`${specName}/${slug(full)}${suffix}`, { group: titles.join(' - '), title: spec.title, project: t.projectName, order: order++ });
      }
    }
  };
  try {
    const json = JSON.parse(res.stdout);
    for (const s of json.suites ?? []) walk(s, [], s.file);
  } catch {
    console.warn('! could not read the Playwright test list; falling back to file names for captions');
  }
  return map;
}

function humanize(file) {
  return file.replace(/\.webm$/, '').replace(/-/g, ' ');
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${cmd} exited ${code}\n${err.slice(-1500)}`))));
  });
}

async function duration(file) {
  const err = await run(FFMPEG, ['-hide_banner', '-i', file]).catch((e) => e.message);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

const fmt = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

async function main() {
  const titles = loadTitles();
  const clips = [];
  for (const dir of fs.readdirSync(VIDEOS).sort()) {
    if (dir.startsWith('_') || dir.startsWith('zz-') || (ONLY && !ONLY.test(dir))) continue;
    const full = path.join(VIDEOS, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.webm'))) {
      const key = `${dir}/${file.replace(/\.webm$/, '')}`;
      const info = titles.get(key) ?? titles.get(key.replace(/-page\d+$/, '')) ?? null;
      clips.push({ dir, file, path: path.join(full, file), info, order: info?.order ?? 1e9 });
    }
  }
  clips.sort((a, b) => (a.dir === b.dir ? a.order - b.order || a.file.localeCompare(b.file) : a.dir.localeCompare(b.dir)));
  if (!clips.length) throw new Error('no videos found - run the Playwright suite first');

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const work = path.join(OUT_DIR, 'parts');
  fs.mkdirSync(work, { recursive: true });
  console.log(`${clips.length} clips, ffmpeg: ${FFMPEG}, ${JOBS} parallel jobs`);

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < clips.length) {
      const i = next++;
      const c = clips[i];
      const device = c.info?.project && c.info.project !== 'chromium' ? ` [${c.info.project}]` : '';
      const line1 = clip(`${c.dir.replace(/\.strict$/, '')}${device}`, 150);
      const line2 = clip(c.info ? `${c.info.group ? `${c.info.group}: ` : ''}${c.info.title}` : humanize(c.file), 150);
      const textFile = path.join(work, `${i}.txt`);
      fs.writeFileSync(textFile, clip(`${line1}  |  ${line2}`, 175), 'utf8');
      const tf = textFile.replace(/\\/g, '/').replace(':', '\\:');
      const out = path.join(work, `${String(i).padStart(4, '0')}.mp4`);
      const vf =
        `fps=25,scale=${W}:${H - BAR}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:${BAR}+(${H - BAR}-ih)/2:color=0x101010,` +
        `drawtext=fontfile='${FONT}':textfile='${tf}':fontsize=13:fontcolor=0xd8d8d8:x=10:y=${(BAR - 13) / 2 - 1}`;
      await run(FFMPEG, ['-y', '-v', 'error', '-i', c.path, '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', CRF, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
      c.part = out;
      c.label = `${line1} | ${line2}`;
      process.stdout.write(`\r${++done}/${clips.length}`);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  process.stdout.write('\n');

  // Concatenate (stream copy: every part has identical codec parameters) and add a chapter per clip.
  let t = 0;
  const meta = [';FFMETADATA1', 'title=PracticePerfect Epic-01 - all e2e flows'];
  const index = [];
  for (const c of clips) {
    const d = await duration(c.part);
    meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(t * 1000)}`, `END=${Math.round((t + d) * 1000)}`, `title=${c.label.replace(/[=;#\\\n]/g, ' ')}`);
    index.push(`${fmt(t)}  ${c.label}`);
    t += d;
  }
  fs.writeFileSync(path.join(work, 'chapters.txt'), meta.join('\n'), 'utf8');
  fs.writeFileSync(path.join(work, 'list.txt'), clips.map((c) => `file '${c.part.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  const final = path.join(OUT_DIR, 'epic-01-showreel.mp4');
  await run(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-i', path.join(work, 'chapters.txt'), '-map_metadata', '1', '-c', 'copy', '-movflags', '+faststart', final]);
  fs.writeFileSync(path.join(OUT_DIR, 'epic-01-showreel-index.txt'), index.join('\n'), 'utf8');
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`${final}\n${clips.length} clips, ${fmt(t)} total, ${(fs.statSync(final).size / 1048576).toFixed(0)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
