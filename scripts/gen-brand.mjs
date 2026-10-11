// Generates MyDashie brand assets with Nano Banana Pro (gemini-3-pro-image).
// Usage: node scripts/gen-brand.mjs [concept|final|all]
// Writes raw PNGs to assets/generated/raw/ (gitignored). Picks are copied to assets/brand/ by hand.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const KEY = env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY missing in .env");

const outDir = resolve(root, "assets/generated/raw");
mkdirSync(outDir, { recursive: true });

const STYLE = `Style: soft, bubbly, friendly 3D-ish character with smooth matte surfaces, gentle subsurface glow, rounded shapes, pastel palette (soft lilac #C7B8FF, mint #BFF3DD, peach #FFD7C2, butter #FFF1B8) on a pure flat white background (#FFFFFF) with no shadow on the ground, no text, no watermark, centered, generous margin around the subject. Clean studio lighting, high quality, consistent character sheet quality.`;

const CONCEPTS = {
  "mascot-blob": `A friendly mascot for an app called Dash SSR that builds data dashboards. The character is a plump, rounded blob shaped like a soft squircle with two big glossy eyes and a tiny smile, holding or hugging a small glowing bar chart made of three rounded pastel bars. ${STYLE}`,
  "mascot-bot": `A friendly mascot for an app called Dash SSR that builds data dashboards. The character is a cute rounded robot with a pill-shaped body, a single wide visor-screen face showing a happy line-chart smile, short stubby arms, floating slightly above the ground, with a little rounded antenna ending in a pastel orb. ${STYLE}`,
  "mascot-dash": `A friendly mascot for an app called Dash SSR that builds data dashboards. The character is a smiling, puffy rounded speech-bubble shape with a soft gradient from lilac to mint, big friendly eyes, and three small rounded bar-chart bars rising inside its belly like a window. ${STYLE}`,
};

async function generate(name, prompt, { aspect = "1:1", size = "2K" } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: aspect, imageSize: size },
    },
  };
  const t0 = Date.now();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${(await r.text()).slice(0, 400)}`);
  const d = await r.json();
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData);
  if (!img) throw new Error(`${name}: no image in response: ${JSON.stringify(d).slice(0, 400)}`);
  const file = resolve(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(img.inlineData.data, "base64"));
  console.log(`wrote ${file} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return file;
}

const mode = process.argv[2] ?? "concept";
if (mode === "concept" || mode === "all") {
  for (const [name, prompt] of Object.entries(CONCEPTS)) {
    if (existsSync(resolve(outDir, `${name}.png`)) && mode !== "all") {
      console.log(`skip ${name} (exists)`);
      continue;
    }
    try {
      await generate(name, prompt);
    } catch (e) {
      console.error(String(e));
    }
  }
}

// ---- Poses: image-to-image from the chosen mascot for consistency ----
const POSES = {
  "dashy-wave": "Same character, same style and colors, waving one arm hello with a big friendly smile, still holding the small bar chart in the other arm.",
  "dashy-building": "Same character, same style and colors, wearing a tiny pastel hard hat, concentrating with tongue slightly out, stacking the three bars of its bar chart like building blocks.",
  "dashy-sleeping": "Same character, same style and colors, eyes closed peacefully asleep, a small pastel 'z z z' floating above, hugging the bar chart like a pillow.",
  "dashy-celebrate": "Same character, same style and colors, both arms up cheering joyfully, pastel confetti dots in the air, the bar chart bars glowing.",
  "dashy-worried": "Same character, same style and colors, slightly worried expression with raised eyebrows and a small sweat drop, one bar of the chart tipped over.",
  "dashy-peek": "Same character, same style and colors, exactly ONE character, shown from the front, tilting its head curiously to one side with wide eyes and a small open mouth, no arms visible, no chart, nothing else in the frame.",
};

