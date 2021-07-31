import path from 'path';
import Module from 'module';
import vm from 'vm';
import { log, PathLike, fileProvider } from '../io';
import { isPromise } from './promiseUtils';
import { EOL } from 'os';

// eslint-disable-next-line no-underscore-dangle, no-undef
declare const __non_webpack_require__: NodeJS.Require;

// Use `Module.createRequire` if available (added in Node v12.2.0)
const createRequire = Module.createRequire || function createModuleRequire(fileName) {
  return createModule(fileName as string, 'module.exports = require;').exports;
};

export function resolveModule(request: string, context: string): string | undefined {
  let resolvedPath: string | undefined;
  try {
    try {
      resolvedPath = createRequire(path.resolve(context, 'package.json')).resolve(request);
    } catch (e) {
      resolvedPath = __non_webpack_require__.resolve(request, { paths: [context] });
    }
  } catch (e) {
    log.debug(e);
  }
  return resolvedPath;
}

export function loadModule<T>(request: string, context: string, force = false): T | undefined {
  try {
    if (force) {
      clearModule(request, context);
    }
    return createRequire(path.resolve(context, 'package.json'))(request);
  } catch (e) {
    const resolvedPath = resolveModule(request, context);
    if (resolvedPath) {
      if (force) {
        clearRequireCache(resolvedPath);
      }
      return __non_webpack_require__(resolvedPath);
    }
  }
  return undefined;
}

function createModule(filename: string, source?: string | undefined): Module {
  const mod = new Module(filename, require.main);
  mod.filename = filename;
  // see https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js#L565-L640
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-underscore-dangle
  mod.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  if (source) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-underscore-dangle
    (mod as any)._compile(source, filename);
  }
  return mod;
}


export function clearModule(request: string, context: string): void {
  const resolvedPath = exports.resolveModule(request, context);
  if (resolvedPath) {
    clearRequireCache(resolvedPath);
  }
}

function clearRequireCache(id: string, map = new Map()) {
  const module = __non_webpack_require__.cache[id];
  if (module) {
    map.set(id, true);
    // Clear children modules
    module.children.forEach(child => {
      if (!map.get(child.id)) {
        clearRequireCache(child.id, map);
      }
    });
    delete __non_webpack_require__.cache[id];
  }
}


export async function runScript(source: string, options: {
  fileName: PathLike,
  lineOffset: number,
  context: Record<string, unknown>,
  require?: Record<string, unknown>,
}): Promise<Record<string, unknown>> {

  const filename = fileProvider.fsPath(options.fileName);

  const mod = createModule(filename);

  function extendedRequire(id: string) {
    if (options.require && options.require[id]) {
      return options.require[id];
    }
    return mod.require(id);
  }

  const context = vm.createContext({
    ...global,
    Buffer,
    process,
    requireUncached: (id: string) => {
      clearModule(id, fileProvider.fsPath(fileProvider.dirname(filename)));
      return mod.require(id);
    },
    ...options.context,
  });

  const compiledWrapper = vm.runInContext(Module.wrap(`${EOL}${source}`), context, {
    filename,
    lineOffset: options.lineOffset,
    displayErrors: true,
  });
  compiledWrapper.apply(context, [
    mod.exports,
    extendedRequire,
    mod,
    filename,
    path.dirname(filename),
  ]);

  let result = mod.exports;
  if (isPromise(result)) {
    result = await result;
  } else {
    for (const [key, value] of Object.entries(result)) {
      if (isPromise(value)) {
        result[key] = await value;
      }
    }
  }
  return result;

}
