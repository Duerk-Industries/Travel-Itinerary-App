/// <reference types="jest" />
/// <reference types="node" />
import { newQuickJSWASMModule, newQuickJSAsyncWASMModule, DEBUG_SYNC, TestQuickJSWASMModule, Scope } from "quickjs-emscripten";

describe("QuickJS Memory Optimization", () => {
  it("ensures no memory leaks with DEBUG_SYNC build", async () => {
    // Initialize the debug build which contains the leak sanitizer
    const wasmModule = await newQuickJSWASMModule(DEBUG_SYNC);
    const QuickJS = new TestQuickJSWASMModule(wasmModule);
    
    Scope.withScope((scope) => {
      const vm = scope.manage(QuickJS.newContext());
      
      // Example usage: Create a string and set it on the global object
      vm.newString("world").consume((world) => vm.setProp(vm.global, "NAME", world));

      // Evaluate code and immediately dispose the result handle
      vm.unwrapResult(vm.evalCode(`"Hello " + NAME + "!"`)).consume(() => {});
    });

    // Assert that all memory allocated by QuickJS has been freed
    QuickJS.assertNoMemoryAllocated();
  });

  it("uses vm.newPromise() and runtime.executePendingJobs() for async operations", async () => {
    const wasmModule = await newQuickJSWASMModule(DEBUG_SYNC);
    const QuickJS = new TestQuickJSWASMModule(wasmModule);

    Scope.withScope((scope) => {
      const vm = scope.manage(QuickJS.newContext());

      // Simulate an async operation using a Promise
      const deferred = scope.manage(vm.newPromise());
      
      // Expose a function that returns the promise
      const asyncFn = scope.manage(vm.newFunction("fetchData", () => {
        return deferred.handle;
      }));
      vm.setProp(vm.global, "fetchData", asyncFn);

      // Evaluate code that awaits the promise
      vm.unwrapResult(vm.evalCode(`
        var result = null;
        fetchData().then((data) => { result = data + " processed"; });
      `)).consume(() => {});

      // Resolve the promise and execute pending jobs
      vm.newString("raw data").consume((str) => deferred.resolve(str));
      vm.runtime.executePendingJobs();

      // Verify the result
      const resultHandle = scope.manage(vm.getProp(vm.global, "result"));
      const result = vm.getString(resultHandle);
      
      if (result !== "raw data processed") {
        throw new Error(`Expected 'raw data processed', got '${result}'`);
      }
    });

    QuickJS.assertNoMemoryAllocated();
  });

  it("uses a single top-level async module when Asyncify is necessary", async () => {
    // If Asyncify is necessary (e.g. for suspending execution), use a shared top-level module
    // to avoid the overhead of creating a new WASM module for every context.
    const asyncModule = await newQuickJSAsyncWASMModule();

    await Scope.withScopeAsync(async (scope) => {
      const vm = scope.manage(asyncModule.newContext());

      // Use evalCodeAsync which requires the Asyncify build
      const result = await vm.evalCodeAsync(`1 + 1`);
      const handle = scope.manage(vm.unwrapResult(result));
      const value = vm.getNumber(handle);

      if (value !== 2) {
        throw new Error(`Expected 2, got ${value}`);
      }
    });
  });
});