async function generateFromRef(name, prompt, refFile, aspect = name.startsWith("wordmark") ? "21:9" : name.startsWith("about-") ? "16:9" : "1:1") {
  const ref = readFileSync(refFile).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${KEY}`;
  const body = {
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "image/png", data: ref } },
      { text: `${prompt} Keep the exact same character design, proportions, materials and pastel palette as the reference image. Pure flat white background (#FFFFFF), no ground shadow, no text, centered with generous margin.` },
    ] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: "2K" } },
  };
  const t0 = Date.now();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${(await r.text()).slice(0, 400)}`);
  const d = await r.json();
  const img = (d.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData);
  if (!img) throw new Error(`${name}: no image: ${JSON.stringify(d).slice(0, 300)}`);
  const file = resolve(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(img.inlineData.data, "base64"));
  console.log(`wrote ${file} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

if (mode === "poses" || mode.startsWith("pose:")) {
  const ref = resolve(root, "assets/brand/dashy-source.png");
  const only = mode.startsWith("pose:") ? mode.slice(5) : null;
  await Promise.all(Object.entries(POSES).filter(([n]) => !only || n === only).map(([n, p]) => generateFromRef(n, p, ref).catch((e) => console.error(String(e)))));
}

// ---- UI icon set: soft 3D pastel icons in the Dashy world, one per file ----
const ICON_STYLE = `A single app icon illustration in the same soft, bubbly, matte 3D style and pastel palette as the reference character (lilac #C7B8FF, mint #BFF3DD, peach #FFD7C2, butter #FFF1B8), simple bold silhouette readable at small sizes, centered, generous margin, pure flat white background (#FFFFFF), no ground shadow, no text, no sparkles, no stars.`;
const ICONS = {
  "icon-new": "A chunky rounded plus sign.",
  "icon-home": "Four rounded square tiles arranged in a 2x2 grid, each a different pastel color.",
  "icon-settings": "A chunky rounded gear with soft teeth.",
  "icon-ai": "The reference character's round face only, smiling, as a badge.",
  "icon-apps": "A chunky electrical plug with a rounded cable loop.",
  "icon-mcp": "Three stacked rounded server blocks with tiny round lights.",
  "icon-general": "Two horizontal slider tracks with round knobs.",
  "icon-schedule": "A chunky round clock face with two short rounded hands.",
  "icon-refresh": "Two chunky rounded arrows chasing each other in a circle.",
  "icon-export": "A rounded document sheet with a chunky arrow pointing up and out.",
  "icon-browser": "A rounded lilac square window frame with a chunky mint arrow bursting diagonally out of its top-right corner, meaning open externally. The window interior is solid plain lilac.",
  "icon-folder": "A chunky rounded folder.",
  "icon-trash": "A chunky rounded trash bin with a lid.",
  "icon-link": "Two chunky rounded chain links.",
  "icon-file": "A rounded spreadsheet document with a tiny bar chart on it.",
  "icon-send": "A chunky rounded arrow pointing up.",
  "icon-stop": "One solid chunky peach rounded square block, a plain stop button shape, nothing on it.",
  "icon-check": "A chunky rounded check mark.",
  "icon-edit": "A single chunky rounded pencil lying diagonally, pointing down and to the left: butter-yellow body, peach eraser, lilac tip.",
  "icon-alert": "A chunky rounded exclamation mark inside a soft circle.",
  "icon-close": "A chunky rounded X.",
  "icon-more": "Three round dots in a row.",
  "icon-chevron": "A chunky rounded chevron pointing down.",
  "icon-search": "A chunky rounded magnifying glass.",
  "icon-key": "A chunky rounded key.",
  "icon-tray": "The reference character's round face only, smiling, simplified, high contrast silhouette.",
};
if (mode === "icons") {
  const ref = resolve(root, "assets/brand/dashy-source.png");
  const entries = Object.entries(ICONS).filter(([n]) => !existsSync(resolve(outDir, `${n}.png`)));
  // run 4 at a time to stay under rate limits
  for (let i = 0; i < entries.length; i += 4) {
    await Promise.all(entries.slice(i, i + 4).map(([n, p]) => generateFromRef(n, `${p} ${ICON_STYLE}`, ref).catch((e) => console.error(String(e)))));
  }
}

