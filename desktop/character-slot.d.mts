type Any = Record<string,any>;
export function isCharacterModel(model: Any | undefined): boolean;
export function characterTokens(input: unknown): string[];
export function normalizeCharacterSlot(input: unknown): Any | undefined;
export function isSlotCharacter(model: Any | undefined, slot: Any | undefined): boolean;
export function updateCharacterSlot(plan: Any, patch: Any, models: Any[], recipes?: Any[]): Any;
export function characterNodeBase(recipe: Any, slot: Any | undefined, models: Any[]): Any;
export function mergeCharacterNodeEdit(raw: Any, patch: Any, slot: Any | undefined, models: Any[]): Any;
export function applyCharacterSlot(recipe: Any, slot: Any | undefined, models: Any[]): Any;
export function characterSlotIssues(recipe: Any, slot: Any | undefined, models: Any[]): string[];

export function isCharacterEntry(entry: Any, models: Any[], slot?: Any): boolean;
export function recipeLoraGroups(recipe: Any, models: Any[], slot?: Any): {characters: Any[]; general: Any[]};

export function recipeCharacterPrompt(recipe: Any, models: Any[]): string;

export function splitRecipePrompt(recipe: Any, models: Any[]): Any;
export function positivePromptBlocks(recipe: Any): string[];
export function composeRecipePrompt(recipe: Any): string;
export function initializeLoraPrompts(entries: Any[], models: Any[]): Any[];
export function checkedBlock(value: unknown): string;

export function taskRecipe(recipe: Any, overrides?: Any): Any;

export function effectiveRecipePrompt(recipe: Any): string;
