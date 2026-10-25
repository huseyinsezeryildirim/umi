const B = "http://localhost:1420/";
const item = (t) => `[...document.querySelectorAll('[role=menuitem]')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}))`;
const inInspector = (t) => `[...document.querySelectorAll('.ed-inspector button, aside button, [class*=inspector] button')].find(x=>x.textContent.trim()===${JSON.stringify(t)})`;
const button = (t) => `[...document.querySelectorAll('button,[role=menuitem]')].find(x=>(x.getAttribute('aria-label')||x.textContent.trim()).startsWith(${JSON.stringify(t)}))`;
export default {
  zoom: {
    url: B + "?demo&open",
    crop: [12, 52, 1084, 708],
    run: async ({ at, click, sleep }) => {
      await sleep(600);
      await click(...(await at(button("Play"))));
      await sleep(8200);
    },
  },
  ums: {
    url: B + "?demo&open&panel=captions&fillers",
    crop: [12, 600, 1416, 300],
    width: 1416,
    run: async ({ at, click, move, sleep }) => {
      const b = await at(button("Remove filler"));
      await sleep(900);
      await move(b[0] - 120, b[1] + 60); await sleep(300);
      await move(b[0], b[1]); await sleep(500);
      await click(...b);
      await sleep(3200);
    },
  },
  masks: {
    url: B + "?demo&open",
    crop: [12, 52, 1416, 708],
    run: async ({ at, click, key, sleep }) => {
      await sleep(700);
      await click(...(await at(button("Add")))); await sleep(700);
      await click(...(await at(item("Blur")))); await sleep(2000);
      await click(...(await at(inInspector("Pixelate")))); await sleep(2000);
      // Highlight is its own kind: swap the mask for one.
      await key("Backspace", "Backspace", 8); await sleep(500);
      await click(...(await at(button("Add")))); await sleep(600);
      await click(...(await at(item("Highlight")))); await sleep(2400);
    },
  },
  clips: {
    url: B + "?demo&open",
    crop: [12, 560, 1084, 240],
    width: 1084,
    run: async ({ evaluate, click, key, sleep }) => {
      const ruler = await evaluate(`(()=>{const r=document.querySelector('.ed-tl-content').getBoundingClientRect();return [r.x,r.y,r.width]})()`);
      const x = (t) => ruler[0] + 10 + (t / 10.1) * (ruler[2] - 20);
      await sleep(700);
      await click(x(3), ruler[1] + 15); await sleep(500);
      await key("s", "KeyS", 83); await sleep(900);
      await click(x(6.2), ruler[1] + 15); await sleep(500);
      await key("s", "KeyS", 83); await sleep(1000);
      await click(x(4.5), ruler[1] + 70); await sleep(800);
      await key("Backspace", "Backspace", 8); await sleep(2500);
    },
  },
};
