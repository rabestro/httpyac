import { Variables, ProcessorContext, HttpRegion, HttpFile } from '../models';
import { ScriptData, executeScript } from './jsActionProcessor';
import { ok } from 'assert';
import { log, scriptConsole, popupService } from '../logger';
import { toAbsoluteFilename } from '../utils';
import { promises as fs } from 'fs';
import { testFactory } from './testMethod';

export interface IntellijScriptData{
  fileName: string;
}

export async function intellijActionProcessor(scriptData: ScriptData | IntellijScriptData, {httpRegion, httpFile, variables}: ProcessorContext) : Promise<boolean> {
  const intellijVars = initIntellijVariables(httpRegion, variables);

  let data: ScriptData;
  if (isIntellijScriptData(scriptData)) {
    const script = await loadScript(scriptData.fileName, httpFile);
    if (!script) {
      return false;
    }
    data = {
      script,
      lineOffset: 0
    };
  } else {
    data = scriptData;
  }
  await executeScript({ script: data.script, fileName: httpFile.fileName, variables: intellijVars, lineOffset: data.lineOffset + 1 });
  return true;
}

async function loadScript(file: string, httpFile: HttpFile) {
  try {
    let script: string | false = false;
    const filename = await toAbsoluteFilename(file, httpFile.fileName);
    if (filename) {
      script = await fs.readFile(filename, 'utf-8');
    } else {
      popupService.error(`File not found: ${file}`);
      log.error(`File not found: ${file}`);
    }
    return script;
  } catch (err) {
    popupService.error(`error loading script ${file}`);
    log.error(file, err);
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isIntellijScriptData(scriptData: any) : scriptData is IntellijScriptData{
  return !!scriptData.fileName;
}

export class HttpClient{
  global: HttpClientVariables;
  constructor(private readonly httpRegion: HttpRegion, variables: Variables) {
    this.global = new HttpClientVariables(variables);
  }
  test(testName: string, func: () => void): void{
    testFactory(this.httpRegion)(testName, func);
  }
  assert(condition: boolean, message?: string) : void {
    ok(condition, message);
  }
  log(text: string): void{
    scriptConsole.info(text);
  }
}

class HttpClientVariables{
  constructor(private readonly variables: Variables) { }
  set(varName: string, varValue: string): void{
    this.variables[varName] = varValue;
  }
  get(varName: string): unknown{
    return this.variables[varName];
  }
  isEmpty(): boolean{
    return Object.entries(this.variables).length === 0;
  }
  clear(varName: string): void{
    delete this.variables[varName];
  }
  clearAll(): void{
    for (const [key] of Object.entries(this.variables)) {
      delete this.variables[key];
    }
  }
}

function initIntellijVariables(httpRegion: HttpRegion, variables: Variables) {
  let response: unknown = undefined;
  if (httpRegion.response) {
    response = {
      body: httpRegion.response.parsedBody || httpRegion.response.body,
      headers: {
        valueOf: (headerName: string) => {
          if (httpRegion.response) {
            return httpRegion.response.headers[headerName];
          }
          return undefined;
        },
        valuesOf: (headerName: string) => {
          if (httpRegion.response) {
            return [httpRegion.response.headers[headerName]];
          }
          return undefined;
        }
      },
      status: httpRegion.response.statusCode,
      contentType: httpRegion.response.contentType,
    };
  }
  const client = new HttpClient(httpRegion, variables);
  const intellijVars = {
    client,
    response,
  };
  return intellijVars;
}
