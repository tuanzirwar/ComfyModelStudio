export function normalizeBaseModels(value: unknown): string[];
export function modelBases(model: { baseModel?: string; baseModels?: string[] } | null | undefined): string[];
export function baseLabel(model: { baseModel?: string; baseModels?: string[] } | null | undefined): string;
export function hasBase(model: { baseModel?: string; baseModels?: string[] } | null | undefined, base: string): boolean;
export function baseGroups(models: any[]): { name: string; versions: string[] }[];
export function baseFamily(label: string): string;
export function matchesBaseFilter(model: any, filter: string): boolean;
export function baseChoiceLabel(label: string, family: string): string;
