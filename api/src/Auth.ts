import * as crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { Database } from './Database'
import * as Logger from 'bunyan'

/**
 * Auth provides authentication and session management.
 *
 * Authentication uses bearer tokens which are session ids generated upon login.
 * Session storage is server-side local (not compatible w. load-balancing).
 *
 */
export class Auth {

  protected db: Database
  protected logger: Logger
  private sessions
  private config

  constructor (config, db: Database, logger: Logger) {
    this.config = config
    this.db = db
    this.logger = logger
    this.sessions = new Map ()
    // invalidate sessions periodically
    setInterval (this.sessionTimeout.bind (this), 30000)
  }

  /**
   * Hashes a string using the SHA256 algorithm
   *
   * @param password Clear text password
   * @returns hexadecimal hash
   */
  private hash (password: string): string {
    return crypto.createHash ('sha256').update (password).digest ('hex')
  }

  /**
   * Compares (given) clear text password with (stored) hash
   *
   * @param givenPwd Clear text password
   * @param storedPwd Stored hash
   * @returns true if passwords match
   */
  private compare (givenPwd: string, storedPwd: string): boolean {
    if (!storedPwd) {
      return true
    }
    const hashedPwd = this.hash (givenPwd)
    return hashedPwd === storedPwd
  }

  /**
   * Performs an authentication using login credentials and if successful creates a new
   * session. Returns a 200 OK response with user details and token, or 401 otherwise.
   *
   * @param req Express request object
   * @param res Express response object
   * @param next Express next function
   */
  public async login (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('Auth.login()')
    try {
      const sql = `SELECT u.*, first_name || ' ' || last_name AS name FROM user u JOIN person p ON (u.person_id = p.id) WHERE u.is_active > 0 AND u.login = ?`
      const row: any = await this.db.get (sql, [req.body.username || ''])
      if (row) {
        const isVerified = this.compare (req.body.password || '', row.password)
        if (isVerified) {
          res.status (200).json ({
            user_id: row.id,
            username: row.login,
            name: row.name,
            visits: row.visits,
            last_visit: row.last_visit,
            token: this.createSession (row, this.getToken (req))
          })
        } else {
          res.status (401).json ()
        }
      } else {
        res.status (404).json ()
      }
      next ()
    } catch (err) {
      next (err)
    }
  }

  /**
   * Destroys the session that corresponds to the given bearer token.
   *
   * @param req Express request object
   * @param res Express response object
   * @param next Express next function
   */
  public async logout (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('Auth.logout()')
    const token = this.getToken (req)
    if (token && this.sessions.has (token)) {
      this.sessions.delete (token)
      this.logger.debug (`Removed session token ${token}, total = ${this.sessions.size} sessions`)
      res.status (205).json ()
    } else {
      res.status (400).json ()
    }
    next ()
  }

  /**
   * Authenticates a user by comparing the token to the stored tokens. Inserts user's session
   * object into the Express req.params object.
   *
   * @param req Express request object
   */
  public authenticate (req: Request): boolean {
    this.logger.trace ('Auth.authenticate()')
    const token = this.getToken (req)
    if (token) {
      const session = this.sessions.get (token)
      if (session) {
        session.time = Date.now ()
        req.params._user_ = session
        return true
      }
    }
    return false
  }

  /**
   * Get session data of an authenticated user.
   *
   * @param req Express request object
   * @param res Express response object
   * @param next Express next function
   */
  public async session (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('Auth.session()')
    const token = this.getToken (req)
    if (token && this.sessions.has (token)) {
      res.status (200).json (this.sessions.get (token))
    } else {
      res.status (401).json ()
    }
    next ()
  }

  private async updateUserStats (user: any) {
    try {
      const sql = 'UPDATE user SET visits = ?, last_visit = ? WHERE id = ?'
      await this.db.run (sql, [user.visits + 1, this.isoDate (), user.id])
    } catch (err) {
      this.logger.warn ('failed to update user stats: ' + err.message)
    }
  }

  private isoDate = (date = undefined): string => {
    const pad = num => {
      return (num < 10 ? '0' : '') + String (num)
    }
    if (!date) {
      date = new Date ()
    }
    return date.getFullYear () +
      '-' + pad (date.getMonth () + 1) +
      '-' + pad (date.getDate ()) +
      ' ' + pad (date.getHours ()) +
      ':' + pad (date.getMinutes ()) +
      ':' + pad (date.getSeconds ())
  }

  /**
   * Creates a user session. If a matching token is found, the existing session is recycled.
   *
   * @param user User object from DB
   * @param existingToken the bearer token that was provided in the request header
   */
  private createSession (user: any, existingToken: string): string {
    if (existingToken && this.sessions.has (existingToken)) {
      const session = this.sessions.get (existingToken)
      session.time = Date.now ()
      this.logger.debug (`Reused session for user ${user.login}, total = ${this.sessions.size} sessions`)
      return existingToken
    }
    const token = crypto.randomBytes (32).toString ('hex')
    const session = {
      time: Date.now (),
      id: user.id,
      username: user.login,
      name: user.name
    }
    this.sessions.set (token, session)
    this.updateUserStats (user)
    this.logger.debug (`Created session for user ${user.login}, total = ${this.sessions.size} sessions`)
    return token
  }

  private getToken (req: Request): string | undefined {
    if (req.headers.authorization) {
      return String (req.headers.authorization).substr (6).trim ()
    }
    return undefined
  }

  /**
   * Checks whether given user id matches the owner of the token.
   *
   * @param req Express request object
   * @param userId user id
   */
  private userIdMatchesLoggedInUser (req: Request, userId: number): boolean {
    const token = this.getToken (req)
    if (!token || !this.sessions.has (token)) {
      return false
    }
    const session = this.sessions.get (token)
    return session.id == userId
  }

  /**
   * Updates the password of a user.
   *
   * @param req Express request object
   * @param res Express response object
   * @param next Express next function
   */
  public async updatePassword (req: Request, res: Response, next: NextFunction) {
    this.logger.trace ('Auth.updatePassword()')
    try {
      if (!this.userIdMatchesLoggedInUser (req, req.params.id)) {
        throw new Error (`403:User ${req.params.id} cannot change password of another user`)
      }
      let sql = 'SELECT password FROM user WHERE id = ?'
      let result: any = await this.db.get (sql, [req.params.id])
      if (!this.compare (req.body.oldPassword || '', result.password)) {
        throw new Error (`400:Old password of user ${req.params.id} does not match`)
      }
      const password = this.hash (req.body.password)
      sql = 'UPDATE user SET password = ? WHERE id = ?'
      result = await this.db.run (sql, [password, req.params.id])
      res.status (result.changes ? 204 : 500).json ()
      next ()
    } catch (err) {
      next (err)
    }
  }

  /**
   * Periodically checks if any session has timed out and -if yes- removes it.
   */
  private sessionTimeout () {
    const now = Date.now ()
    this.sessions.forEach ((session, token) => {
      if (now - session.time > this.config.session_timeout) {
        this.sessions.delete (token)
        this.logger.debug (`Timed out session with token ${token}, total = ${this.sessions.size} sessions`)
      }
    })
  }
}
