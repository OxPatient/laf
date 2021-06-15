import * as vm from 'vm'
import { nanosecond2ms } from '../utils/time'
import { FunctionConsole } from './console'
import { FunctionResult, IncomingContext, RequireFuncType, RuntimeContext } from './types'


const require_func: RequireFuncType = (module): any => {
  // const supported = ['crypto', 'path', 'querystring', 'url', 'lodash', 'moment']
  // if (supported.includes(module)) { return require(module) as any }
  return require(module) as any
}

export class FunctionEngine {
  buildSandbox(incomingCtx: IncomingContext): RuntimeContext {
    const fconsole = new FunctionConsole()

    const _module = {
      exports: {}
    }
    return {
      __context__: incomingCtx.context,
      module: _module,
      exports: _module.exports,
      __runtime_promise: null,
      console: fconsole,
      less: incomingCtx.less,
      require: require_func,
      Buffer: Buffer
    }
  }

  async run(code: string, incomingCtx: IncomingContext): Promise<FunctionResult> {
    // 调用前计时
    const _start_time = process.hrtime.bigint()

    const wrapped = `
      ${code};
      if(exports.main && exports.main instanceof Function) {
        __runtime_promise = exports.main(__context__);
      } else if(main && main instanceof Function) {
        __runtime_promise = main(__context__)
      }
  `

    const sandbox = this.buildSandbox(incomingCtx)
    const contextifiedObject = vm.createContext(sandbox)
    const fconsole = sandbox.console
    try {
      // @ts-ignore
      const funcModule = new vm.SourceTextModule(wrapped, { context: contextifiedObject })
      await funcModule.link(linker)

      await funcModule.evaluate()
      const data = await sandbox.__runtime_promise

      // 函数执行耗时
      const _end_time = process.hrtime.bigint()
      const time_usage = nanosecond2ms(_end_time - _start_time)
      return {
        data,
        logs: fconsole.logs,
        time_usage
      }
    } catch (error) {
      fconsole.log(error.message)
      fconsole.log(error.stack)

      // 函数执行耗时
      const _end_time = process.hrtime.bigint()
      const time_usage = nanosecond2ms(_end_time - _start_time)
      return {
        error: error,
        logs: fconsole.logs,
        time_usage
      }
    }
  }
}

async function linker(specifier, referencingModule) {
  if (specifier === 'foo') {
    // @ts-ignore
    return new vm.SourceTextModule(`
      // The "secret" variable refers to the global variable we added to
      // "contextifiedObject" when creating the context.
      export default secret;
    `, { context: referencingModule.context })
  }
  // if (specifier === 'path') {
  const mod = require(specifier)
  // @ts-ignore
  return new vm.SourceTextModule(
    Object.keys(mod)
      .map((x) => `export const ${x} = import.meta.mod.${x};`)
      .join('\n'),
    {
      initializeImportMeta(meta) {
        meta.mod = mod
      },
      context: referencingModule.context
    }
  )
}