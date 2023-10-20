class AsyncIDB {
    name;
    models;
    version;
    db = null;
    stores = {};
    initialization = undefined;
    constructor(name, models, version) {
        this.name = name;
        this.models = models;
        this.version = version;
        for (const [key, model] of Object.entries(this.models)) {
            this.stores[key] = new AsyncIDBStore(model, this, key);
        }
        this.init();
        window.addEventListener("beforeunload", () => {
            if (this.db)
                this.db.close();
        });
    }
    async init() {
        if (this.initialization)
            return this.initialization;
        this.initialization = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.name, this.version);
            request.onerror = (e) => reject(e);
            request.onsuccess = () => {
                this.db = request.result;
                this.initializeStores(this.db, ...Object.values(this.stores));
                resolve(this);
            };
            request.onupgradeneeded = () => {
                this.db = request.result;
                this.initializeStores(this.db, ...Object.values(this.stores));
                resolve(this);
            };
        });
        return this;
    }
    async restart() {
        if (this.db)
            this.db.close();
        this.db = null;
        this.initialization = undefined;
        return await this.init();
    }
    initializeStores(db, ...stores) {
        for (const store of stores) {
            if (db.objectStoreNames.contains(store.name)) {
                store.store = db.transaction(store.name, "readwrite").objectStore(store.name);
                continue;
            }
            const primaryKeys = Object.keys(store.model.definition).filter((key) => store.model.definition[key].options.primaryKey);
            store.store = db.createObjectStore(store.name, {
                keyPath: primaryKeys.length === 1 ? primaryKeys[0] : primaryKeys,
                autoIncrement: primaryKeys.length === 1,
            });
            const indexes = Object.entries(store.model.definition).filter(([_, val]) => val.options.index);
            for (const [key, val] of indexes) {
                store.store.createIndex(`idx_${key}_${store.name}_${this.name}`, key, {
                    unique: val.options.primaryKey,
                });
            }
        }
    }
}
export class AsyncIDBStore {
    model;
    name;
    store = undefined;
    db;
    constructor(model, db, name) {
        this.model = model;
        this.name = name;
        this.db = db;
    }
    onBefore(evtName, data) {
        const callbacks = this.model.callbacks(`before${evtName}`);
        let cancelled = false;
        for (const callback of callbacks) {
            ;
            callback(data, () => (cancelled = true));
            if (cancelled)
                return false;
        }
        return true;
    }
    onAfter(evtName, data) {
        const callbacks = this.model.callbacks(evtName);
        for (const callback of callbacks) {
            callback(data);
        }
    }
    async getStore() {
        if (this.store)
            return this.store;
        await this.db.init();
        return this.store;
    }
    async create(data) {
        const record = this.model.applyDefaults(data);
        if (!this.onBefore("write", record))
            return;
        const request = (this.store ?? (await this.getStore())).add(record);
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => this.read(request.result).then((data) => {
                this.onAfter("write", data);
                resolve(data);
            });
        });
    }
    async read(id) {
        const request = (this.store ?? (await this.getStore())).get(id);
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => resolve(request.result);
        });
    }
    async update(data) {
        const record = this.model.applyDefaults(data);
        if (!this.onBefore("write", record))
            return;
        const request = (this.store ?? (await this.getStore())).put(record);
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => this.read(request.result).then((data) => {
                this.onAfter("write", data);
                resolve(data);
            });
        });
    }
    async delete(id) {
        const data = await this.read(id);
        if (!this.onBefore("delete", data))
            return;
        const request = (this.store ?? (await this.getStore())).delete(id);
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => {
                this.onAfter("delete", data);
                resolve();
            };
        });
    }
    async clear() {
        const request = (this.store ?? (await this.getStore())).clear();
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => resolve();
        });
    }
    async find(predicate) {
        const request = (this.store ?? (await this.getStore())).openCursor();
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    if (predicate(cursor.value)) {
                        resolve(cursor.value);
                    }
                    cursor.continue();
                }
                else {
                    resolve();
                }
            };
        });
    }
    async findMany(predicate) {
        const request = (this.store ?? (await this.getStore())).openCursor();
        return new Promise((resolve, reject) => {
            const results = [];
            request.onerror = (err) => reject(err);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    if (predicate(cursor.value)) {
                        results.push(cursor.value);
                    }
                    cursor.continue();
                }
                else {
                    resolve(results);
                }
            };
        });
    }
    async all() {
        return this.findMany(() => true);
    }
    async count() {
        const request = (this.store ?? (await this.getStore())).count();
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => resolve(request.result);
        });
    }
    async upsert(...data) {
        return Promise.all(data.map((item) => this.update(item)));
    }
    async max(field) {
        const fieldDef = this.model.definition[field];
        if (!fieldDef)
            throw new Error(`Unknown field ${field}`);
        if (!fieldDef.options.index)
            throw new Error(`Field ${field} is not indexed`);
        const request = (this.store ?? (await this.getStore())).index(field).openCursor(null, "prev");
        return new Promise((resolve, reject) => {
            request.onerror = (err) => reject(err);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    resolve(cursor.key);
                }
                else {
                    resolve(0);
                }
            };
        });
    }
}
export function idb(name, models, version = 1) {
    const db = new AsyncIDB(name, models, version);
    return Object.entries(models).reduce((acc, [key]) => {
        return {
            ...acc,
            [key]: db.stores[key],
        };
    }, {});
}
