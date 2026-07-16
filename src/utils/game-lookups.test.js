import { describe, test, expect, vi, beforeEach } from 'vitest';

import dataManager from '../core/data-manager.js';
import { getActionHridFromName } from './game-lookups.js';

vi.mock('../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(),
    },
}));

const MOCK_ACTION_MAP = {
    '/actions/cooking/donut': { name: 'Donut' },
    '/actions/cooking/blueberry_donut': { name: 'Blueberry Donut' },
    '/actions/milking/cow': { name: 'Cow' },
    '/actions/foraging/farmland': { name: 'Farmland' },
    '/actions/foraging/apple_refined': { name: 'Apple ★' },
};

describe('getActionHridFromName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function setupGameData(map = MOCK_ACTION_MAP) {
        dataManager.getInitClientData.mockReturnValue({ actionDetailMap: map });
    }

    test('returns HRID for exact English name', () => {
        setupGameData();
        expect(getActionHridFromName('Donut')).toBe('/actions/cooking/donut');
    });

    test('returns HRID for refined item name variant ★', () => {
        setupGameData();
        expect(getActionHridFromName('Apple ★')).toBe('/actions/foraging/apple_refined');
    });

    test('returns null for unknown name', () => {
        setupGameData();
        expect(getActionHridFromName('Nonexistent')).toBeNull();
    });

    test('returns null for empty string', () => {
        setupGameData();
        expect(getActionHridFromName('')).toBeNull();
    });

    test('returns null when getInitClientData returns null', () => {
        dataManager.getInitClientData.mockReturnValue(null);
        expect(getActionHridFromName('Donut')).toBeNull();
    });

    test('zh: returns HRID for Chinese production action name', () => {
        setupGameData();
        expect(getActionHridFromName('甜甜圈')).toBe('/actions/cooking/donut');
    });

    test('zh: returns HRID for Chinese non-item milking action', () => {
        setupGameData();
        expect(getActionHridFromName('奶牛')).toBe('/actions/milking/cow');
    });

    test('zh: returns HRID for Chinese zone action', () => {
        setupGameData();
        expect(getActionHridFromName('翠野农场')).toBe('/actions/foraging/farmland');
    });

    test('zh: returns null when mapped hrid is absent from actionDetailMap', () => {
        setupGameData(MOCK_ACTION_MAP);
        expect(getActionHridFromName('探索迷宫')).toBeNull();
    });
});
