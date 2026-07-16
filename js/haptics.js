/** 筆跡用の軽いハプティクス（iPhone / Android） */

const STORAGE_KEY = "fluid-words-haptic-v1";

export function createHaptics() {
  let enabled = true;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "0") enabled = false;
  } catch (_) {
    /* ignore */
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }

  function vibrate(pattern) {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch (_) {
      /* ignore */
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    set enabled(v) {
      enabled = !!v;
      save();
    },
    /** 書き始め */
    touchStart() {
      vibrate(10);
    },
    /** 曲がり角・なぞりのリズム */
    strokeTick() {
      vibrate(8);
    },
    /** 指を離したとき */
    liftEnd() {
      vibrate([12, 36, 18]);
    },
    bindToggle(input) {
      if (!input) return;
      input.checked = enabled;
      input.addEventListener("change", (e) => {
        e.stopPropagation();
        enabled = !!input.checked;
        save();
        if (enabled) vibrate(12);
      });
      input.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
      input.addEventListener("pointerdown", (e) => e.stopPropagation());
    },
  };
}