// ---- Object-only icons (no character reference, so the mascot does not sneak in) ----
const OBJECT_ICON_STYLE = `A single app icon: one simple object, rendered as a soft, bubbly, matte 3D clay-like shape with smooth rounded edges, gentle studio lighting, pastel palette only (lilac #B9A8FF, mint #BFF3DD, peach #FFD7C2, butter #FFF1B8), bold readable silhouette, centered, generous margin, pure flat white background (#FFFFFF), no ground shadow, no text, no face, no character, no sparkles, no stars, no clouds, no logos, no badges, no extra small objects.`;
const OBJECT_ICONS = {
  "icon-home": "Four blank rounded square tiles in a 2x2 grid: lilac, mint, peach, butter. The tiles are completely plain and smooth with no symbols, shapes, pictures, or markings on them at all.",
  "icon-browser": "A single chunky rounded mint arrow pointing diagonally up and to the right, by itself.",
  "icon-check": "A chunky rounded check mark.",
  "icon-edit": "A single chunky rounded pencil lying diagonally, pointing down and to the left: butter-yellow body, peach eraser, lilac tip.",
  "icon-export": "A rounded sheet of paper with a chunky arrow pointing up and out of its top edge.",
  "icon-file": "A rounded sheet of paper with three short horizontal pastel bars on it like a tiny bar chart.",
  "icon-schedule": "A chunky round clock face with two short rounded hands.",
  "icon-stop": "One solid chunky peach rounded square block, a plain stop button shape, nothing on it.",
  "icon-send": "A chunky rounded arrow pointing straight up.",
  "icon-chevron": "A chunky rounded chevron pointing down.",
  "icon-more": "Three equal round dots in a horizontal row.",
  "icon-search": "A chunky rounded magnifying glass.",
  "icon-key": "A chunky rounded key.",
  "icon-general": "Two horizontal lilac slider tracks stacked vertically, each with one round mint knob. Nothing else in the image.",
};
if (mode === "objects" || mode.startsWith("object:")) {
  const only = mode.startsWith("object:") ? mode.slice(7) : null;
  const entries = Object.entries(OBJECT_ICONS).filter(([n]) => !only || n === only);
  for (let i = 0; i < entries.length; i += 4) {
    await Promise.all(entries.slice(i, i + 4).map(([n, p]) => generate(n, `${p} ${OBJECT_ICON_STYLE}`).catch((e) => console.error(String(e)))));
  }
}

// ---- Dashboard topic icons (replace emoji next to dashboard names) ----
const TOPIC_ICONS = {
  "topic-revenue": "Exactly one object: a stack of three chunky butter-yellow coins, large and filling the frame, plain coins with no symbols.",
  "topic-sales": "A chunky rounded funnel.",
  "topic-meetings": "Exactly one object: two chunky rounded speech bubbles, one lilac and one mint, overlapping slightly, both completely plain with nothing inside.",
  "topic-tasks": "A rounded clipboard with three short check lines.",
  "topic-marketing": "A chunky rounded megaphone.",
  "topic-traffic": "Exactly one object: a single chunky lilac mouse cursor arrow, by itself.",
  "topic-product": "Exactly one object: a single chunky mint cube shown in three-quarter view, plain faces.",
  "topic-support": "A chunky rounded headset.",
  "topic-engineering": "Chunky rounded angle brackets < > side by side.",
  "topic-finance": "Exactly one object: a single chunky peach piggy bank standing alone on white, with no tile, no frame, no square behind it.",
  "topic-people": "Exactly one object pair: two plain rounded person silhouettes (round head over rounded shoulders), lilac and mint, side by side, no faces, no hair details, nothing else.",
  "topic-operations": "Two interlocking chunky rounded cogs.",
  "topic-world": "A chunky rounded globe with soft meridian grooves, no continents.",
  "topic-calendar": "A chunky rounded calendar page with two rings on top, blank.",
  "topic-email": "A chunky rounded envelope.",
  "topic-general": "Exactly one object: a single chunky rounded butter-yellow lightbulb floating alone on white, with no tile, no frame, no square behind it.",
};
if (mode === "topics") {
  const entries = Object.entries(TOPIC_ICONS).filter(([n]) => !existsSync(resolve(outDir, `${n}.png`)));
  for (let i = 0; i < entries.length; i += 4) {
    await Promise.all(entries.slice(i, i + 4).map(([n, p]) => generate(n, `${p} ${OBJECT_ICON_STYLE}`).catch((e) => console.error(String(e)))));
  }
}

