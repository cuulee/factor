import { log } from "@factor/tools"
import { pushToFilter } from "@factor/tools/filters"
import { writeConfig } from "@factor/cli/setup"
import mongoose from "mongoose"
import { getAddedSchemas } from "./util"

let __schemas = {}
let __models = {}
let __offline = false

export function dbIsOffline() {
  return __offline || !process.env.DB_CONNECTION ? true : false
}

// Must be non-async so we can use chaining
export function getModel(name) {
  // If model doesn't exist, create a vanilla one
  if (!__models[name] && name != "post") setModel({ name }, getModel("post"))

  return __models[name]
}

// export function getSchema(name) {
//   return __schemas[name] || null
// }

export async function dbInitialize() {
  await dbConnect()

  if (process.env.FACTOR_DEBUG == "yes") mongoose.set("debug", true)
  mongoose.plugin(require("mongoose-beautiful-unique-validation"))
  initializeModels()
}

function initializeModels() {
  __schemas = {}
  __models = {}

  const sch = getAddedSchemas()

  const baseSchema = sch.find(_ => _.name == "post")

  const { model: baseModel } = setModel(baseSchema)

  sch.filter(s => s.name != "post").forEach(s => setModel(s, baseModel))
}

// Set schemas and models
// For server restarting we need to inherit from already constructed mdb models if they exist
export function setModel(schemaConfig, baseModel?: any) {
  const { Schema, modelSchemas, models, model } = mongoose
  const { schema = {}, options = {}, callback, name } = schemaConfig

  let _model_
  let _schema_

  // If already set in mongoose
  if (models[name]) {
    _schema_ = modelSchemas[name]
    _model_ = models[name]
  } else {
    _schema_ = new Schema(schema, options)

    // Callback for hooks, etc.
    if (callback) callback(_schema_)

    _model_ = !baseModel ? model(name, _schema_) : baseModel.discriminator(name, _schema_)

    _model_.createIndexes()
  }

  __schemas[name] = _schema_
  __models[name] = _model_

  return { schema: _schema_, model: _model_ }
}

export async function dbDisconnect() {
  if (isConnected()) {
    await mongoose.connection.close()
  }
}

export async function dbConnect() {
  if (!isConnected()) {
    try {
      const connectionString = process.env.DB_CONNECTION

      const result = await mongoose.connect(connectionString, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      })

      __offline = false

      return result
    } catch (error) {
      dbHandleError(error)
    }
  }
}

function dbHandleError(error) {
  if (error.code === "ECONNREFUSED") {
    __offline = true
    log.warn("Couldn't connect to the database. Serving in offline mode.")
  } else if (
    dbReadyState() == "connecting" &&
    error.code == "EDESTRUCTION" &&
    !process.env.FACTOR_DEBUG
  ) {
    // TODO not sure the exact context/meaning of this error
    // do nothing, this occurs in offline mode on server restart
  } else {
    log.error(error)
  }
}

export function isConnected() {
  return ["connected"].includes(dbReadyState())
}

export function dbReadyState() {
  const states = ["disconnected", "connected", "connecting", "disconnecting"]

  return states[mongoose.connection.readyState]
}

export function dbSetupUtility() {
  // ADD CLI
  if (!process.env.DB_CONNECTION) {
    pushToFilter("setup-needed", {
      title: "DB Connection",
      value: "Needed for auth, users, posts, dashboard, etc...",
      location: ".env / DB_CONNECTION"
    })

    return
  }

  pushToFilter("cli-add-setup", () => {
    return {
      name: "DB Connection - Add/edit the connection string for MongoDB",
      value: "db",
      callback: async ({ inquirer }) => {
        const questions = [
          {
            name: "connection",
            message: "What's your MongoDB connection string? (mongodb://...)",
            type: "input",
            default: process.env.DB_CONNECTION
          }
        ]

        const { connection } = await inquirer.prompt(questions)

        await writeConfig(".env", { DB_CONNECTION: connection })
      }
    }
  })
}