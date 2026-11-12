const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// An inextensible arc: the hinge is fixed and each strip follows its tangent.
export function paperProfile(progress, width, count = 24) {
  const p = clamp(progress, 0, 1);
  const bend = 0.76 * Math.sin(Math.PI * p);
  const start = Math.PI * p - bend;
  const curvature = 2 * bend / width;
  const step = width / count;
  const point = (distance) => distance === 0 ? { x: 0, z: 0 } : Math.abs(curvature) < 1e-9
    ? { x: distance * Math.cos(start), z: distance * Math.sin(start) }
    : { x: (Math.sin(start + curvature * distance) - Math.sin(start)) / curvature,
        z: (Math.cos(start) - Math.cos(start + curvature * distance)) / curvature };
  return Array.from({ length: count }, (_, index) => {
    const distance = index * step;
    const a = point(distance);
    const b = point(distance + step);
    return { ...a, angle: start + curvature * (distance + step / 2),
      width: Math.hypot(b.x - a.x, b.z - a.z),
      frontOffset: distance, backOffset: width - distance - step };
  });
}

function pageCopy(source, width, height, mirrored) {
  const clone = source.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  clone.querySelectorAll("button, a, input, [tabindex]").forEach((node) => node.tabIndex = -1);
  clone.hidden = false;
  clone.className = "leaf paper-page";
  clone.style.cssText = `position:relative;left:0;top:0;bottom:auto;width:${width}px;height:${height}px;visibility:visible;transform:${mirrored ? "scaleX(-1)" : "none"}`;
  return clone;
}

export function waitForPageImages(pages, signal) {
  const decoded = Promise.all(pages.flatMap((page) => [...page.querySelectorAll("img")]).map((img) =>
    img.decode?.().catch(() => {}) || Promise.resolve()));
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, 1500);
    signal?.addEventListener("abort", finish, { once: true });
    decoded.then(finish);
    if (signal?.aborted) finish();
  });
}

export function turnPaper(host, front, back, { forward, signal, duration = 780, reveal }) {
  if (signal?.aborted) return Promise.resolve(false);
  const { width, height } = front.getBoundingClientRect();
  if (!width || !height) return Promise.resolve(false);
  const mirrored = !forward;
  const count = 24;
  const stripWidth = width / count;
  const frontPage = pageCopy(front, width, height, mirrored);
  const backPage = pageCopy(back, width, height, mirrored);
  const shade = document.createElement("div");
  shade.className = "paper-shadow";
  const sheet = document.createElement("div");
  sheet.className = "paper-sheet";
  sheet.style.transform = mirrored ? "scaleX(-1)" : "none";
  const strips = Array.from({ length: count }, (_, index) => {
    const strip = document.createElement("div");
    strip.className = "page-strip";
    strip.style.width = `${stripWidth + 0.35}px`;
    for (const [face, page, offset] of [
      ["front", frontPage, index * stripWidth],
      ["back", backPage, width - (index + 1) * stripWidth],
    ]) {
      const side = document.createElement("div");
      side.className = `paper-face paper-${face}`;
      const ink = document.createElement("div");
      ink.className = "paper-ink";
      ink.style.width = `${width}px`;
      ink.style.left = `${-offset}px`;
      ink.append(page.cloneNode(true));
      side.append(ink);
      strip.append(side);
    }
    sheet.append(strip);
    return strip;
  });
  host.replaceChildren(shade, sheet);
  host.dataset.direction = forward ? "forward" : "back";
  host.dataset.progress = "0";
  host.hidden = false;
  host.inert = true;

  return new Promise((resolve) => {
    let frame;
    let start;
    let settled = false;
    function finish(completed) {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", abort);
      host.hidden = true;
      host.replaceChildren();
      delete host.dataset.progress;
      delete host.dataset.direction;
      resolve(completed);
    }
    const abort = () => finish(false);
    signal?.addEventListener("abort", abort, { once: true });
    function draw(time) {
      if (signal?.aborted) return finish(false);
      start ??= time;
      const linear = clamp((time - start) / duration, 0, 1);
      const p = linear * linear * (3 - 2 * linear);
      const profile = paperProfile(p, width, count);
      host.dataset.progress = String(p);
      for (let index = 0; index < strips.length; index += 1) {
        const strip = strips[index];
        const pose = profile[index];
        strip.style.transform = `translate3d(${pose.x}px,0,${pose.z}px) rotateY(${-pose.angle}rad)`;
        // Front and reverse receive opposite light; the bend is visible on the ink too.
        const light = Math.cos(pose.angle);
        strip.children[0].style.setProperty("--paper-dim", String(0.31 * (1 - light) / 2));
        strip.children[1].style.setProperty("--paper-dim", String(0.24 * (1 + light) / 2));
      }
      const lift = Math.sin(Math.PI * p);
      shade.style.opacity = String(lift * 0.46);
      shade.style.width = `${width * (0.13 + 0.72 * Math.abs(Math.cos(Math.PI * p)))}px`;
      shade.style.left = p < 0.5 ? "50%" : "auto";
      shade.style.right = p < 0.5 ? "auto" : "50%";
      if (!forward) {
        shade.style.left = p < 0.5 ? "auto" : "50%";
        shade.style.right = p < 0.5 ? "50%" : "auto";
      }
      if (linear === 0) reveal();
      if (linear >= 1) return finish(true);
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
  });
}
