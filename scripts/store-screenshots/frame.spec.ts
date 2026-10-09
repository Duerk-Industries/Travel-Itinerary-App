/**
 * Composes captioned, phone-framed App Store images from output/*-full.png.
 * Run after expenses.spec.ts and itinerary-blog.spec.ts.
 * Output: output/store-*.png at 1290x2796.
 */
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(__dirname, 'output');
// Height (in CSS px at 430-wide) of the app's top bar, cropped out of the frame.
const HEADER_CROP = 100;

type Slide = { src: string; file: string; title: string; sub: string; bg: [string, string]; offset: number };

const slides: Slide[] = [
  { src: 'ledger-full.png', file: 'store-1-plan-and-split.png', title: 'Plan the trip.<br>Split the costs.', sub: 'Book a hotel or flight and it lands on the group tab automatically.', bg: ['#FF9F43', '#EE5A24'], offset: 0 },
  { src: 'settle-full.png', file: 'store-2-who-owes-whom.png', title: 'Know who owes whom', sub: 'Settle up before you fly home. No spreadsheets.', bg: ['#FC5C65', '#EB3B5A'], offset: 0 },
  { src: 'itinerary-full.png', file: 'store-3-plan-together.png', title: 'Plan your trip together', sub: 'One shared day-by-day plan the whole group can see and edit.', bg: ['#FFB142', '#FF793F'], offset: 113 },
  { src: 'votes-full.png', file: 'store-4-vote-together.png', title: 'Vote on plans together', sub: 'Thumbs up or down on flights, stays and activities until everyone agrees.', bg: ['#F7B731', '#FA8231'], offset: 0 },
  { src: 'blog-full.png', file: 'store-5-trip-story.png', title: 'Turn your trip into a story', sub: "Everyone's photos and memories, day by day.", bg: ['#FF7979', '#F0932B'], offset: 280 },
  { src: 'expenses-full.png', file: 'store-6-every-expense.png', title: 'Every meal, ride and ticket', sub: 'Logged day by day and split the way your group wants.', bg: ['#FD9644', '#F7B731'], offset: 0 },
];

test.use({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 });

for (const s of slides) {
  test(s.file, async ({ page }) => {
    const img = fs.readFileSync(path.join(OUT, s.src)).toString('base64');
    await page.setContent(`<!doctype html><html><head>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@800;600&display=swap" rel="stylesheet">
      <style>
        *{margin:0;box-sizing:border-box}
        body{width:430px;height:932px;overflow:hidden;font-family:Nunito,system-ui,sans-serif;
          background:linear-gradient(160deg,${s.bg[0]},${s.bg[1]});display:flex;flex-direction:column;align-items:center}
        h1{color:#fff;font-weight:800;font-size:40px;line-height:1.05;text-align:center;margin:58px 24px 12px;letter-spacing:-.5px;
          text-shadow:0 2px 10px rgba(0,0,0,.12)}
        p{color:rgba(255,255,255,.95);font-weight:600;font-size:18px;text-align:center;margin:0 34px 30px;line-height:1.3}
        .phone{width:338px;height:690px;border-radius:52px;background:#111;padding:11px;
          box-shadow:0 30px 60px rgba(80,20,0,.35)}
        .screen{width:100%;height:100%;border-radius:42px;overflow:hidden;background:#F1F5F9;position:relative}
        .screen img{position:absolute;left:0;width:100%;top:${-(HEADER_CROP + s.offset) * (316 / 430)}px}
      </style></head><body>
      <h1>${s.title}</h1><p>${s.sub}</p>
      <div class="phone"><div class="screen"><img src="data:image/png;base64,${img}"></div></div>
    </body></html>`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(OUT, s.file) });
  });
}
