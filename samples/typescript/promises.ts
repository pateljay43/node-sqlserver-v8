import {Error, PoolOptions, Query, SqlClient, QueryDescription, Pool, PoolStatusRecord, Connection, QueryAggregatorResults, ConnectionPromises, BulkTableMgr} from 'msnodesqlv8';

// require the module so it can be used in your node JS code.
export const sql : SqlClient = require('msnodesqlv8');

function getConnection () : string {
  const path = require('path')
  const config = require(path.join(__dirname, '..\\config.json'))
  return config.connection.local
}

async function openSelectClose() {
    try {
        const connStr: string = getConnection()
        const conn: Connection = await sql.promises.open(connStr)
        const res: QueryAggregatorResults = await conn.promises.query('select @@SPID as spid')
        console.log(JSON.stringify(res, null, 4))
        await conn.promises.close()
    } catch (e) {
        console.log(e)
    }
}

async function adhocQuery() {
    try {
        const connStr: string = getConnection()
        const res: QueryAggregatorResults = await sql.promises.query(connStr, 'select @@SPID as spid')
        console.log(`ashoc spid ${res.first[0].spid}`)
    } catch (e) {
        console.log(e)
    }
}

async function pool() {
    try {
        const connStr: string = getConnection()
        const size = 4
        const options: PoolOptions = {
            connectionString: connStr,
            ceiling: size
        }
        const pool: Pool = new sql.Pool(options)
        await pool.promises.open()
        const all = Array(size * 2).fill(0).map((_, i) => pool.promises.query(`select ${i} as i, @@SPID as spid`))
        const promised: QueryAggregatorResults[] = await Promise.all(all)
        const res = promised.map(r => r.first[0].spid)
        await pool.promises.close()
        console.log(`pool spids ${res.join(', ')}`)
    } catch (e) {
        console.log(e)
    }
}

class ProcTest {
    dropProcedureSql: string
    
    constructor (public connStr: string, public def: ProcDef) {
        this.dropProcedureSql = `IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND OBJECT_ID = OBJECT_ID('${def.name}'))
        begin drop PROCEDURE ${def.name} end `
    }

    async create () {
        try {
            const conn: Connection = await sql.promises.open(this.connStr)
            const promises: ConnectionPromises = conn.promises
            await promises.query(this.dropProcedureSql)
            await promises.query(this.def.sql)
            await conn.promises.close()
        } catch (e) {
            console.log(e)
        }
    }

    async drop () {
        try {
            const conn: Connection = await sql.promises.open(this.connStr)
            const promises: ConnectionPromises = conn.promises
            await promises.query(this.dropProcedureSql)
            await conn.promises.close()
        } catch (e) {
            console.log(e)
        }
    }
}

interface ProcDef {
    name: string,
    sql: string
}

const sampleProc: ProcDef = {
    name: 'sp_test',
    sql: `create PROCEDURE sp_test @param VARCHAR(50) 
    AS 
    BEGIN 
    RETURN LEN(@param); 
    END 
    `
}

async function adhocProc() {
    try {
        const connStr: string = getConnection()
        const proc = new ProcTest(connStr, sampleProc)
        await proc.create()    
        const msg = 'hello world'
        const res: QueryAggregatorResults = await sql.promises.callProc(connStr, sampleProc.name, {
            param: msg
        })        
        await proc.drop()
        console.log(`adhocProc returns ${res.returns} from param '${msg}''`)
    } catch (e) {
        console.log(e)
    }
}

async function proc() {
    try {
        const connStr: string = getConnection()
        const proc = new ProcTest(connStr, sampleProc)
        await proc.create()    
        const conn: Connection = await sql.promises.open(connStr)
        const promises: ConnectionPromises = conn.promises
        const msg = 'hello world'
        const res: QueryAggregatorResults = await promises.callProc(sampleProc.name, {
            param: msg
        })
       
        console.log(`proc returns ${res.returns} from param '${msg}''`)
        await proc.drop()
        await promises.close()
    } catch (e) {
        console.log(e)
    }
}

