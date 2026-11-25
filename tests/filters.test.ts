import { describe, expect, it } from 'vitest';
import {
  filterRepos,
  languageSlug,
  matchesLanguage,
  matchesType,
  matchesVisibility,
} from '../src/shared/filter';
import { buildView } from '../src/shared/view';
import { makeRepo } from './helpers';

describe('Type filter', () => {
  const repos = [
    makeRepo(1, { name: 'plain' }),
    makeRepo(2, { name: 'forked', fork: true }),
    makeRepo(3, { name: 'old', archived: true }),
    makeRepo(4, { name: 'tpl', template: true }),
    makeRepo(5, { name: 'mirrored', mirror: true }),
  ];

  it('matches each GitHub Type value', () => {
    expect(repos.filter((repo) => matchesType(repo, 'all'))).toHaveLength(5);
    expect(repos.filter((repo) => matchesType(repo, 'forks')).map((r) => r.name)).toEqual(['forked']);
    expect(repos.filter((repo) => matchesType(repo, 'non-forks')).map((r) => r.name)).toEqual([
      'plain', 'old', 'tpl', 'mirrored',
    ]);
    expect(repos.filter((repo) => matchesType(repo, 'archived')).map((r) => r.name)).toEqual(['old']);
    expect(repos.filter((repo) => matchesType(repo, 'template')).map((r) => r.name)).toEqual(['tpl']);
    expect(repos.filter((repo) => matchesType(repo, 'mirror')).map((r) => r.name)).toEqual(['mirrored']);
  });

  it('applies the Type filter before pagination', () => {
    const many = Array.from({ length: 61 }, (_, index) =>
      makeRepo(index + 1, { name: `repo-${index}`, archived: index % 2 === 0 }),
    );
    const view = buildView({ repos: many, sort: 'activity', scope: 'all', query: '', page: 1, type: 'archived' });
    expect(view.totalFiltered).toBe(31);
    expect(view.page.items).toHaveLength(30);
    expect(view.page.totalPages).toBe(2);
  });
});

describe('Language filter', () => {
  it('normalises display names to GitHub menu slugs', () => {
    expect(languageSlug('Jupyter Notebook')).toBe('jupyter-notebook');
    expect(languageSlug('C++')).toBe('c++');
    expect(languageSlug('  TypeScript ')).toBe('typescript');
  });

  it('matches the API display name against the menu slug', () => {
    const repo = makeRepo(1, { language: 'Jupyter Notebook' });
    expect(matchesLanguage(repo, 'jupyter-notebook')).toBe(true);
    expect(matchesLanguage(repo, 'python')).toBe(false);
    expect(matchesLanguage(repo, 'all')).toBe(true);
    expect(matchesLanguage(makeRepo(2, { language: null }), 'python')).toBe(false);
  });

  it('combines with Type and search', () => {
    const repos = [
      makeRepo(1, { name: 'py-app', language: 'Python' }),
      makeRepo(2, { name: 'py-fork', language: 'Python', fork: true }),
      makeRepo(3, { name: 'ts-app', language: 'TypeScript' }),
    ];
    const filtered = filterRepos(repos, { scope: 'all', query: 'app', type: 'non-forks', language: 'python' });
    expect(filtered.map((repo) => repo.name)).toEqual(['py-app']);
  });
});

describe('Visibility filter', () => {
  const repos = [
    makeRepo(1, { name: 'pub', visibility: 'public' }),
    makeRepo(2, { name: 'priv', visibility: 'private' }),
  ];

  it('matches public, private and all', () => {
    expect(repos.filter((repo) => matchesVisibility(repo, 'all'))).toHaveLength(2);
    expect(repos.filter((repo) => matchesVisibility(repo, 'public')).map((r) => r.name)).toEqual(['pub']);
    expect(repos.filter((repo) => matchesVisibility(repo, 'private')).map((r) => r.name)).toEqual(['priv']);
  });

  it('is applied by filterRepos', () => {
    expect(filterRepos(repos, { scope: 'all', query: '', visibility: 'private' }).map((r) => r.name)).toEqual(['priv']);
  });
});
