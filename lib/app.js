const SQLite3Provider = require('./database/providers/sqlite3provider')
const MySQLProvider = require('./database/providers/mysqlprovider')

const PingController = require('./ping')
const Server = require('./server')
const { TimeTracker } = require('./time')
const MessageOf = require('./message')

const config = require('../config')
const minecraftVersions = require('../minecraft_versions')
const PORT = process.env.PORT || config.site.port

class App {
  serverRegistrations = []

  constructor () {
    this.pingController = new PingController(this)
    this.server = new Server(this)
    this.timeTracker = new TimeTracker(this)
  }

  loadDatabase (callback) {
    let provider = config["data-provider"]
    switch (provider) {
      case "sqlite3":
        this.database = new SQLite3Provider(this)
        break;
      case "mysql":
        this.database = new MySQLProvider(this)
        break;

      default:
        throw new Error('Unsupported type for data provider: ' + provider)
    }

    // Setup database instance
    this.database.initDB(() => {
      this.database.ensureIndexes(() => {
        this.database.loadGraphPoints(config.graphDuration, () => {
          this.database.loadRecords(() => {
            if (config.oldPingsCleanup && config.oldPingsCleanup.enabled) {
              this.database.initOldPingsDelete(callback)
            } else {
              callback()
            }
          })
        })
      })
    })
  }

  async handleReady () {
    this.server.listen(config.site.ip, PORT)

    // Allow individual modules to manage their own task scheduling
    while (true) {
      await this.pingController.schedule()
    }
  }

  handleClientConnection = (client) => {
    if (config.logToDatabase) {
      client.on('message', (message) => {
        if (message === 'requestHistoryGraph') {
          // Send historical graphData built from all serverRegistrations
          const graphData = this.serverRegistrations.map(serverRegistration => serverRegistration.graphData)

          // Send graphData in object wrapper to avoid needing to explicity filter
          // any header data being appended by #MessageOf since the graph data is fed
          // directly into the graphing system
          client.send(MessageOf('historyGraph', {
            timestamps: this.timeTracker.getGraphPoints(),
            graphData
          }))
        }
      })
    }

    const initMessage = {
      config: (() => {
        // Remap minecraftVersion entries into name values
        const minecraftVersionNames = {}
        Object.keys(minecraftVersions).forEach(function (key) {
          minecraftVersionNames[key] = minecraftVersions[key].map(version => version.name)
        })

        // Send configuration data for rendering the page
        return {
          graphDurationLabel: config.graphDurationLabel || (Math.floor(config.graphDuration / (60 * 60 * 1000)) + 'h'),
          graphMaxLength: TimeTracker.getMaxGraphDataLength(),
          serverGraphMaxLength: TimeTracker.getMaxServerGraphDataLength(),
          servers: this.serverRegistrations.map(serverRegistration => serverRegistration.getPublicData()),
          minecraftVersions: minecraftVersionNames,
          isGraphVisible: config.logToDatabase
        }
      })(),
      timestampPoints: this.timeTracker.getServerGraphPoints(),
      servers: this.serverRegistrations.map(serverRegistration => serverRegistration.getPingHistory())
    }

    client.send(MessageOf('init', initMessage))
  }
}

module.exports = App
