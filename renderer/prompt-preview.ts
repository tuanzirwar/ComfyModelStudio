import {preprocessRecipePrompts} from '../desktop/prompt-preprocess.mjs';
export function promptPreview(recipe:Record<string,any>,part:'prompt'|'negative'='prompt'){try{return preprocessRecipePrompts(recipe)[part];}catch(error){return '语法定义需完善：'+(error as Error).message;}}
