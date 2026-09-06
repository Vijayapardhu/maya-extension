global.chrome = {
  storage: {
    local: {
      get: (keys, callback) => {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { result[k] = undefined; });
        } else if (keys && typeof keys === 'object') {
          Object.keys(keys).forEach(k => { result[k] = keys[k]; });
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: (items, callback) => {
        if (callback) callback();
        return Promise.resolve();
      },
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
    onChanged: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
  runtime: {
    sendMessage: (message, callback) => {
      if (callback) callback({ ok: false, error: 'mocked' });
      return Promise.resolve({ ok: false, error: 'mocked' });
    },
    onMessage: {
      addListener: () => {},
      removeListener: () => {},
    },
    getURL: (path) => `chrome-extension://test/${path}`,
  },
  cookies: {
    getAll: (details, callback) => {
      callback([]);
      return Promise.resolve([]);
    },
  },
};
