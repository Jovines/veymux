import {writeClipboardText} from '../utils/clipboard';
import {sendTmuxAction} from './api';
type TmuxSelectionResponse = Awaited<ReturnType<typeof sendTmuxAction>>;
export type RequestTmuxSelection = () => Promise<TmuxSelectionResponse>;

/** Explicit user copy writes to this computer, independently of the service. */
export function writeTerminalClipboardText(text:string,current:()=>boolean=()=>true):Promise<boolean>{
 return text ? writeClipboardText(text,current) : Promise.resolve(false);
}
/** Read a captured tmux selection through the current page's encrypted API. */
export async function copyTmuxTerminalSelection(session:string,current:()=>boolean,request:RequestTmuxSelection=()=>sendTmuxAction(session,{action:'copy-selection'})):Promise<boolean>{
 if(!current())return false;
 const result=await request();
 if(!current())return false;
 const selection=result.selection;
 if(!result.success||!selection||!['copied','empty'].includes(selection.status)||typeof selection.text!=='string'||typeof selection.paneId!=='string'||!/^%[0-9]+$/.test(selection.paneId)||new TextEncoder().encode(selection.text).length!==selection.bytes||selection.bytes>262144)throw new Error('服务未返回有效的终端选区，请更新服务后重试。');
 if(selection.status==='empty')return false;
 if(!selection.bytes)throw new Error('终端选区为空。');
 return writeTerminalClipboardText(selection.text,current);
}
