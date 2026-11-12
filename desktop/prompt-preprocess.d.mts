type Any=Record<string,any>;
export function parsePromptDefinitions(input?:string):Map<string,string>;
export function preprocessRecipePrompts(recipe:Any):{prompt:string;negative:string;blocks:string[];definitions:{key:string;value:string}[]};
