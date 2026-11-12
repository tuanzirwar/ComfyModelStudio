type Any=Record<string,any>;
export function itemProgress(item:Any):{value:number;max:number;percent:number|null};
export function runProgress(run:Any):{completed:number;total:number;current:Any|null};
export function applyProgressEvent(item:Any,event:Any):void;
