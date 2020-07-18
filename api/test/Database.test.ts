import * as sqlite3 from 'sqlite3'
import { Database } from '../src/Database'
import { createMockLogger } from './MockLogger'

jest.mock ('sqlite3')

describe ('Database', () => {

  let instance: Database
  let logger, db, dbCloseFunction, timeoutFunction
  let config = {
    sqlite_db: '/path/to/database/file',
    db_connection_timeout: 1000
  }

  beforeEach (() => {
    logger = createMockLogger ()
    instance = new Database (config, logger)
    dbCloseFunction = jest.fn ()
    timeoutFunction = jest.fn ()
    db = {
      get: jest.fn (),
      run: jest.fn (),
      all: jest.fn (),
      serialize: jest.fn (),
      each: jest.fn (),
      close: dbCloseFunction,
      lastID: 11,
      changes: 22
    }
    Object.defineProperty (instance, 'db', { value: db })
    Object.defineProperty (instance, 'resetTimeout', { value: timeoutFunction })
  })

  it ('should instantiate database object without opening sqlite3 connection', () => {
    expect (instance).toBeInstanceOf (Database)
    expect (sqlite3.verbose).not.toHaveBeenCalled ()
  })

  it ('should create a sqlite3 connection when open() is called and run PRAGMA command', async () => {
    instance = new Database (config, logger)
    Object.defineProperty (instance, 'resetTimeout', { value: timeoutFunction })
    const verboseFunction = jest.fn().mockReturnValue ({ OPEN_READWRITE: 222 })
    Object.defineProperty (sqlite3, 'verbose', { value: verboseFunction })
    const databaseMock = jest.fn((param1, param2, callback) => {
      setTimeout(() => { callback() }, 20)
      db.run = jest.fn ((param1, callbackFunction) => { callbackFunction() })
      return db
    })
    Object.defineProperty(sqlite3, 'Database', { value: databaseMock })
    expect.assertions (7)
    return instance.open ().then (() => {
      expect (timeoutFunction).toHaveBeenCalled ()
      expect (verboseFunction).toHaveBeenCalled ()
      expect (databaseMock).toHaveBeenCalled ()
      expect (databaseMock.mock.calls[0][0]).toEqual ('/path/to/database/file')
      expect (databaseMock.mock.calls[0][1]).toEqual (222)
      expect (db.run).toHaveBeenCalledTimes (1)
      expect (db.run.mock.calls[0][0]).toEqual ('PRAGMA foreign_keys = true')
    })
  })

  it ('should close the database connection automatically after the timeout period has elapsed', done => {
    const testConfig = {
      sqlite_db: '/path/to/database/file',
      db_connection_timeout: 150
    }
    instance = new Database (testConfig, logger)
    const verboseFunction = jest.fn().mockReturnValue ({ OPEN_READWRITE: 2 })
    Object.defineProperty (sqlite3, 'verbose', { value: verboseFunction })
    const databaseMock = jest.fn((param1, param2, callback) => {
      setTimeout(() => { callback() }, 20)
      db.run = jest.fn ((param1, callbackFunction) => { callbackFunction() })
      return db
    })
    Object.defineProperty(sqlite3, 'Database', { value: databaseMock })
    setTimeout (() => {
      const db = Object.getOwnPropertyDescriptor (instance, 'db')
      expect (dbCloseFunction).not.toHaveBeenCalled ()
      expect (db.value).not.toEqual (null)
    }, 75)
    setTimeout (() => {
      const db = Object.getOwnPropertyDescriptor (instance, 'db')
      expect (dbCloseFunction).toHaveBeenCalled ()
      expect (db.value).toEqual (null)
      done()
    }, 200)
    instance.open ()
  })

  it ('should reset timeout and return immediately when open() is called on an already open connection', async () => {
    Object.defineProperty (sqlite3, 'verbose', { value: jest.fn() })
    return instance.open ().then (() => {
      expect (timeoutFunction).toHaveBeenCalled ()
      expect (sqlite3.verbose).not.toHaveBeenCalled ()
    })
  })

  it ('should close sqlite3 connection when close() is called', async () => {
    expect.assertions (2)
    return instance.close ().then (() => {
      expect (dbCloseFunction).toHaveBeenCalled ()
      let db = Object.getOwnPropertyDescriptor (instance, 'db')
      expect (db.value).toEqual (null)
    })
  })

  it ('should run a command or update/insert query against database and log output when run() is called', async () => {
    const sql = 'UPDATE table SET field = 1 WHERE field = 2'
    const runResult = { lastID: undefined, changes: 1 }
    db.run = jest.fn ((param1, param2, callback) => {
      callback.call (runResult)
    })
    const status = await instance.run (sql)
    expect (db.run).toHaveBeenCalledTimes (1)
    expect (db.run.mock.calls[0][0]).toEqual (sql)
    expect (status).toEqual (runResult)
    expect (logger.debug).toHaveBeenCalledTimes (1)
    expect (logger.debug.mock.calls[0][0]).toContain (sql)
  })

  it ('should run a command or update/insert query with params against database and log output when run() is called', async () => {
    const sql = 'INSERT (id, field) INTO table VALUES (?, ?)'
    const params = ['1', 'value']
    const runResult = { lastID: 11, changes: 1 }
    db.run = jest.fn ((param1, param2, callback) => {
      callback.call (runResult)
    })
    const status = await instance.run (sql, params)
    expect (db.run).toHaveBeenCalledTimes (1)
    expect (db.run.mock.calls[0][0]).toBe (sql)
    expect (db.run.mock.calls[0][1]).toBe (params)
    expect (status).toEqual (runResult)
    expect (logger.debug).toHaveBeenCalledTimes (1)
    expect (logger.debug.mock.calls[0][0]).toContain (sql)
  })

  it ('should run a command or update/insert query against database and reject the promise on DB error', async () => {
    const sql = 'PRAGMA invalid'
    db.run = jest.fn ((param1, param2, callback) => { callback ('error') })
    try {
      const row = await instance.run (sql)
    } catch (e) {
      expect (e).toMatch('error');
      expect (db.run).toHaveBeenCalledTimes (1)
      expect (db.run.mock.calls[0][0]).toEqual (sql)
      expect (logger.debug).toHaveBeenCalledTimes (1)
      expect (logger.debug.mock.calls[0][0]).toContain (sql)
    }
  })

  it ('should run single row query against database and log output when get() is called', async () => {
    const sql = 'SELECT * FROM table WHERE field = 1'
    const result = { field: 1 }
    db.get = jest.fn ((param1, param2, callback) => { callback (null, result) })
    const row = await instance.get (sql)
    expect (db.get).toHaveBeenCalledTimes (1)
    expect (db.get.mock.calls[0][0]).toEqual (sql)
    expect (row).toEqual (result)
    expect (logger.debug).toHaveBeenCalledTimes (1)
    expect (logger.debug.mock.calls[0][0]).toContain (sql)
  })

  it ('should run single row query with params against database and log output when get() is called', async () => {
    const sql = 'SELECT * FROM table WHERE field = ?'
    const params = ['1']
    const result = { field: 1 }
    db.get = jest.fn ((param1, param2, callback) => { callback (null, result) })
    const row = await instance.get (sql, params)
    expect (db.get).toHaveBeenCalledTimes (1)
    expect (db.get.mock.calls[0][0]).toBe (sql)
    expect (db.get.mock.calls[0][1]).toBe (params)
    expect (row).toEqual (result)
    expect (logger.debug).toHaveBeenCalledTimes (1)
    expect (logger.debug.mock.calls[0][0]).toContain (sql)
  })

  it ('should run single row query against database and reject the promise on DB error', async () => {
    const sql = 'SELECT * FROM table WHERE field = 1'
    const result = { field: 1 }
    db.get = jest.fn ((param1, param2, callback) => { callback ('error') })
    try {
      const row = await instance.get (sql)
    } catch (e) {
      expect (e).toMatch('error');
      expect (db.get).toHaveBeenCalledTimes (1)
      expect (db.get.mock.calls[0][0]).toEqual (sql)
      expect (logger.debug).toHaveBeenCalledTimes (1)
      expect (logger.debug.mock.calls[0][0]).toContain (sql)
    }
  })

  it ('should run a query against database and log output when all() is called', async () => {
    const sql = 'SELECT * FROM user WHERE name = "Bill"'
    const result = [{ id: 101, name: 'Bill' }, { id: 202, name: 'Bill' }]
    db.all = jest.fn ((param1, param2, callback) => { callback (null, result) })
    const rows = await instance.all (sql)
    expect (db.all).toHaveBeenCalledTimes (1)
    expect (db.all.mock.calls[0][0]).toEqual (sql)
    expect (rows).toEqual (result)
    expect (logger.debug).toHaveBeenCalledTimes (1)
    expect (logger.debug.mock.calls[0][0]).toContain (sql)
  })

  it ('should run single row query with params against database and log output when get() is called', async () => {
    const sql = 'SELECT * FROM user WHERE name = ?'
    const params = ['Bill']
    const result = [{ id: 101, name: 'Bill' }, { id: 202, name: 'Bill' }]
    db.all = jest.fn ((param1, param2, callback) => { callback (null, result) })
    const row = await instance.all (sql, params)
    expect (db.all).toHaveBeenCalledTimes (1)
    expect (db.all.mock.calls[0][0]).toBe (sql)
    expect (db.all.mock.calls[0][1]).toBe (params)
    expect (row).toEqual (result)
    expect (logger.debug).toHaveBeenCalledTimes (1)
    expect (logger.debug.mock.calls[0][0]).toContain (sql)
  })

  it ('should run single row query against database and reject the promise on DB error', async () => {
    const sql = 'SELECT * FROM table WHERE field < 10'
    const result = [{ field: 1 }, { field: 5 }, { field: 9 }]
    db.all = jest.fn ((param1, param2, callback) => { callback ('error') })
    try {
      const row = await instance.all (sql)
    } catch (e) {
      expect (e).toMatch('error');
      expect (db.all).toHaveBeenCalledTimes (1)
      expect (db.all.mock.calls[0][0]).toEqual (sql)
      expect (logger.debug).toHaveBeenCalledTimes (1)
      expect (logger.debug.mock.calls[0][0]).toContain (sql)
    }
  })
})
