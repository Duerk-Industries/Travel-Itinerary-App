"use strict";
var gapSnapshotStore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // app/utils/offlineSnapshotStorage.web.ts
  var offlineSnapshotStorage_web_exports = {};
  __export(offlineSnapshotStorage_web_exports, {
    readAsyncOrThrow: () => readAsyncOrThrow,
    removeAsyncOrThrow: () => removeAsyncOrThrow,
    writeAsyncOrThrow: () => writeAsyncOrThrow
  });
  var DATABASE = "wanderbunnies-private-offline-v1";
  var STORE = "snapshots";
  var opening;
  var open = () => {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("Offline storage is unavailable in this browser."));
        return;
      }
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other WanderBunnies tabs and try again."));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = void 0;
        };
        resolve(db);
      };
    }).catch((error) => {
      opening = void 0;
      throw error;
    });
    return opening;
  };
  var transaction = async (mode, work) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error("Offline storage transaction was interrupted."));
      tx.onerror = () => reject(tx.error || new Error("Offline storage is full or unavailable."));
    });
  };
  var readAsyncOrThrow = async (key) => await transaction("readonly", (store) => store.get(key)) ?? null;
  var writeAsyncOrThrow = async (key, value) => {
    await transaction("readwrite", (store) => store.put(value, key));
  };
  var removeAsyncOrThrow = async (key) => {
    await transaction("readwrite", (store) => store.delete(key));
    localStorage.removeItem(key);
  };
  return __toCommonJS(offlineSnapshotStorage_web_exports);
})();
