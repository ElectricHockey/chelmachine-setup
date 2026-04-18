const db = require('./db');
const fs = require('fs');
const config = global.config;
const util = require('./util');
const { DateTime } = require('luxon');
const cvar = require('./cvar');
const bson = require('bson');
// const ObjectId = require('mongodb').ObjectId;
// const mso = require('./mso');
const seasons = require('./seasons');
const teams = require('./teams');

const init = async function() {
    const client = await db.client();
    // do upgrades / fixes on the db here
    await client.close();
}

module.exports = { init };
