const store = {};

export function getFirestore(app) {
  return {
    collection: (name) => ({
      doc: (id) => ({
        id: `${name}/${id}`,
        path: `${name}/${id}`,
      }),
      query: (...args) => ({
        where: (field, op, value) => ({
          getDocs: async () => {
            const results = [];
            Object.keys(store).forEach(key => {
              if (key.startsWith(`${name}/`)) {
                results.push({ data: () => store[key], id: key.split('/')[1] });
              }
            });
            return { size: results.length, forEach: (fn) => results.forEach(fn) };
          }
        })
      })
    })
  };
}

export function doc(ref, id) {
  return { id: `${ref.id}/${id}`, path: `${ref.id}/${id}`, data: () => store[`${ref.id}/${id}`] || null };
}

export function getDoc(ref) {
  return {
    exists: () => !!store[ref.path],
    data: () => store[ref.path] || null,
  };
}

export function setDoc(ref, data) {
  store[ref.path] = data;
  return Promise.resolve();
}

export function collection(db, name) {
  return db.collection(name);
}

export function query(col, ...args) {
  return col;
}

export function where(col, field, op, value) {
  return col;
}

export function getDocs(col) {
  return col.getDocs();
}

export function limit(n) {
  return {
    getDocs: async () => {
      const results = [];
      Object.keys(store).forEach(key => {
        results.push({ data: () => store[key], id: key });
      });
      return { size: Math.min(results.length, n), forEach: (fn) => results.slice(0, n).forEach(fn) };
    }
  };
}

export function serverTimestamp() {
  return { _serverTimestamp: true };
}
