import { describe, expect, it, vi } from 'vitest';
import {
  LOCALES,
  MESSAGES,
  currentLocale,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  resolveLocale,
  t,
  translate,
} from '../src/shared/i18n';
import type { MessageKey } from '../src/shared/i18n';

const EN_KEYS = Object.keys(MESSAGES.en) as MessageKey[];
const JA_KEYS = Object.keys(MESSAGES.ja) as MessageKey[];

describe('message catalogs', () => {
  it('has the same keys in every locale', () => {
    expect([...JA_KEYS].sort()).toEqual([...EN_KEYS].sort());
  });

  it('has no empty messages', () => {
    for (const locale of LOCALES) {
      for (const key of EN_KEYS) {
        expect(MESSAGES[locale][key].message.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('uses matching placeholders so substitutions cannot silently drop', () => {
    for (const key of EN_KEYS) {
      const enPlaceholders = [...MESSAGES.en[key].message.matchAll(/\$(\d+)/g)].map((m) => m[1]).sort();
      const jaPlaceholders = [...MESSAGES.ja[key].message.matchAll(/\$(\d+)/g)].map((m) => m[1]).sort();
      expect(jaPlaceholders, `placeholders for ${key}`).toEqual(enPlaceholders);
    }
  });

  it('has no leftover Japanese in the English catalog', () => {
    for (const key of EN_KEYS) {
      expect(MESSAGES.en[key].message, `en.${key}`).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
  });

  it('translates every message that is not intentionally identical', () => {
    // Brand and GitHub vocabulary that stays the same in both languages.
    const sameByDesign = new Set<MessageKey>([
      'extName',
      'menuHeading',
      'kindPush',
      'kindFork',
      'forkedFromHint',
      'starsAria',
      'dateWithLabel',
      'optionsHeading',
    ]);
    for (const key of EN_KEYS) {
      if (sameByDesign.has(key)) continue;
      expect(MESSAGES.ja[key].message, `ja.${key} is not translated`).not.toBe(
        MESSAGES.en[key].message,
      );
    }
  });
});

describe('resolveLocale', () => {
  it('picks Japanese only for Japanese language tags', () => {
    expect(resolveLocale('ja')).toBe('ja');
    expect(resolveLocale('ja-JP')).toBe('ja');
    expect(resolveLocale('JA-jp')).toBe('ja');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('fr-FR')).toBe('en');
    expect(resolveLocale('')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale(null)).toBe('en');
  });
});

describe('translate', () => {
  it('translates both locales', () => {
    expect(translate('en', 'sortActivity')).toBe('Created · Forked · Pushed');
    expect(translate('ja', 'sortActivity')).toBe('作成・Fork・Push順');
  });

  it('substitutes positional placeholders', () => {
    expect(translate('en', 'pagerStatus', [1, 30, 61, 1, 3])).toBe('1–30 of 61 (1/3 pages)');
    expect(translate('ja', 'pagerStatus', [31, 60, 61, 2, 3])).toBe('31–60 / 61件（2/3ページ）');
  });

  it('falls back to the key for an unknown message', () => {
    expect(translate('en', 'notAKey' as MessageKey)).toBe('notAKey');
  });
});

describe('runtime translation', () => {
  it('uses chrome.i18n when available', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: (key: string) => `chrome:${key}`, getUILanguage: () => 'ja' } });
    expect(t('refresh')).toBe('chrome:refresh');
    expect(currentLocale()).toBe('ja');
    vi.unstubAllGlobals();
  });

  it('falls back to the bundled catalog for a non-Japanese display language', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: () => '', getUILanguage: () => 'fr' } });
    expect(t('refresh')).toBe('Refresh');
    vi.unstubAllGlobals();
  });

  it('falls back to navigator.language without chrome.i18n', () => {
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    expect(t('refresh')).toBe('再取得');
    vi.unstubAllGlobals();
  });
});

describe('locale-aware formatting', () => {
  const ms = Date.parse('2026-11-25T04:21:00Z');

  it('formats dates for each locale', () => {
    expect(formatDateTime(ms, 'en')).toMatch(/2026/);
    expect(formatDateTime(ms, 'ja')).toMatch(/2026/);
    expect(formatDateTime(ms, 'en')).not.toBe(formatDateTime(ms, 'ja'));
  });

  it('formats numbers for each locale', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
    expect(formatNumber(1234567, 'ja')).toBe('1,234,567');
  });

  it('formats relative time for each locale', () => {
    const now = ms + 3 * 60_000;
    expect(formatRelativeTime(ms, now, 'en')).toBe('3 min ago');
    expect(formatRelativeTime(ms, now, 'ja')).toBe('3分前');
    expect(formatRelativeTime(ms, ms + 90 * 60_000, 'en')).toBe('1 h ago');
    expect(formatRelativeTime(ms, ms + 90 * 60_000, 'ja')).toBe('1時間前');
    expect(formatRelativeTime(ms, ms, 'en')).toBe('just now');
    expect(formatRelativeTime(ms, ms, 'ja')).toBe('たった今');
  });

  it('renders a missing date in the active locale', () => {
    expect(formatDateTime(null, 'en')).toBe('No date');
    expect(formatDateTime(null, 'ja')).toBe('日時なし');
  });
});
