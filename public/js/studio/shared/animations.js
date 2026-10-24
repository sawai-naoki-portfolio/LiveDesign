// public/js/studio/shared/animations.js
// 登場・アクションの動き（Web Animations API のキーフレーム）。
// ループの動き（鼓動・浮遊…）は止めずに回し続けるので CSS 側（studio-render.css）にある。

export const ENTER_KEYFRAMES = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  slideUp: [{ opacity: 0, transform: "translateY(60%)" }, { opacity: 1, transform: "none" }],
  slideDown: [{ opacity: 0, transform: "translateY(-60%)" }, { opacity: 1, transform: "none" }],
  slideLeft: [{ opacity: 0, transform: "translateX(60%)" }, { opacity: 1, transform: "none" }],
  slideRight: [{ opacity: 0, transform: "translateX(-60%)" }, { opacity: 1, transform: "none" }],
  zoom: [{ opacity: 0, transform: "scale(0.3)" }, { opacity: 1, transform: "none" }],
  pop: [
    { opacity: 0, transform: "scale(0.4)" },
    { opacity: 1, transform: "scale(1.12)", offset: 0.6 },
    { transform: "scale(0.96)", offset: 0.8 },
    { opacity: 1, transform: "none" },
  ],
  bounce: [
    { opacity: 0, transform: "translateY(-120%)" },
    { opacity: 1, transform: "translateY(0)", offset: 0.55 },
    { transform: "translateY(-14%)", offset: 0.72 },
    { transform: "translateY(0)", offset: 0.86 },
    { transform: "translateY(-4%)", offset: 0.94 },
    { opacity: 1, transform: "none" },
  ],
  flip: [
    { opacity: 0, transform: "perspective(800px) rotateX(90deg)" },
    { opacity: 1, transform: "perspective(800px) rotateX(-12deg)", offset: 0.7 },
    { opacity: 1, transform: "none" },
  ],
  blur: [{ opacity: 0, filter: "blur(24px)" }, { opacity: 1, filter: "blur(0)" }],
  spin: [{ opacity: 0, transform: "rotate(-200deg) scale(0.3)" }, { opacity: 1, transform: "none" }],
};

export const EXIT_KEYFRAMES = {
  fade: [{ opacity: 1 }, { opacity: 0 }],
  zoom: [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.6)" }],
  slideUp: [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-40%)" }],
};

export const ACTION_KEYFRAMES = {
  shake: [
    { transform: "translateX(0)" }, { transform: "translateX(-6%) rotate(-3deg)" },
    { transform: "translateX(6%) rotate(3deg)" }, { transform: "translateX(-4%) rotate(-2deg)" },
    { transform: "translateX(4%) rotate(2deg)" }, { transform: "translateX(0)" },
  ],
  pulse: [{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }],
  bounce: [
    { transform: "translateY(0)" }, { transform: "translateY(-30%)", easing: "ease-in" },
    { transform: "translateY(0)", easing: "ease-out" }, { transform: "translateY(-10%)" },
    { transform: "translateY(0)" },
  ],
  spin: [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }],
  flash: [{ filter: "brightness(1)" }, { filter: "brightness(2.6)" }, { filter: "brightness(1)" }],
  jelly: [
    { transform: "scale(1,1)" }, { transform: "scale(1.25,0.75)" }, { transform: "scale(0.75,1.25)" },
    { transform: "scale(1.15,0.85)" }, { transform: "scale(0.95,1.05)" }, { transform: "scale(1,1)" },
  ],
  tada: [
    { transform: "scale(1)" }, { transform: "scale(0.9) rotate(-3deg)" },
    { transform: "scale(1.15) rotate(3deg)" }, { transform: "scale(1.15) rotate(-3deg)" },
    { transform: "scale(1.15) rotate(3deg)" }, { transform: "scale(1)" },
  ],
  heartbeat: [
    { transform: "scale(1)" }, { transform: "scale(1.25)", offset: 0.14 },
    { transform: "scale(1)", offset: 0.28 }, { transform: "scale(1.25)", offset: 0.42 },
    { transform: "scale(1)", offset: 0.7 }, { transform: "scale(1)" },
  ],
};

/** 動きを付ける（Web Animations が無い環境では何もしない） */
export function play(node, keyframes, opts) {
  if (!node || typeof node.animate !== "function" || !keyframes) return null;
  try {
    return node.animate(keyframes, opts);
  } catch (e) {
    return null;
  }
}