// ---- Scene library: many Dashy moments so the mascot feels alive (rotated per app state) ----
const SCENES = {
  // working / building
  "scene-research": "holding a big magnifying glass up to a small floating pastel bar chart, curious focused eyes",
  "scene-pour": "carefully pouring glowing pastel droplets from a little jug into three short rounded bars, which are filling up",
  "scene-paint": "painting a rounded pastel bar chart on a small easel with a chunky paintbrush, proud smile",
  "scene-laptop": "typing happily on a tiny rounded pastel laptop, little motion lines near its hands",
  "scene-measure": "holding a chunky rounded ruler up next to three pastel bars, measuring them",
  "scene-juggle": "juggling three round pastel balls (lilac, mint, peach) above its head, delighted",
  "scene-stack": "lifting one rounded pastel bar above its head to place it on top of a short stack of bars",
  // connecting / waiting
  "scene-plug": "holding a chunky pastel plug toward a rounded wall socket, hopeful expression",
  "scene-key": "holding up a big chunky butter-yellow key with both arms, smiling",
  "scene-wait": "sitting patiently holding a small round mint clock, calm content smile",
  // refreshing
  "scene-water": "watering a little potted plant whose leaves are rounded pastel bars, with a small watering can",
  "scene-spin": "holding two rounded curved pastel arrows that form a circle around it, cheerful",
  // idle / home
  "scene-read": "reading a small rounded report sheet that shows a tiny pastel chart, content smile",
  "scene-coffee": "holding a chunky pastel mug with a little steam swirl, cozy relaxed smile",
  "scene-think": "finger on chin thinking, a small thought bubble above showing three pastel bars",
  "scene-hello": "waving with both arms up enthusiastically, big happy smile",
  // problems
  "scene-fix": "holding a chunky pastel wrench, determined little frown, one bar beside it slightly tilted",
};
if (mode === "scenes" || mode.startsWith("scene:")) {
  const only = mode.startsWith("scene:") ? mode.slice(6) : null;
  const ref = resolve(root, "assets/brand/dashy-source.png");
  const entries = Object.entries(SCENES).filter(([n]) => (only ? n === only : !existsSync(resolve(outDir, `${n}.png`))));
  for (let i = 0; i < entries.length; i += 5) {
    await Promise.all(entries.slice(i, i + 5).map(([n, p]) => generateFromRef(n, `Same character, exactly one character, ${p}. Any props are simple, chunky, rounded and in the same pastel palette. No text, no stars, no sparkles.`, ref).catch((e) => console.error(String(e)))));
  }
}

// ---- Wordmark: "Dash SSR" as a custom 3D clay logotype matching Dashy ----
const WORDMARKS = {
  "wordmark-a": 'A logotype that reads exactly "Dash SSR" (D-a-s-h, space, S-S-R), nothing else. Chunky, rounded, bubbly 3D clay letters with soft matte surfaces, same material and lighting as the reference character. "Dash" in soft lilac (#B9A8FF), "SSR" in mint (#9FE5C9). Letters slightly puffy, tightly kerned, one single line, perfectly legible, centered. Pure flat white background, no shadow on the ground, no character, no other text, no tagline, no stars.',
  "wordmark-b": 'A logotype that reads exactly "Dash SSR", nothing else. Friendly rounded geometric letters extruded as soft lilac (#A897FF) clay with gentle highlights, the dot-free letters evenly spaced, "SSR" slightly smaller and mint (#8FDCBF). One line, perfectly legible, centered. Pure flat white background, no ground shadow, no character, no other text, no stars.',
  "wordmark-c": 'A logotype that reads exactly "Dash SSR", nothing else. Bold rounded sans-serif letters made of glossy-matte lilac clay (#9F8BFF) with a subtle pastel gradient toward peach on the lower edges, chunky and playful but clean and premium. One line, perfectly legible, centered. Pure flat white background, no ground shadow, no character, no other text, no stars.',
};
if (mode === "wordmark") {
  const ref = resolve(root, "assets/brand/dashy-source.png");
  await Promise.all(Object.entries(WORDMARKS).map(([n, p]) => generateFromRef(n, p, ref).catch((e) => console.error(String(e)))));
}

