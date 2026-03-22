const HOTKEY_MAP: Record<string, string> = {
  ArrowUp: '\u2191', ArrowDown: '\u2193', ArrowLeft: '\u2190', ArrowRight: '\u2192',
  Enter: '\u23CE', Escape: '\u238B', Shift: '\u21E7', Control: '\u2303', Alt: '\u2325', Meta: '\u2318',
  Tab: '\u21E5', Backspace: '\u232B', Delete: '\u2326', ' ': '\u2423',
};

export function hotkeyDisplayChar(key: string): string {
  if (HOTKEY_MAP[key]) return HOTKEY_MAP[key];
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase();
}
