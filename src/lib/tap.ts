/** Click feedback for every interactive element: a springy press animation (.tap in index.css) and a light haptic tick.
 *  Installed once from main.tsx; components need nothing. */
const TARGETS = 'button, a[href], summary, select, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], input[type="checkbox"], input[type="radio"]';

let iosSwitch: HTMLLabelElement | null = null;

/** Android/Chrome: Vibration API. iOS Safari 18+: toggling a native <input switch> via its label plays the system haptic. */
function haptic() {
  if (typeof navigator.vibrate === 'function') { navigator.vibrate(8); return; }
  if (!/iP(hone|ad|od)/.test(navigator.userAgent)) return;
  if (!iosSwitch) {
    iosSwitch = document.createElement('label');
    iosSwitch.setAttribute('aria-hidden', 'true');
    iosSwitch.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
    iosSwitch.appendChild(input);
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}

function press(el: HTMLElement) {
  el.classList.remove('tap', 'tap-lg');
  void el.offsetWidth; // restart the animation on rapid repeat clicks
  el.classList.add(el.offsetWidth > 280 ? 'tap-lg' : 'tap');
  el.addEventListener('animationend', () => el.classList.remove('tap', 'tap-lg'), { once: true });
}

export function installTapFeedback() {
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
    if (el && !el.matches(':disabled, [aria-disabled="true"]')) press(el);
  }, { passive: true });
  // Haptics need a trusted click (a user gesture); our own synthetic label click is ignored.
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
    if (el && !el.matches(':disabled, [aria-disabled="true"]')) haptic();
  }, { passive: true });
}