// ---- About / welcome tour illustrations (wide) ----
const ABOUT = {
  "about-hero": "standing proudly next to a large floating rounded dashboard screen made of soft pastel cards: a few big numbers, a smooth line chart and rounded bars (no readable text, just shapes). Small floating pastel bars and dots around it. Joyful.",
  "about-connect": "in the center as a friendly hub, holding soft glowing pastel cables that connect to eight floating rounded app tiles around it in a gentle arc. The tiles are plain pastel rounded squares with simple abstract symbols (a cloud, an envelope, a calendar, a database cylinder, a chat bubble, a document, a cart, a gear), no logos, no text.",
  "about-schedule": "relaxing happily in a little pastel hammock, while beside it a big rounded clock and three small floating dashboard cards update themselves with soft circular refresh arrows. Calm, cozy, effortless mood.",
  "about-library": "standing to the left and gesturing with one arm toward a tidy grid of nine floating rounded pastel dashboard cards (three rows of three) that hover in mid-air with clear gaps between them, every card filled with a clearly colored solid pastel (lilac, mint, peach, butter or sky blue; never white or grey), each with simple chart shapes (bars, lines, donuts), no readable text. Flat even studio lighting, absolutely no cast shadows, no contact shadows, no ambient occlusion on the background.",
};
if (mode === "about" || mode.startsWith("about:")) {
  const ref = resolve(root, "assets/brand/dashy-source.png");
  const only = mode.startsWith("about:") ? mode.slice(6) : null;
  await Promise.all(Object.entries(ABOUT).filter(([n]) => !only || n === only).map(([n, p]) => generateFromRef(n, `Same character, exactly one character, ${p} Wide composition with the character on one side and generous empty space. Objects float freely and do not touch each other. Same soft clay 3D style and pastel palette. Pure flat white background, no ground shadow, no text, no stars, no sparkles.`, ref).catch((e) => console.error(String(e)))));
}

// ---- MyDashie wordmark ----
const WORDMARKS2 = {
  "wordmark-mydashie-a": 'A logotype that reads exactly "MyDashie" as one word (M-y-D-a-s-h-i-e), nothing else. Chunky, rounded, bubbly 3D clay letters with soft matte surfaces, same material and lighting as the reference character. "My" in mint (#9FE5C9) and "Dashie" in soft lilac (#B9A8FF). The dot on the i is a perfectly round little ball. Tightly kerned, single line, perfectly legible, centered. Pure flat white background, no ground shadow, no character, no other text, no stars.',
  "wordmark-mydashie-b": 'A logotype that reads exactly "MyDashie" as one word, nothing else. Chunky, rounded, bubbly 3D clay letters, all in soft lilac (#B1A0FF), with the dot on the i as a mint (#9FE5C9) ball. Puffy friendly letterforms, tightly kerned, single line, perfectly legible, centered. Pure flat white background, no ground shadow, no character, no other text, no stars.',
};
if (mode === "wordmark2") {
  const ref = resolve(root, "assets/brand/dashy-source.png");
  await Promise.all(Object.entries(WORDMARKS2).map(([n, p]) => generateFromRef(n, p, ref).catch((e) => console.error(String(e)))));
}

