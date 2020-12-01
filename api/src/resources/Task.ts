import { Request, Response, NextFunction } from 'express'
import { SingleTable } from '../SingleTable'
import { Database } from '../Database'
import * as Logger from 'bunyan'

export class Task extends SingleTable {

  constructor (db: Database, logger: Logger) {
    const schema = {
      id: 't.id',
      customer_id: 't.customer_id',
      user_id: 't.user_id',
      parent_id: 't.parent_id',
      name: 't.name',
      description: 't.description',
      is_active: 't.is_active',
      is_closed: 't.is_closed',
      is_leaf: 't.is_leaf',
      created_at: 't.created_at',
      updated_at: 't.updated_at'
    }
    super ('task AS t', schema, db, logger)
  }

  public async list (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('task.list()')
    try {
      let sql, params, whereClause
      if(req.query.format === 'extended') {
        [whereClause, params] = this.sqlGenerator.generateWhereClause (req.query)
        const orderClause = this.sqlGenerator.generateOrderClause (req.query)
        sql = `SELECT t.id, t.parent_id, pt.name AS parent_name, t.name, t.customer_id, c.name AS customer_name, t.is_active, t.created_at, t.is_leaf, t.user_id, SUM(l.duration) AS duration FROM task t LEFT JOIN task pt ON (t.parent_id = pt.id) LEFT JOIN customer c ON (c.id = t.customer_id) LEFT JOIN time_log l ON (l.task_id = t.id) ${whereClause} GROUP BY t.id ${orderClause}`
      } else {
        [whereClause, params] = this.sqlGenerator.generate (req.query)
        sql = `SELECT t.id, t.parent_id, t.name, t.customer_id, c.name AS customer_name FROM task t LEFT JOIN customer c ON (c.id = t.customer_id) ${whereClause}`
      }
      const rows = await this.db.all (sql, params)
      rows ? res.json (rows) : res.status (404).json ()
      next ()
    } catch (err) {
      next (err)
    }
  }

  public async read (req: Request, res: Response, next: NextFunction) {
    this.logger.trace (`task.read(${[req.params.id]})`)
    const sql = `SELECT t.*, c.name AS customer_name, pt.name AS parent_name, p.first_name || ' ' || p.last_name AS user_name FROM task t LEFT JOIN customer c ON (c.id = t.customer_id) LEFT JOIN task pt ON (t.parent_id = pt.id) LEFT JOIN user u ON (t.user_id = u.id) LEFT JOIN person p ON (p.id = u.person_id) WHERE t.id = ?`
    try {
      let row = await this.db.get (sql, [req.params.id])
      row ? res.status (200).json (row) : res.status (404).json ()
      next ()
    }
    catch (err) {
      next (err)
    }
  }

  public async todoList (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('task.todoList()')
    try {
      const orderClause = this.sqlGenerator.generateOrderClause (req.query)
      const sql = `SELECT t.id, t.name, t.user_id, t.created_at, t.is_active, c.name AS customer_name, SUM(l.duration) AS duration FROM task t LEFT JOIN customer c ON (c.id = t.customer_id) LEFT JOIN time_log l ON (l.task_id = t.id) WHERE (t.user_id IS NULL OR t.user_id = ?) AND t.is_leaf = 1 AND t.is_closed = 0 GROUP BY t.id ${orderClause}`
      const rows = await this.db.all (sql, [req.params.userId])
      rows ? res.json (rows) : res.status (404).json ()
      next ()
    } catch (err) {
      next (err)
    }
  }

  public async todoCount (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('task.todoCount()')
    try {
      const sql = `SELECT COUNT(*) AS count FROM task t WHERE (t.user_id IS NULL OR t.user_id = ?) AND t.is_leaf = 1 AND t.is_closed = 0;`
      const row = await this.db.get (sql, [req.params.userId])
      row ? res.status (200).json (row) : res.status (404)
      next ()
    } catch (err) {
      next (err)
    }
  }

  public async projects (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('task.projects()')
    try {
      const [whereClause, params] = this.sqlGenerator.generate (req.query)
      const sql = `SELECT t.* FROM task t ${whereClause}`
      const rows = await this.db.all (sql, params)
      rows ? res.json (rows) : res.status (404).json ()
      next ()
    } catch (err) {
      next (err)
    }
  }

  public async projectList (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('task.projectList()')
    try {
      const orderClause = this.sqlGenerator.generateOrderClause (req.query)
      const sql = `SELECT t.id, t.name, t.customer_id, c.name AS customer_name FROM task t LEFT JOIN customer c ON (c.id = t.customer_id) WHERE (t.user_id IS NULL OR t.user_id = ?) AND t.is_leaf = 0 AND t.is_active = 1 AND t.is_closed = 0 GROUP BY t.id ${orderClause}`
      const rows = await this.db.all (sql, [req.params.userId])
      rows ? res.json (rows) : res.status (404).json ()
      next ()
    } catch (err) {
      next (err)
    }
  }

  private async findDescendants (id: string | number, name: string, type: string | undefined = undefined) {
    const result = []
    const findChildren = async (id: string | number, name: string) => {
      const sql = 'SELECT t.id, t.name, t.is_leaf FROM task t WHERE t.parent_id = ?'
        + (type == 'project' ? ' AND t.is_leaf = 0' : '')
      const rows: any = await this.db.all (sql, [id])
      if (rows) {
        for (let row of rows) {
          if (!(type == 'task' && row.is_leaf == 0)) {
            result.push({id: row.id, parent_id: id, is_leaf: row.is_leaf, path: `${name}/${row.name}`})
          }
          if (row.is_leaf == 0) {
            await findChildren (row.id, `${name}/${row.name}`)
          }
        }
      }
    }
    await findChildren (id, name)
    return result
  }

  public async descendants (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('task.descendants()')
    try {
      const type = req.query.type ? String(req.query.type) : undefined
      const extendedFormat = req.query.format === 'extended'
      let projectName = ''
      if (extendedFormat) {
        const rows: any = await this.db.get (`SELECT t.name FROM task t WHERE t.id = ?`, [req.params.id])
        if (rows && rows.name) {
          projectName = rows.name
        }
      }
      let descendants = await this.findDescendants (req.params.id, projectName, type)
      if (!extendedFormat) {
        descendants = descendants.map (desc => desc.id)
      }
      res.json (descendants)
      next ()
    } catch (err) {
      next (err)
    }
  }

  public async updateDescendants (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('task.updateDescendants()')
    try {
      let status = 400
      const [ names, values ] = this.sqlGenerator.buildParameterList (req.body)
      if (names.length > 0) {
        let descendants = await this.findDescendants (req.params.id, '')
        descendants = descendants.map (desc => desc.id)
        descendants.unshift (req.params.id)
        const sql = `UPDATE task AS t SET ` + this.getUpdateList(names) + ` WHERE t.id IN (${descendants.join (',')})`
        const result: any = await this.db.run (sql, values)
        status = result.changes ? 204 : 404
      }
      res.status (status).json ()
      next ()
    }
    catch (err) {
      next (err)
    }
  }

  public validateCreate (req: Request) {
    if (!req.body.name) {
      throw new Error ('400:Create new task: name is required')
    }
  }
}