function getInsertVec (rows: number): any[] {
    const testDate = new Date('Mon Apr 26 2021 22:05:38 GMT-0500 (Central Daylight Time)')
      const expected = []
      for (let i = 0; i < rows; ++i) {
        expected.push({
          id: i,
          d1: testDate,
          s1: `${i}`,
          s2: `testing${i + 1}2Data`,
          s3: `testing${i + 2}2Data`,
          s4: `testing${i + 3}2Data`
        })
      }
      return expected
}

async function table() {
    const TableDef: TableDef = {
        tableName: 'test_table_bulk',
        columns: [
          {
            name: 'id',
            type: 'INT PRIMARY KEY'
          },
          {
            name: 'd1',
            type: 'datetime'
          },
          {
            name: 's1',
            type: 'VARCHAR (255) NOT NULL'
          },
          {
            name: 's2',
            type: 'VARCHAR (100) NOT NULL'
          },
          {
            name: 's3',
            type: 'VARCHAR (50) NOT NULL'
          },
          {
            name: 's4',
            type: 'VARCHAR (50) NOT NULL'
          }
        ]
      }

      try {
        const connStr: string = getConnection()
        const connection = await sql.promises.open(connStr)
        const tm: BulkTableTest = new BulkTableTest(connection, TableDef)
        const table: BulkTableMgr = await tm.create()
        const vec = getInsertVec(10)
        console.log(`table = ${tm.createTableSql}`)
        await table.promises.insert(vec)
        const read = await connection.promises.query(tm.selectSql)
        console.log(`table ${read.first.length} rows from ${tm.tableName}`)
        console.log(JSON.stringify(read.first, null, 4))
        await tm.drop()
        await connection.promises.close()
       } catch (e) {
        console.log(e)
      }
}

async function run() {
    await openSelectClose()
    await proc()
    await adhocProc()
    await adhocQuery()
    await pool()
    await table()
}

run().then(() => {
    console.log('finished')
})

interface TableColumn {
    name: string
    type: string
}

interface TableDef {
    tableName: string
    columns: TableColumn[]
}

class BulkTableTest {
    dropTableSql: string
    createTableSql: string
    clusteredSql: string
    selectSql: string 
    insertSql: string
    truncateSql: string
    tableName: string
    paramsSql: string
    insertParamsSql:string
    
    constructor (public theConnection: Connection, public definition: TableDef) {
      const tableName = definition.tableName
      const columns = definition.columns.map(e => `${e.name} ${e.type}`).join(', ')
      const insertColumnNames = definition.columns.filter((c: TableColumn) => {
        const res = !c.type.includes('identity')
        return res
      }).map(e => `${e.name}`).join(', ')

      const columnNames = definition.columns.map(e => `${e.name}`).join(', ')
      this.dropTableSql = `IF OBJECT_ID('${tableName}', 'U') IS NOT NULL DROP TABLE ${tableName};`
      this.createTableSql = `CREATE TABLE ${tableName} (${columns})`
      this.clusteredSql = `CREATE CLUSTERED INDEX IX_${tableName} ON ${tableName}(id)`
      this.insertSql = `INSERT INTO ${tableName} (${insertColumnNames}) VALUES `
      this.selectSql = `SELECT ${columnNames} FROM ${tableName}`
      this.truncateSql = `TRUNCATE TABLE ${tableName}`
      this.paramsSql = `(${definition.columns.map(_ => '?').join(', ')})`
      this.insertParamsSql = `${this.insertSql} ${this.paramsSql}`
      this.tableName = tableName
    }

    async drop () {
        await this.theConnection.promises.query(this.dropTableSql)
    }

    async create () {
      const promises = this.theConnection.promises
      await promises.query(this.dropTableSql)
      await promises.query(this.createTableSql)
      const table = await promises.getTable(this.tableName)
      return table
    }
  }