// ---- Hero storyboard poses (full body, same scale, facing slightly right) ----
const HERO = {
  "hero-listen": "holding a small pastel notepad and a chunky pencil, listening attentively with a curious happy face, as if taking an order",
  "hero-gather": "with both arms stretched up and wide, joyfully catching five small round glowing pastel data bubbles (lilac, mint, peach, butter) that float around its hands and head. Every bubble and the whole character sit completely inside the frame with generous empty margin on all sides; nothing touches or crosses the image edges",
  "hero-build": "happily tapping a floating rounded pastel dashboard tile into place with a chunky rounded mallet, a couple of small tiles floating nearby",
  "hero-check": "holding a chunky pastel clipboard with a big mint check mark, giving a satisfied nod",
  "hero-present": "standing proudly with one arm extended to the right, presenting something off-screen, big confident smile",
};
if (mode === "hero" || mode.startsWith("hero:")) {
  const only = mode.startsWith("hero:") ? mode.slice(5) : null;
  const ref = resolve(root, "assets/brand/dashy-source.png");
  await Promise.all(Object.entries(HERO).filter(([n]) => !only || n === only).map(([n, p]) =>
    generateFromRef(n, `Same character, exactly one character, full body visible, ${p}. Character fills about 80% of the frame height, centered, facing slightly to the right. Props are simple, chunky, rounded and pastel. Flat even studio lighting, no cast shadows, no ground shadow. Pure flat white background, no text, no stars, no sparkles.`, ref).catch((e) => console.error(String(e)))));
}

// ---- Walk cycle + hero props ----
const WALK = {
  "walk-1": "walking to the right, seen from the side in three-quarter view, mid-stride with the LEFT foot forward and the right foot back, arms swinging, cheerful determined face looking ahead to the right",
  "walk-2": "walking to the right, seen from the side in three-quarter view, mid-stride with the RIGHT foot forward and the left foot back, arms swinging the opposite way, cheerful determined face looking ahead to the right",
  "walk-3": "walking to the right, seen from the side in three-quarter view, feet together in the passing position of a walk cycle, body slightly higher, cheerful face looking ahead to the right",
};
const PROPS = {
  "prop-bars": "Exactly one object: three chunky rounded pastel bars of different heights standing side by side (mint, peach, butter), like a tiny bar chart.",
  "prop-donut": "Exactly one object: a chunky rounded pastel donut chart ring split into lilac, mint and peach segments.",
  "prop-line": "Exactly one object: a small rounded pastel card with a smooth rising lilac line chart drawn on it.",
  "prop-coin": "Exactly one object: a single chunky butter-yellow coin, tilted slightly.",
};
if (mode === "walk") {
  const ref = resolve(root, "assets/brand/dashy-source.png");
  await Promise.all([
    ...Object.entries(WALK).map(([n, p]) => generateFromRef(n, `Same character, exactly one character, full body visible, ${p}. Exactly the same proportions, size and colors as the reference. Character fills about 80% of the frame height, centered. Flat even studio lighting, no cast shadows, no ground shadow. Pure flat white background, no text, no props.`, ref).catch((e) => console.error(String(e)))),
    ...Object.entries(PROPS).map(([n, p]) => generate(n, `${p} ${OBJECT_ICON_STYLE}`).catch((e) => console.error(String(e)))),
  ]);
}
if (mode === "walkfix") {
  const ref = resolve(root, "assets/generated/raw/walk-2.png");
  await generateFromRef("walk-1", "Exactly the same character, same camera angle, same size, same position in the frame and same lighting as the reference image, but mid-stride with the opposite leg forward (LEFT foot forward, right foot back) and arms swinging the opposite way. Empty hands, holding nothing. Pure flat white background, no ground shadow, no text, no props.", ref).catch((e) => console.error(String(e)));
}
if (mode === "buildfix") {
  const ref = resolve(root, "assets/brand/dashy-source.png");
  await generateFromRef("hero-build", "The exact same character as the reference, rendered in exactly the same way: soft 3D clay render with smooth subsurface shading, glossy dark eyes with white highlights, small rosy cheeks, tiny smile, same lilac color and same chubby rounded proportions. NOT a flat 2D illustration, no outlines, no cartoon line work. Pose: full body, happily tapping a floating rounded pastel dashboard tile into place with a small chunky rounded mallet held in one hand; the tile is a soft 3D rounded rectangle in mint, peach and butter blocks. Character fills about 80% of the frame height, centered, facing slightly right, everything fully inside the frame with margin. Flat even studio lighting, no cast shadows, no ground shadow. Pure flat white background, no text, no stars, no sparkles.", ref).catch((e) => console.error(String(e)));
}
